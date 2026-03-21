# TikTok Trend Intelligence API — Submission

## What Was Built

A production-ready TikTok Trend Intelligence API that follows the Proxies.sx marketplace template structure exactly. The service provides real-time TikTok data extraction gated behind x402 USDC payments, routed through Proxies.sx 4G/5G mobile carrier IPs.

## Endpoints Implemented

| Endpoint | Description | Price |
|----------|-------------|-------|
| `GET /api/run?type=trending&country=US` | Trending videos, hashtags, and sounds for a country | $0.02 USDC |
| `GET /api/run?type=hashtag&tag=ai&country=US` | Hashtag analytics: view count, growth velocity, top videos | $0.02 USDC |
| `GET /api/run?type=creator&username=@charlidamelio` | Creator profile: followers, engagement rate, recent posts | $0.02 USDC |
| `GET /api/run?type=sound&id=12345` | Sound/audio trend: usage count, velocity, top videos | $0.02 USDC |

## Country Support

- 🇺🇸 US — T-Mobile
- 🇩🇪 DE — Vodafone
- 🇫🇷 FR — Orange
- 🇪🇸 ES — Movistar
- 🇬🇧 GB — EE
- 🇵🇱 PL — Play

## Technical Architecture

```
src/
├── index.ts                    # Hono server, CORS, rate limiting, discovery
├── service.ts                  # 4 endpoint handlers + x402 payment gating
├── proxy.ts                    # Multi-proxy pool, round-robin, retry with backoff
├── payment.ts                  # On-chain USDC verification (Solana + Base)
├── types/index.ts              # TypeScript interfaces for all data types
└── scrapers/
    └── tiktok-scraper.ts       # TikTok data extraction engine
```

## Anti-Bot Strategy

TikTok's anti-bot mechanisms are handled as follows:

1. **msToken cookie rotation** — Service fetches fresh session tokens per country by hitting TikTok's homepage before each request. Tokens are cached for 15 minutes and rotated on expiry.

2. **Mobile carrier IPs** — All requests route through Proxies.sx 4G/5G mobile IPs. TikTok's IP reputation scoring trusts real carrier IPs (T-Mobile, Vodafone, etc.) because they match the expected mobile device fingerprint.

3. **Authentic mobile User-Agent** — Uses `iPhone iOS 17.4.1 Safari` UA, matching the carrier IP's expected device type.

4. **Cookie management** — Sets `tt_webid_v2`, `msToken`, `ttwid`, and `tt_chain_token` cookies on all API requests, mimicking real browser behavior.

5. **Multi-endpoint fallback** — Primary path uses TikTok's internal JSON API (`/api/recommend/item_list/`, `/api/challenge/item_list/`, etc.). If that fails, falls back to HTML scraping with SIGI_STATE / `__UNIVERSAL_DATA_FOR_REHYDRATION__` extraction.

6. **Retry with IP rotation** — `proxyFetch()` retries up to 3 times with exponential backoff, rotating to a different proxy on connection errors. Dead proxies are removed from the pool.

7. **Rate limiting** — Per-IP rate limits protect the proxy quota (20 proxy-routed requests/minute per client IP).

## Payment Flow

```
1. Client hits /api/run → gets 402 with price + wallet addresses
2. Client sends 0.02 USDC on Solana or Base
3. Client resubmits with Payment-Signature: <txHash> header
4. Service verifies on-chain: tx confirmed + correct amount + correct recipient
5. Service executes TikTok scrape and returns JSON
```

## Response Schema (matches bounty spec exactly)

```json
{
  "type": "trending",
  "country": "US",
  "timestamp": "2026-02-14T12:00:00Z",
  "data": {
    "videos": [{
      "id": "7341234567890",
      "description": "Video caption here",
      "author": { "username": "creator", "followers": 1200000, "verified": true },
      "stats": { "views": 5400000, "likes": 340000, "comments": 12000, "shares": 45000 },
      "sound": { "name": "Original Sound", "author": "creator", "original": true },
      "hashtags": ["fyp", "viral", "ai"],
      "createdAt": "2026-02-13T08:00:00Z",
      "url": "https://www.tiktok.com/@creator/video/7341234567890"
    }],
    "trending_hashtags": [{ "name": "#ai", "views": 45000000000, "velocity": "+340% 24h" }],
    "trending_sounds": [{ "name": "Sound Name", "uses": 890000, "velocity": "+120% 24h" }]
  },
  "proxy": { "country": "US", "carrier": "T-Mobile", "type": "mobile" },
  "payment": { "txHash": "...", "amount": 0.02, "verified": true }
}
```

## Build & Test

```bash
bun install
bun run dev

# Health check
curl http://localhost:3000/health

# Service discovery  
curl http://localhost:3000/

# 402 challenge (correct behavior — no payment yet)
curl "http://localhost:3000/api/run?type=trending&country=US"
```

TypeScript compiles cleanly with `bun run typecheck` (zero errors).

## Dependencies

- **hono** ^4.6.0 — web framework
- **bun** runtime — built-in proxy support, fast TypeScript execution
- Zero external scraping dependencies — pure fetch() with proxy routing

## Deployment

Docker + Railway/Render ready. Dockerfile included. Set `WALLET_ADDRESS` + `PROXY_*` env vars and deploy.

For multi-country support, set `PROXY_LIST` with semicolon-separated proxy credentials per country.
