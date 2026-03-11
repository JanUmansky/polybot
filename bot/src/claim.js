import { Wallet } from 'ethers';
import { createWalletClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { createLogger } from './logger.js';
import { broadcast } from './feed.js';

const logger = createLogger('Claim', {
  emit: (event, data) => broadcast('claim', event, data),
});

const CTF = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CHAIN_ID = 137;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

const REDEEM_ABI = [{
  name: 'redeemPositions',
  type: 'function',
  inputs: [
    { name: 'collateralToken', type: 'address' },
    { name: 'parentCollectionId', type: 'bytes32' },
    { name: 'conditionId', type: 'bytes32' },
    { name: 'indexSets', type: 'uint256[]' },
  ],
}];

const DEFAULT_POLL_MS = 5 * 60 * 1000; // 5 minutes

let pollTimer = null;

async function buildRelayClient() {
  const { RelayClient, RelayerTxType } = await import('@polymarket/builder-relayer-client');
  const { BuilderConfig } = await import('@polymarket/builder-signing-sdk');

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');

  const rpc = process.env.POLYGON_RPC;
  if (!rpc) throw new Error('POLYGON_RPC not set — add a Polygon RPC URL to .env');

  const builderKey = process.env.BUILDER_API_KEY;
  const builderSecret = process.env.BUILDER_API_SECRET;
  const builderPassphrase = process.env.BUILDER_API_PASSPHRASE;
  if (!builderKey || !builderSecret || !builderPassphrase) {
    throw new Error('Builder API credentials not set (BUILDER_API_KEY, BUILDER_API_SECRET, BUILDER_API_PASSPHRASE)');
  }

  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http(rpc) });

  const builderConfig = new BuilderConfig({
    localBuilderCreds: { key: builderKey, secret: builderSecret, passphrase: builderPassphrase },
  });

  return new RelayClient(
    'https://relayer-v2.polymarket.com/',
    CHAIN_ID,
    walletClient,
    builderConfig,
    RelayerTxType.PROXY,
  );
}

async function fetchRedeemablePositions() {
  const funder = process.env.POLY_FUNDER;
  if (!funder) throw new Error('POLY_FUNDER not set');

  const url = `https://data-api.polymarket.com/positions?user=${funder}&limit=100&redeemable=true`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Positions API returned ${resp.status}`);
  return resp.json();
}

function muteConsole() {
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = () => {};
  return () => Object.assign(console, saved);
}

async function claimCondition(relayClient, conditionId) {
  const cid = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;

  const data = encodeFunctionData({
    abi: REDEEM_ABI,
    functionName: 'redeemPositions',
    args: [USDC_E, ZERO_BYTES32, cid, [1n, 2n]],
  });

  const unmute = muteConsole();
  try {
    const response = await relayClient.execute([{ to: CTF, data, value: '0' }], 'Redeem winnings');
    const result = await response.wait();
    return result?.transactionHash ?? null;
  } finally {
    unmute();
  }
}

export async function fetchPositionsForCondition(conditionId) {
  const funder = process.env.POLY_FUNDER;
  if (!funder) return [];

  const url = `https://data-api.polymarket.com/positions?user=${funder}&conditionId=${conditionId}&limit=10`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Positions API returned ${resp.status}`);
  return resp.json();
}

export async function claimAllWinnings() {
  let positions;
  try {
    positions = await fetchRedeemablePositions();
  } catch (err) {
    logger.error(`Failed to fetch redeemable positions: ${err.message}`);
    return;
  }

  const byCondition = new Map();
  for (const p of positions) {
    if (!p.redeemable || !(Number(p.size) > 0)) continue;
    const cid = p.conditionId || p.condition_id;
    if (!cid || byCondition.has(cid)) continue;
    byCondition.set(cid, p);
  }

  if (byCondition.size === 0) return;

  logger.info(`Found ${byCondition.size} redeemable position(s) — claiming...`);

  let relayClient;
  try {
    relayClient = await buildRelayClient();
  } catch (err) {
    logger.error(`Failed to build relay client: ${err.message}`);
    return;
  }

  for (const [conditionId, pos] of byCondition) {
    const label = (pos.title || pos.question || conditionId).slice(0, 60);
    try {
      const txHash = await claimCondition(relayClient, conditionId);
      if (txHash) {
        logger.info(`Claimed "${label}" — tx: ${txHash}`);
      } else {
        logger.warn(`Claimed "${label}" — no tx hash returned`);
      }
    } catch (err) {
      logger.error(`Failed to claim "${label}": ${err.message}`);
    }
  }
}

export function startClaimLoop(intervalMs = DEFAULT_POLL_MS) {
  if (pollTimer) return;

  if (!process.env.POLYGON_RPC) {
    logger.warn('POLYGON_RPC not set — auto-claim disabled');
    return;
  }

  logger.info(`Auto-claim loop started (every ${Math.round(intervalMs / 60_000)}min)`);
  claimAllWinnings();
  pollTimer = setInterval(claimAllWinnings, intervalMs);
}

export function stopClaimLoop() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  logger.info('Auto-claim loop stopped');
}
