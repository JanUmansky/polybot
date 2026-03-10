import chalk from 'chalk';
import config from './config.js';

const SYMBOL_DISPLAY = config.binance.symbol.toUpperCase();
const SEP = chalk.gray('─'.repeat(58));

export function createLogger(prefix = '', { emit } = {}) {
  const tag = prefix ? chalk.magenta(`[${prefix}] `) : '';
  let pmLive = null;

  return {
    info(msg) {
      console.log(chalk.blue('ℹ'), chalk.gray(ts()), tag + msg);
      emit?.('info', { message: msg });
    },

    warn(msg) {
      console.log(chalk.yellow('⚠'), chalk.gray(ts()), tag + msg);
      emit?.('warn', { message: msg });
    },

    error(msg) {
      console.log(chalk.red('✖'), chalk.gray(ts()), tag + msg);
      emit?.('error', { message: msg });
    },

    banner() {
      console.log('');
      console.log(SEP);
      console.log(
        chalk.bold(`  POLYBOT `) +
        chalk.cyan(`${SYMBOL_DISPLAY} @ ${config.binance.interval}`) +
        chalk.gray(` | buffer: ${config.binance.bufferSize} candles`)
      );
      console.log(SEP);
      console.log('');
    },

    candle(candle) {
      const dir = candle.close >= candle.open ? chalk.green('▲') : chalk.red('▼');
      const time = new Date(candle.time).toLocaleTimeString();
      console.log(
        tag +
        chalk.gray(`  ${time}`) +
        `  ${dir}` +
        `  O ${fmt(candle.open)}` +
        `  H ${fmt(candle.high)}` +
        `  L ${fmt(candle.low)}` +
        `  C ${chalk.bold(fmt(candle.close))}` +
        `  V ${fmtVol(candle.volume)}`
      );
      emit?.('candle', candle);
    },

    prediction(result) {
      console.log('');
      console.log(SEP);

      if (result.verdict) {
        const v = result.verdict;
        if (v.result === 'WIN') {
          console.log(tag + chalk.green.bold(`  ✔ WIN`) + chalk.gray(`  predicted ${v.predicted}, actual ${v.actual}`));
        } else if (v.result === 'LOSS') {
          console.log(tag + chalk.red.bold(`  ✖ LOSS`) + chalk.gray(`  predicted ${v.predicted}, actual ${v.actual}`));
        } else {
          console.log(tag + chalk.yellow(`  ○ SKIP`) + chalk.gray(`  predicted ${v.predicted}, actual ${v.actual || '—'}`));
        }
        console.log('');
      }

      const dirColor =
        result.direction === 'UP' ? chalk.green :
        result.direction === 'DOWN' ? chalk.red :
        chalk.yellow;

      const arrow =
        result.direction === 'UP' ? '▲▲▲' :
        result.direction === 'DOWN' ? '▼▼▼' :
        '◆◆◆';

      const convictionStr = result.direction === 'NEUTRAL'
        ? chalk.gray('no conviction')
        : chalk.gray('conviction: ') + chalk.bold(`${result.conviction}%`);

      console.log(
        tag +
        `  ${dirColor.bold(`${arrow}  NEXT CANDLE: ${result.direction}`)}` +
        chalk.gray(` | `) + convictionStr +
        chalk.gray(` | score: ${result.score}`)
      );

      console.log('');
      for (const ind of result.breakdown) {
        const sigColor =
          ind.signal === 'BULL' ? chalk.green :
          ind.signal === 'BEAR' ? chalk.red :
          chalk.gray;

        const tags = [];
        if (ind.crossover) tags.push(chalk.magenta('⚡CROSS'));
        if (ind.confirming) tags.push(chalk.cyan('📊VOL↑'));
        if (ind.patterns && ind.patterns.length > 0) {
          tags.push(chalk.yellow(ind.patterns.join(', ')));
        }
        const tagStr = tags.length > 0 ? '  ' + tags.join(' ') : '';

        const strengthBar = renderStrength(ind.strength);

        console.log(
          tag +
          chalk.gray(`    ${ind.name.padEnd(14)}`) +
          sigColor(ind.signal.padEnd(6)) +
          chalk.white(String(ind.value ?? '—').padEnd(12)) +
          strengthBar +
          tagStr
        );
      }

      const { correct, wrong, neutral } = result.stats;
      const total = correct + wrong;
      if (total > 0) {
        console.log('');
        const accColor = result.accuracy >= 50 ? chalk.green : chalk.red;
        console.log(
          tag +
          chalk.gray(`  W/L: `) +
          chalk.green.bold(correct) +
          chalk.gray('/') +
          chalk.red.bold(wrong) +
          (neutral > 0 ? chalk.gray(` (${neutral} skipped)`) : '') +
          chalk.gray(`  |  Accuracy: `) +
          accColor.bold(`${result.accuracy}%`)
        );
      }

      const pm = result.pmStats;
      const pmTotal = pm.correct + pm.wrong;
      if (pmTotal > 0) {
        const pmAccColor = result.pmAccuracy >= 50 ? chalk.green : chalk.red;
        console.log(
          tag +
          chalk.magenta(`  PM W/L: `) +
          chalk.green.bold(pm.correct) +
          chalk.gray('/') +
          chalk.red.bold(pm.wrong) +
          (pm.neutral > 0 ? chalk.gray(` (${pm.neutral} skipped)`) : '') +
          chalk.gray(`  |  PM Accuracy: `) +
          pmAccColor.bold(`${result.pmAccuracy}%`)
        );
      }

      console.log(SEP);
      console.log('');
      emit?.('prediction', result);
    },

    livePrice(price, countdown) {
      const countdownStr = countdown
        ? chalk.gray(' | ') + chalk.yellow(countdown)
        : '';
      let pmStr = '';
      if (pmLive) {
        const upPct = Math.round(pmLive.upPrice * 100);
        const dnPct = Math.round(pmLive.downPrice * 100);
        pmStr = chalk.gray(' | ') +
          chalk.magenta('PM ') +
          chalk.green(`▲${upPct}`) + chalk.gray('/') + chalk.red(`▼${dnPct}`);
        if (pmLive.lastTrade) {
          const t = pmLive.lastTrade;
          const sideColor = t.side === 'BUY' ? chalk.green : chalk.red;
          pmStr += chalk.gray(' ') + sideColor(`${t.outcome}@${t.price}`);
        }
      }
      process.stdout.write(
        `\r  ${chalk.gray(ts())}  ${tag}${SYMBOL_DISPLAY}  ${chalk.cyan.bold(fmt(price))}${countdownStr}${pmStr}   `
      );
      emit?.('livePrice', { price, countdown });
    },

    pmSmaProgress(direction, smaProb, threshold, samples) {
      const smaPct = Math.round(smaProb * 100);
      const threshPct = Math.round(threshold * 100);
      const dirColor = direction === 'UP' ? chalk.green : chalk.red;

      process.stdout.write(
        `\r  ${chalk.gray(ts())}  ${tag}${chalk.yellow('⏳ SMA')} ` +
        dirColor(direction) +
        chalk.gray(` ${smaPct}%/${threshPct}%`) +
        chalk.gray(` (${samples} samples)`) +
        '   ',
      );
      emit?.('pmSmaProgress', { direction, smaProb, threshold, samples });
    },

    buySignal(signal) {
      process.stdout.write('\r' + ' '.repeat(120) + '\r');
      const dirColor = signal.direction === 'UP' ? chalk.green : chalk.red;
      const arrow = signal.direction === 'UP' ? '▲▲▲' : '▼▼▼';
      const smaPct = Math.round(signal.pmSmaProb * 100);
      const upPct = Math.round(signal.pmUpPrice * 100);
      const dnPct = 100 - upPct;
      const taLabel = signal.taDirection === signal.direction
        ? chalk.green('AGREE')
        : signal.taDirection === 'NEUTRAL' || signal.taDirection === 'NONE'
          ? chalk.yellow(signal.taDirection)
          : chalk.red('OPPOSE');

      console.log('');
      console.log(SEP);
      console.log(
        tag +
        chalk.green.bold('  💰 BUY SIGNAL  ') +
        dirColor.bold(`${arrow} ${signal.direction}`) +
        chalk.gray(` | SMA: `) + chalk.bold(`${smaPct}%`) +
        chalk.gray(` | spot PM `) + chalk.green(`▲${upPct}`) + chalk.gray('/') + chalk.red(`▼${dnPct}`) +
        chalk.gray(` | TA: `) + taLabel +
        chalk.gray(` | ${signal.side} `) + chalk.bold(`${signal.amount}`) + chalk.gray(` @ `) + chalk.bold(`${Math.round(signal.limit * 100)}¢`) +
        chalk.gray(` | ${signal.smaSamples} samples`) +
        chalk.gray(` | ${signal.elapsedSec}s elapsed`)
      );
      console.log(SEP);
      console.log('');
      emit?.('buySignal', signal);
    },

    buyExecuted(result) {
      const { direction, tokenId, side, amount, limit, orderId, status, taDirection } = result;
      const dirColor = direction === 'UP' ? chalk.green : chalk.red;
      const statusColor = status === 'matched' || status === 'live' ? chalk.green.bold : chalk.yellow.bold;

      console.log(
        tag +
        chalk.green.bold('  ✅ ORDER PLACED  ') +
        dirColor.bold(direction) +
        chalk.gray(` | ${side} `) + chalk.bold(`${amount}`) +
        chalk.gray(` @ `) + chalk.bold(`${Math.round(limit * 100)}¢`) +
        chalk.gray(` | TA: `) + chalk.bold(taDirection ?? '—') +
        chalk.gray(` | status: `) + statusColor(status) +
        chalk.gray(` | order: `) + chalk.cyan(orderId ?? '—')
      );
      console.log(chalk.gray(`  token: ${tokenId}`));
      emit?.('buyExecuted', result);
    },

    buyFailed(err, direction, amount, limit) {
      console.log('');
      console.log(SEP);
      console.log(
        tag +
        chalk.red.bold('  ❌ ORDER FAILED  ') +
        chalk.gray(`direction=${direction} amount=${amount} limit=${Math.round(limit * 100)}¢`) +
        chalk.red(` | ${err}`)
      );
      console.log(SEP);
      console.log('');
      emit?.('buyFailed', { error: err, direction, amount, limit });
    },

    seeded(count) {
      this.info(`Seeded buffer with ${chalk.bold(count)} historical candles`);
    },

    polymarketMarket(market) {
      pmLive = {
        upPrice: market.prices[market.outcomes.indexOf('Up')] ?? 0.5,
        downPrice: market.prices[market.outcomes.indexOf('Down')] ?? 0.5,
        lastTrade: null,
      };

      const PM = chalk.magenta.bold('POLYMARKET');
      console.log('');
      console.log(SEP);
      console.log(`  ${tag}${PM}  ${chalk.cyan(market.question)}`);
      console.log(chalk.gray(`  Outcomes: `) + market.outcomes.map((o, i) => {
        const price = market.prices[i];
        const pct = Math.round(price * 100);
        const color = o === 'Up' ? chalk.green : chalk.red;
        return color(`${o} ${pct}%`);
      }).join(chalk.gray(' | ')));
      if (market.endDate) {
        console.log(chalk.gray(`  Resolves: `) + chalk.yellow(new Date(market.endDate).toLocaleString()));
      }
      console.log(SEP);
      console.log('');
      emit?.('polymarketMarket', {
        question: market.question,
        outcomes: market.outcomes,
        prices: market.prices,
        endDate: market.endDate,
        slug: market.slug,
      });
    },

    polymarketBook(book, market) {
      if (!pmLive) pmLive = { upPrice: 0.5, downPrice: 0.5, lastTrade: null };

      const upIdx = market.outcomes.indexOf('Up');
      const upAsset = market.assetIds[upIdx];

      if (book.asset_id === upAsset) {
        const bestBid = book.bids?.[book.bids.length - 1];
        const bestAsk = book.asks?.[0];
        if (bestBid && bestAsk) {
          pmLive.upPrice = (parseFloat(bestBid.price) + parseFloat(bestAsk.price)) / 2;
          pmLive.downPrice = 1 - pmLive.upPrice;
        }
      }
      emit?.('polymarketBook', { asset_id: book.asset_id, upPrice: pmLive.upPrice, downPrice: pmLive.downPrice });
    },

    polymarketTrade(trade, market) {
      if (!pmLive) pmLive = { upPrice: 0.5, downPrice: 0.5, lastTrade: null };

      const upIdx = market.outcomes.indexOf('Up');
      const isUpToken = trade.asset_id === market.assetIds[upIdx];

      pmLive.lastTrade = {
        side: trade.side,
        outcome: isUpToken ? 'Up' : 'Dn',
        price: trade.price,
      };

      const tradePrice = parseFloat(trade.price);
      if (isUpToken) {
        pmLive.upPrice = tradePrice;
        pmLive.downPrice = 1 - tradePrice;
      } else {
        pmLive.downPrice = tradePrice;
        pmLive.upPrice = 1 - tradePrice;
      }
      emit?.('polymarketTrade', { side: trade.side, outcome: pmLive.lastTrade.outcome, price: trade.price, upPrice: pmLive.upPrice, downPrice: pmLive.downPrice });
    },

    polymarketResolved(msg, market, verdict) {
      process.stdout.write('\r' + ' '.repeat(120) + '\r');
      pmLive = null;

      const winner = msg.winning_outcome;
      const resolveColor = winner === 'Up' ? chalk.green.bold : chalk.red.bold;
      console.log('');
      console.log(SEP);
      console.log(`  ${tag}${chalk.magenta.bold('POLYMARKET')}  ${resolveColor(`RESOLVED: ${winner}`)}  ${chalk.gray(market.question)}`);

      if (verdict) {
        if (verdict.result === 'WIN') {
          console.log(tag + chalk.green.bold(`  ✔ WIN`) + chalk.gray(`  bought ${verdict.bought}, resolved ${verdict.actual}`));
        } else if (verdict.result === 'LOSS') {
          console.log(tag + chalk.red.bold(`  ✖ LOSS`) + chalk.gray(`  bought ${verdict.bought}, resolved ${verdict.actual}`));
        } else {
          console.log(tag + chalk.yellow(`  ○ NO BUY`) + chalk.gray(`  resolved ${verdict.actual}`));
        }
      }

      console.log(SEP);
      console.log('');
      emit?.('polymarketResolved', { winner, verdict, question: market.question });
    },

    resetPmLive() {
      pmLive = null;
    },
  };
}

export const logger = createLogger();

function ts() {
  return new Date().toLocaleTimeString();
}

function fmt(n) {
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toPrecision(6);
}

function fmtVol(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(2) + 'K';
  return v.toFixed(2);
}

function renderStrength(strength) {
  if (strength == null) return '';
  const filled = Math.round(strength * 5);
  const bar = '█'.repeat(filled) + '░'.repeat(5 - filled);
  const color = filled >= 4 ? chalk.green : filled >= 2 ? chalk.yellow : chalk.gray;
  return color(bar);
}

