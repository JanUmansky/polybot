import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.WS_PORT || '3004', 10);

const wss = new WebSocketServer({ port: PORT });

const subscriptions = new Map();
const producers = new Set();

function addSubscription(channel, ws) {
  if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
  subscriptions.get(channel).add(ws);
}

function removeSubscription(channel, ws) {
  const subs = subscriptions.get(channel);
  if (!subs) return;
  subs.delete(ws);
  if (subs.size === 0) subscriptions.delete(channel);
}

function removeAllSubscriptions(ws) {
  for (const [channel, subs] of subscriptions) {
    subs.delete(ws);
    if (subs.size === 0) subscriptions.delete(channel);
  }
}

function fanOut(channel, event, data) {
  const subs = subscriptions.get(channel);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({ channel, event, data, ts: new Date().toISOString() });
  for (const ws of subs) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

wss.on('connection', (ws) => {
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!role) {
      if (msg.type === 'producer') {
        role = 'producer';
        producers.add(ws);
        return;
      }
      role = 'consumer';
    }

    if (role === 'producer' && msg.type === 'publish') {
      fanOut(msg.channel, msg.event, msg.data);
      return;
    }

    if (role === 'consumer') {
      if (msg.type === 'subscribe') {
        addSubscription(msg.channel, ws);
      } else if (msg.type === 'unsubscribe') {
        removeSubscription(msg.channel, ws);
      }
    }
  });

  ws.on('close', () => {
    producers.delete(ws);
    removeAllSubscriptions(ws);
  });
});

console.log(`WS relay server listening on port ${PORT}`);
