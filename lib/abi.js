/**
 * Contract ABIs — synced with mainnet XAUERouter implementation
 * (0x9823bfb54c9516e04632de189e0ee6730d90c558).
 *
 * Notable changes from Sepolia spec:
 *   - mint:         added minXaueOut (slippage protection)
 *   - requestRedeem: added minXautOut (slippage protection)
 *   - share():      removed — use fundToken() instead
 *   - quote functions added for pre-trade price estimation
 */

export const ROUTER_ABI = [
  // --- view ----------------------------------------------------------------
  'function asset() view returns (address)',
  'function fundToken() view returns (address)',
  'function nextRouterReqId() view returns (uint256)',
  'function blacklist(address account) view returns (bool)',
  'function paused() view returns (bool)',
  'function getRouterRedemptionStatus(uint256 routerReqId) view returns (uint8)',
  'function getUnderlyingRequestId(uint256 routerReqId) view returns (uint256)',
  'function routerRedemptions(uint256 routerReqId) view returns (uint256 id, address user, uint256 navReqId, uint256 xaueAmount, uint256 requestedAt, bool xautClaimed, bool rejectedSharesClaimed)',

  // --- write (user) --------------------------------------------------------
  'function mint(uint256 xautAmount, uint256 minXaueOut)',
  'function requestRedeem(uint256 xaueAmount, uint256 minXautOut) returns (uint256 routerReqId)',
  'function claimXaut(uint256 routerReqId)',
  'function claimRejectedShares(uint256 routerReqId)',

  // --- events --------------------------------------------------------------
  'event MintRouted(address indexed user, uint256 xautAmount, uint256 xaueAmount)',
  'event RedemptionRequestedViaRouter(uint256 indexed routerReqId, uint256 indexed navReqId, address indexed user, uint256 xaueAmount)',
  'event XautClaimed(uint256 indexed routerReqId, address indexed user, uint256 xautAmount)',
  'event RejectedSharesClaimed(uint256 indexed routerReqId, address indexed user, uint256 xaueAmount)',
];

// CoboFundToken — minimal slice needed for NAV oracle lookup.
// fundToken() on the Router returns this contract's address.
export const FUND_ABI = [
  'function oracle() view returns (address)',
];

// CoboFundOracle — returns NAV in 1e18, unit: XAUT per XAUE.
export const ORACLE_ABI = [
  'function getLatestPrice() view returns (uint256)',
];

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Enum mirror of RouterRedemptionStatus.
export const ROUTER_STATUS = ['Pending', 'Claimable', 'Rejected', 'Claimed'];
export const ROUTER_STATUS_CODES = Object.fromEntries(ROUTER_STATUS.map((n, i) => [n, i]));

// Default slippage tolerance: 30 bps (0.30%)
// NAV is non-decreasing, so drift is minimal; 30 bps is ample for most conditions.
export const DEFAULT_SLIPPAGE_BPS = 30n;

/**
 * Apply slippage to a quoted amount.
 * minOut = quote * (10000 - slippageBps) / 10000
 */
export function applySlippage(quote, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  return (BigInt(quote) * (10000n - slippageBps)) / 10000n;
}

/**
 * Compute minXaueOut for mint via the oracle chain.
 *   router.fundToken() → fund.oracle() → oracle.getLatestPrice() → NAV
 *   xaueExpected = xautAmount * SHARE_SCALE * PRECISION / (nav * ASSET_SCALE)
 *
 * Returns { xaueExpected, minXaueOut, nav } or null if oracle is unreachable.
 */
export async function quoteForMint(router, xautAmount, xautDecimals, xaueDecimals, provider, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  try {
    const { Contract } = await import('ethers');
    const fund   = new Contract(await router.fundToken(), FUND_ABI, provider);
    const oracle = new Contract(await fund.oracle(),      ORACLE_ABI, provider);
    const nav    = await oracle.getLatestPrice();
    if (!nav || nav === 0n) return null;

    const PRECISION   = 10n ** 18n;
    const ASSET_SCALE = 10n ** BigInt(xautDecimals);
    const SHARE_SCALE = 10n ** BigInt(xaueDecimals);
    const xaueExpected = (xautAmount * SHARE_SCALE * PRECISION) / (nav * ASSET_SCALE);
    const minXaueOut   = applySlippage(xaueExpected, slippageBps);
    return { xaueExpected, minXaueOut, nav };
  } catch {
    return null;
  }
}

/**
 * Compute minXautOut for requestRedeem via the oracle chain.
 *   xautExpected = xaueAmount * nav * ASSET_SCALE / (SHARE_SCALE * PRECISION)
 */
export async function quoteForRedeem(router, xaueAmount, xautDecimals, xaueDecimals, provider, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  try {
    const { Contract } = await import('ethers');
    const fund   = new Contract(await router.fundToken(), FUND_ABI, provider);
    const oracle = new Contract(await fund.oracle(),      ORACLE_ABI, provider);
    const nav    = await oracle.getLatestPrice();
    if (!nav || nav === 0n) return null;

    const PRECISION   = 10n ** 18n;
    const ASSET_SCALE = 10n ** BigInt(xautDecimals);
    const SHARE_SCALE = 10n ** BigInt(xaueDecimals);
    const xautExpected = (xaueAmount * nav * ASSET_SCALE) / (SHARE_SCALE * PRECISION);
    const minXautOut   = applySlippage(xautExpected, slippageBps);
    return { xautExpected, minXautOut, nav };
  } catch {
    return null;
  }
}
