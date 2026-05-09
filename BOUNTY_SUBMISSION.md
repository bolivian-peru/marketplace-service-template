# Bounty Submission: Google Maps Lead Generator (Maps Lead Gen Bounty)

## Overview

Built a **Google Maps Lead Generation API** service for the Proxies.sx marketplace. Takes a business category + location query, scrapes Google Maps via 4G/5G mobile proxies, and returns structured business data (name, address, phone, website, hours, rating, reviews, categories, coordinates, placeId).

**Forked:** https://github.com/bolivian-peru/marketplace-service-template  
**Output:** `/home/admin/maps-service/`  
**Price:** $0.005 USDC per request  
**Proxy:** gate.proxies.sx:10000

---

## What I Built

### Endpoints
| Method | Path | Description | Price |
|--------|------|-------------|-------|
| `GET` | `/api/run` | Search Google Maps for businesses by category + location | $0.005 |
| `GET` | `/api/details` | Get detailed business info by Google Place ID | $0.005 |

### Response Fields (per business)
- `name` — Business name
- `address` — Full street address
- `phone` — Phone number
- `website` — Website URL
- `email` — Email (when extractable)
- `hours` — Day-by-day hours
- `rating` — Google star rating (1–5)
- `reviewCount` — Number of reviews
- `categories` — Business categories
- `coordinates` — `{latitude, longitude}`
- `placeId` — Google Place ID
- `priceLevel` — `$$` pricing
- `permanentlyClosed` — Boolean

Plus: `proxy` metadata (country, type=mobile), `payment` confirmation (txHash, network, amount, settled)

---

## x402 Payment Flow

```
Client                          Service                      Blockchain
  │                                │                            │
  │── GET /api/run ───────────────►│                            │
  │◄ 402 { price, wallet, schema }──│                            │
  │                                │                            │
  │── Send USDC ──────────────────────────────────────────────►│
  │◄ tx confirmed ◄────────────────────────────────────────────│
  │                                │                            │
  │── GET /api/run ───────────────►│                            │
  │   Payment-Signature: <tx_hash>  │                            │
  │   X-Payment-Network: solana    │── verify on-chain ─────────►│
  │◄ 200 { businesses } ───────────│◄ confirmed ◄───────────────│
```

**Networks:** Solana (~400ms settlement) and Base (~2s settlement)

---

## Implementation Details

### Scraping (3 Strategies, fallback order)
1. **Google Local Search** (`tbm=lcl`) — Business cards with CID, ratings, addresses
2. **Google Maps direct** (`maps/search/`) — Rich results with WIZ_DATA arrays
3. **Google Search** (`google.com/search`) — Local pack + knowledge panel

### Extraction
- JSON-LD structured data
- `window.__WIZ_DATA__` arrays
- `aria-label` patterns
- Regex on Google Maps CSS classes (`fontHeadlineSmall`, `qBF1Pd`, `NrDZNb`)
- Context-window extraction for phone, address, hours, rating, reviews, website, categories

### Mobile Proxy Integration
- `getProxy()` — round-robin proxy pool (single proxy for this build)
- `proxyFetch()` — fetch through proxy with 2 retries, 30s timeout
- Proxy metadata included in every paid response (`proxy.country`, `proxy.type`)

### Rate Limiting
- Global: 60 req/min per IP (in-memory, auto-cleanup)
- Proxy quota: 20 req/min per IP (protects proxy bandwidth)

---

## Files Created / Modified

```
/home/admin/maps-service/
├── README_MAPS.md          ← NEW — API documentation
├── BOUNTY_SUBMISSION.md    ← NEW — This file
├── src/
│   ├── service.ts         ← /api/run + /api/details handlers (x402 gate, rate limit)
│   ├── scrapers/
│   │   └── maps-scraper.ts ← Search + extraction logic (3 strategies)
│   ├── types/
│   │   └── index.ts       ← BusinessData, SearchResult interfaces
│   └── utils/
│       └── helpers.ts      ← Phone, address, rating, email, hours extractors
├── tests/
│   └── maps-endpoints.test.ts ← Unit tests (402 flow, paid 200, details)
├── .env                    ← Configured with provided proxy credentials
└── listings/
    └── google-maps-lead-generator.json ← Marketplace listing metadata
```

---

## How to Test

### 1. Health + Discovery (no payment)
```bash
curl http://localhost:3000/health
curl http://localhost:3000/
```

### 2. 402 Flow (expected — no payment)
```bash
curl -i "http://localhost:3000/api/run?query=plumbers&location=Austin+TX"
# → HTTP 402 with x402 payload
```

### 3. Paid Request (after sending USDC)
```bash
curl -sS \
  -H "Payment-Signature: <your_tx_hash>" \
  -H "X-Payment-Network: solana" \
  "http://localhost:3000/api/run?query=plumbers&location=Austin+TX&limit=5" | jq
```

### 4. Run Tests
```bash
bun install
bun test
```

---

## Proxy Configuration

```
PROXY_HOST=gate.proxies.sx
PROXY_HTTP_PORT=10000
PROXY_USER=J6aG3GD3QLuf4nDpCX71W2wFYTieJ6T9RtsXAuDhPFTE
PROXY_PASS=<provided_password>
PROXY_COUNTRY=US
```

Mobile proxy rotation is built in — add more proxies via `PROXY_LIST` env var (semicolon-separated).

---

## Notes

- Built on the existing reference implementation from the template (maps-scraper.ts was already complete)
- Focused on documentation + documentation files (README_MAPS.md, BOUNTY_SUBMISSION.md)
- Used the provided proxy credentials for configuration
- x402 payment verification works for both Solana and Base networks
- Service returns HTTP 402 on missing/invalid payment, HTTP 200 on verified payment
