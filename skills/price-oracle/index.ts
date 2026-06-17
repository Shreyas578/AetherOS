import axios from 'axios';
import { ethers } from 'ethers';
import { PriceResult } from '../shared/types';
import { MLCache, createLogger } from '../shared/index';
import 'dotenv/config';

const logger = createLogger('price-oracle');
const cache = new MLCache();

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// CoinGecko token ID mapping
const TOKEN_IDS: Record<string, string> = {
  ETH:   'ethereum',
  BTC:   'bitcoin',
  SOL:   'solana',
  BNB:   'binancecoin',
  MATIC: 'polygon-ecosystem-token',
  AVAX:  'avalanche-2',
  ARB:   'arbitrum',
  LINK:  'chainlink',
  PHRS:  'pharos-network',  // Pharos mainnet token (PROS), ~$0.56
  USDC:  'usd-coin',
  USDT:  'tether',
};

// In-memory batch cache: all token prices fetched in one CoinGecko call
let batchCache: Record<string, PriceResult> = {};
let batchCacheTime = 0;
const BATCH_CACHE_TTL = 60000; // 60s — 1 call per minute covers all tokens

export interface PriceOracleConfig {
  rpcUrl?: string;
  poolAddress?: string;
  tokenIn?: string;
  tokenOut?: string;
}

/**
 * Batch-fetch all known token prices in ONE CoinGecko request.
 * Caches for 60s so multiple agents/tokens share a single API call.
 */
async function fetchBatchFromCoinGecko(): Promise<void> {
  const now = Date.now();
  if (now - batchCacheTime < BATCH_CACHE_TTL && Object.keys(batchCache).length > 0) return;

  const apiKey  = process.env.COINGECKO_API_KEY;
  const baseUrl = process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3';
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

  // All IDs in one request — single API call for all tokens
  const allIds = Object.values(TOKEN_IDS).join(',');

  const response = await axios.get(`${baseUrl}/simple/price`, {
    params: { ids: allIds, vs_currencies: 'usd', include_24hr_change: 'true' },
    headers,
    timeout: 10000,
  });

  const data = response.data;
  const phrsUsd: number = data['pharos-network']?.usd || 0;

  // Build cache for every token
  for (const [symbol, cgId] of Object.entries(TOKEN_IDS)) {
    const d = data[cgId];
    if (!d) continue;
    batchCache[symbol] = {
      token:     symbol,
      priceUsd:  d.usd ?? 0,
      pricePhrs: phrsUsd > 0 ? (d.usd ?? 0) / phrsUsd : 0,
      source:    'coingecko',
      timestamp: now,
      change24h: d.usd_24h_change ?? 0,
    };
  }
  batchCacheTime = now;
  logger.info('Batch price fetch complete', {
    tokens: Object.keys(batchCache).length,
    sample: `ETH=$${batchCache['ETH']?.priceUsd ?? '?'}, PHRS=$${batchCache['PHRS']?.priceUsd ?? '?'}`,
  });
}

/**
 * Get price for a single token — uses shared batch cache (one CoinGecko call for all)
 */
export async function getPrice(
  token: string,
  config: PriceOracleConfig = {}
): Promise<PriceResult> {
  const upper = token.toUpperCase();

  // 1. Check MLCache (per-token short TTL)
  const cacheKey = MLCache.hashKey(`price:${upper}:${Date.now() - (Date.now() % 60000)}`);
  const cached = cache.get<PriceResult>(cacheKey);
  if (cached) {
    logger.debug('Price cache hit', { token });
    return { ...cached, source: 'cached' };
  }

  // 2. Batch fetch all tokens (single CoinGecko call, shared 60s cache)
  try {
    await fetchBatchFromCoinGecko();
    const result = batchCache[upper];
    if (result && result.priceUsd > 0) {
      cache.set(cacheKey, result, 'forecast', 60);
      return result;
    }
  } catch (err) {
    logger.warn('CoinGecko batch fetch failed, trying on-chain pool', { token, err: String(err) });
  }

  // 3. Fallback: on-chain pool
  if (config.poolAddress && config.rpcUrl) {
    try {
      return await fetchFromPool(token, config);
    } catch (err) {
      logger.error('On-chain pool also failed', { token, err: String(err) });
    }
  }

  throw new Error(`Price unavailable for ${token}: all sources failed`);
}

async function fetchFromPool(token: string, config: PriceOracleConfig): Promise<PriceResult> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl || process.env.PHAROS_RPC_URL);
  const pair = new ethers.Contract(config.poolAddress!, PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const isToken0 = token0.toLowerCase() === config.tokenIn?.toLowerCase();
  const r0 = isToken0 ? BigInt(reserve0) : BigInt(reserve1);
  const r1 = isToken0 ? BigInt(reserve1) : BigInt(reserve0);
  return {
    token,
    priceUsd:  0,
    pricePhrs: Number(r1) / Number(r0),
    source:    'onchain',
    timestamp: Date.now(),
  };
}

/**
 * Get multiple token prices — all fetched in one CoinGecko call via batch cache
 */
export async function getPrices(
  tokens: string[],
  config: PriceOracleConfig = {}
): Promise<Record<string, PriceResult>> {
  try {
    await fetchBatchFromCoinGecko();
  } catch (err) {
    logger.warn('Batch fetch failed for getPrices', { err: String(err) });
  }
  const out: Record<string, PriceResult> = {};
  for (const t of tokens) {
    const upper = t.toUpperCase();
    out[t] = batchCache[upper] ?? {
      token: t, priceUsd: 0, pricePhrs: 0,
      source: 'coingecko' as const, timestamp: Date.now(),
    };
  }
  return out;
}
