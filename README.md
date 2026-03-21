# TikTok Trend Intelligence API

> Real-time TikTok intelligence via real 4G/5G mobile carrier IPs — x402 USDC payment gated.

**Price:** $0.02 USDC per query  
**Countries:** US (T-Mobile), DE (Vodafone), FR (Orange), ES (Movistar), GB (EE), PL (Play)

## Endpoints

```
GET /api/run?type=trending&country=US
GET /api/run?type=hashtag&tag=ai&country=US
GET /api/run?type=creator&username=@charlidamelio
GET /api/run?type=sound&id=12345
```

All endpoints require a `Payment-Signature` header with a confirmed USDC transaction hash.

## Quick Start

```bash
git clone <your-fork>
cd tiktok-trend-intelligence

cp .env.example .env
# Edit .env: set WALLET_ADDRESS + PROXY_* credentials

bun install
bun run dev
```

Test it:
```bash
# Service discovery
curl http://localhost:3000/

# Health check
curl http://localhost:3000/health

# Trending (will return 402 — correct!)
curl "http://localhost:3000/api/run?type=trending&country=US"
```

## How It Works

```
AI Agent                    Your Service               Blockchain
  │                              │                         │
  │── GET /api/run ─────────────►│                         │
  │◄── 402 {price, wallet} ──────│                         │
  │                              │                         │
  │── Send 0.02 USDC ──────────────────────────────────────►│
  │◄── tx confirmed ───────────────────────────────────────│
  │                              │                         │
  │── GET /api/run ─────────────►│                         │
  │   Payment-Signature: <hash>  │── verify on-chain ─────►│
  │                              │◄── confirmed ───────────│
  │◄── 200 { trending data } ────│                         │
```

## Response Schema

```json
{
  "type": "trending",
  "country": "US",
  "timestamp": "2026-02-14T12:00:00Z",
  "data": {
    "videos": [
      {
        "id": "7341234567890",
        "description": "Video caption here",
        "author": { "username": "creator", "followers": 1200000, "verified": true },
        "stats": { "views": 5400000, "likes": 340000, "comments": 12000, "shares": 45000 },
        "sound": { "name": "Original Sound", "author": "creator", "original": true },
        "hashtags": ["fyp", "viral", "ai"],
        "createdAt": "2026-02-13T08:00:00Z",
        "url": "https://www.tiktok.com/@creator/video/7341234567890"
      }
    ],
    "trending_hashtags": [
      { "name": "#ai", "views": 45000000000, "velocity": "+340% 24h" }
    ],
    "trending_sounds": [
      { "name": "Sound Name", "uses": 890000, "velocity": "+120% 24h" }
    ]
  },
  "proxy": { "country": "US", "carrier": "T-Mobile", "type": "mobile" },
  "payment": { "txHash": "...", "amount": 0.02, "verified": true }
}
```

## Environment Variables

```env
# Required
WALLET_ADDRESS=YOUR_SOLANA_WALLET_ADDRESS
PROXY_HOST=your.proxy.host
PROXY_HTTP_PORT=8080
PROXY_USER=your_user
PROXY_PASS=your_pass
PROXY_COUNTRY=US

# Multi-country pool (optional)
PROXY_LIST=host1:8080:user1:pass1:US;host2:8080:user2:pass2:DE;host3:8080:user3:pass3:GB
```

## Why Mobile Proxies Are Required

TikTok uses the most advanced anti-scraping in social media:
- **Device fingerprinting** — TLS fingerprint + canvas hash checks
- **Behavioral analysis** — datacenter IPs flagged within minutes
- **X-Bogus / msToken** — encrypted signatures validated against IP reputation
- **Geo-fencing** — trending content differs by country; carrier-level geo accuracy

Proxies.sx real 4G/5G carrier IPs (T-Mobile US, Vodafone DE, Orange FR) pass all these checks.

## Deploy

```bash
# Docker
docker build -t tiktok-trend-intelligence .
docker run -p 3000:3000 --env-file .env tiktok-trend-intelligence

# Railway / Fly.io / Render
# Connect the repo — Dockerfile detected automatically
```

## Architecture

```
src/
├── index.ts          # Server entry, middleware, discovery endpoint
├── service.ts        # Route handlers, x402 payment checks, 4 endpoints
├── proxy.ts          # Multi-proxy pool, round-robin rotation, retry logic
├── payment.ts        # On-chain USDC verification (Solana + Base)
├── types/
│   └── index.ts      # TypeScript interfaces
└── scrapers/
    └── tiktok-scraper.ts  # TikTok API + HTML parsing, token management
```

## Built on Proxies.sx Template

This service follows the [Proxies.sx marketplace template](https://github.com/bolivian-peru/marketplace-service-template) pattern:
- x402 payment gating (same payment.ts)
- Mobile proxy routing (same proxy.ts)
- Hono framework
- Bun runtime
