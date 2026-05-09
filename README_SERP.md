# SERP Tracker API

Track Google search engine results pages (SERPs) for any keyword — positions, titles, URLs, snippets, and rich result types.

**Price:** $0.001 USDC per request

## Quick Start

```bash
# Install
bun install

# Configure .env
cp .env.example .env
# Set WALLET_ADDRESS to your Solana/Base wallet

# Run
bun run dev
```

## Endpoints

### `GET /api/run?keyword=...`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `keyword` | string | **required** | Search query |
| `locale` | string | `en` | Language code |
| `country` | string | `us` | Country code |
| `limit` | number | `20` | Max results (max 50) |

**Example:**
```bash
curl "localhost:3000/api/run?keyword=ai+agents&country=us" \
  -H "payment-signature: <tx_hash>" \
  -H "x-payment-network: base"
```

**Response:**
```json
{
  "keyword": "ai agents",
  "results": [
    {
      "position": 1,
      "title": "AI Agents: What They Are and How They Work",
      "url": "https://example.com/ai-agents",
      "displayUrl": "example.com",
      "snippet": "AI agents are systems that perceive environments and take autonomous actions...",
      "isAd": false,
      "richResultType": "article"
    }
  ],
  "totalResults": 12500000,
  "searchTime": 1.23,
  "locale": "en",
  "country": "us",
  "proxy": { "country": "US", "type": "mobile" },
  "payment": { "txHash": "...", "network": "base", "amount": 0.001, "settled": true }
}
```

## Payment

Uses **x402** protocol on **Solana** or **Base** — pay with USDC.

**Wallet:** Set via `WALLET_ADDRESS` env var.

See [.env.example](./.env.example) for all configuration options.
