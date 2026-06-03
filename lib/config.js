/**
 * config.js — load XAUERouter config from environment variables.
 *
 * Mainnet defaults are hardcoded — no env vars needed for mainnet.
 * Override with env vars for testnet or custom deployments.
 *
 * Optional env vars (override mainnet defaults):
 *   XAUE_ROUTER_ADDRESS   — XAUERouter proxy address
 *   XAUE_TOKEN_ADDRESS    — XAUE token address
 *   XAUE_TOKEN_DECIMALS   — XAUE token decimals (default: 18)
 *   XAUT_TOKEN_ADDRESS    — XAUT address
 *   XAUT_TOKEN_DECIMALS   — XAUT decimals (default: 6)
 *   XAUE_EVENT_LOOKBACK_BLOCKS — blocks to scan for list tool (default: 200000)
 */

const XAUE_ROUTER_MAINNET   = '0x885Df4908101C07FC6853ca2fb853eb7B33Cece6';
const XAUE_TOKEN_MAINNET    = '0xd5d6840ed95f58faf537865dca15d5f99195f87a';
const XAUE_DECIMALS_DEFAULT = 18;
const XAUT_MAINNET_ADDRESS  = '0x68749665FF8D2d112Fa859AA293F07A622782F38';
const XAUT_DECIMALS_DEFAULT = 6;

const PLACEHOLDER = new Set(['', 'REPLACE_ME', '0x0000000000000000000000000000000000000000']);

function validateAddress(v, name) {
  if (!v || PLACEHOLDER.has(v)) throw new Error(`"${name}" is not set`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`"${name}" is not a valid 0x address: ${v}`);
  return v;
}

function resolveAddress(envKey, mainnetDefault) {
  const v = process.env[envKey];
  return (v && !PLACEHOLDER.has(v)) ? validateAddress(v, envKey) : mainnetDefault;
}

function parseDecimals(envKey, defaultValue) {
  const raw = parseInt(process.env[envKey] ?? String(defaultValue), 10);
  if (!Number.isInteger(raw) || raw < 0 || raw > 77) {
    throw new Error(`${envKey} must be an integer between 0 and 77 (got: ${process.env[envKey]})`);
  }
  return raw;
}

function parseLookback(envKey, defaultValue) {
  const raw = parseInt(process.env[envKey] ?? String(defaultValue), 10);
  if (!Number.isInteger(raw) || raw < 1 || raw > 10_000_000) {
    throw new Error(`${envKey} must be a positive integer up to 10,000,000 (got: ${process.env[envKey]})`);
  }
  return raw;
}

export function loadConfig() {
  return {
    contracts: {
      router: resolveAddress('XAUE_ROUTER_ADDRESS', XAUE_ROUTER_MAINNET),
    },
    tokens: {
      XAUT: {
        address:  resolveAddress('XAUT_TOKEN_ADDRESS', XAUT_MAINNET_ADDRESS),
        decimals: parseDecimals('XAUT_TOKEN_DECIMALS', XAUT_DECIMALS_DEFAULT),
      },
      XAUE: {
        address:  resolveAddress('XAUE_TOKEN_ADDRESS', XAUE_TOKEN_MAINNET),
        decimals: parseDecimals('XAUE_TOKEN_DECIMALS', XAUE_DECIMALS_DEFAULT),
      },
    },
    token_rules: {
      XAUT: { requires_reset_approve: true  },
      XAUE: { requires_reset_approve: false },
    },
    event_scan: {
      default_lookback_blocks: parseLookback('XAUE_EVENT_LOOKBACK_BLOCKS', 200000),
    },
  };
}

export function tokenSpec(cfg, symbol) {
  const t = cfg.tokens[symbol];
  if (!t) throw new Error(`Unknown token "${symbol}"`);
  return t;
}
