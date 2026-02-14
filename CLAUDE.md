# Marketplace Service Template

> For AI agents editing this repo. Read this before making changes.

## Architecture

```
src/
├── service.ts             ← EDIT THIS (your service logic, pricing, description)
├── scrapers/
│   └── maps-scraper.ts    ← Reference implementation (Google Maps scraping)
├── types/
│   └── index.ts           ← TypeScript interfaces for your service
├── utils/
│   └── helpers.ts         ← Reusable extraction helper functions
├── index.ts               ← DON'T EDIT (server, CORS, rate limiting, discovery)
├── payment.ts             ← DON'T EDIT (x402 USDC verification on Solana + Base)
└── proxy.ts               ← DON'T EDIT (proxy credentials + fetch with retry)
```

## Current Implementation: Google Maps Lead Generator

The repo ships with a working reference implementation — a Google Maps Lead Generator built by @aliraza556.

**Endpoints:**
- `GET /api/run?query=plumbers&location=Austin+TX&limit=20` — Search businesses
- `GET /api/details?placeId=<google_place_id>` — Get detailed business info
- `GET /health` — Health check
- `GET /` — Service discovery JSON

## What to Change in service.ts

1. **SERVICE_NAME** — Short identifier for your service
2. **PRICE_USDC** — Price per request in dollars (0.005 = half a cent)
3. **DESCRIPTION** — One-line description for AI agents
4. **OUTPUT_SCHEMA** — Describes your input/output contract (AI agents read this)
5. **The /run handler** — Your actual business logic

## Pattern for the /run Handler

```typescript
serviceRouter.get('/run', async (c) => {
  // 1. Payment check (extractPayment → build402Response if null)
  // 2. Payment verification (verifyPayment → reject if invalid)
  // 3. Input validation (check query params, reject if bad)
  // 4. Your logic (use proxyFetch for web requests)
  // 5. Return JSON result with payment confirmation
});
```

## Available Helpers

### From proxy.ts
- `getProxy()` — Returns proxy config from .env
- `proxyFetch(url, options?)` — Fetch through mobile proxy with retry (2 retries, 30s timeout)

### From payment.ts
- `extractPayment(c)` — Extract tx hash + network from request headers
- `verifyPayment(payment, wallet, amount)` — Verify USDC on-chain (Solana or Base)
- `build402Response(resource, desc, price, wallet, schema)` — Standard 402 JSON

## Environment Variables

Copy `.env.example` to `.env`:
- **WALLET_ADDRESS** — Your Solana wallet (required)
- **WALLET_ADDRESS_BASE** — Your Base wallet (optional, defaults to WALLET_ADDRESS)
- **PROXY_HOST/PORT/USER/PASS** — Mobile proxy credentials
- **PORT** — Server port (default 3000)
- **RATE_LIMIT** — Max requests per IP per minute (default 60)
- **SOLANA_RPC_URL** — Custom Solana RPC (optional)
- **BASE_RPC_URL** — Custom Base RPC (optional)

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Development with hot reload
bun run start        # Production
bun run typecheck    # Type checking
```

## Testing

```bash
curl localhost:3000/health                                        # → 200 healthy
curl localhost:3000/                                              # → 200 service discovery JSON
curl "localhost:3000/api/run?query=plumbers&location=Austin+TX"   # → 402 payment required (correct!)
```

The 402 response contains everything an AI agent needs to make a payment and retry.

## Deployment

```bash
# Docker
docker build -t my-service .
docker run -p 3000:3000 --env-file .env my-service

# Direct
bun install --production && bun run start
```

## Security Notes

- Payment verification is ON by default (Solana + Base RPCs)
- SSRF protection blocks private/internal URLs
- Rate limiting is per-IP (configurable via RATE_LIMIT env var)
- See SECURITY.md for production hardening checklist
