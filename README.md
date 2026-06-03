# xaueshop-mcp

MCP server for XAUERouter mint and redeem operations.

## Prerequisites

- Node.js >= 20.19.0
- An Ethereum wallet private key with ETH (gas) and XAUT

## Installation

```bash
npm install
```

## Configuration

### Mainnet

Only one environment variable is required:

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Wallet private key (0x...) |

All contract addresses and the RPC endpoint default to mainnet values. Set `ETH_RPC_URL` to a dedicated node for production reliability:

| Provider | Free tier | URL format |
|----------|-----------|------------|
| [Alchemy](https://alchemy.com) | 300M CU/month | `https://eth-mainnet.g.alchemy.com/v2/<KEY>` |
| [Infura](https://infura.io) | 100K req/day | `https://mainnet.infura.io/v3/<KEY>` |

## Setup

Add to your MCP client config (Claude Code, OpenClaw, Hermes, etc.):

```json
{
  "mcpServers": {
    "xaueshop": {
      "command": "node",
      "args": ["/path/to/xaueshop-mcp/index.js"],
      "env": {
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

**Claude Code shortcut:**

```bash
claude mcp add xaueshop node /path/to/xaueshop-mcp/index.js \
  -e PRIVATE_KEY=0x...
```

## Tools

| Tool | Description |
|------|-------------|
| `xaue_balance` | ETH / XAUT / XAUE balances |
| `xaue_allowance` | ERC-20 allowance to Router |
| `xaue_approve` | Approve XAUT or XAUE to Router |
| `xaue_is_blacklisted` | Check blacklist status |
| `xaue_paused` | Router pause state |
| `xaue_mint` | XAUT → XAUE |
| `xaue_request_redeem` | Initiate XAUE redemption, returns `routerReqId` |
| `xaue_redeem_status` | Status: Pending / Claimable / Rejected / Claimed |
| `xaue_claim_xaut` | Claim XAUT after approved redemption |
| `xaue_claim_rejected_shares` | Reclaim XAUE after rejected redemption |
| `xaue_list_redemptions` | Scan redemption history |

Write tools accept optional `key_env` or `key_file` to override the default `PRIVATE_KEY`:

```
xaue_mint({ amount: "10", key_env: "MY_TRADING_KEY" })
xaue_mint({ amount: "10", key_file: "~/keys/wallet.key" })
```

## Tests

```bash
npm test
```
