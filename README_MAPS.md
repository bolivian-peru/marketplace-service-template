# Google Maps Lead Generator — API Reference

Extract structured business data from Google Maps using real 4G/5G mobile proxies. 100x cheaper than Google's Places API.

## Quick Start

```bash
git clone https://github.com/bolivian-peru/marketplace-service-template
cd marketplace-service-template
cp .env.example .env
# Edit .env with your WALLET_ADDRESS + proxy credentials

bun install
bun run dev
```

## Endpoints

### `GET /api/run` — Search Businesses
Search Google Maps for businesses by category + location.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | ✅ | — | Search query (e.g., "plumbers", "pizza", "dentist") |
| `location` | string | ✅ | — | Location (e.g., "Austin TX", "Manhattan, NYC") |
| `limit` | number | ❌ | 20 | Max results (1–100) |
| `pageToken` | string | ❌ | — | Pagination token for next page |

**Example:**
```bash
curl "http://localhost:3000/api/run?query=plumbers&location=Austin+TX&limit=10"
```

### `GET /api/details` — Place Details
Get detailed business info by Google Place ID.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `placeId` | string | ✅ | Google Place ID |

**Example:**
```bash
curl "http://localhost:3000/api/details?placeId=ChIJN1t_tDeuEmsRUsoyG83frY4"
```

### `GET /health` — Health Check
```bash
curl http://localhost:3000/health
```

### `GET /` — Service Discovery
Returns service metadata + all endpoint descriptions (AI agents read this).

---

## Response Schema

### Search (`/api/run`)
```json
{
  "businesses": [{
    "name": "Acme Plumbing Co.",
    "address": "123 Main St, Austin, TX 78701",
    "phone": "+1-512-555-1234",
    "website": "https://acmeplumbing.com",
    "email": "info@acmeplumbing.com",
    "hours": {
      "Monday": "8:00 AM - 6:00 PM",
      "Tuesday": "8:00 AM - 6:00 PM",
      "Saturday": "9:00 AM - 2:00 PM"
    },
    "rating": 4.7,
    "reviewCount": 312,
    "categories": ["Plumber", "Drain Cleaning Service"],
    "coordinates": {
      "latitude": 30.2672,
      "longitude": -97.7431
    },
    "placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "priceLevel": "$$",
    "permanentlyClosed": false
  }],
  "totalFound": 20,
  "nextPageToken": "40",
  "searchQuery": "plumbers",
  "location": "Austin TX",
  "proxy": {
    "country": "US",
    "type": "mobile"
  },
  "payment": {
    "txHash": "...",
    "network": "solana",
    "amount": 0.005,
    "settled": true
  }
}
```

### Details (`/api/details`)
```json
{
  "business": {
    "name": "Acme Plumbing Co.",
    "address": "123 Main St, Austin, TX 78701",
    "phone": "+1-512-555-1234",
    "website": "https://acmeplumbing.com",
    "email": "info@acmeplumbing.com",
    "hours": { ... },
    "rating": 4.7,
    "reviewCount": 312,
    "categories": ["Plumber"],
    "coordinates": { "latitude": 30.2672, "longitude": -97.7431 },
    "placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "priceLevel": "$$",
    "permanentlyClosed": false
  },
  "proxy": { "country": "US", "type": "mobile" },
  "payment": { ... }
}
```

---

## x402 Payment Flow

```
Client                    Service                    Blockchain
  │                          │                            │
  │── GET /api/run ─────────►│                            │
  │◄ 402 {price, wallet} ───│                            │
  │                          │                            │
  │── Send USDC ──────────────────────────────────────►   │
  │◄ tx confirmed ◄─────────────────────────────────────  │
  │                          │                            │
  │── GET /api/run ─────────►│                            │
  │   Payment-Signature: tx  │── verify on-chain ────────►│
  │◄ 200 {businesses} ──────│◄ confirmed ◄───────────────│
```

### Payment Headers
| Header | Value |
|--------|-------|
| `Payment-Signature` | Transaction hash |
| `X-Payment-Network` | `solana` or `base` (auto-detected if omitted) |

### Supported Networks
| Network | Chain ID | Asset | Settlement |
|---------|----------|-------|------------|
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDC | ~400ms |
| Base | `eip155:8453` | USDC | ~2s |

---

## Pricing

| Endpoint | Price |
|----------|-------|
| `/api/run` | **$0.005** (0.5¢) per search |
| `/api/details` | **$0.005** (0.5¢) per lookup |

**vs Google Places API:** $0.017–$0.032 per lookup → **97% cheaper**.

---

## Rate Limits

- **Global rate limit:** 60 requests/min per IP (configurable via `RATE_LIMIT` env var)
- **Proxy rate limit:** 20 requests/min per IP (protects proxy quota)
- On 429: wait 60 seconds and retry

---

## Deployment

### Docker
```bash
docker build -t maps-lead-gen .
docker run -p 3000:3000 --env-file .env maps-lead-gen
```

### VPS / Railway / Fly.io / Render
```bash
bun install --production
bun run start
```

### Environment Variables
```bash
WALLET_ADDRESS=your_solana_wallet        # Required — where USDC payments arrive
WALLET_ADDRESS_BASE=your_base_wallet     # Optional — defaults to WALLET_ADDRESS
PORT=3000                                 # Server port (default: 3000)
RATE_LIMIT=60                             # Requests/min per IP (default: 60)

# Proxy credentials (from client.proxies.sx)
PROXY_HOST=gate.proxies.sx
PROXY_HTTP_PORT=10000
PROXY_USER=J6aG3GD3QLuf4nDpCX71W2wFYTieJ6T9RtsXAuDhPFTE
PROXY_PASS=your_proxy_pass
PROXY_COUNTRY=US
```

---

## Architecture

```
src/
├── index.ts              # Server entry (CORS, rate limiting, discovery)
├── service.ts            # API handlers (/api/run, /api/details)
├── payment.ts            # x402 USDC verification (Solana + Base)
├── proxy.ts              # Mobile proxy rotation + fetch
├── types/
│   └── index.ts          # TypeScript interfaces
├── utils/
│   └── helpers.ts        # HTML extraction helpers
└── scrapers/
    └── maps-scraper.ts   # Google Maps scraping (3 strategies)
```

**3 Scraping Strategies:**
1. **Google Local Search** (`tbm=lcl`) — most reliable for business data
2. **Google Maps direct** (`maps/search/`) — rich cards with ratings
3. **Google Search** (`google.com/search`) — fallback for additional results

---

## Security

- On-chain USDC verification (Solana + Base RPCs)
- Replay prevention (each tx hash accepted once)
- SSRF protection (private/internal URLs blocked)
- Per-IP rate limiting
- Security headers (nosniff, DENY, no-referrer)

---

## Live Instance

Production deployment at: `https://api.proxies.sx/v1/x402/maps`

Marketplace listing: [agents.proxies.sx/marketplace/google-maps-lead-generator](https://agents.proxies.sx/marketplace/google-maps-lead-generator/)
