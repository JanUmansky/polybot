export class Predictor {
  constructor() {
    this.lastPrediction = null;
    this.lastClose = null;
    this.stats = { correct: 0, wrong: 0, neutral: 0 };

    this.pmPendingPrediction = null;
    this.pmStats = { correct: 0, wrong: 0, neutral: 0 };
    this.pmHistory = [];
  }

  predict(analysis, currentClose) {
    const verdict = this._scorePrevious(currentClose);

    const directional = [analysis.rsi, analysis.macd, analysis.bb, analysis.ema, analysis.candles];
    const volume = analysis.volume;

    // Weighted score: signal * strength * weight for each directional indicator
    let weightedSum = 0;
    let maxPossible = 0;

    for (const ind of directional) {
      const contribution = ind.signal * Math.max(ind.strength, 0.1) * ind.weight;
      weightedSum += contribution;
      maxPossible += ind.weight;
    }

    // Volume acts as a conviction multiplier (0.8x – 1.4x)
    const volMultiplier = volume.confirming ? 1.0 + (volume.strength * 0.4) : 0.8 + (volume.strength * 0.2);
    weightedSum *= volMultiplier;

    const normalizedScore = maxPossible > 0 ? weightedSum / maxPossible : 0;
    const conviction = Math.min(Math.round(Math.abs(normalizedScore) * 100), 100);

    let direction;
    if (normalizedScore > 0.05) direction = 'UP';
    else if (normalizedScore < -0.05) direction = 'DOWN';
    else direction = 'NEUTRAL';

    this.lastPrediction = direction;
    this.lastClose = currentClose;

    const allIndicators = [...directional, volume];

    return {
      direction,
      conviction,
      score: round(weightedSum),
      breakdown: allIndicators.map((i) => ({
        name: i.name,
        value: i.value,
        signal: i.signal > 0 ? 'BULL' : i.signal < 0 ? 'BEAR' : '----',
        strength: i.strength,
        weight: i.weight,
        crossover: i.crossover ?? false,
        confirming: i.confirming ?? false,
        patterns: i.patterns ?? [],
      })),
      accuracy: this.accuracy(),
      stats: { ...this.stats },
      verdict,
      pmAccuracy: this.pmAccuracy(),
      pmStats: { ...this.pmStats },
    };
  }

  _scorePrevious(newClose) {
    if (this.lastPrediction == null || this.lastClose == null) return null;

    if (this.lastPrediction === 'NEUTRAL') {
      this.stats.neutral++;
      return { result: 'SKIP', predicted: 'NEUTRAL', actual: null };
    }

    const wentUp = newClose > this.lastClose;
    const flat = newClose === this.lastClose;
    const predictedUp = this.lastPrediction === 'UP';
    const actual = flat ? 'FLAT' : wentUp ? 'UP' : 'DOWN';

    if (flat) {
      this.stats.neutral++;
      return { result: 'SKIP', predicted: this.lastPrediction, actual };
    }

    const win = wentUp === predictedUp;
    if (win) {
      this.stats.correct++;
    } else {
      this.stats.wrong++;
    }

    return { result: win ? 'WIN' : 'LOSS', predicted: this.lastPrediction, actual };
  }

  accuracy() {
    const decided = this.stats.correct + this.stats.wrong;
    if (decided === 0) return null;
    return Math.round((this.stats.correct / decided) * 100);
  }

  snapshotForPolymarket(market) {
    const direction = this.lastPrediction;
    if (!direction) return;

    this.pmPendingPrediction = {
      direction,
      slug: market.slug,
      timestamp: Date.now(),
    };
  }

  scorePolymarketResolution(winningOutcome) {
    const pending = this.pmPendingPrediction;
    this.pmPendingPrediction = null;

    if (!pending) return null;

    const normalized = (winningOutcome || '').toLowerCase();
    const actual = normalized === 'up' ? 'UP' : 'DOWN';

    if (pending.direction === 'NEUTRAL') {
      this.pmStats.neutral++;
      const entry = { result: 'SKIP', predicted: 'NEUTRAL', actual, slug: pending.slug };
      this.pmHistory.push(entry);
      return entry;
    }

    const win = pending.direction === actual;
    if (win) {
      this.pmStats.correct++;
    } else {
      this.pmStats.wrong++;
    }

    const entry = {
      result: win ? 'WIN' : 'LOSS',
      predicted: pending.direction,
      actual,
      slug: pending.slug,
    };
    this.pmHistory.push(entry);
    return entry;
  }

  pmAccuracy() {
    const decided = this.pmStats.correct + this.pmStats.wrong;
    if (decided === 0) return null;
    return Math.round((this.pmStats.correct / decided) * 100);
  }
}

function round(v, decimals = 4) {
  if (v == null) return null;
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
}
