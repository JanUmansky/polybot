import { fetchLiveMarket, fetchMarketBySlug, initPolymarketWs, closePolymarketWs } from './polymarket.js';
import { initBinanceWs, closeBinanceWs } from './ws.js';
import { Bot } from './bot.js';
import { createLogger } from './logger.js';
import { connectDb, disconnectDb, getUnresolvedBotRuns, getFirstStrategy } from './db.js';
import { initTradingClient, getBalanceAllowance, initUserChannel, closeUserChannel } from './trading.js';
import { initFeed, closeFeed, broadcast } from './feed.js';
import { startClaimLoop, stopClaimLoop } from './claim.js';

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

  initFeed();
  initBinanceWs();
  initPolymarketWs();
  initUserChannel();
  startClaimLoop();

  const activeBots = new Set();

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  async function shutdown() {
    logger.info('Shutting down...');
    for (const bot of activeBots) bot.stop();
    closeBinanceWs();
    closePolymarketWs();
    closeUserChannel();
    stopClaimLoop();
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

      const MAX_RETRIES = 5;
      const RETRY_DELAY_MS = 5_000;
      let next = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        next = await fetchLiveMarket();
        if (next) break;
        if (attempt < MAX_RETRIES) {
          logger.info(`No live market yet (attempt ${attempt}/${MAX_RETRIES}) — retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }

      if (next) {
        logger.info(`Found next market: ${next.slug}`);
        broadcast('orchestrator', 'next_market', { slug: next.slug, question: next.question });
        await spawnBot(next);
      } else {
        logger.warn(`No live market found after ${MAX_RETRIES} attempts`);
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

  const staleSlugs = new Set();

  try {
    const unresolved = await getUnresolvedBotRuns();
    if (unresolved.length > 0) {
      logger.info(`Found ${unresolved.length} unresolved bot run(s) — re-spawning...`);
      for (const run of unresolved) {
        staleSlugs.add(run.market);
        const market = await fetchMarketBySlug(run.market);
        if (!market) {
          logger.warn(`  ${run.market}: could not fetch market data — skipping`);
          continue;
        }
        logger.info(`  ${run.market}: spawning bot (db status: ${run.status})`);
        await spawnBot(market);
      }
    }
  } catch (err) {
    logger.error(`Failed to load unresolved runs: ${err.message}`);
  }

  const initial = await fetchLiveMarket();
  if (initial && !staleSlugs.has(initial.slug)) {
    logger.info(`Found live market on startup: ${initial.slug}`);
    await spawnBot(initial);
  } else if (!initial) {
    logger.warn('No live market found on startup');
  }
}
