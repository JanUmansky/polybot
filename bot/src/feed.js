import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:3004';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer = null;
let closing = false;
const queue = [];

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    reconnectDelay = RECONNECT_BASE_MS;
    ws.send(JSON.stringify({ type: 'producer' }));
    flush();
  });

  ws.on('close', () => {
    ws = null;
    if (!closing) scheduleReconnect();
  });

  ws.on('error', () => {
    // close event will fire after this
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    connect();
  }, reconnectDelay);
}

function flush() {
  while (queue.length > 0 && ws?.readyState === WebSocket.OPEN) {
    ws.send(queue.shift());
  }
}

export function broadcast(channel, event, data) {
  const payload = JSON.stringify({ type: 'publish', channel, event, data });
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(payload);
  } else {
    queue.push(payload);
  }
}

export function initFeed() {
  closing = false;
  connect();
}

export function closeFeed() {
  closing = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}
