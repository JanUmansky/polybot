import mongoose from 'mongoose';
import { BotRun, Strategy } from 'common';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import config from './config.js';

export { BotRun, Strategy };

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(config.mongoUri);
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

function generateBotName() {
  return uniqueNamesGenerator({ dictionaries: [adjectives, animals], separator: ' ', style: 'capital', length: 2 });
}

export async function createBotRun(market) {
  const doc = await BotRun.findOneAndUpdate(
    { market: market.slug },
    {
      $setOnInsert: {
        question: market.question,
        marketStartTime: market.startTime ?? null,
        marketEndTime: market.endTime ?? null,
        runStartTime: new Date(),
        name: generateBotName(),
      },
      $set: { status: 'running' },
    },
    { upsert: true, returnDocument: 'after', projection: { _id: 1, name: 1 } },
  );
  return { id: doc._id.toString(), name: doc.name };
}

export async function getRunningBotRuns() {
  return BotRun.find({ status: 'running' }).lean();
}

export async function updatePrediction(slug, direction) {
  await BotRun.updateOne({ market: slug }, { prediction: direction });
}

export async function hasOrder(slug, side = 'BUY') {
  const run = await BotRun.findOne(
    { market: slug, 'orders.side': side },
    { _id: 1 },
  ).lean();
  return !!run;
}

export async function getOrders(slug) {
  const run = await BotRun.findOne({ market: slug }, { orders: 1 }).lean();
  return run?.orders ?? [];
}

export async function recordOrder(slug, { side = 'BUY', direction, amount, limit, pmProb, tokenId, orderId, orderStatus, taDirection, orderType, originalSize, error }) {
  await BotRun.updateOne(
    { market: slug },
    {
      $push: {
        orders: {
          side,
          direction: direction ?? null,
          amount: amount ?? null,
          limit: limit ?? null,
          pmProb: pmProb ?? null,
          tokenId: tokenId ?? null,
          orderId: orderId ?? null,
          orderStatus: orderStatus ?? null,
          taDirection: taDirection ?? null,
          orderType: orderType ?? null,
          originalSize: originalSize ?? amount ?? null,
          statusHistory: [{ status: orderStatus ?? 'pending', ts: new Date() }],
          error: error ?? null,
        },
      },
    },
  );
}

export async function updateOrderFill(slug, orderId, { orderStatus, filledPrice, avgPrice, sizeMatched, transactionsHash, matchedAt } = {}) {
  const setFields = {};
  if (orderStatus) setFields['orders.$.orderStatus'] = orderStatus;
  if (filledPrice != null) setFields['orders.$.filledPrice'] = filledPrice;
  if (avgPrice != null) setFields['orders.$.avgPrice'] = avgPrice;
  if (sizeMatched != null) setFields['orders.$.sizeMatched'] = sizeMatched;
  if (transactionsHash) setFields['orders.$.transactionsHash'] = transactionsHash;
  if (matchedAt) setFields['orders.$.matchedAt'] = matchedAt;

  if (Object.keys(setFields).length === 0) return;

  const update = { $set: setFields };
  if (orderStatus) {
    update.$push = { 'orders.$.statusHistory': { status: orderStatus, ts: new Date() } };
  }

  const filter = { 'orders.orderId': orderId };
  if (slug) filter.market = slug;

  await BotRun.updateOne(filter, update);
}

export async function updateBotRunStatus(slug, status) {
  await BotRun.updateOne({ market: slug }, { status });
}

export async function finishBotRun(slug, { status, resolution, verdict, triggerGroups, logs }) {
  const update = {
    status,
    resolution: resolution ?? null,
    verdict: verdict ?? null,
    runEndTime: new Date(),
  };
  if (triggerGroups) update.triggerGroups = triggerGroups;
  if (logs?.length) update.logs = logs;
  await BotRun.updateOne({ market: slug }, update);
}

export async function getFirstStrategy() {
  return Strategy.findOne().lean();
}

export async function getBotRunStrategy(slug) {
  const run = await BotRun.findOne({ market: slug }, { strategy: 1 }).lean();
  return run?.strategy ?? null;
}

export async function saveBotRunStrategy(slug, strategy) {
  await BotRun.updateOne(
    { market: slug, strategy: null },
    { $set: { strategy } },
  );
}

export async function updateBotRunTriggerFired(slug, groupIndex, triggerIndex) {
  const set = {
    [`strategy.triggerGroups.${groupIndex}.triggers.${triggerIndex}.fired`]: true,
  };
  await BotRun.updateOne({ market: slug }, { $set: set });
}
