import { fetchLiveMarket, fetchMarketBySlug, initPolymarketWs, closePolymarketWs } from './polymarket.js';
import { initBinanceWs, closeBinanceWs } from './ws.js';
import { Bot } from './bot.js';
import { createLogger } from './logger.js';
import { connectDb, disconnectDb, getRunningBotRuns, finishBotRun, getFirstStrategy } from './db.js';
import { initTradingClient, getBalanceAllowance, initUserChannel, closeUserChannel } from './trading.js';
import { initFeed, closeFeed, broadcast } from './feed.js';

const logger = createLogger('Orchestrator', {
  emit: (event, data) => broadcast('orchestrator', event, data),
});

export async function startOrchestrator() {
  await initTradingClient();
  const balanceAllowance = await getBalanceAllowance({ asset_type: "COLLATERAL" });
  logger.info(`Balance allowance: ${balanceAllowance}`);
  logger.info('Starting orchestrator...');

  try {
    await connectDb();
    logger.info('Connected to MongoDB');
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    logger.warn('Continuing without database — runs will not be persisted');
  }

  await reconcileStaleRuns();

  initFeed();
  initBinanceWs();
  initPolymarketWs();
  initUserChannel();

  const activeBots = new Set();

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  async function shutdown() {
    logger.info('Shutting down...');
    for (const bot of activeBots) bot.stop();
    closeBinanceWs();
    closePolymarketWs();
    closeUserChannel();
    closeFeed();
    await disconnectDb().catch(() => {});
    process.exit(0);
  }

  async function spawnBot(market) {
    const strategy = await getFirstStrategy();
    if (!strategy) {
      logger.error('No strategy found in DB — cannot spawn bot');
      return;
    }

    const bot = new Bot(market, strategy);
    activeBots.add(bot);

    bot.onEnd(async () => {
      logger.info(`Market ${market.slug} ended — fetching next market`);
      broadcast('orchestrator', 'bot_ended', { botId: bot.dbId, slug: market.slug });
      const next = await fetchLiveMarket();
      if (next) {
        logger.info(`Found next market: ${next.slug}`);
        broadcast('orchestrator', 'next_market', { slug: next.slug, question: next.question });
        await spawnBot(next);
      } else {
        logger.warn('No live market found after current market ended');
      }
    });

    bot.start().catch((err) => {
      logger.error(`Bot crashed: ${err.message}`);
      broadcast('orchestrator', 'bot_crashed', { botId: bot.dbId, slug: market.slug, error: err.message });
      bot._finishRun('crashed');
      bot.stop();
    });

    bot.done.then(() => {
      activeBots.delete(bot);
      logger.info(`Bot for ${market.slug} cleaned up (${activeBots.size} still active)`);
    });

    logger.info(`Spawned bot for ${market.slug} (${activeBots.size} active)`);
  }

  const initial = await fetchLiveMarket();
  if (initial) {
    logger.info(`Found live market on startup: ${initial.slug}`);
    await spawnBot(initial);
  } else {
    logger.warn('No live market found on startup');
  }
}

async function reconcileStaleRuns() {
  let staleRuns;
  try {
    staleRuns = await getRunningBotRuns();
  } catch {
    return;
  }

  if (staleRuns.length === 0) return;
  logger.info(`Found ${staleRuns.length} stale "running" bot run(s) in DB — reconciling...`);

  const now = new Date();

  for (const run of staleRuns) {
    const slug = run.market;

    if (run.marketEndTime && now < run.marketEndTime) {
      logger.info(`  ${slug}: still within timeframe — will be picked up by normal startup`);
      continue;
    }

    logger.info(`  ${slug}: past marketEndTime — checking resolution...`);

    const market = await fetchMarketBySlug(slug);
    if (!market) {
      logger.warn(`  ${slug}: could not fetch market data — marking as timeout`);
      await finishBotRun(slug, { status: 'timeout', resolution: null, verdict: null }).catch(() => {});
      continue;
    }

    if (market.resolved) {
      const outcome = market.winningOutcome;
      const FILLED = new Set(['MATCHED', 'CONFIRMED']);
      const buyOrder = (run.orders || []).find((o) => o.side === 'BUY' && FILLED.has(o.orderStatus));
      const bought = buyOrder?.direction ?? null;
      let verdict = null;

      if (bought) {
        const actual = (outcome || '').toLowerCase() === 'up' ? 'UP' : 'DOWN';
        const win = bought === actual;
        verdict = { result: win ? 'WIN' : 'LOSS', bought, actual };
      } else {
        const actual = (outcome || '').toLowerCase() === 'up' ? 'UP' : 'DOWN';
        const anyBuy = (run.orders || []).find((o) => o.side === 'BUY');
        verdict = { result: 'SKIP', bought: anyBuy?.direction ?? null, actual, reason: 'no order confirmed' };
      }

      logger.info(`  ${slug}: resolved → ${outcome} (bought: ${bought || 'none'}, verdict: ${verdict.result})`);
      await finishBotRun(slug, { status: 'resolved', resolution: outcome, verdict }).catch(() => {});
    } else {
      logger.warn(`  ${slug}: past marketEndTime but not yet resolved`);
      // await finishBotRun(slug, { status: 'timeout', resolution: null, verdict: null }).catch(() => {});
    }
  }
}
