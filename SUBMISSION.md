# Submission: X/Twitter Real-Time Search API

**Bounty:** [#73 — X/Twitter Real-Time Search API](https://github.com/bolivian-peru/marketplace-service-template/issues/73)  
**Reward:** $100 in $SX tokens  
**GitHub:** stupeterwilliams-ui

---

## What I Built

A complete X/Twitter real-time data API with 5 endpoints, x402 USDC payment gating, and Proxies.sx mobile proxy routing. Built on Bun + Hono following the marketplace-service-template pattern exactly.

### Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/x/search?query=&sort=latest&limit=20` | $0.01 USDC | Search tweets by keyword/hashtag/from:user |
| `GET /api/x/trending?country=US` | $0.005 USDC | Trending topics (20+ countries via WOEID) |
| `GET /api/x/user/:handle` | $0.01 USDC | User profile with followers + verification |
| `GET /api/x/user/:handle/tweets?limit=20` | $0.01 USDC | Recent tweets from a user |
| `GET /api/x/thread/:tweet_id` | $0.02 USDC | Full conversation thread extraction |

---

## How It Solves the Task

### X Anti-Scraping Evasion

X.com updates anti-scraping measures every 2-4 weeks. The service handles this with a layered approach:

1. **Mobile carrier IPs** via Proxies.sx — X's detection profiles IPs by type. Mobile carrier IPs get 5-10x more generous rate limits because they're the same IPs used by X's mobile app.

2. **Guest token handshake** — Activates fresh guest tokens via X's `POST /1.1/guest/activate.json` with the embedded public bearer token from X's web app. Tokens are cached with 3-hour TTL. On 403/429, tokens auto-rotate.

3. **Mobile User-Agent** — All requests use `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0...)` Safari + Twitter iOS UA. This matches legitimate mobile traffic patterns.

4. **GraphQL endpoints** — Uses X's internal GraphQL APIs (`SearchTimeline`, `UserByScreenName`, `UserTweets`, `TweetDetail`) rather than legacy REST endpoints. These are less scrutinized because they serve the official web frontend.

5. **Proxy pool rotation** — Supports `PROXY_LIST` env for multiple proxies with automatic dead proxy removal and round-robin distribution.

### Payment Flow

Follows x402 standard exactly matching the template:
- No payment → 402 with price, wallet address, and outputSchema
- With `Payment-Signature: <tx_hash>` → on-chain USDC verification (Solana + Base)
- Replay protection via in-memory txHash set
- 2% tolerance for gas-adjusted amounts

---

## Architecture

```
src/
├── index.ts              # Hono server, middleware, rate limiting
├── service.ts            # Route handlers with x402 payment gating
├── proxy.ts              # Proxies.sx pool rotation (verbatim from template)
├── payment.ts            # On-chain USDC verification (verbatim from template)
├── index.test.ts         # 12 unit tests (all passing)
└── scrapers/
    └── x-scraper.ts      # X GraphQL scraper: search, trending, profile, tweets, thread
```

**Key design decisions:**
- `proxy.ts` and `payment.ts` are verbatim from the template (per template instructions — "Don't Edit")
- Guest token management is in the scraper layer with module-level caching
- All X API requests go through `proxyFetch()` (Proxies.sx routing)
- Trending uses Twitter's WOEID system via `GET /1.1/trends/place.json` with fallback to explore API

---

## Pricing Rationale (matches bounty spec)

- Search: $0.01/query (bounty spec: $0.01)
- Trending: $0.005/fetch (bounty spec: $0.005)
- User profile: $0.01/profile (bounty spec: $0.01)
- Thread: $0.02/extraction (bounty spec: $0.02)

---

## Tests

```bash
bun test
# 12 pass, 0 fail
```

All tests run without proxy credentials (unit tests only for 402 gating, health, schema validation).

---

## Deploy

### Railway (recommended)
```bash
railway login && railway init && railway up
```

### Docker
```bash
docker build -t x-intelligence-search .
docker run -p 3000:3000 --env-file .env x-intelligence-search
```

---

## Checklist

- [x] Uses Proxies.sx mobile proxies (all X requests via `proxyFetch()`)
- [x] Gated with x402 USDC payments (returns 402/metadata for agent payments)
- [x] Follows marketplace-service-template structure (`src/service.ts`, `src/index.ts`, etc.)
- [x] Returns structured JSON data
- [x] Search by keyword/hashtag/from:user
- [x] Trending topics (multiple countries)
- [x] User profile extraction (followers, verification status)
- [x] Thread/conversation extraction
- [x] Rate limiting per IP
- [x] Replay protection on payment hashes
- [x] Supports Solana + Base USDC
- [x] Docker + Railway deploy ready
- [x] 12 unit tests passing

---

## Solana Wallet (for payout)

`3KwQDrTSUASS6HqDz2RqVDkbKpmDWuSDcGtmAGDn8VZe`
