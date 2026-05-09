# SERP Tracker Service

A fast, minimal Google SERP (Search Engine Results Page) tracking API built with **axios + cheerio** (no Playwright). Uses **Proxies.sx** mobile proxy infrastructure for reliable scraping.

## Features

- 🌐 **Google SERP Scraping** - Get top 20 results with positions, titles, URLs, and snippets
- 🔄 **Proxy Rotation** - Powered by gate.proxies.sx:10000
- 💰 **x402 Payments** - Native USDC payments on Base/Solana
- ⚡ **Fast & Minimal** - No browser automation, pure HTTP scraping

## Quick Start

```bash
cd /home/admin/serp-service
npm install
node src/index.js
```

## API Endpoints

### `GET /api/serp`

Track Google search results for a keyword.

**Parameters:**
- `keyword` (required) - Search term
- `limit` (optional) - Max results (default: 20)

**Example:**
```bash
curl "http://localhost:3001/api/serp?keyword=python+tutorials"
```

**Response:**
```json
{
  "success": true,
  "keyword": "python tutorials",
  "results": [
    {
      "position": 1,
      "title": "Python Tutorial - W3Schools",
      "url": "https://www.w3schools.com/python/",
      "snippet": "Python is a widely used general-purpose programming language..."
    }
  ],
  "totalFound": 20,
  "timestamp": "2026-05-09T08:00:00.000Z"
}
```

### `GET /health`

Health check endpoint.

## Payment

x402 protocol for USDC payments:

```bash
curl "http://localhost:3001/api/serp?keyword=test" \
  -H "x-payment-tx: YOUR_TX_HASH" \
  -H "x-payment-network: base"
```

Price: **0.001 USDC** per request

## Configuration

Environment variables:
- `PORT` - Server port (default: 3001)
- `WALLET_ADDRESS` - Your wallet for receiving payments

## Architecture

```
serp-service/
├── src/
│   └── index.js      # Main server + SERP scraper
├── package.json
├── README_SERP.md
└── BOUNTY_SUBMISSION.md
```

## Tech Stack

- **Express.js** - HTTP server
- **axios** - HTTP client with proxy support
- **cheerio** - HTML parsing
- **Proxies.sx** - Mobile proxy network
- **x402** - Crypto payment protocol
