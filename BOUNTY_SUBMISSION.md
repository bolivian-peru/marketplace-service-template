# Bounty Submission: App Store Intelligence API (Bounty #54)

**Reward:** $50 paid in $SX token  
**Branch:** `bounty-54-app-store`  
**Fork:** https://github.com/jing11223344/app-store-intelligence-api

## What I Built

A production-ready **App Store Intelligence API** that scrapes real-time app rankings, app details, search results, and trending apps from **Apple App Store** and **Google Play Store** using **Proxies.sx mobile proxy infrastructure** (`proxyFetch()`), protected by an **x402 (USDC) payment gate**.

### Endpoints

| Endpoint | Description | Example |
|----------|-------------|---------|
| `GET /api/run?type=rankings` | Top app rankings by category + country | `/api/run?type=rankings&store=apple&category=games&country=US&limit=50` |
| `GET /api/run?type=app` | App details + recent reviews | `/api/run?type=app&store=google&appId=com.spotify.music&country=DE` |
| `GET /api/run?type=search` | Search apps by keyword | `/api/run?type=search&store=apple&query=vpn&country=GB` |
| `GET /api/run?type=trending` | Top grossing/trending apps | `/api/run?type=trending&store=google&country=US` |
| `GET /health` | Health check | `/health` |
| `GET /` | Service discovery JSON | `/` |

### Supported Countries
US, DE, FR, ES, GB, PL — matching Proxies.sx's 6-country mobile proxy infrastructure.

### Output Fields
For each app: `rank`, `appName`, `developer`, `appId`, `rating`, `ratingCount`, `price`, `inAppPurchases`, `category`, `lastUpdated`, `size`, `icon`, `url`, and store-specific fields (`description`, `version`, `languages`, `recentReviews`).

### Proxy Metadata (required by reviewer)
Each paid 200 response includes:
- `proxy.country` — proxy exit country
- `proxy.type: "mobile"` — real 4G/5G carrier IP

## Reviewer Requirements Checklist

### 1) Live deployed instance ❌
- Needs deployment (Render/Railway/Docker)
- Requires `WALLET_ADDRESS` + `PROXY_*` env vars

### 2) Real scraped output + mobile proxy IP ❌
- Proof samples generated (see `proof/` directory)
- Will be regenerated from actual deployment

### 3) Output Schema Documentation ✅
- Documented in `src/payment.ts` (402 schema)
- Documented in service discovery (`GET /`)
- Documented in this submission

### 4) Rate limiting resilience ✅
- 20 req/min per IP limit configured
- Proxy retry with backoff (2 retries, 30s timeout)

### 5) Quality Standards ✅
- Error handling for all failure modes (CAPTCHA, 429, auth wall, proxy error, empty results)
- Structured JSON output with typed fields
- Listing JSON with competitive context (vs Sensor Tower/data.ai at $30K-$100K/yr)

## How to Deploy

```bash
# Clone
git clone https://github.com/jing11223344/app-store-intelligence-api
cd app-store-intelligence-api

# Install deps
bun install

# Configure
cp .env.example .env
# Edit .env: set WALLET_ADDRESS + PROXY_HOST/PORT/USER/PASS

# Run
bun run dev    # Development
bun run start  # Production

# Docker
docker build -t app-store-intelligence .
docker run -p 3000:3000 --env-file .env app-store-intelligence
```

## How to Test (curl)

### 1) Health + Discovery (no payment)
```bash
curl -sS http://localhost:3000/health
curl -sS http://localhost:3000/
```

### 2) Expected x402 flow (HTTP 402)
```bash
curl -i "http://localhost:3000/api/run?type=rankings&store=apple&category=games&country=US&limit=10"
```

### 3) Paid 200 response (after payment)
```bash
curl -sS \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana" \
  "http://localhost:3000/api/run?type=rankings&store=apple&category=games&country=US&limit=10" | jq
```

## Market Context

| Feature | App Store Intelligence API | Sensor Tower / data.ai |
|---------|--------------------------|----------------------|
| Pricing | $0.01/query | $30K-$100K+/year |
| Mobile IPs | ✅ Real 4G/5G mobile | ❌ Datacenter IPs |
| x402 USDC | ✅ Pay-per-request | ❌ Annual contract |
| Countries | 6 (matching SX infra) | Global |
| Deployment | Self-hosted | SaaS only |

## Files Changed
- `src/service.ts` — Complete rewrite for App Store Intelligence
- `src/scrapers/app-store-scraper.ts` — New: Apple + Google Play scrapers
- `listings/app-store-intelligence.json` — Marketplace listing
- `BOUNTY_SUBMISSION.md` — This file
- `proof/` — Sample outputs
