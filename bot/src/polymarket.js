import WebSocket from 'ws';
import config from './config.js';
import { createLogger } from './logger.js';

const { polymarket: pm } = config;
const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 2_000;
const FIVE_MIN = 300;
const INTERVAL_SECS = parseIntervalSecs(config.binance.interval);

const logger = createLogger('PolymarketWs');

let ws = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let intentionalClose = false;
let pingTimer = null;
let connected = false;

const marketSubs = new Map();
const newMarketListeners = new Set();

function connect() {
  logger.info('[PM] Connecting to WebSocket...');
  ws = new WebSocket(pm.wsUrl);

  ws.on('open', () => {
    logger.info('[PM] WebSocket connected');
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    connected = true;
    initialSubscriptionSent = false;
    resubscribeAll();
    startPing();
  });

  ws.on('message', (raw) => {
    const text = raw.toString();
    if (text === 'PONG') return;

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    dispatch(msg);
  });

  ws.on('error', (err) => {
    logger.error(`[PM] WebSocket error: ${err.message}`);
  });

  ws.on('close', (code, reason) => {
    connected = false;
    stopPing();
    logger.warn(`[PM] WebSocket closed (${code}). ${reason || ''}`);
    if (!intentionalClose) scheduleReconnect();
  });
}

function dispatch(msg) {
  if (Array.isArray(msg)) {
    for (const m of msg) dispatch(m);
    return;
  }

  for (const sub of marketSubs.values()) {
    const { market, callbacks } = sub;

    switch (msg.event_type) {
      case 'book':
        callbacks.onBook?.(msg, market);
        break;

      case 'price_change':
        callbacks.onPriceChange?.(msg, market);
        break;

      case 'last_trade_price':
        callbacks.onTrade?.(msg, market);
        break;

      case 'market_resolved': {
        const msgAssets = msg.assets_ids;
        const isOurs = !msgAssets || market.assetIds.some(id => msgAssets.includes(id));
        if (isOurs) {
          sub.resolved = true;
          logger.info(`[PM] Market resolved: ${msg.winning_outcome} (${market.slug})`);
          callbacks.onMarketResolved?.(msg, market);
        }
        break;
      }

      case 'best_bid_ask':
        callbacks.onPriceChange?.({ ...msg, event_type: 'best_bid_ask' }, market);
        break;
    }
  }

  if (msg.event_type === 'new_market') {
    for (const listener of newMarketListeners) {
      try { listener(msg); } catch (err) {
        logger.error(`[PM] new_market listener error: ${err.message}`);
      }
    }
  }
}

function resubscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const allAssetIds = [];
  for (const { market } of marketSubs.values()) {
    allAssetIds.push(...market.assetIds);
  }
  if (allAssetIds.length === 0) return;

  ws.send(JSON.stringify({
    type: 'market',
    assets_ids: allAssetIds,
    initial_dump: true,
    custom_feature_enabled: true,
  }));
  initialSubscriptionSent = true;
  logger.info(`[PM] Re-subscribed to ${marketSubs.size} market(s)`);
}

let initialSubscriptionSent = false;

function sendSubscribe(assetIds) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !connected) return;

  if (!initialSubscriptionSent) {
    ws.send(JSON.stringify({
      type: 'market',
      assets_ids: assetIds,
      initial_dump: true,
      custom_feature_enabled: true,
    }));
    initialSubscriptionSent = true;
  } else {
    ws.send(JSON.stringify({
      operation: 'subscribe',
      assets_ids: assetIds,
      custom_feature_enabled: true,
    }));
  }
}

function sendUnsubscribe(assetIds) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    operation: 'unsubscribe',
    assets_ids: assetIds,
  }));
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send('PING');
  }, pm.pingIntervalMs);
}

function stopPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function scheduleReconnect() {
  logger.info(`[PM] Reconnecting in ${(reconnectDelay / 1000).toFixed(1)}s...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

// ── Public API ──────────────────────────────────────────────────────

export function initPolymarketWs() {
  if (ws) return;
  connect();
}

export function closePolymarketWs() {
  intentionalClose = true;
  stopPing();
  ws?.close();
  ws = null;
}

export function onNewMarket(listener) {
  newMarketListeners.add(listener);
  return () => newMarketListeners.delete(listener);
}

export function subscribePolymarket(market, callbacks) {
  const slug = market.slug;

  marketSubs.set(slug, { market, callbacks, resolved: false });
  sendSubscribe(market.assetIds);
  logger.info(`[PM] Subscribed to "${market.question}"`);

  return function unsubscribe() {
    if (!marketSubs.has(slug)) return;
    sendUnsubscribe(market.assetIds);
    marketSubs.delete(slug);
    logger.info(`[PM] Unsubscribed from "${market.question}"`);
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseIntervalSecs(interval) {
  const units = { m: 60, h: 3600, d: 86400 };
  const match = interval.match(/^(\d+)([mhd])$/);
  if (!match) throw new Error(`Cannot parse interval: ${interval}`);
  return parseInt(match[1], 10) * units[match[2]];
}

function parseMarketTimes(slug) {
  const parts = slug.split('-');
  const epoch = parseInt(parts[parts.length - 1], 10);
  if (!epoch || isNaN(epoch)) return { startTime: null, endTime: null };
  return {
    startTime: new Date(epoch * 1000),
    endTime: new Date((epoch + INTERVAL_SECS) * 1000),
  };
}

// ── Market discovery helpers (used by orchestrator) ─────────────────

export function currentWindowSlug() {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / FIVE_MIN) * FIVE_MIN;
  return `btc-updown-5m-${windowStart}`;
}

export async function fetchLiveMarket() {
  const slug = currentWindowSlug();

  try {
    const res = await fetch(`${pm.gammaApiUrl}/markets?slug=${slug}&limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const markets = await res.json();
    const market = markets[0];
    if (!market || market.slug !== slug) return null;

    const tokenIds = JSON.parse(market.clobTokenIds);
    const outcomes = JSON.parse(market.outcomes);
    const prices = JSON.parse(market.outcomePrices);
    const { startTime, endTime } = parseMarketTimes(market.slug);

    return {
      question: market.question,
      slug: market.slug,
      conditionId: market.conditionId,
      assetIds: tokenIds,
      outcomes,
      prices: prices.map(Number),
      endDate: market.endDate,
      startTime,
      endTime,
    };
  } catch {
    return null;
  }
}

export async function fetchMarketBySlug(slug) {
  try {
    const res = await fetch(`${pm.gammaApiUrl}/markets?slug=${slug}&limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const markets = await res.json();
    const market = markets[0];
    if (!market || market.slug !== slug) return null;

    const tokenIds = JSON.parse(market.clobTokenIds);
    const outcomes = JSON.parse(market.outcomes);
    const prices = JSON.parse(market.outcomePrices);
    const { startTime, endTime } = parseMarketTimes(market.slug);

    return {
      question: market.question,
      slug: market.slug,
      conditionId: market.conditionId,
      assetIds: tokenIds,
      outcomes,
      prices: prices.map(Number),
      endDate: market.endDate,
      resolved: market.resolved ?? false,
      winningOutcome: market.winningOutcome ?? null,
      startTime,
      endTime,
    };
  } catch {
    return null;
  }
}

export function parseNewMarketEvent(msg) {
  if (!msg || msg.event_type !== 'new_market') return null;
  const { startTime, endTime } = parseMarketTimes(msg.slug);
  return {
    question: msg.question,
    slug: msg.slug,
    conditionId: msg.market,
    assetIds: msg.assets_ids,
    outcomes: msg.outcomes,
    prices: null,
    endDate: null,
    startTime,
    endTime,
  };
}
