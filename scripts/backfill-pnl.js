/**
 * Backfill P&L data for resolved BotRuns using the Polymarket activity API.
 *
 * Usage:
 *   node scripts/backfill-pnl.js          # dry run (default)
 *   node scripts/backfill-pnl.js --apply  # apply changes to DB
 */
import mongoose from 'mongoose';
import { BotRun } from '../common/bot.js';

const FUNDER = process.env.POLY_FUNDER;
const MONGO_URI = process.env.MONGO_URI;
const DRY_RUN = !process.argv.includes('--apply');

async function fetchAllActivities() {
  const activities = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const url = `https://data-api.polymarket.com/activity?user=${FUNDER}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Activity API returned ${resp.status}`);
    const batch = await resp.json();
    if (!batch.length) break;
    activities.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return activities;
}

function buildTradeMap(activities) {
  const map = new Map(); // slug -> { buys: [], sells: [], redeems: [] }

  for (const a of activities) {
    if (!a.slug) continue;
    if (!map.has(a.slug)) map.set(a.slug, { buys: [], sells: [], redeems: [] });
    const entry = map.get(a.slug);

    if (a.type === 'TRADE' && a.side === 'BUY') {
      entry.buys.push({
        outcome: a.outcome,
        price: a.price,
        size: a.size,
        usdcSize: a.usdcSize,
        asset: a.asset,
        txHash: a.transactionHash,
        ts: a.timestamp,
      });
    } else if (a.type === 'TRADE' && a.side === 'SELL') {
      entry.sells.push({
        outcome: a.outcome,
        price: a.price,
        size: a.size,
        usdcSize: a.usdcSize,
        asset: a.asset,
        txHash: a.transactionHash,
        ts: a.timestamp,
      });
    } else if (a.type === 'REDEEM') {
      entry.redeems.push({
        size: a.size,
        usdcSize: a.usdcSize,
        txHash: a.transactionHash,
        ts: a.timestamp,
      });
    }
  }

  return map;
}

function computePnl(result, buys, sells) {
  let totalPnl = 0;

  for (const b of buys) {
    if (b.size <= 0 || b.price <= 0) continue;
    if (result === 'WIN') totalPnl += b.size * (1 - b.price);
    else totalPnl -= b.size * b.price;
  }

  for (const s of sells) {
    if (s.size <= 0 || s.price <= 0) continue;
    totalPnl += s.size * s.price;
  }

  return Math.round(totalPnl * 1e6) / 1e6;
}

async function main() {
  if (!FUNDER) {
    console.error('POLY_FUNDER env not set');
    process.exit(1);
  }
  if (!MONGO_URI) {
    console.error('MONGO_URI env not set');
    process.exit(1);
  }

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Fetching activities for ${FUNDER}...`);

  const activities = await fetchAllActivities();
  console.log(`Fetched ${activities.length} activities`);

  const tradeMap = buildTradeMap(activities);
  console.log(`Built trade map for ${tradeMap.size} markets\n`);

  await mongoose.connect(MONGO_URI);

  const runs = await BotRun.find({
    'verdict.result': { $in: ['WIN', 'LOSS'] },
    $or: [{ 'verdict.pnl': null }, { 'verdict.pnl': { $exists: false } }],
    status: 'resolved',
  }).lean();

  console.log(`Found ${runs.length} resolved runs missing P&L\n`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const run of runs) {
    const slug = run.market;
    const trades = tradeMap.get(slug);

    if (!trades || trades.buys.length === 0) {
      notFound++;
      console.log(`  [SKIP] ${slug} — no trade data in activity API`);
      continue;
    }

    const result = run.verdict.result;

    // Match buy trades to the bot's order direction
    const boughtDirection = run.verdict.bought;
    const matchingBuys = trades.buys.filter(
      (b) => b.outcome?.toUpperCase() === boughtDirection?.toUpperCase()
    );

    if (matchingBuys.length === 0) {
      notFound++;
      console.log(`  [SKIP] ${slug} — no matching ${boughtDirection} buys in activities`);
      continue;
    }

    const pnl = computePnl(result, matchingBuys, trades.sells);

    // Use the first (or only) buy for position summary
    const totalSize = matchingBuys.reduce((s, b) => s + b.size, 0);
    const totalUsdc = matchingBuys.reduce((s, b) => s + b.usdcSize, 0);
    const avgPrice = totalUsdc / totalSize;

    console.log(
      `  [${result}] ${slug} — P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} | ` +
        `size: ${totalSize.toFixed(4)} | avgPrice: ${avgPrice.toFixed(4)} | ` +
        `buys: ${matchingBuys.length}, sells: ${trades.sells.length}`
    );

    if (!DRY_RUN) {
      await BotRun.updateOne(
        { _id: run._id },
        {
          $set: {
            'verdict.pnl': pnl,
            'verdict.positionSize': Math.round(totalSize * 1e6) / 1e6,
            'verdict.avgPrice': Math.round(avgPrice * 1e6) / 1e6,
          },
        }
      );
    }

    updated++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (no trade data): ${notFound}`);
  console.log(`Total: ${runs.length}`);

  if (DRY_RUN && updated > 0) {
    console.log(`\nRun with --apply to write changes to DB`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
