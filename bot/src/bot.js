import { CandleBuffer } from './candles.js';
import { subscribeBinance } from './ws.js';
import { analyze } from './ta.js';
import { Predictor } from './predict.js';
import { subscribePolymarket } from './polymarket.js';
import { createBotRun, updatePrediction, updateBotRunStatus, finishBotRun, hasOrder, getOrders, recordOrder, getBotRunStrategy, saveBotRunStrategy, updateBotRunTriggerFired, updateOrderFill, getBotRun } from './db.js';
import { fetchMarketBySlug } from './polymarket.js';
import { buyAuto, buyMarketAuto, sellMarketAuto, getBalanceAllowance, ensureConditionalAllowance, subscribeUserMarket, onOrderUpdate, removeOrderListener, trackOrder, untrackOrder } from './trading.js';
import { fetchPositionsForCondition } from './claim.js';
import { broadcast } from './feed.js';
import { createLogger } from './logger.js';
import config from './config.js';

const logger = createLogger('Bot');

let botCounter = 0;

export class Bot {
  constructor(market, strategy) {
    botCounter++;
    this.id = botCounter;
    this.name = null;
    this.market = market;
    this.dbId = null;
    this.buffer = new CandleBuffer();
    this.predictor = new Predictor();
    this._unsubBinance = null;
    this._unsubPm = null;
    this._resolve = null;
    this._done = new Promise((resolve) => { this._resolve = resolve; });
    this._stopped = false;
    this._onResolved = null;
    this.resolved = new Promise((resolve) => { this._onResolved = resolve; });

    this._pmUpPrice = null;
    this._taDirection = null;
    this._firedGroups = new Set();
    this._buyDirection = null;
    this._endTimer = null;
    this._onEndCallback = null;
    this._activeStopLosses = [];

    this.strategy = strategy;
    this._pmHistory = [];
    this._positionData = null;

    this.state = {
      status: 'created',
      market: {
        slug: market.slug,
        question: market.question,
        outcomes: market.outcomes,
        prices: market.prices,
        startTime: market.startTime ?? null,
        endTime: market.endTime ?? null,
        endDate: market.endDate ?? null,
      },
      strategy: null, // populated by _buildStateStrategy below
      candle: null,
      prediction: null,
      targetPrice: null,
      livePrice: null,
      priceDiff: null,
      countdown: null,
      pm: {
        upPrice: null,
        downPrice: null,
        lastTrade: null,
      },
      sma: {
        upProb: null,
        downProb: null,
        samples: 0,
      },
      orders: [],
      resolution: null,
      verdict: null,
      bufferSize: 0,
      logs: [],
    };

    this._buildStateStrategy();
  }

  _log(level, msg) {
    this.state.logs.push({ level, msg, ts: Date.now() });
    if (this.state.logs.length > 200) {
      this.state.logs = this.state.logs.slice(-200);
    }
    this._broadcast();
  }

  _broadcast() {
    if (this.dbId) {
      this.state.stopLosses = this._activeStopLosses.map((sl) => ({
        orderId: sl.orderId,
        direction: sl.direction,
        stopLossPrice: sl.stopLossPrice,
        triggered: sl.triggered,
      }));
      broadcast(`bot:${this.dbId}`, 'state', this.state);
    }
  }

  _broadcastStatus() {
    broadcast('orchestrator', 'bot_status', {
      botId: this.dbId,
      slug: this.market.slug,
      status: this.state.status,
    });
  }

  _buildStateStrategy() {
    const s = this.strategy;
    this.state.strategy = {
      name: s.name,
      pmSmaWindowMs: s.pmSmaWindowMs,
      triggerGroups: s.triggerGroups.map((g) => ({
        label: g.label ?? null,
        fired: false,
        triggers: g.triggers.map((t) => ({
          taDirection: t.conditions.taDirection ?? null,
          pmThreshold: t.conditions.pmThreshold ?? null,
          spreadThreshold: t.conditions.spreadThreshold ?? null,
          windowStartMs: t.conditions.windowStartMs ?? null,
          windowEndMs: t.conditions.windowEndMs ?? null,
          outcome: t.action.outcome ?? 'UP',
          side: t.action.side,
          amount: t.action.amount,
          limit: t.action.limit,
          stopLoss: t.action.stopLoss ?? null,
          fired: t.fired ?? false,
        })),
      })),
    };
  }

  onEnd(cb) {
    this._onEndCallback = cb;
  }

  async start() {
    const { market, strategy } = this;

    this._log('info', `Starting for market: ${market.slug}`);

    const groupsSummary = strategy.triggerGroups.map((g, gi) => {
      const label = g.label ?? `Group ${gi + 1}`;
      const inner = g.triggers.map((t) => {
        const start = t.conditions.windowStartMs != null ? `${t.conditions.windowStartMs / 1000}s` : '0s';
        const end = t.conditions.windowEndMs != null ? `${t.conditions.windowEndMs / 1000}s` : '∞';
        const spread = t.conditions.spreadThreshold != null ? `/spread${t.conditions.spreadThreshold >= 0 ? '>' : '<'}${t.conditions.spreadThreshold}` : '';
        const ta = t.conditions.taDirection ?? '*';
        const pm = t.conditions.pmThreshold != null ? `${Math.round(t.conditions.pmThreshold * 100)}c` : '*';
        const outcome = t.action.outcome ?? 'UP';
        const limitStr = t.action.limit != null ? `@${t.action.limit}` : '@MKT';
        return `${outcome}/${ta}:${t.action.side}${t.action.amount}${limitStr}/${pm}[${start}–${end}]${spread}`;
      }).join(' | ');
      return `[${label}: ${inner}]`;
    }).join(' & ');
    this._log('info', `Strategy: sma=${strategy.pmSmaWindowMs / 1000}s  groups: ${groupsSummary}`);

    await this._hydrateFromDb();

    const liveMarket = await fetchMarketBySlug(market.slug);
    if (liveMarket) {
      Object.assign(market, liveMarket);
      this.state.market.endDate = market.endDate;
      this.state.market.startTime = market.startTime;
      this.state.market.endTime = market.endTime;
    }

    if (liveMarket?.resolved) {
      return this._resolveImmediately(liveMarket.winningOutcome);
    }

    const pastEnd = market.endTime && Date.now() >= market.endTime.getTime();
    if (pastEnd) {
      this.state.status = 'ended';
      this._log('info', 'Market already past endTime — waiting for resolution via WS');
      this._broadcastStatus();
      await updateBotRunStatus(market.slug, 'ended').catch(() => {});
      this._subscribePm();
      return this._done;
    }

    this._startActiveBotLifecycle();
    return this._done;
  }

  async _hydrateFromDb() {
    const { market, strategy } = this;

    try {
      const botRun = await createBotRun(market);
      this.dbId = botRun.id;
      this.name = botRun.name;
      await saveBotRunStrategy(market.slug, strategy);
      this.state.status = 'running';
      broadcast('orchestrator', 'bot_spawned', {
        botId: this.dbId,
        slug: market.slug,
        question: market.question,
      });
      this._broadcastStatus();
      this._broadcast();
      const dbStrategy = await getBotRunStrategy(market.slug);
      if (dbStrategy?.triggerGroups?.length) {
        for (let gi = 0; gi < dbStrategy.triggerGroups.length; gi++) {
          const dbGroup = dbStrategy.triggerGroups[gi];
          const stateGroup = this.state.strategy.triggerGroups[gi];
          if (!stateGroup) continue;
          for (let ti = 0; ti < (dbGroup.triggers || []).length; ti++) {
            const dbTrigger = dbGroup.triggers[ti];
            if (dbTrigger?.fired) {
              stateGroup.triggers[ti].fired = true;
              if (this.strategy.triggerGroups[gi]?.triggers[ti]) {
                this.strategy.triggerGroups[gi].triggers[ti].fired = true;
              }
              if (!this._buyDirection) {
                this._buyDirection = dbTrigger.action?.outcome ?? 'UP';
              }
            }
          }
          const groupFired = stateGroup.triggers.some((t) => t.fired);
          if (groupFired) {
            this._firedGroups.add(gi);
            stateGroup.fired = true;
          }
        }
        const restoredCount = this._firedGroups.size;
        if (restoredCount > 0) {
          this._log('info', `[DB] Restored ${restoredCount} fired trigger group(s) from database (buyDirection: ${this._buyDirection})`);
        }
      } else if (await hasOrder(market.slug, 'BUY')) {
        for (let gi = 0; gi < strategy.triggerGroups.length; gi++) {
          this._firedGroups.add(gi);
          this.state.strategy.triggerGroups[gi].fired = true;
        }
        const existingOrders = await getOrders(market.slug);
        const firstOrder = existingOrders.find((o) => o.direction);
        if (firstOrder && !this._buyDirection) {
          this._buyDirection = firstOrder.direction;
        }
        this._log('info', `[DB] Orders already recorded for this market — all trigger groups marked as fired (buyDirection: ${this._buyDirection})`);
      }

      const dbOrders = await getOrders(market.slug);
      if (dbOrders.length > 0) {
        this.state.orders = dbOrders.map((o) => ({
          side: o.side,
          direction: o.direction ?? null,
          amount: o.amount ?? null,
          limit: o.limit ?? null,
          pmProb: o.pmProb ?? null,
          taDirection: o.taDirection ?? null,
          tokenId: o.tokenId ?? null,
          orderId: o.orderId ?? null,
          status: o.orderStatus ?? 'pending',
          orderType: o.orderType ?? null,
          filledPrice: o.filledPrice ?? null,
          avgPrice: o.avgPrice ?? null,
          sizeMatched: o.sizeMatched ?? null,
          originalSize: o.originalSize ?? o.amount ?? null,
          transactionsHash: o.transactionsHash ?? null,
          statusHistory: o.statusHistory ?? [],
          error: o.error ?? null,
          ts: o.createdAt ? new Date(o.createdAt).getTime() : Date.now(),
        }));
        this._log('info', `[DB] Hydrated ${dbOrders.length} order(s) from database`);
      }
    } catch (err) {
      this._log('error', `[DB] Failed to create run record: ${err.message}`);
    }
  }

  async _resolveImmediately(winningOutcome) {
    this._log('info', `Market already resolved (${winningOutcome}) — reconciling positions`);
    await this._reconcilePositions();
    this._broadcast();
    const verdict = this._scoreResolution(winningOutcome);
    this.state.resolution = winningOutcome;
    this.state.verdict = verdict;
    this.state.status = 'resolved';
    const pnlStr = verdict.pnl != null ? ` | pnl: $${verdict.pnl.toFixed(4)}` : '';
    this._log('info', `Market resolved: ${winningOutcome} — ${verdict.result}${pnlStr}`);
    this._broadcastStatus();
    await this._finishRun('resolved', winningOutcome, verdict);
    this._onResolved?.();
    this.stop();
    return this._done;
  }

  _subscribePm() {
    const { market } = this;
    const upIdx = market.outcomes.indexOf('Up');

    this._unsubPm = subscribePolymarket(market, {
      onBook: () => {},
      onTrade: () => {},
      onPriceChange: () => {},
      onMarketResolved: async (msg) => {
        await this._reconcilePositions();
        this._broadcast();
        const verdict = this._scoreResolution(msg.winning_outcome);
        this.state.resolution = msg.winning_outcome;
        this.state.verdict = verdict;
        this.state.status = 'resolved';
        const pnlStr = verdict.pnl != null ? ` | pnl: $${verdict.pnl.toFixed(4)}` : '';
        this._log('info', `Market resolved: ${msg.winning_outcome} — ${verdict.result}${pnlStr}`);
        this._broadcastStatus();
        await this._finishRun('resolved', msg.winning_outcome, verdict);
        this._onResolved?.();
        this.stop();
      },
    });
  }

  _startActiveBotLifecycle() {
    const { market } = this;

    this._log('info', 'Fetching historical candles...');
    this.buffer.seed().then(() => {
      this.state.bufferSize = this.buffer.length;
      this._log('info', `Seeded buffer with ${this.buffer.length} historical candles`);

      const initialAnalysis = analyze(this.buffer);
      if (initialAnalysis) {
        const lastCandle = this.buffer.last();
        this.state.candle = lastCandle;
        this.state.targetPrice = lastCandle.close;
        this._log('info', `Target price (last candle close): ${lastCandle.close}`);
        const result = this.predictor.predict(initialAnalysis, lastCandle.close);
        this.state.prediction = result;
        this._taDirection = result.direction;
        this._broadcast();

        if (result.direction) {
          updatePrediction(market.slug, result.direction).catch(
            (err) => this._log('error', `[DB] Failed to save prediction: ${err.message}`),
          );
        }
      }
    }).catch((err) => {
      this._log('error', `Failed to seed candle buffer: ${err.message}`);
    });

    if (market.prices && market.outcomes) {
      this._pmUpPrice = market.prices[market.outcomes.indexOf('Up')] ?? 0.5;
      this.state.pm.upPrice = this._pmUpPrice;
      this.state.pm.downPrice = 1 - this._pmUpPrice;
    }

    this._unsubBinance = subscribeBinance(config.binance.symbol, config.binance.interval, {
      onLivePrice: (price, k) => {
        if (this.state.status === 'ended' || this.state.status === 'resolved') return;
        const remaining = k.T + 1 - Date.now();
        const countdown = remaining > 0 ? formatCountdown(remaining) : '00:00';
        this.state.livePrice = price;
        this.state.countdown = countdown;

        if (this.state.targetPrice != null) {
          this.state.priceDiff = price - this.state.targetPrice;
        }
        this.buffer.push(k);

        this.state.bufferSize = this.buffer.length;
        this._broadcast();
      },
    });

    const upIdx = market.outcomes.indexOf('Up');

    this._unsubPm = subscribePolymarket(market, {
      onBook: (book, mkt) => {
        if (this.state.status === 'ended' || this.state.status === 'resolved') return;
        if (book.asset_id === mkt.assetIds[upIdx]) {
          const bestBid = book.bids?.[book.bids.length - 1];
          const bestAsk = book.asks?.[0];
          if (bestBid && bestAsk) {
            const mid = (parseFloat(bestBid.price) + parseFloat(bestAsk.price)) / 2;
            this.state.pm.upPrice = mid;
            this.state.pm.downPrice = 1 - mid;
            this._updatePmPrice(mid);
          }
        }
      },

      onTrade: (trade, mkt) => {
        if (this.state.status === 'ended' || this.state.status === 'resolved') return;
        const isUpToken = trade.asset_id === mkt.assetIds[upIdx];
        const tradePrice = parseFloat(trade.price);

        this.state.pm.lastTrade = {
          side: trade.side,
          outcome: isUpToken ? 'Up' : 'Dn',
          price: trade.price,
        };

        if (isUpToken) {
          this.state.pm.upPrice = tradePrice;
          this.state.pm.downPrice = 1 - tradePrice;
          this._updatePmPrice(tradePrice);
        } else {
          this.state.pm.downPrice = tradePrice;
          this.state.pm.upPrice = 1 - tradePrice;
          this._updatePmPrice(1 - tradePrice);
        }
      },

      onPriceChange: (msg, mkt) => {
        if (this.state.status === 'ended' || this.state.status === 'resolved') return;
        if (msg.asset_id === mkt.assetIds[upIdx] && msg.price != null) {
          const p = parseFloat(msg.price);
          this.state.pm.upPrice = p;
          this.state.pm.downPrice = 1 - p;
          this._updatePmPrice(p);
        }
      },

      onMarketResolved: async (msg) => {
        await this._reconcilePositions();
        this._broadcast();
        const verdict = this._scoreResolution(msg.winning_outcome);
        this.state.resolution = msg.winning_outcome;
        this.state.verdict = verdict;
        this.state.status = 'resolved';
        const pnlStr = verdict.pnl != null ? ` | pnl: $${verdict.pnl.toFixed(4)}` : '';
        this._log('info', `Market resolved: ${msg.winning_outcome} — ${verdict.result}${pnlStr}`);
        this._broadcastStatus();
        await this._finishRun('resolved', msg.winning_outcome, verdict);
        this._onResolved?.();
        this.stop();
      },
    });

    this.predictor.snapshotForPolymarket(market);
    if (this.predictor.pmPendingPrediction) {
      const dir = this.predictor.pmPendingPrediction.direction;
      this._log('info', `[PM] Prediction locked: ${dir}`);
      updatePrediction(market.slug, dir).catch(
        (err) => this._log('error', `[DB] Failed to save prediction: ${err.message}`),
      );
    } else {
      this._log('warn', '[PM] No prediction available yet for this market');
    }

    this._startEndTimer();
  }

  _startEndTimer() {
    const { market } = this;
    if (!market.endTime) {
      this._log('warn', 'No endTime on market — onEnd timer will not run');
      return;
    }

    this._endTimer = setInterval(() => {
      if (Date.now() >= market.endTime.getTime()) {
        this._onEnd();
      }
    }, 5_000);
  }

  async _onEnd() {
    if (this._stopped) return;
    clearInterval(this._endTimer);
    this._endTimer = null;

    this.state.status = 'ended';
    this.state.countdown = null;
    this.state.livePrice = null;
    this._log('info', 'Market window ended — waiting for resolution');
    this._broadcastStatus();
    try {
      await updateBotRunStatus(this.market.slug, 'ended');
    } catch (err) {
      this._log('error', `[DB] Failed to update status to ended: ${err.message}`);
    }
    this._onEndCallback?.();
  }

  _updatePmPrice(upPrice) {
    this._pmUpPrice = upPrice;
    this._pmHistory.push({ t: Date.now(), upPrice });
    this._evaluateBuySignal();
    this._evaluateStopLosses();
    this._broadcast();
  }

  _evaluateStopLosses() {
    if (this._stopped) return;
    if (this._pmUpPrice == null) return;

    const { avg: smaUp } = this._pmSma();
    if (smaUp == null) return;

    for (const sl of this._activeStopLosses) {
      if (sl.triggered) continue;

      const smaPrice = sl.direction === 'UP' ? smaUp : (1 - smaUp);

      if (smaPrice <= sl.stopLossPrice) {
        sl.triggered = true;
        this._log('warn', `STOP LOSS TRIGGERED for ${sl.orderId} | ${sl.direction} SMA ${Math.round(smaPrice * 100)}c <= ${Math.round(sl.stopLossPrice * 100)}c`);
        this._executeStopLoss(sl);
      }
    }
  }

  async _executeStopLoss(sl) {
    const { market } = this;

    let shares;
    try {
      const bal = await ensureConditionalAllowance(sl.tokenId);
      shares = parseFloat(bal?.balance ?? 0);
      const allowance = parseFloat(bal?.allowance ?? 0);
      this._log('info', `STOP LOSS: balance=${shares}, allowance=${allowance} for ${sl.orderId}`);
    } catch (err) {
      this._log('error', `STOP LOSS: failed to query/set balance allowance for ${sl.orderId}: ${err.message}`);
      sl.triggered = false;
      return;
    }

    if (shares <= 0) {
      this._log('warn', `STOP LOSS: no shares to sell for ${sl.orderId} (balance: ${shares})`);
      return;
    }

    const currentPrice = sl.direction === 'UP' ? this._pmUpPrice : (1 - this._pmUpPrice);
    const orderEntry = {
      side: 'SELL',
      direction: sl.direction,
      amount: shares,
      limit: null,
      pmProb: currentPrice,
      taDirection: this._taDirection,
      tokenId: sl.tokenId,
      orderId: null,
      status: 'pending',
      orderType: 'FOK',
      filledPrice: null,
      avgPrice: null,
      sizeMatched: null,
      originalSize: shares,
      transactionsHash: null,
      statusHistory: [{ status: 'pending', ts: Date.now() }],
      error: null,
      ts: Date.now(),
      isStopLoss: true,
      parentOrderId: sl.orderId,
    };

    this.state.orders.push(orderEntry);
    this._broadcast();

    try {
      const resp = await sellMarketAuto({ tokenId: sl.tokenId, amount: shares, worstPrice: 0.01, fillType: 'FOK' });

      if (resp && resp.error) {
        const errMsg = typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error);
        throw new Error(errMsg);
      }

      const rawStatus = resp.status ?? 'live';
      const initialStatus = String(rawStatus).toUpperCase();
      orderEntry.orderId = resp.orderID ?? null;
      orderEntry.status = initialStatus;
      orderEntry.orderType = resp.type ?? resp.orderType ?? 'FOK';
      orderEntry.statusHistory.push({ status: initialStatus, ts: Date.now() });

      logger.info(`[${market.slug}] STOP LOSS SELL PLACED ${sl.direction} | SELL ${shares} @ MKT | id: ${orderEntry.orderId} | status: ${initialStatus}`);
      this._log('info', `STOP LOSS SELL PLACED ${sl.direction} | SELL ${shares} @ MKT | id: ${orderEntry.orderId} | status: ${initialStatus}`);
      broadcast('orchestrator', 'order_update', { botId: this.dbId, slug: market.slug, orderId: orderEntry.orderId, status: initialStatus });

      recordOrder(market.slug, {
        side: 'SELL',
        direction: sl.direction,
        amount: shares,
        limit: null,
        pmProb: currentPrice,
        tokenId: sl.tokenId,
        orderId: orderEntry.orderId,
        orderStatus: initialStatus,
        taDirection: this._taDirection,
        orderType: orderEntry.orderType,
        originalSize: shares,
      }).catch((err) => this._log('error', `[DB] Failed to record stop loss order: ${err.message}`));

      if (orderEntry.orderId) {
        trackOrder(orderEntry.orderId);
        subscribeUserMarket(market.conditionId);
        onOrderUpdate(orderEntry.orderId, (evt) => this._handleOrderUpdate(orderEntry, evt));
      }
    } catch (err) {
      const serializedError = {
        message: err.message,
        stack: err.stack,
        name: err.name,
        ...(err.response ? { response: { status: err.response.status, statusText: err.response.statusText, data: err.response.data } } : {}),
        ...(err.status != null ? { status: err.status } : {}),
        ...(err.code ? { code: err.code } : {}),
      };

      orderEntry.status = 'error';
      orderEntry.error = serializedError;
      orderEntry.statusHistory.push({ status: 'error', ts: Date.now() });
      this._log('error', `STOP LOSS SELL FAILED ${sl.direction} | ${err.message}`);
      logger.error(`[${market.slug}] STOP LOSS ORDER ERROR: ${JSON.stringify(serializedError)}`);

      sl.triggered = false;

      recordOrder(market.slug, {
        side: 'SELL',
        direction: sl.direction,
        amount: shares,
        limit: null,
        pmProb: currentPrice,
        tokenId: sl.tokenId,
        orderStatus: 'error',
        taDirection: this._taDirection,
        originalSize: shares,
        error: serializedError,
      }).catch((dbErr) => this._log('error', `[DB] Failed to record failed stop loss order: ${dbErr.message}`));
    }
  }

  _pmSma() {
    const { pmSmaWindowMs } = this.strategy;
    const now = Date.now();
    const cutoff = now - pmSmaWindowMs;

    let sum = 0;
    let count = 0;
    for (let i = this._pmHistory.length - 1; i >= 0; i--) {
      const e = this._pmHistory[i];
      if (e.t < cutoff) break;
      sum += e.upPrice;
      count++;
    }

    if (count === 0) return { avg: null, samples: 0 };
    return { avg: sum / count, samples: count };
  }

  _evaluateBuySignal() {
    if (this._stopped) return;
    if (this._pmUpPrice == null) return;

    const { market, strategy } = this;
    if (!market.startTime) return;

    const { avg: smaUp, samples } = this._pmSma();
    if (smaUp == null) return;

    const smaDown = 1 - smaUp;
    this.state.sma = { upProb: smaUp, downProb: smaDown, samples };

    const groups = strategy.triggerGroups;
    if (this._firedGroups.size >= groups.length) return;

    const elapsed = Date.now() - market.startTime.getTime();

    for (let gi = 0; gi < groups.length; gi++) {
      if (this._firedGroups.has(gi)) continue;

      const group = groups[gi];

      for (let ti = 0; ti < group.triggers.length; ti++) {
        const { conditions, action } = group.triggers[ti];
        const direction = action.outcome ?? 'UP';
        const pmProb = direction === 'UP' ? smaUp : smaDown;

        if (conditions.taDirection != null && conditions.taDirection !== this._taDirection) continue;
        if (conditions.windowStartMs != null && elapsed < conditions.windowStartMs) continue;
        if (conditions.windowEndMs != null && elapsed > conditions.windowEndMs) continue;
        if (conditions.pmThreshold != null && pmProb < conditions.pmThreshold) continue;

        if (conditions.spreadThreshold != null) {
          if (this.state.priceDiff == null) continue;
          if (conditions.spreadThreshold >= 0 && this.state.priceDiff < conditions.spreadThreshold) continue;
          if (conditions.spreadThreshold < 0 && this.state.priceDiff > conditions.spreadThreshold) continue;
        }

        this._firedGroups.add(gi);
        this.strategy.triggerGroups[gi].triggers[ti].fired = true;
        this._buildStateStrategy();
        this.state.strategy.triggerGroups[gi].fired = true;
        if (!this._buyDirection) this._buyDirection = direction;

        updateBotRunTriggerFired(market.slug, gi, ti)
          .catch((err) => this._log('error', `[DB] Failed to persist trigger fired: ${err.message}`));

        const signal = {
          direction,
          taDirection: this._taDirection ?? 'NONE',
          pmUpPrice: this._pmUpPrice,
          pmSmaProb: pmProb,
          elapsedSec: Math.round(elapsed / 1000),
          side: action.side,
          amount: action.amount,
          limit: action.limit,
          stopLoss: action.stopLoss ?? null,
          groupIndex: gi,
          triggerIndex: ti,
          slug: market.slug,
          smaSamples: samples,
        };

        const groupLabel = group.label ?? `Group ${gi + 1}`;
        const spreadInfo = conditions.spreadThreshold != null ? ` | spread: ${this.state.priceDiff?.toFixed(2) ?? '?'} (thresh: ${conditions.spreadThreshold})` : '';
        const limitInfo = action.limit != null ? `@ ${Math.round(action.limit * 100)}c` : '@ MKT';
        this._log('info', `BUY SIGNAL [${groupLabel}] ${direction} | SMA(${direction}): ${Math.round(pmProb * 100)}% | ${action.side} ${action.amount} ${limitInfo}${spreadInfo}`);
        this._executeBuy(signal);

        break;
      }
    }
  }

  async _executeBuy(signal) {
    const { market } = this;
    const { direction, side, amount, limit } = signal;
    const isMarketOrder = limit == null;

    const upIdx = market.outcomes.indexOf('Up');
    const downIdx = market.outcomes.indexOf('Down');
    const tokenId = direction === 'UP' ? market.assetIds[upIdx] : market.assetIds[downIdx];

    const orderEntry = {
      side,
      direction,
      amount,
      limit: limit ?? null,
      pmProb: signal.pmSmaProb,
      taDirection: signal.taDirection,
      tokenId,
      orderId: null,
      status: 'pending',
      orderType: null,
      filledPrice: null,
      avgPrice: null,
      sizeMatched: null,
      originalSize: amount,
      transactionsHash: null,
      statusHistory: [{ status: 'pending', ts: Date.now() }],
      error: null,
      ts: Date.now(),
      _stopLoss: signal.stopLoss ?? null,
    };

    this.state.orders.push(orderEntry);
    this._broadcast();

    try {
      let resp;
      if (isMarketOrder) {
        resp = await buyMarketAuto({ tokenId, amount, worstPrice: 0.99, fillType: 'FAK' });
      } else {
        const expiration = market.endTime ? Math.floor(market.endTime.getTime() / 1000) : null;
        resp = await buyAuto({ tokenId, price: limit, size: amount, expiration });
      }

      if (resp && resp.error) {
        const errMsg = typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error);
        throw new Error(errMsg);
      }

      const rawStatus = resp.status ?? 'live';
      const initialStatus = String(rawStatus).toUpperCase();
      orderEntry.orderId = resp.orderID ?? null;
      orderEntry.status = initialStatus;
      orderEntry.orderType = resp.type ?? resp.orderType ?? (isMarketOrder ? 'FOK' : 'GTC');
      orderEntry.statusHistory.push({ status: initialStatus, ts: Date.now() });

      const priceStr = isMarketOrder ? 'MKT' : `${Math.round(limit * 100)}c`;
      logger.info(`[${market.slug}] ORDER PLACED ${direction} | ${side} ${amount} @ ${priceStr} | id: ${orderEntry.orderId} | status: ${initialStatus}`);
      this._log('info', `ORDER PLACED ${direction} | ${side} ${amount} @ ${priceStr} | id: ${orderEntry.orderId} | status: ${initialStatus}`);
      broadcast('orchestrator', 'order_update', { botId: this.dbId, slug: market.slug, orderId: orderEntry.orderId, status: initialStatus });

      recordOrder(market.slug, {
        side,
        direction,
        amount,
        limit: limit ?? null,
        pmProb: signal.pmSmaProb,
        tokenId,
        orderId: orderEntry.orderId,
        orderStatus: initialStatus,
        taDirection: signal.taDirection,
        orderType: orderEntry.orderType,
        originalSize: amount,
      }).catch((err) => this._log('error', `[DB] Failed to record order: ${err.message}`));

      if (orderEntry.orderId) {
        trackOrder(orderEntry.orderId);
        subscribeUserMarket(market.conditionId);
        onOrderUpdate(orderEntry.orderId, (evt) => this._handleOrderUpdate(orderEntry, evt));
      }
    } catch (err) {
      const serializedError = {
        message: err.message,
        stack: err.stack,
        name: err.name,
        ...( err.response ? { response: { status: err.response.status, statusText: err.response.statusText, data: err.response.data } } : {}),
        ...( err.status != null ? { status: err.status } : {}),
        ...( err.code ? { code: err.code } : {}),
      };

      orderEntry.status = 'error';
      orderEntry.error = serializedError;
      orderEntry.statusHistory.push({ status: 'error', ts: Date.now() });
      this._log('error', `ORDER FAILED ${direction} | ${err.message}`);
      logger.error(`[${market.slug}] ORDER ERROR: ${JSON.stringify(serializedError)}`);

      recordOrder(market.slug, {
        side,
        direction,
        amount,
        limit: limit ?? null,
        pmProb: signal.pmSmaProb,
        tokenId,
        orderStatus: 'error',
        taDirection: signal.taDirection,
        originalSize: amount,
        error: serializedError,
      }).catch((dbErr) => this._log('error', `[DB] Failed to record failed order: ${dbErr.message}`));
    }
  }

  _handleOrderUpdate(orderEntry, evt) {
    if (evt.type === 'order') {
      const action = evt.action;

      if (action === 'CANCELLATION') {
        orderEntry.status = 'CANCELED';
        orderEntry.statusHistory.push({ status: 'CANCELED', ts: Date.now() });
        logger.warn(`[${this.market.slug}] ORDER CANCELED ${orderEntry.orderId}`);
        this._log('info', `ORDER CANCELED ${orderEntry.orderId}`);
        removeOrderListener(orderEntry.orderId);
        untrackOrder(orderEntry.orderId);
      } else if (action === 'UPDATE') {
        if (evt.sizeMatched != null) orderEntry.sizeMatched = evt.sizeMatched;
        if (evt.originalSize != null) orderEntry.originalSize = evt.originalSize;
        if (evt.price != null) orderEntry.filledPrice = evt.price;
        logger.info(`[${this.market.slug}] ORDER UPDATE ${orderEntry.orderId} | matched: ${orderEntry.sizeMatched}/${orderEntry.originalSize}`);
        this._log('info', `ORDER UPDATE ${orderEntry.orderId} | matched: ${orderEntry.sizeMatched}/${orderEntry.originalSize}`);
      } else if (action === 'PLACEMENT') {
        orderEntry.status = 'LIVE';
        orderEntry.statusHistory.push({ status: 'LIVE', ts: Date.now() });
        logger.info(`[${this.market.slug}] ORDER LIVE ${orderEntry.orderId}`);
      }

      broadcast('orchestrator', 'order_update', { botId: this.dbId, slug: this.market.slug, orderId: orderEntry.orderId, status: orderEntry.status });
      this._broadcast();
      return;
    }

    if (evt.type === 'trade') {
      const prevStatus = orderEntry.status;
      orderEntry.status = evt.status;
      orderEntry.statusHistory.push({ status: evt.status, ts: Date.now() });

      if (evt.price != null) orderEntry.filledPrice = evt.price;
      if (evt.matchedAmount != null) orderEntry.sizeMatched = evt.matchedAmount;
      if (evt.size != null && orderEntry.sizeMatched == null) orderEntry.sizeMatched = evt.size;
      if (evt.transactionHash) orderEntry.transactionsHash = evt.transactionHash;

      logger.info(`[${this.market.slug}] ORDER ${orderEntry.orderId} ${prevStatus} → ${evt.status} | price: ${orderEntry.filledPrice ?? '?'} | matched: ${orderEntry.sizeMatched ?? '?'}/${orderEntry.originalSize}`);
      this._log('info', `ORDER ${orderEntry.orderId} ${prevStatus} → ${evt.status} | price: ${orderEntry.filledPrice ?? '?'} | matched: ${orderEntry.sizeMatched ?? '?'}/${orderEntry.originalSize}`);

      const TERMINAL = new Set(['CONFIRMED', 'FAILED']);
      if (TERMINAL.has(evt.status)) {
        removeOrderListener(orderEntry.orderId);
        untrackOrder(orderEntry.orderId);
      }

      const FILLED = new Set(['MATCHED', 'CONFIRMED']);
      if (FILLED.has(evt.status) && orderEntry._stopLoss != null && orderEntry.side === 'BUY') {
        const alreadyArmed = this._activeStopLosses.some((sl) => sl.orderId === orderEntry.orderId);
        if (!alreadyArmed) {
          this._activeStopLosses.push({
            orderId: orderEntry.orderId,
            tokenId: orderEntry.tokenId,
            direction: orderEntry.direction,
            stopLossPrice: orderEntry._stopLoss,
            triggered: false,
          });
          this._log('info', `STOP LOSS ARMED for ${orderEntry.orderId} | sell if ${orderEntry.direction} drops below ${Math.round(orderEntry._stopLoss * 100)}c`);

          ensureConditionalAllowance(orderEntry.tokenId)
            .then(() => this._log('info', `STOP LOSS: pre-approved conditional token allowance for ${orderEntry.orderId}`))
            .catch((err) => this._log('warn', `STOP LOSS: failed to pre-approve allowance for ${orderEntry.orderId}: ${err.message}`));
        }
      }

      broadcast('orchestrator', 'order_update', { botId: this.dbId, slug: this.market.slug, orderId: orderEntry.orderId, status: evt.status });
      this._broadcast();
    }
  }

  async _reconcilePositions() {
    try {
      const positions = await fetchPositionsForCondition(this.market.conditionId);
      if (!positions || positions.length === 0) {
        this._log('info', '[POSITIONS] No on-chain positions found for this market');
        this._positionData = null;
        return;
      }

      const buyOrders = this.state.orders.filter((o) => o.side === 'BUY');
      const tokenIds = new Set(buyOrders.map((o) => o.tokenId).filter(Boolean));

      let totalSize = 0;
      let weightedPriceSum = 0;

      for (const pos of positions) {
        const posToken = pos.asset || pos.token_id || pos.tokenId;
        const size = parseFloat(pos.size ?? 0);
        if (size <= 0) continue;

        if (tokenIds.size > 0 && !tokenIds.has(posToken)) continue;

        const avgPrice = parseFloat(pos.avgPrice ?? pos.avg_price ?? 0);
        totalSize += size;
        weightedPriceSum += size * avgPrice;

        this._log('info', `[POSITIONS] token=${posToken} size=${size} avgPrice=${avgPrice}`);
      }

      if (totalSize > 0) {
        this._positionData = {
          size: totalSize,
          avgPrice: weightedPriceSum / totalSize,
        };

        const FILLED = new Set(['MATCHED', 'CONFIRMED']);
        const hasFilledLocal = buyOrders.some((o) => FILLED.has((o.status ?? '').toUpperCase()));

        if (!hasFilledLocal && buyOrders.length > 0) {
          for (const orderEntry of buyOrders) {
            if (FILLED.has((orderEntry.status ?? '').toUpperCase())) continue;
            if (orderEntry.status === 'error' || orderEntry.status === 'CANCELED' || orderEntry.status === 'FAILED') continue;

            const prev = orderEntry.status;
            orderEntry.status = 'CONFIRMED';
            orderEntry.statusHistory.push({ status: 'CONFIRMED', ts: Date.now(), source: 'position_reconcile' });
            if (!orderEntry.sizeMatched) orderEntry.sizeMatched = totalSize;
            if (!orderEntry.avgPrice) orderEntry.avgPrice = this._positionData.avgPrice;

            logger.info(`[${this.market.slug}] POSITION RECONCILE ${orderEntry.orderId ?? '?'} ${prev} → CONFIRMED (position exists on-chain)`);
            this._log('info', `POSITION RECONCILE ${orderEntry.orderId ?? '?'} ${prev} → CONFIRMED (position exists on-chain)`);

            if (orderEntry.orderId) {
              updateOrderFill(this.market.slug, orderEntry.orderId, {
                orderStatus: 'CONFIRMED',
                sizeMatched: orderEntry.sizeMatched,
                avgPrice: this._positionData.avgPrice,
              }).catch((err) => this._log('error', `[DB] Position reconcile update failed: ${err.message}`));

              removeOrderListener(orderEntry.orderId);
              untrackOrder(orderEntry.orderId);
            }
            break;
          }
        }
      } else {
        this._positionData = null;
      }
    } catch (err) {
      this._log('warn', `[POSITIONS] Failed to fetch positions: ${err.message}`);
    }
  }

  _scoreResolution(winningOutcome) {
    const actual = (winningOutcome || '').toLowerCase() === 'up' ? 'UP' : 'DOWN';

    if (!this._buyDirection) {
      return { result: 'SKIP', bought: null, actual, pnl: 0, reason: 'no trigger fired' };
    }

    const FILLED = new Set(['MATCHED', 'CONFIRMED']);
    const hasFilledOrder = this.state.orders.some((o) => FILLED.has(o.status.toUpperCase()));
    const hasPosition = this._positionData && this._positionData.size > 0;

    if (!hasFilledOrder && !hasPosition) {
      return { result: 'SKIP', bought: this._buyDirection, actual, pnl: 0, reason: 'no order confirmed' };
    }

    const posSize = this._positionData?.size ?? null;
    const posAvgPrice = this._positionData?.avgPrice ?? null;

    const stopLossTriggered = this._activeStopLosses.some((sl) => sl.triggered);
    if (stopLossTriggered) {
      const pnl = this._computePnl('LOSS');
      return { result: 'LOSS', bought: this._buyDirection, actual, pnl, positionSize: posSize, avgPrice: posAvgPrice, reason: 'stop_loss' };
    }

    const win = this._buyDirection === actual;
    const pnl = this._computePnl(win ? 'WIN' : 'LOSS');
    return { result: win ? 'WIN' : 'LOSS', bought: this._buyDirection, actual, pnl, positionSize: posSize, avgPrice: posAvgPrice };
  }

  _computePnl(result) {
    if (this._positionData && this._positionData.size > 0) {
      const { size, avgPrice } = this._positionData;
      if (result === 'WIN') return size * (1 - avgPrice);
      return -(size * avgPrice);
    }

    const FILLED = new Set(['MATCHED', 'CONFIRMED']);
    const filledBuys = this.state.orders.filter((o) => o.side === 'BUY' && FILLED.has((o.status ?? '').toUpperCase()));

    let totalPnl = 0;
    for (const o of filledBuys) {
      const shares = o.sizeMatched ?? o.originalSize ?? o.amount ?? 0;
      const price = o.avgPrice ?? o.filledPrice ?? o.limit ?? 0;
      if (shares <= 0 || price <= 0) continue;
      if (result === 'WIN') totalPnl += shares * (1 - price);
      else totalPnl -= shares * price;
    }

    const filledSells = this.state.orders.filter((o) => o.side === 'SELL' && FILLED.has((o.status ?? '').toUpperCase()));
    for (const o of filledSells) {
      const shares = o.sizeMatched ?? o.originalSize ?? o.amount ?? 0;
      const price = o.avgPrice ?? o.filledPrice ?? 0;
      if (shares <= 0 || price <= 0) continue;
      totalPnl += shares * price;
    }

    return Math.round(totalPnl * 1e6) / 1e6;
  }

  async _finishRun(status, resolution, verdict) {
    try {
      await finishBotRun(this.market.slug, {
        status,
        resolution: resolution ?? null,
        verdict: verdict ?? null,
        triggerGroups: this.state.strategy?.triggerGroups ?? null,
        logs: this.state.logs ?? [],
      });
    } catch (err) {
      this._log('error', `[DB] Failed to finish run record: ${err.message}`);
    }
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    this.state.status = this.state.status === 'resolved' ? 'resolved' : 'stopped';
    this._log('info', 'Stopping...');
    if (this._endTimer) { clearInterval(this._endTimer); this._endTimer = null; }
    this._unsubBinance?.();
    this._unsubPm?.();

    const TERMINAL = new Set(['CANCELED', 'CONFIRMED', 'FAILED', 'error']);
    for (const o of this.state.orders) {
      if (!o.orderId) continue;
      if (TERMINAL.has(o.status)) {
        removeOrderListener(o.orderId);
        untrackOrder(o.orderId);
      }
    }
    this._resolve?.();
  }

  get done() {
    return this._done;
  }
}

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
