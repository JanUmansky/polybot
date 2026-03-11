import WebSocket from 'ws';
import config from './config.js';
import { createLogger } from './logger.js';

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;
const STALE_TIMEOUT_MS = 15_000;

const logger = createLogger('BinanceWs');

let ws = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let intentionalClose = false;
let nextId = 1;
let staleTimer = null;
let lastActivityTs = 0;

const subscriptions = new Map();

function resetStaleTimer() {
  lastActivityTs = Date.now();
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(onStale, STALE_TIMEOUT_MS);
}

function clearStaleTimer() {
  if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
}

function onStale() {
  const silentSec = ((Date.now() - lastActivityTs) / 1000).toFixed(0);
  logger.warn(`No data received for ${silentSec}s — forcing reconnect`);
  clearStaleTimer();
  if (ws) {
    try { ws.terminate(); } catch {}
    ws = null;
  }
  scheduleReconnect();
}

function streamName(symbol, interval) {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

function connect() {
  intentionalClose = false;
  const url = `${config.binance.wsUrl}/ws`;
  logger.info(`Connecting to ${url}`);

  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('WebSocket connected');
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    resetStaleTimer();
    resubscribeAll();
  });

  ws.on('ping', (data) => {
    resetStaleTimer();
    ws.pong(data);
  });

  ws.on('message', (raw) => {
    resetStaleTimer();

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.result !== undefined || msg.id) return;

    if (msg.e !== 'kline') return;
    const k = msg.k;
    const stream = streamName(k.s.toLowerCase(), k.i);

    const listeners = subscriptions.get(stream);
    if (!listeners) return;

    for (const { onLivePrice, onCandle } of listeners.values()) {
      onLivePrice?.(parseFloat(k.c), k);
      if (k.x) onCandle?.(k);
    }
  });

  ws.on('error', (err) => {
    logger.error(`WebSocket error: ${err.message}`);
  });

  ws.on('close', (code, reason) => {
    clearStaleTimer();
    logger.warn(`WebSocket closed (${code}). ${reason || ''}`);
    if (!intentionalClose) scheduleReconnect();
  });
}

function resubscribeAll() {
  const streams = [...subscriptions.keys()];
  if (streams.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    method: 'SUBSCRIBE',
    params: streams,
    id: nextId++,
  }));
  logger.info(`Re-subscribed to ${streams.length} stream(s)`);
}

function scheduleReconnect() {
  logger.info(`Reconnecting in ${(reconnectDelay / 1000).toFixed(1)}s...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

export function initBinanceWs() {
  if (ws) return;
  connect();
}

export function closeBinanceWs() {
  intentionalClose = true;
  clearStaleTimer();
  ws?.close();
  ws = null;
}

export function subscribeBinance(symbol, interval, callbacks) {
  const stream = streamName(symbol, interval);
  const subId = nextId++;

  if (!subscriptions.has(stream)) {
    subscriptions.set(stream, new Map());

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [stream],
        id: nextId++,
      }));
    }
  }

  subscriptions.get(stream).set(subId, callbacks);
  logger.info(`Subscribed to ${stream} (sub#${subId})`);

  return function unsubscribe() {
    const listeners = subscriptions.get(stream);
    if (!listeners) return;

    listeners.delete(subId);
    logger.info(`Unsubscribed sub#${subId} from ${stream}`);

    if (listeners.size === 0) {
      subscriptions.delete(stream);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          method: 'UNSUBSCRIBE',
          params: [stream],
          id: nextId++,
        }));
      }
    }
  };
}
