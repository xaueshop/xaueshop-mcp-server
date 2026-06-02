/**
 * Contract ABIs — hand-typed from XAUERouter spec v0.1 §10 and the minimal
 * Nav4626 view needed to compute user-visible status.
 *
 * Only the methods / events this skill actually calls are listed. Extend as
 * the router evolves; keep in sync with the deployed proxy.
 */

export const ROUTER_ABI = [
  // --- view ----------------------------------------------------------------
  'function asset() view returns (address)',
  'function share() view returns (address)',
  'function nav4626() view returns (address)',
  'function nextRouterReqId() view returns (uint256)',
  'function blacklist(address account) view returns (bool)',
  'function paused() view returns (bool)',
  'function getRouterRedemptionStatus(uint256 routerReqId) view returns (uint8)',
  'function getUnderlyingRequestId(uint256 routerReqId) view returns (uint256)',
  'function routerRedemptions(uint256 routerReqId) view returns (uint256 id, address user, uint256 navReqId, uint256 xaueAmount, uint256 requestedAt, bool xautClaimed, bool rejectedSharesClaimed)',

  // --- write (user) --------------------------------------------------------
  'function mint(uint256 xautAmount)',
  'function requestRedeem(uint256 xaueAmount) returns (uint256 routerReqId)',
  'function claimXaut(uint256 routerReqId)',
  'function claimRejectedShares(uint256 routerReqId)',

  // --- events --------------------------------------------------------------
  'event MintRouted(address indexed user, uint256 xautAmount, uint256 xaueAmount)',
  'event RedemptionRequestedViaRouter(uint256 indexed routerReqId, uint256 indexed navReqId, address indexed user, uint256 xaueAmount)',
  'event XautClaimed(uint256 indexed routerReqId, address indexed user, uint256 xautAmount)',
  'event RejectedSharesClaimed(uint256 indexed routerReqId, address indexed user, uint256 xaueAmount)',
];

/**
 * Minimal Nav4626 view surface we rely on.
 *
 * Per spec §13: status is computed from `Nav4626.redemptions(navReqId)` — we
 * don't assume a specific layout, so the router is the only oracle of truth
 * for status. However, if the router doesn't expose a status getter on some
 * path, we fall back to reading Nav4626 directly. The `redemptions(uint256)`
 * signature below is a placeholder; adjust once the real Nav4626 ABI is
 * available.
 */
export const NAV4626_ABI = [
  // Placeholder: real shape depends on Nav4626 deployment. Only used as a
  // fallback when router.getRouterRedemptionStatus isn't available.
  'function redemptions(uint256 id) view returns (address requester, uint256 shares, uint8 status, uint256 timestamp)',
];

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Enum mirror of RouterRedemptionStatus in the spec §8.
export const ROUTER_STATUS = ['Pending', 'Claimable', 'Rejected', 'Claimed'];
export const ROUTER_STATUS_CODES = Object.fromEntries(ROUTER_STATUS.map((n, i) => [n, i]));
