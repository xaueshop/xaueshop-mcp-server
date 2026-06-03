/**
 * JSON-RPC provider with automatic fallback.
 *
 * Reads `ETH_RPC_URL` and an optional comma-separated `ETH_RPC_URL_FALLBACK`
 * list from the environment.
 *
 * If ETH_RPC_URL is not set, falls back to a public node with a warning.
 * Public nodes are rate-limited and less reliable — set ETH_RPC_URL to a
 * dedicated endpoint (Alchemy, Infura, etc.) for production use.
 */

import { FallbackProvider, JsonRpcProvider } from 'ethers';

const DEFAULT_RPC = 'https://eth.llamarpc.com';

function parseRpcList(envVar) {
  if (!envVar) return [];
  return String(envVar)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createProvider({
  primary = process.env.ETH_RPC_URL,
  fallbacks = parseRpcList(process.env.ETH_RPC_URL_FALLBACK),
} = {}) {
  if (!primary) {
    process.stderr.write(
      '[xaueshop] ETH_RPC_URL not set — using public node (rate-limited).\n' +
      '[xaueshop] Set ETH_RPC_URL to a dedicated endpoint for better reliability.\n',
    );
    primary = DEFAULT_RPC;
  }

  if (!/^https?:\/\//i.test(primary)) {
    throw new Error(`ETH_RPC_URL must start with https:// or http://: ${primary}`);
  }

  const urls = [primary, ...fallbacks].filter(Boolean);
  if (urls.length === 1) {
    return new JsonRpcProvider(urls[0], undefined, { batchMaxCount: 1 });
  }
  const providers = urls.map((u, i) => ({
    provider: new JsonRpcProvider(u),
    priority: i + 1,
    stallTimeout: 2000,
    weight: 1,
  }));
  return new FallbackProvider(providers, undefined, { quorum: 1 });
}
