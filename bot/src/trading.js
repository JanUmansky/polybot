import { Wallet } from 'ethers';
import WebSocket from 'ws';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { createLogger } from './logger.js';
import { updateOrderFill } from './db.js';
import config from './config.js';

const logger = createLogger('Trading');

const HOST = 'https://clob.polymarket.com';
const USER_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user';
const CHAIN_ID = 137;

let client = null;
let apiCreds = null;
let heartbeatTimer = null;
let heartbeatId = '';
const activeOrderIds = new Set();

// ethers v6 uses `signTypedData` but the CLOB client expects the v5 interface
// (`_signTypedData` + `getAddress`). This wrapper bridges the two.
function wrapSignerForClob(ethersV6Wallet) {
  return {
    _signTypedData(domain, types, value) {
      return ethersV6Wallet.signTypedData(domain, types, value);
    },
    getAddress() {
      return Promise.resolve(ethersV6Wallet.address);
    },
  };
}

// ── Initialization ──────────────────────────────────────────────────

export async function initTradingClient() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');

  const wallet = new Wallet(pk);
  const signer = wrapSignerForClob(wallet);

  logger.info('Deriving API credentials...');
  const tempClient = new ClobClient(HOST, CHAIN_ID, signer);

  let creds = await tempClient.deriveApiKey();
  if (!creds?.key) {
    creds = await tempClient.createApiKey();
  }
  if (!creds?.key) {
    throw new Error('Failed to obtain API credentials — both derive and create returned empty keys');
  }
  apiCreds = creds;

  const funder = process.env.POLY_FUNDER;
  if (!funder) throw new Error('POLY_FUNDER not set — set it to your Polymarket proxy wallet address (shown on your profile page)');
  client = new ClobClient(HOST, CHAIN_ID, signer, creds, 1, funder);

  logger.info(`Trading client initialized (${wallet.address})`);
  return client;
}

export function getClient() {
  if (!client) throw new Error('Trading client not initialized — call initTradingClient() first');
  return client;
}

// ── Market helpers ──────────────────────────────────────────────────

export async function getTickSize(tokenId) {
  return getClient().getTickSize(tokenId);
}

export async function getNegRisk(tokenId) {
  return getClient().getNegRisk(tokenId);
}

export async function getOrderBook(tokenId) {
  return getClient().getOrderBook(tokenId);
}

export async function getMidpoint(tokenId) {
  return getClient().getMidpoint(tokenId);
}

export async function getPrice(tokenId, side) {
  return getClient().getPrice(tokenId, side);
}

export async function getSpread(tokenId) {
  return getClient().getSpread(tokenId);
}

// ── Balance & allowance ─────────────────────────────────────────────

export async function getBalanceAllowance(params) {
  return getClient().getBalanceAllowance(params);
}

// ── Limit orders ────────────────────────────────────────────────────

export async function buyLimit({ tokenId, price, size, tickSize, negRisk = false }) {
  logger.info(`Placing BUY limit: token=${tokenId} price=${price} size=${size}`);
  const resp = await getClient().createAndPostOrder(
    { tokenID: tokenId, price, size, side: Side.BUY },
    { tickSize, negRisk },
    OrderType.GTC,
  );
  logger.info(`Order response: id=${resp.orderID} status=${resp.status}`);
  return resp;
}

export async function sellLimit({ tokenId, price, size, tickSize, negRisk = false }) {
  logger.info(`Placing SELL limit: token=${tokenId} price=${price} size=${size}`);
  const resp = await getClient().createAndPostOrder(
    { tokenID: tokenId, price, size, side: Side.SELL },
    { tickSize, negRisk },
    OrderType.GTC,
  );
  logger.info(`Order response: id=${resp.orderID} status=${resp.status}`);
  return resp;
}

// ── GTD (auto-expiring) orders ──────────────────────────────────────

export async function buyGtd({ tokenId, price, size, durationSecs, expiration, tickSize, negRisk = false }) {
  const exp = expiration ?? Math.floor(Date.now() / 1000) + 60 + durationSecs;
  const expiresIn = exp - Math.floor(Date.now() / 1000);
  logger.info(`Placing BUY GTD: token=${tokenId} price=${price} size=${size} expires in ${expiresIn}s`);
  const resp = await getClient().createAndPostOrder(
    { tokenID: tokenId, price, size, side: Side.BUY, expiration: exp },
    { tickSize, negRisk },
    OrderType.GTD,
  );
  logger.info(`Order response: id=${resp.orderID} status=${resp.status}`);
  return resp;
}

export async function sellGtd({ tokenId, price, size, durationSecs, expiration, tickSize, negRisk = false }) {
  const exp = expiration ?? Math.floor(Date.now() / 1000) + 60 + durationSecs;
  const expiresIn = exp - Math.floor(Date.now() / 1000);
  logger.info(`Placing SELL GTD: token=${tokenId} price=${price} size=${size} expires in ${expiresIn}s`);
  const resp = await getClient().createAndPostOrder(
    { tokenID: tokenId, price, size, side: Side.SELL, expiration: exp },
    { tickSize, negRisk },
    OrderType.GTD,
  );
  logger.info(`Order response: id=${resp.orderID} status=${resp.status}`);
  return resp;
}

// ── Market orders (FOK / FAK) ───────────────────────────────────────

export async function buyMarket({ tokenId, amount, worstPrice, tickSize, negRisk = false, fillType = 'FOK' }) {
  const orderType = fillType === 'FAK' ? OrderType.FAK : OrderType.FOK;
  logger.info(`Placing BUY market (${fillType}): token=${tokenId} amount=$${amount} worst=${worstPrice}`);
  const resp = await getClient().createAndPostMarketOrder(
    { tokenID: tokenId, side: Side.BUY, amount, price: worstPrice },
    { tickSize, negRisk },
    orderType,
  );
  logger.info(`Market order response: id=${resp.orderID} status=${resp.status}`);
  return resp;
}

export async function sellMarket({ tokenId, amount, worstPrice, tickSize, negRisk = false, fillType = 'FOK' }) {
  const orderType = fillType === 'FAK' ? OrderType.FAK : OrderType.FOK;
  logger.info(`Placing SELL market (${fillType}): token=${tokenId} shares=${amount} worst=${worstPrice}`);
  const resp = await getClient().createAndPostMarketOrder(
    { tokenID: tokenId, side: Side.SELL, amount, price: worstPrice },
    { tickSize, negRisk },
    orderType,
  );
  logger.info(`Market order response: id=${resp.orderID} status=${resp.status}`);
  return resp;
}

// ── Order management ────────────────────────────────────────────────

export async function getOpenOrders(params) {
  return getClient().getOpenOrders(params);
}

export async function getOrder(orderId) {
  return getClient().getOrder(orderId);
}

export async function cancelOrder(orderId) {
  logger.info(`Cancelling order ${orderId}`);
  return getClient().cancelOrder({ orderID: orderId });
}

export async function cancelOrders(orderIds) {
  logger.info(`Cancelling ${orderIds.length} orders`);
  return getClient().cancelOrders(orderIds);
}

export async function cancelAll() {
  logger.warn('Cancelling ALL open orders');
  return getClient().cancelAll();
}

export async function cancelMarketOrders({ market, assetId } = {}) {
  logger.info(`Cancelling orders for market=${market ?? 'all'} asset=${assetId ?? 'all'}`);
  return getClient().cancelMarketOrders({ market, asset_id: assetId });
}

// ── Trade history ───────────────────────────────────────────────────

export async function getTrades(params) {
  return getClient().getTrades(params);
}

export async function getTradesPaginated(params) {
  return getClient().getTradesPaginated(params);
}

// ── Heartbeat ───────────────────────────────────────────────────────
// Once started, heartbeats must keep arriving every ~10s or all orders
// are auto-cancelled. Start only when you have active orders.

async function sendHeartbeat() {
  try {
    const resp = await getClient().postHeartbeat(heartbeatId || undefined);
    heartbeatId = resp.heartbeat_id ?? '';
  } catch (err) {
    const respData = err?.response?.data ?? err?.data;
    if (respData?.heartbeat_id) {
      logger.warn(`Heartbeat rejected — adopting server heartbeat_id: ${respData.heartbeat_id}`);
      heartbeatId = respData.heartbeat_id;
    } else {
      logger.error(`Heartbeat failed: ${err.message}`);
      heartbeatId = '';
    }
  }
}

export function startHeartbeat(intervalMs = 5_000) {
  if (heartbeatTimer) return;
  logger.info('Starting heartbeat');
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, intervalMs);
}

export function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  heartbeatId = '';
  logger.info('Heartbeat stopped');
}

const TERMINAL_ORDER_STATES = new Set(['CANCELED', 'CONFIRMED', 'FAILED']);

export function trackOrder(orderId) {
  activeOrderIds.add(orderId);
  startHeartbeat();
}

export function untrackOrder(orderId) {
  activeOrderIds.delete(orderId);
  if (activeOrderIds.size === 0) stopHeartbeat();
}

// ── Convenience: auto-resolve tick size & neg risk ───────────────────

export async function resolveMarketParams(tokenId) {
  const [tickSize, negRisk] = await Promise.all([
    getTickSize(tokenId),
    getNegRisk(tokenId),
  ]);
  return { tickSize, negRisk };
}

export async function buyAuto({ tokenId, price, size, expiration }) {
  const { tickSize, negRisk } = await resolveMarketParams(tokenId);
  if (expiration) {
    return buyGtd({ tokenId, price, size, expiration, tickSize, negRisk });
  }
  return buyLimit({ tokenId, price, size, tickSize, negRisk });
}

export async function sellAuto({ tokenId, price, size, expiration }) {
  const { tickSize, negRisk } = await resolveMarketParams(tokenId);
  if (expiration) {
    return sellGtd({ tokenId, price, size, expiration, tickSize, negRisk });
  }
  return sellLimit({ tokenId, price, size, tickSize, negRisk });
}

export async function buyMarketAuto({ tokenId, amount, worstPrice, fillType }) {
  const { tickSize, negRisk } = await resolveMarketParams(tokenId);
  return buyMarket({ tokenId, amount, worstPrice, tickSize, negRisk, fillType });
}

export async function sellMarketAuto({ tokenId, amount, worstPrice, fillType }) {
  const { tickSize, negRisk } = await resolveMarketParams(tokenId);
  return sellMarket({ tokenId, amount, worstPrice, tickSize, negRisk, fillType });
}

// ── User Channel WebSocket (order & trade status updates) ────────────

let userWs = null;
let userPingTimer = null;
let userReconnectDelay = 2_000;
let userIntentionalClose = false;

const subscribedConditionIds = new Set();
const orderListeners = new Map();

function userChannelConnect() {
  if (!apiCreds) {
    logger.error('[UserWS] Cannot connect — API credentials not available');
    return;
  }

  logger.info('[UserWS] Connecting...');
  userWs = new WebSocket(USER_WS_URL);

  userWs.on('open', () => {
    logger.info('[UserWS] Connected');
    userReconnectDelay = 2_000;
    userChannelSubscribeAll();
    userStartPing();
  });

  userWs.on('message', (raw) => {
    const text = raw.toString();
    if (text === 'PONG') return;

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (Array.isArray(msg)) {
      for (const m of msg) userChannelDispatch(m);
    } else {
      userChannelDispatch(msg);
    }
  });

  userWs.on('error', (err) => {
    logger.error(`[UserWS] Error: ${err.message}`);
  });

  userWs.on('close', (code, reason) => {
    userStopPing();
    logger.warn(`[UserWS] Closed (${code}). ${reason || ''}`);
    if (!userIntentionalClose) userScheduleReconnect();
  });
}

function userChannelDispatch(msg) {
  const eventType = msg.event_type;

  if (eventType === 'order') {
    const orderId = msg.id;
    const action = msg.type;
    logger.info(`[UserWS] order event: ${action} ${orderId}`);

    if (orderId && action !== 'PLACEMENT') {
      const dbUpdate = {};
      if (action === 'CANCELLATION') dbUpdate.orderStatus = 'CANCELED';
      if (msg.size_matched != null) dbUpdate.sizeMatched = parseFloat(msg.size_matched);
      if (msg.price != null) dbUpdate.filledPrice = parseFloat(msg.price);
      if (Object.keys(dbUpdate).length > 0) {
        updateOrderFill(null, orderId, dbUpdate)
          .catch((err) => logger.error(`[UserWS] DB update failed for order ${orderId}: ${err.message}`));
      }
    }

    const listener = orderListeners.get(orderId);
    if (listener) {
      listener({
        type: 'order',
        action,
        orderId,
        price: msg.price != null ? parseFloat(msg.price) : null,
        sizeMatched: msg.size_matched != null ? parseFloat(msg.size_matched) : null,
        originalSize: msg.original_size != null ? parseFloat(msg.original_size) : null,
        side: msg.side,
        outcome: msg.outcome,
        timestamp: msg.timestamp,
        raw: msg,
      });
    }
    return;
  }

  if (eventType === 'trade') {
    const status = msg.status;
    logger.info(`[UserWS] trade event: ${status} price=${msg.price ?? '?'} size=${msg.size ?? '?'}`);
    const takerId = msg.taker_order_id;
    const makerIds = (msg.maker_orders || []).map((m) => m.order_id);
    const matchedOrderIds = [takerId, ...makerIds].filter(Boolean);

    for (const oid of matchedOrderIds) {
      const makerMatch = (msg.maker_orders || []).find((m) => m.order_id === oid);

      const dbUpdate = { orderStatus: status };
      if (msg.price != null) dbUpdate.filledPrice = parseFloat(msg.price);
      if (makerMatch?.matched_amount != null) dbUpdate.sizeMatched = parseFloat(makerMatch.matched_amount);
      if (msg.transaction_hash) dbUpdate.transactionsHash = msg.transaction_hash;
      if (status === 'CONFIRMED' || status === 'MATCHED') dbUpdate.matchedAt = new Date();

      updateOrderFill(null, oid, dbUpdate)
        .catch((err) => logger.error(`[UserWS] DB update failed for trade on order ${oid}: ${err.message}`));

      const listener = orderListeners.get(oid);
      if (!listener) continue;

      listener({
        type: 'trade',
        status,
        orderId: oid,
        tradeId: msg.id,
        price: msg.price != null ? parseFloat(msg.price) : null,
        size: msg.size != null ? parseFloat(msg.size) : null,
        side: msg.side,
        matchedAmount: makerMatch?.matched_amount != null ? parseFloat(makerMatch.matched_amount) : null,
        transactionHash: msg.transaction_hash ?? null,
        timestamp: msg.matchtime || msg.timestamp,
        raw: msg,
      });
    }
  }
}

function userChannelSubscribeAll() {
  if (!userWs || userWs.readyState !== WebSocket.OPEN) return;
  if (subscribedConditionIds.size === 0) return;

  const payload = {
    auth: {
      apiKey: apiCreds.key,
      secret: apiCreds.secret,
      passphrase: apiCreds.passphrase,
    },
    markets: [...subscribedConditionIds],
    type: 'user',
  };

  userWs.send(JSON.stringify(payload));
  logger.info(`[UserWS] Subscribed to ${subscribedConditionIds.size} market(s)`);
}

function userStartPing() {
  userStopPing();
  userPingTimer = setInterval(() => {
    if (userWs?.readyState === WebSocket.OPEN) userWs.send('PING');
  }, 10_000);
}

function userStopPing() {
  if (userPingTimer) { clearInterval(userPingTimer); userPingTimer = null; }
}

function userScheduleReconnect() {
  logger.info(`[UserWS] Reconnecting in ${(userReconnectDelay / 1000).toFixed(1)}s...`);
  setTimeout(() => {
    userReconnectDelay = Math.min(userReconnectDelay * 2, 30_000);
    userChannelConnect();
  }, userReconnectDelay);
}

export function initUserChannel() {
  // Connection is now deferred until subscribeUserMarket() is called with
  // an actual conditionId.  This avoids opening an idle WS that the server
  // drops every ~10s (code 1006) before we have anything to subscribe to.
}

export function closeUserChannel() {
  userIntentionalClose = true;
  userStopPing();
  userWs?.close();
  userWs = null;
}

export function subscribeUserMarket(conditionId) {
  if (subscribedConditionIds.has(conditionId)) return;
  subscribedConditionIds.add(conditionId);

  if (!userWs) {
    userChannelConnect();
    return;
  }

  if (userWs.readyState === WebSocket.OPEN) {
    userChannelSubscribeAll();
  }
}

export function onOrderUpdate(orderId, callback) {
  orderListeners.set(orderId, callback);
  return () => orderListeners.delete(orderId);
}

export function removeOrderListener(orderId) {
  orderListeners.delete(orderId);
}

// Re-export enums for convenience
export { Side, OrderType };
