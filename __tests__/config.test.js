import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.js';

const ROUTER_MN = '0x885Df4908101C07FC6853ca2fb853eb7B33Cece6';
const XAUE_MN   = '0xd5d6840ed95f58faf537865dca15d5f99195f87a';
const XAUT_MN   = '0x68749665FF8D2d112Fa859AA293F07A622782F38';

let savedEnv;
test.beforeEach(() => { savedEnv = { ...process.env }; });
test.afterEach(()  => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
});

// ---------------------------------------------------------------------------
// Mainnet defaults (no env vars needed)
// ---------------------------------------------------------------------------

test('uses mainnet defaults when no env vars set', () => {
  delete process.env.XAUE_ROUTER_ADDRESS;
  delete process.env.XAUE_TOKEN_ADDRESS;
  delete process.env.XAUT_TOKEN_ADDRESS;
  const cfg = loadConfig();
  assert.equal(cfg.contracts.router,     ROUTER_MN);
  assert.equal(cfg.tokens.XAUE.address,  XAUE_MN);
  assert.equal(cfg.tokens.XAUE.decimals, 18);
  assert.equal(cfg.tokens.XAUT.address,  XAUT_MN);
  assert.equal(cfg.tokens.XAUT.decimals, 6);
});

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------

test('XAUE_ROUTER_ADDRESS overrides mainnet default', () => {
  const custom = '0x1111111111111111111111111111111111111111';
  process.env.XAUE_ROUTER_ADDRESS = custom;
  const cfg = loadConfig();
  assert.equal(cfg.contracts.router, custom);
});

test('XAUE_TOKEN_ADDRESS overrides mainnet default', () => {
  const custom = '0x2222222222222222222222222222222222222222';
  process.env.XAUE_TOKEN_ADDRESS = custom;
  const cfg = loadConfig();
  assert.equal(cfg.tokens.XAUE.address, custom);
});

test('XAUT_TOKEN_ADDRESS overrides mainnet default', () => {
  const custom = '0x3333333333333333333333333333333333333333';
  process.env.XAUT_TOKEN_ADDRESS = custom;
  const cfg = loadConfig();
  assert.equal(cfg.tokens.XAUT.address, custom);
});

test('XAUE_TOKEN_DECIMALS overrides default of 18', () => {
  process.env.XAUE_TOKEN_DECIMALS = '6';
  const cfg = loadConfig();
  assert.equal(cfg.tokens.XAUE.decimals, 6);
});

// ---------------------------------------------------------------------------
// REPLACE_ME / invalid address is rejected even with override attempt
// ---------------------------------------------------------------------------

test('REPLACE_ME router address falls back to mainnet default', () => {
  process.env.XAUE_ROUTER_ADDRESS = 'REPLACE_ME';
  const cfg = loadConfig();
  assert.equal(cfg.contracts.router, ROUTER_MN);
});

test('zero address falls back to mainnet default', () => {
  process.env.XAUE_ROUTER_ADDRESS = '0x0000000000000000000000000000000000000000';
  const cfg = loadConfig();
  assert.equal(cfg.contracts.router, ROUTER_MN);
});

test('throws on invalid address format', () => {
  process.env.XAUE_TOKEN_ADDRESS = 'not-an-address';
  assert.throws(() => loadConfig(), /not a valid 0x address/);
});

// ---------------------------------------------------------------------------
// Other defaults
// ---------------------------------------------------------------------------

test('token_rules defaults are correct', () => {
  const cfg = loadConfig();
  assert.equal(cfg.token_rules.XAUT.requires_reset_approve, true);
  assert.equal(cfg.token_rules.XAUE.requires_reset_approve, false);
});

test('event_scan defaults to 200000', () => {
  const cfg = loadConfig();
  assert.equal(cfg.event_scan.default_lookback_blocks, 200000);
});

test('XAUE_EVENT_LOOKBACK_BLOCKS can be overridden', () => {
  process.env.XAUE_EVENT_LOOKBACK_BLOCKS = '500';
  const cfg = loadConfig();
  assert.equal(cfg.event_scan.default_lookback_blocks, 500);
});
