import {
  RSI, MACD, BollingerBands, EMA,
  bullishengulfingpattern, bearishengulfingpattern,
  bullishharami, bearishharami,
  bullishharamicross, bearishharamicross,
  morningstar, eveningstar,
  morningdojistar, eveningdojistar,
  hammerpattern, hangingman,
  shootingstar,
  threewhitesoldiers, threeblackcrows,
  piercingline, darkcloudcover,
  doji,
  tweezertop, tweezerbottom,
  bullishmarubozu, bearishmarubozu,
} from 'technicalindicators';

const MIN_CANDLES = 26;

// Weights control how much each indicator contributes to the final score.
// Higher weight = more influence. They don't need to sum to 1.
export const WEIGHTS = {
  rsi: 1.0,
  macd: 1.5,
  bb: 0.8,
  ema: 1.2,
  volume: 0.7,
  candles: 1.3,
};

export function analyze(buffer) {
  if (buffer.length < MIN_CANDLES) {
    return null;
  }

  const opens = buffer.opens();
  const closes = buffer.closes();
  const highs = buffer.highs();
  const lows = buffer.lows();
  const volumes = buffer.volumes();
  const lastClose = closes[closes.length - 1];

  const rsi = computeRSI(closes);
  const macd = computeMACD(closes);
  const bb = computeBB(closes, lastClose);
  const ema = computeEMA(closes);
  const volume = computeVolume(volumes);
  const candles = computeCandlePatterns({ open: opens, high: highs, low: lows, close: closes });

  return { rsi, macd, bb, ema, volume, candles };
}

function computeRSI(closes) {
  const values = RSI.calculate({ values: closes, period: 14 });
  const value = values[values.length - 1];

  let signal = 0;
  let strength = 0;

  if (value > 70) {
    signal = -1;
    strength = Math.min((value - 70) / 30, 1);
  } else if (value < 30) {
    signal = 1;
    strength = Math.min((30 - value) / 30, 1);
  }

  return { value: round(value), signal, strength: round(strength), weight: WEIGHTS.rsi, name: 'RSI(14)' };
}

function computeMACD(closes) {
  const values = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const current = values[values.length - 1];
  const prev = values[values.length - 2];

  if (!current || !prev || current.histogram == null || prev.histogram == null) {
    return { value: null, signal: 0, strength: 0, weight: WEIGHTS.macd, name: 'MACD(12,26,9)' };
  }

  let signal = 0;
  let strength = 0;
  const crossover =
    (current.histogram > 0 && prev.histogram <= 0) ||
    (current.histogram < 0 && prev.histogram >= 0);

  if (crossover) {
    // Crossovers get full strength — they're the strongest MACD signal
    signal = current.histogram > 0 ? 1 : -1;
    strength = 1.0;
  } else if (current.histogram > 0) {
    signal = 1;
    // Momentum: increasing histogram = stronger signal
    strength = current.histogram > prev.histogram ? 0.7 : 0.3;
  } else if (current.histogram < 0) {
    signal = -1;
    strength = current.histogram < prev.histogram ? 0.7 : 0.3;
  }

  return {
    value: round(current.histogram),
    signal,
    strength: round(strength),
    crossover,
    weight: WEIGHTS.macd,
    name: 'MACD(12,26,9)',
  };
}

function computeBB(closes, lastClose) {
  const values = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });

  const current = values[values.length - 1];
  if (!current) return { value: null, signal: 0, strength: 0, weight: WEIGHTS.bb, name: 'BB(20,2)' };

  const { upper, lower, middle } = current;
  const bandwidth = upper - lower;
  const position = bandwidth > 0 ? (lastClose - lower) / bandwidth : 0.5;

  let signal = 0;
  let strength = 0;

  if (position > 0.8) {
    signal = -1;
    strength = Math.min((position - 0.8) / 0.2, 1);
  } else if (position < 0.2) {
    signal = 1;
    strength = Math.min((0.2 - position) / 0.2, 1);
  }

  return {
    value: round(position * 100),
    signal,
    strength: round(strength),
    weight: WEIGHTS.bb,
    name: 'BB(20,2)',
    detail: { upper: round(upper), middle: round(middle), lower: round(lower) },
  };
}

function computeEMA(closes) {
  const fast = EMA.calculate({ values: closes, period: 9 });
  const slow = EMA.calculate({ values: closes, period: 21 });

  const fastVal = fast[fast.length - 1];
  const slowVal = slow[slow.length - 1];

  if (fastVal == null || slowVal == null) {
    return { value: null, signal: 0, strength: 0, weight: WEIGHTS.ema, name: 'EMA(9/21)' };
  }

  const prevFast = fast[fast.length - 2];
  const prevSlow = slow[slow.length - 2];

  let signal = 0;
  let strength = 0;

  const crossover =
    prevFast != null && prevSlow != null &&
    Math.sign(fastVal - slowVal) !== Math.sign(prevFast - prevSlow);

  if (fastVal > slowVal) {
    signal = 1;
    strength = crossover ? 1.0 : 0.5;
  } else if (fastVal < slowVal) {
    signal = -1;
    strength = crossover ? 1.0 : 0.5;
  }

  return {
    value: round(fastVal - slowVal),
    signal,
    strength: round(strength),
    crossover,
    weight: WEIGHTS.ema,
    name: 'EMA(9/21)',
  };
}

function computeVolume(volumes) {
  if (volumes.length < 2) {
    return { value: null, signal: 0, strength: 0, weight: WEIGHTS.volume, name: 'VOL' };
  }

  const lookback = volumes.slice(-20);
  const avg = lookback.reduce((a, b) => a + b, 0) / lookback.length;
  const current = volumes[volumes.length - 1];
  const ratio = avg > 0 ? current / avg : 1;

  // Volume alone doesn't give direction — it confirms trend conviction.
  // signal stays 0; the predictor uses strength as a multiplier on the aggregate.
  return {
    value: round(ratio, 2),
    signal: 0,
    strength: round(Math.min(ratio, 3) / 3),
    weight: WEIGHTS.volume,
    name: 'VOL',
    confirming: ratio > 1.2,
  };
}

// Each entry: [detectorFn, displayName, direction (+1 bull / -1 bear / 0 neutral), strength tier]
const CANDLE_PATTERNS = [
  // Strong reversal patterns (3-candle)
  [morningstar,              'Morning Star',        1,  1.0],
  [eveningstar,              'Evening Star',       -1,  1.0],
  [morningdojistar,          'Morning Doji Star',   1,  1.0],
  [eveningdojistar,          'Evening Doji Star',  -1,  1.0],
  [threewhitesoldiers,       'Three White Soldiers', 1, 1.0],
  [threeblackcrows,          'Three Black Crows',  -1,  1.0],

  // Strong 2-candle patterns
  [bullishengulfingpattern,  'Bull Engulfing',      1,  0.9],
  [bearishengulfingpattern,  'Bear Engulfing',     -1,  0.9],
  [piercingline,             'Piercing Line',       1,  0.8],
  [darkcloudcover,           'Dark Cloud Cover',   -1,  0.8],

  // Moderate patterns
  [bullishharami,            'Bull Harami',         1,  0.6],
  [bearishharami,            'Bear Harami',        -1,  0.6],
  [bullishharamicross,       'Bull Harami Cross',   1,  0.65],
  [bearishharamicross,       'Bear Harami Cross',  -1,  0.65],
  [tweezerbottom,            'Tweezer Bottom',      1,  0.6],
  [tweezertop,               'Tweezer Top',        -1,  0.6],
  [bullishmarubozu,          'Bull Marubozu',       1,  0.7],
  [bearishmarubozu,          'Bear Marubozu',      -1,  0.7],

  // Single-candle patterns
  [hammerpattern,            'Hammer',              1,  0.5],
  [hangingman,               'Hanging Man',        -1,  0.5],
  [shootingstar,             'Shooting Star',      -1,  0.5],
  [doji,                     'Doji',                0,  0.3],
];

function computeCandlePatterns(stockData) {
  const detected = [];

  for (const [fn, name, direction, strength] of CANDLE_PATTERNS) {
    try {
      if (fn(stockData)) {
        detected.push({ name, direction, strength });
      }
    } catch {
      // Some patterns need more candles than available — skip silently
    }
  }

  if (detected.length === 0) {
    return {
      value: null,
      signal: 0,
      strength: 0,
      weight: WEIGHTS.candles,
      name: 'CANDLE',
      patterns: [],
    };
  }

  // Use the strongest detected pattern to determine signal.
  // If multiple patterns fire, average their direction weighted by strength.
  let dirSum = 0;
  let strSum = 0;
  let bestStrength = 0;

  for (const p of detected) {
    dirSum += p.direction * p.strength;
    strSum += p.strength;
    if (p.strength > bestStrength) bestStrength = p.strength;
  }

  const avgDir = strSum > 0 ? dirSum / strSum : 0;
  const signal = avgDir > 0.1 ? 1 : avgDir < -0.1 ? -1 : 0;

  return {
    value: detected.length,
    signal,
    strength: round(bestStrength),
    weight: WEIGHTS.candles,
    name: 'CANDLE',
    patterns: detected.map((p) => p.name),
  };
}

function round(v, decimals = 4) {
  if (v == null) return null;
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
}
