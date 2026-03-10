import config from './config.js';

function parseKline(k) {
  return {
    time: k.t ?? k[0],
    open: parseFloat(k.o ?? k[1]),
    high: parseFloat(k.h ?? k[2]),
    low: parseFloat(k.l ?? k[3]),
    close: parseFloat(k.c ?? k[4]),
    volume: parseFloat(k.v ?? k[5]),
  };
}

export class CandleBuffer {
  constructor(maxSize = config.binance.bufferSize) {
    this.maxSize = maxSize;
    this.candles = [];
  }

  async seed() {
    const url =
      `${config.binance.apiUrl}/api/v3/klines` +
      `?symbol=${config.binance.symbol.toUpperCase()}&interval=${config.binance.interval}&limit=${this.maxSize}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance REST error ${res.status}: ${await res.text()}`);

    const raw = await res.json();
    // REST klines: [openTime, open, high, low, close, volume, closeTime, ...]
    // Drop the last entry -- it's the currently open (incomplete) candle
    this.candles = raw.slice(0, -1).map((arr) => ({
      time: arr[0],
      open: parseFloat(arr[1]),
      high: parseFloat(arr[2]),
      low: parseFloat(arr[3]),
      close: parseFloat(arr[4]),
      volume: parseFloat(arr[5]),
    }));
  }

  push(klineEvent) {
    const candle = parseKline(klineEvent);
    const last = this.candles[this.candles.length - 1];
    if (last && last.time === candle.time) {
      this.candles[this.candles.length - 1] = candle;
    } else {
      this.candles.push(candle);
    }
    if (this.candles.length > this.maxSize) {
      this.candles.shift();
    }
    return candle;
  }

  get length() {
    return this.candles.length;
  }

  opens() {
    return this.candles.map((c) => c.open);
  }

  closes() {
    return this.candles.map((c) => c.close);
  }

  highs() {
    return this.candles.map((c) => c.high);
  }

  lows() {
    return this.candles.map((c) => c.low);
  }

  volumes() {
    return this.candles.map((c) => c.volume);
  }

  last() {
    return this.candles[this.candles.length - 1] ?? null;
  }
}
