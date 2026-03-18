# Bounty #149 — Google SERP + AI Search Scraper

## Live Endpoint
**http://135.125.243.226:9000**

## Endpoints

### GET /api/serp/search — $0.01/request
Full Google SERP with organic results, related searches, and news results.

```
GET /api/serp/search?q=bitcoin+price+2025
```

**Response:**
```json
{
  "query": "bitcoin price 2025",
  "organic": [
    { "position": 1, "title": "...", "url": "...", "description": "..." }
  ],
  "relatedSearches": ["bitcoin price 2025", "bitcoin price prediction", ...],
  "ads": [],
  "scrapedAt": "2026-03-18T19:11:00.000Z"
}
```

### GET /api/serp/ai — $0.005/request
AI Overview extraction from Google Search.

```
GET /api/serp/ai?q=how+does+blockchain+work
```

**Response:**
```json
{
  "query": "how does blockchain work",
  "available": false,
  "text": null,
  "sources": [],
  "scrapedAt": "..."
}
```

### GET /api/serp/suggest — $0.002/request
Google Autocomplete suggestions (real-time, routed through mobile proxy).

```
GET /api/serp/suggest?q=solana
```

**Response:**
```json
{
  "query": "solana",
  "suggestions": ["solana price", "solana staking", "solana news", ...],
  "scrapedAt": "..."
}
```

## Implementation

- **Proxy:** proxies.sx mobile proxy (real 4G/5G carrier IPs)
- **Runtime:** Bun + TypeScript + Hono
- **Anti-detection:** Random mobile User-Agents, proxy IP rotation
- **Fallback:** Google News for SERP when google.com returns JS challenge

## Proof Files

Real scraped data in `proof/` directory:
- `serp-search-bitcoin.json` — Full SERP for "bitcoin price 2025"
- `serp-search-crypto-exchange.json` — Full SERP for "best crypto exchange 2025"
- `serp-ai-blockchain.json` — AI Overview check for "how does blockchain work"
- `serp-suggest-solana.json` — Autocomplete for "solana" (10 suggestions)

## Solana Wallet
`2fPV8uNxdP1VAm7mP9ks8NdcxhZgA2n5x62hxj48jzSL`

Closes #149
