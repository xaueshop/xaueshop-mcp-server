import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonRpcProvider, FallbackProvider } from 'ethers';
import { createProvider } from '../lib/provider.js';

let savedEnv;
test.beforeEach(() => { savedEnv = { ...process.env }; });
test.afterEach(()  => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
});

test('falls back to public node when ETH_RPC_URL is not set', () => {
  delete process.env.ETH_RPC_URL;
  delete process.env.ETH_RPC_URL_FALLBACK;
  const p = createProvider();
  assert.ok(p instanceof JsonRpcProvider);
});

test('single URL returns JsonRpcProvider', () => {
  const p = createProvider({ primary: 'https://eth.llamarpc.com' });
  assert.ok(p instanceof JsonRpcProvider);
});

test('primary + fallbacks returns FallbackProvider', () => {
  const p = createProvider({
    primary:   'https://eth.llamarpc.com',
    fallbacks: ['https://eth.drpc.org'],
  });
  assert.ok(p instanceof FallbackProvider);
});

test('reads primary from ETH_RPC_URL env var', () => {
  process.env.ETH_RPC_URL = 'https://eth.llamarpc.com';
  delete process.env.ETH_RPC_URL_FALLBACK;
  const p = createProvider();
  assert.ok(p instanceof JsonRpcProvider);
});

test('reads fallbacks from ETH_RPC_URL_FALLBACK env var', () => {
  process.env.ETH_RPC_URL          = 'https://eth.llamarpc.com';
  process.env.ETH_RPC_URL_FALLBACK = 'https://eth.drpc.org,https://ethereum.publicnode.com';
  const p = createProvider();
  assert.ok(p instanceof FallbackProvider);
});
