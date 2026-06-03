#!/usr/bin/env node
/**
 * xaueshop-mcp — MCP server for XAUERouter mint and redeem operations.
 *
 * Tools exposed:
 *   xaue_balance              — ETH / XAUT / XAUE balances
 *   xaue_allowance            — ERC-20 allowance for XAUT or XAUE to router
 *   xaue_approve              — approve XAUT or XAUE to router
 *   xaue_is_blacklisted       — router blacklist lookup
 *   xaue_paused               — router pause state
 *   xaue_mint                 — XAUT → XAUE via router
 *   xaue_request_redeem       — XAUE → pending redemption request
 *   xaue_redeem_status        — user-visible status for a routerReqId
 *   xaue_claim_xaut           — claim XAUT after approved redemption
 *   xaue_claim_rejected_shares — reclaim XAUE after rejected redemption
 *   xaue_list_redemptions     — list user's RedemptionRequestedViaRouter events
 *
 * Required env vars (set via MCP server config or shell):
 *   ETH_RPC_URL    — Ethereum JSON-RPC endpoint
 *   PRIVATE_KEY    — default signing key (0x...), or pass key_env/key_file per tool call
 *
 * Required config file:
 *   ~/.xaueshop/router.yaml — contract & token addresses
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  Contract,
  formatUnits,
  parseUnits,
  ZeroAddress,
  isAddress,
} from 'ethers';

import { ROUTER_ABI, ERC20_ABI, ROUTER_STATUS, ROUTER_STATUS_CODES, applySlippage, quoteForMint, quoteForRedeem } from './lib/abi.js';
import { loadConfig, tokenSpec } from './lib/config.js';
import { createProvider } from './lib/provider.js';
import { createSigner } from './lib/signer.js';

// Shared key-source schema fields added to every write tool.
const KEY_SOURCE_SCHEMA = {
  key_env:  z.string().optional().describe('Env var name holding the private key, e.g. "MY_KEY"'),
  key_file: z.string().optional().describe('File path holding the private key, e.g. "~/trading.key"'),
};

// ---------------------------------------------------------------------------
// Context builder (mirrors router.js buildContext)
// ---------------------------------------------------------------------------

async function buildContext({ needSigner = false, keyEnv, keyFile } = {}) {
  const cfg = loadConfig();
  const provider = createProvider();
  const signer = needSigner
    ? await createSigner({ keyEnv, keyFile }, provider)
    : null;

  const routerAddr = cfg.contracts.router;
  const conn = signer ?? provider;
  const router = new Contract(routerAddr, ROUTER_ABI, conn);
  const xaut = new Contract(cfg.tokens.XAUT.address, ERC20_ABI, conn);
  const xaue = new Contract(cfg.tokens.XAUE.address, ERC20_ABI, conn);

  return { cfg, provider, signer, router, xaut, xaue, routerAddr };
}

function walletAddr(ctx) {
  if (!ctx.signer) throw new Error('signer required');
  return ctx.signer.address ?? ctx.signer.getAddress();
}

function tokenContract(ctx, symbol) {
  if (symbol === 'XAUT') return { contract: ctx.xaut, decimals: ctx.cfg.tokens.XAUT.decimals };
  if (symbol === 'XAUE') return { contract: ctx.xaue, decimals: ctx.cfg.tokens.XAUE.decimals };
  throw new Error(`Unknown token "${symbol}"`);
}

function needsResetApprove(cfg, symbol) {
  return Boolean(cfg.token_rules?.[symbol]?.requires_reset_approve);
}

async function waitOk(tx, label) {
  const rec = await tx.wait(1);
  if (!rec || rec.status !== 1) throw new Error(`${label}: transaction reverted (${tx.hash})`);
  return { txHash: tx.hash, gasUsed: String(rec.gasUsed), blockNumber: rec.blockNumber };
}

function toBigIntSafe(v) {
  if (typeof v === 'bigint') return v;
  return BigInt(v);
}

function toJson(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = toJson(v[k]);
    return o;
  }
  return v;
}

function ok(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(toJson(obj), null, 2) }] };
}

function err(e) {
  const msg = e?.message || String(e);
  return { isError: true, content: [{ type: 'text', text: msg }] };
}

// Annotation presets
const READ  = { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true };
const CLAIM = { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: true };

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'xaueshop-mcp',
  version: '0.1.0',
});

// ── xaue_balance ────────────────────────────────────────────────────────────

server.tool(
  'xaue_balance',
  'Get ETH, XAUT, and XAUE balances. Defaults to the configured wallet; pass address to query any wallet.',
  { address: z.string().optional().describe('Wallet address to query (defaults to configured wallet)') },
  READ,
  async ({ address } = {}) => {
    try {
      const needSigner = !address;
      const ctx = await buildContext({ needSigner });
      const addr = address || await walletAddr(ctx);
      const [eth, xautBal, xaueBal] = await Promise.all([
        ctx.provider.getBalance(addr),
        ctx.xaut.balanceOf(addr),
        ctx.xaue.balanceOf(addr),
      ]);
      return ok({
        address: addr,
        ETH:  formatUnits(eth, 18),
        XAUT: formatUnits(xautBal, ctx.cfg.tokens.XAUT.decimals),
        XAUE: formatUnits(xaueBal, ctx.cfg.tokens.XAUE.decimals),
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_allowance ──────────────────────────────────────────────────────────

server.tool(
  'xaue_allowance',
  'Check the current ERC-20 allowance of XAUT or XAUE approved to the XAUERouter.',
  {
    token:   z.enum(['XAUT', 'XAUE']).describe('Token symbol'),
    address: z.string().optional().describe('Wallet address to query (defaults to configured wallet)'),
  },
  READ,
  async ({ token, address } = {}) => {
    try {
      const needSigner = !address;
      const ctx = await buildContext({ needSigner });
      const addr = address || await walletAddr(ctx);
      const { contract, decimals } = tokenContract(ctx, token);
      const raw = await contract.allowance(addr, ctx.routerAddr);
      return ok({
        address: addr,
        token,
        spender: ctx.routerAddr,
        allowance: formatUnits(raw, decimals),
        allowanceRaw: raw,
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_approve ────────────────────────────────────────────────────────────

server.tool(
  'xaue_approve',
  'Approve XAUT or XAUE for the XAUERouter to spend. XAUT uses USDT-style reset-before-approve automatically.',
  {
    token:  z.enum(['XAUT', 'XAUE']).describe('Token to approve'),
    amount: z.string().describe('Amount to approve (decimal string, e.g. "100")'),
    ...KEY_SOURCE_SCHEMA,
  },
  WRITE,
  async ({ token, amount, key_env, key_file }) => {
    try {
      const ctx = await buildContext({ needSigner: true, keyEnv: key_env, keyFile: key_file });
      const addr = await walletAddr(ctx);
      const { contract, decimals } = tokenContract(ctx, token);
      const amountRaw = parseUnits(String(amount), decimals);

      const events = [];
      if (needsResetApprove(ctx.cfg, token)) {
        const current = await contract.allowance(addr, ctx.routerAddr);
        if (current > 0n) {
          const reset = await contract.approve(ctx.routerAddr, 0n);
          events.push({ step: 'reset', ...(await waitOk(reset, 'approve reset')) });
        }
      }
      const tx = await contract.approve(ctx.routerAddr, amountRaw);
      const receipt = await waitOk(tx, 'approve');

      return ok({
        address: addr,
        token,
        spender: ctx.routerAddr,
        amount: formatUnits(amountRaw, decimals),
        events,
        ...receipt,
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_is_blacklisted ─────────────────────────────────────────────────────

server.tool(
  'xaue_is_blacklisted',
  'Check if an Ethereum address is on the XAUERouter blacklist.',
  { account: z.string().describe('Ethereum address to check (0x...)') },
  READ,
  async ({ account }) => {
    try {
      if (!isAddress(account)) return err(new Error('account must be a valid 0x address'));
      const ctx = await buildContext({ needSigner: false });
      const flag = await ctx.router.blacklist(account).catch(() => false);
      return ok({ account, blacklisted: Boolean(flag) });
    } catch (e) { return err(e); }
  },
);

// ── xaue_paused ─────────────────────────────────────────────────────────────

server.tool(
  'xaue_paused',
  'Check whether the XAUERouter contract is currently paused.',
  {},
  READ,
  async () => {
    try {
      const ctx = await buildContext({ needSigner: false });
      let paused = false;
      try { paused = Boolean(await ctx.router.paused()); }
      catch { paused = null; }
      return ok({ paused });
    } catch (e) { return err(e); }
  },
);

// ── xaue_mint ───────────────────────────────────────────────────────────────

server.tool(
  'xaue_mint',
  'Mint XAUE by depositing XAUT into the XAUERouter. Requires prior xaue_approve for XAUT. ' +
  'Fails with a clear error if allowance is insufficient, XAUT balance is too low, or sender is blacklisted.',
  {
    amount: z.string().describe('XAUT amount to deposit (decimal string, e.g. "10")'),
    ...KEY_SOURCE_SCHEMA,
  },
  WRITE,
  async ({ amount, key_env, key_file }) => {
    try {
      const ctx = await buildContext({ needSigner: true, keyEnv: key_env, keyFile: key_file });
      const decimals = ctx.cfg.tokens.XAUT.decimals;
      const amountRaw = parseUnits(String(amount), decimals);
      if (amountRaw <= 0n) return err(new Error('amount must be greater than 0'));
      const addr = await walletAddr(ctx);

      const [isBlocked, pausedState, xautBal, allowance] = await Promise.all([
        ctx.router.blacklist(addr).catch(() => false),
        ctx.router.paused().catch(() => false),
        ctx.xaut.balanceOf(addr),
        ctx.xaut.allowance(addr, ctx.routerAddr),
      ]);
      if (isBlocked)   return err(new Error('Router: sender is blacklisted — cannot mint'));
      if (pausedState) return err(new Error('Router: paused — cannot mint'));
      if (xautBal < amountRaw)  return err(new Error(`Insufficient XAUT balance (have ${formatUnits(xautBal, decimals)}, need ${amount})`));
      if (allowance < amountRaw) return err(new Error(`Insufficient XAUT allowance (have ${formatUnits(allowance, decimals)}); run xaue_approve first`));

      const xaueDecimals = ctx.cfg.tokens.XAUE.decimals;
      const q = await quoteForMint(ctx.router, amountRaw, decimals, xaueDecimals, ctx.provider);
      const minXaueOut = q?.minXaueOut ?? 0n;

      const xaueBefore = await ctx.xaue.balanceOf(addr);
      const tx = await ctx.router.mint(amountRaw, minXaueOut);
      const receipt = await waitOk(tx, 'mint');
      const xaueAfter = await ctx.xaue.balanceOf(addr);
      const xaueDelta = xaueAfter - xaueBefore;

      return ok({
        address:      addr,
        xautAmount:   formatUnits(amountRaw, decimals),
        xaueExpected: q ? formatUnits(q.xaueExpected, xaueDecimals) : null,
        xaueMinOut:   formatUnits(minXaueOut, xaueDecimals),
        xaueAmount:   formatUnits(xaueDelta, xaueDecimals),
        slippageBps:  q ? 30 : null,
        ...receipt,
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_request_redeem ─────────────────────────────────────────────────────

server.tool(
  'xaue_request_redeem',
  'Initiate a XAUE redemption request via the XAUERouter. Returns routerReqId and navReqId ' +
  'needed for later xaue_claim_xaut or xaue_claim_rejected_shares calls. ' +
  'Requires prior xaue_approve for XAUE.',
  {
    amount: z.string().describe('XAUE amount to redeem (decimal string, e.g. "5")'),
    ...KEY_SOURCE_SCHEMA,
  },
  WRITE,
  async ({ amount, key_env, key_file }) => {
    try {
      const ctx = await buildContext({ needSigner: true, keyEnv: key_env, keyFile: key_file });
      const decimals = ctx.cfg.tokens.XAUE.decimals;
      const amountRaw = parseUnits(String(amount), decimals);
      if (amountRaw <= 0n) return err(new Error('amount must be greater than 0'));
      const addr = await walletAddr(ctx);

      const [isBlocked, pausedState, xaueBal, allowance] = await Promise.all([
        ctx.router.blacklist(addr).catch(() => false),
        ctx.router.paused().catch(() => false),
        ctx.xaue.balanceOf(addr),
        ctx.xaue.allowance(addr, ctx.routerAddr),
      ]);
      if (isBlocked)   return err(new Error('Router: sender is blacklisted — cannot requestRedeem'));
      if (pausedState) return err(new Error('Router: paused — cannot requestRedeem'));
      if (xaueBal < amountRaw)  return err(new Error(`Insufficient XAUE balance (have ${formatUnits(xaueBal, decimals)}, need ${amount})`));
      if (allowance < amountRaw) return err(new Error(`Insufficient XAUE allowance; run xaue_approve first`));

      const xautDecimals = ctx.cfg.tokens.XAUT.decimals;
      const q = await quoteForRedeem(ctx.router, amountRaw, xautDecimals, decimals, ctx.provider);
      const minXautOut = q?.minXautOut ?? 0n;

      const tx = await ctx.router.requestRedeem(amountRaw, minXautOut);
      const rec = await tx.wait(1);
      if (!rec || rec.status !== 1) return err(new Error(`requestRedeem: transaction reverted (${tx.hash})`));

      const iface = ctx.router.interface;
      let parsed = null;
      for (const log of rec.logs ?? []) {
        try {
          const d = iface.parseLog(log);
          if (d?.name === 'RedemptionRequestedViaRouter') { parsed = d.args; break; }
        } catch { /* foreign log */ }
      }

      return ok({
        address:      addr,
        xaueAmount:   formatUnits(amountRaw, decimals),
        xautExpected: q ? formatUnits(q.xautExpected, xautDecimals) : null,
        xautMinOut:   formatUnits(minXautOut, xautDecimals),
        slippageBps:  q ? 30 : null,
        routerReqId:  parsed?.routerReqId ?? null,
        navReqId:     parsed?.navReqId ?? null,
        ...(parsed === null && { warning: 'routerReqId not found in logs — run xaue_list_redemptions to locate your request' }),
        txHash:       tx.hash,
        gasUsed:      String(rec.gasUsed),
        blockNumber:  rec.blockNumber,
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_redeem_status ──────────────────────────────────────────────────────

server.tool(
  'xaue_redeem_status',
  'Query the user-visible status of an XAUERouter redemption request. ' +
  'Status values: Pending, Claimable (call xaue_claim_xaut), Rejected (call xaue_claim_rejected_shares), Claimed.',
  { req_id: z.union([z.string(), z.number()]).describe('routerReqId returned from xaue_request_redeem') },
  READ,
  async ({ req_id }) => {
    try {
    const ctx = await buildContext({ needSigner: false });
    const reqId = toBigIntSafe(req_id);
    const [row, statusIdx] = await Promise.all([
      ctx.router.routerRedemptions(reqId),
      ctx.router.getRouterRedemptionStatus(reqId),
    ]);
    if (row[1] === ZeroAddress) return err(new Error(`Request ${req_id} does not exist`));

    const statusName = ROUTER_STATUS[Number(statusIdx)] ?? `Unknown(${statusIdx})`;
    return ok({
      routerReqId:           reqId,
      navReqId:              row[2],
      user:                  row[1],
      xaueAmount:            formatUnits(row[3], ctx.cfg.tokens.XAUE.decimals),
      requestedAt:           row[4],
      status:                statusName,
      statusCode:            Number(statusIdx),
      xautClaimed:           row[5],
      rejectedSharesClaimed: row[6],
    });
    } catch (e) { return err(e); }
  },
);

// ── xaue_claim_xaut ─────────────────────────────────────────────────────────

server.tool(
  'xaue_claim_xaut',
  'Claim the approved XAUT from a completed XAUERouter redemption. ' +
  'The request must be in Claimable status (xaue_redeem_status returns status="Claimable").',
  {
    req_id: z.union([z.string(), z.number()]).describe('routerReqId to claim XAUT for'),
    ...KEY_SOURCE_SCHEMA,
  },
  CLAIM,
  async ({ req_id, key_env, key_file }) => {
    try {
      const ctx = await buildContext({ needSigner: true, keyEnv: key_env, keyFile: key_file });
      const addr = await walletAddr(ctx);
      const reqId = toBigIntSafe(req_id);

      const row = await ctx.router.routerRedemptions(reqId);
      if (row[1] === ZeroAddress) return err(new Error(`Request ${req_id} does not exist`));
      if (row[1].toLowerCase() !== addr.toLowerCase()) return err(new Error('Request does not belong to this wallet'));
      if (row[5]) return err(new Error('XAUT already claimed for this request'));

      const statusIdx = Number(await ctx.router.getRouterRedemptionStatus(reqId));
      if (statusIdx !== ROUTER_STATUS_CODES.Claimable) {
        return err(new Error(`Request status is ${ROUTER_STATUS[statusIdx]}; must be Claimable to claim XAUT`));
      }

      const xautBefore = await ctx.xaut.balanceOf(addr);
      const tx = await ctx.router.claimXaut(reqId);
      const receipt = await waitOk(tx, 'claimXaut');
      const xautAfter = await ctx.xaut.balanceOf(addr);

      return ok({
        address: addr,
        routerReqId: reqId,
        xautAmount: formatUnits(xautAfter - xautBefore, ctx.cfg.tokens.XAUT.decimals),
        ...receipt,
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_claim_rejected_shares ──────────────────────────────────────────────

server.tool(
  'xaue_claim_rejected_shares',
  'Reclaim XAUE shares after a rejected XAUERouter redemption request. ' +
  'The request must be in Rejected status (xaue_redeem_status returns status="Rejected").',
  {
    req_id: z.union([z.string(), z.number()]).describe('routerReqId to reclaim XAUE shares for'),
    ...KEY_SOURCE_SCHEMA,
  },
  CLAIM,
  async ({ req_id, key_env, key_file }) => {
    try {
      const ctx = await buildContext({ needSigner: true, keyEnv: key_env, keyFile: key_file });
      const addr = await walletAddr(ctx);
      const reqId = toBigIntSafe(req_id);

      const row = await ctx.router.routerRedemptions(reqId);
      if (row[1] === ZeroAddress) return err(new Error(`Request ${req_id} does not exist`));
      if (row[1].toLowerCase() !== addr.toLowerCase()) return err(new Error('Request does not belong to this wallet'));
      if (row[6]) return err(new Error('Rejected XAUE already claimed for this request'));

      const statusIdx = Number(await ctx.router.getRouterRedemptionStatus(reqId));
      if (statusIdx !== ROUTER_STATUS_CODES.Rejected) {
        return err(new Error(`Request status is ${ROUTER_STATUS[statusIdx]}; must be Rejected to reclaim shares`));
      }

      const xaueBefore = await ctx.xaue.balanceOf(addr);
      const tx = await ctx.router.claimRejectedShares(reqId);
      const receipt = await waitOk(tx, 'claimRejectedShares');
      const xaueAfter = await ctx.xaue.balanceOf(addr);

      return ok({
        address: addr,
        routerReqId: reqId,
        xaueAmount: formatUnits(xaueAfter - xaueBefore, ctx.cfg.tokens.XAUE.decimals),
        ...receipt,
      });
    } catch (e) { return err(e); }
  },
);

// ── xaue_list_redemptions ───────────────────────────────────────────────────

server.tool(
  'xaue_list_redemptions',
  'List XAUERouter redemption requests for a wallet by scanning RedemptionRequestedViaRouter events.',
  {
    user:       z.string().optional().describe('Wallet address to query; defaults to the configured wallet'),
    from_block: z.number().optional().describe('Starting block number; defaults to 200 000 blocks ago'),
  },
  READ,
  async ({ user, from_block } = {}) => {
    try {
      const ctx = await buildContext({ needSigner: !user });
      const targetUser = user || await walletAddr(ctx);
      if (!isAddress(targetUser)) return err(new Error(`Invalid user address: ${targetUser}`));

      const latest   = await ctx.provider.getBlockNumber();
      const lookback = BigInt(ctx.cfg.event_scan?.default_lookback_blocks ?? 200000);
      const fromBlock = from_block != null ? BigInt(from_block) : BigInt(latest) - lookback;
      const from = fromBlock < 0n ? 0n : fromBlock;

      const MAX_SCAN_RANGE = 500_000n;
      if (BigInt(latest) - from > MAX_SCAN_RANGE) {
        return err(new Error(
          `Block range too large (${BigInt(latest) - from} blocks). ` +
          `Use from_block with a recent block number.`,
        ));
      }

      const filter = ctx.router.filters.RedemptionRequestedViaRouter(null, null, targetUser);
      const events  = await ctx.router.queryFilter(filter, Number(from), latest);
      const items   = events.map((e) => ({
        routerReqId: e.args?.routerReqId,
        navReqId:    e.args?.navReqId,
        xaueAmount:  formatUnits(e.args?.xaueAmount ?? 0n, ctx.cfg.tokens.XAUE.decimals),
        blockNumber: e.blockNumber,
        txHash:      e.transactionHash,
      }));

      return ok({
        user:        targetUser,
        fromBlock:   from,
        toBlock:     BigInt(latest),
        total_count: items.length,
        has_more:    false,
        items,
      });
    } catch (e) { return err(e); }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
