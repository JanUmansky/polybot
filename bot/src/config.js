import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'];

const interval = process.env.INTERVAL || '5m';

if (!VALID_INTERVALS.includes(interval)) {
  console.error(`Invalid interval "${interval}". Valid: ${VALID_INTERVALS.join(', ')}`);
  process.exit(1);
}

export default {
  mongoUri: process.env.MONGODB_URI,

  binance: {
    symbol: (process.env.SYMBOL || 'btcusdt').toLowerCase(),
    interval,
    bufferSize: parseInt(process.env.BUFFER_SIZE, 10) || 100,
    wsUrl: 'wss://stream.binance.com:9443',
    apiUrl: 'https://api.binance.com',
  },

  polymarket: {
    wsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    gammaApiUrl: 'https://gamma-api.polymarket.com',
    pingIntervalMs: 10_000,
  },
};
