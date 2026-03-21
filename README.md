# Amazon Product & BSR Tracker API

Real-time Amazon product data API gated by x402 USDC micropayments. Built for the [Proxies.sx bounty #72](https://github.com/bolivian-peru/marketplace-service-template/issues/72).

## What It Does

- **Product Lookup** — price, BSR rank/category, rating, review count, buy box winner, availability, images, brand, features
- **Search** — keyword search with category filter, up to 20 results per page
- **Best Sellers** — top-ranked BSR products by category
- **Reviews** — product reviews with ratings, dates, verified purchase status

All requests routed through Proxies.sx 4G/5G mobile proxies — Amazon's highest-trust IP type.

## Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/amazon/product/:asin` | $0.005 USDC | Product data, price, BSR, buy box |
| `GET /api/amazon/search` | $0.01 USDC | Keyword search (20 results) |
| `GET /api/amazon/bestsellers` | $0.01 USDC | BSR top list by category |
| `GET /api/amazon/reviews/:asin` | $0.02 USDC | Reviews with rating + date |

## Supported Marketplaces

| Code | Domain | Currency |
|------|--------|----------|
| US | amazon.com | USD |
| UK | amazon.co.uk | GBP |
| DE | amazon.de | EUR |
| FR | amazon.fr | EUR |
| IT | amazon.it | EUR |
| ES | amazon.es | EUR |
| CA | amazon.ca | CAD |
| JP | amazon.co.jp | JPY |

## Quick Start

```bash
git clone <your-fork>
cd amazon-product-bsr-tracker

cp .env.example .env
# Edit .env: set WALLET_ADDRESS + PROXY_* credentials

bun install
bun run dev
```

Test:

```bash
curl http://localhost:3000/health
# → {"status":"healthy","service":"amazon-product-bsr-tracker",...}

curl http://localhost:3000/api/amazon/product/B0BSHF7WHW
# → 402 with payment instructions

curl http://localhost:3000/api/amazon/search?query=headphones
# → 402 with payment instructions
```

## x402 Payment Flow

1. Client calls endpoint → gets **402** with wallet + price
2. Client sends USDC on Solana or Base
3. Client retries with `Payment-Signature: <tx_hash>` header
4. Service verifies on-chain → returns **200** with data

## Example Response (Product)

```json
{
  "asin": "B0BSHF7WHW",
  "title": "Apple AirPods Pro (2nd Generation)",
  "price": {
    "current": 189.99,
    "currency": "USD",
    "was": 249.00,
    "discount_pct": 24,
    "deal_label": null
  },
  "bsr": {
    "rank": 1,
    "category": "Electronics",
    "sub_category_ranks": [
      { "category": "Headphones", "rank": 1 }
    ]
  },
  "rating": 4.7,
  "reviews_count": 125432,
  "buy_box": {
    "seller": "Amazon.com",
    "is_amazon": true,
    "fulfilled_by": "Amazon",
    "seller_rating": null,
    "seller_ratings_count": null
  },
  "availability": "In Stock",
  "brand": "Apple",
  "images": ["https://..."],
  "meta": {
    "marketplace": "US",
    "url": "https://www.amazon.com/dp/B0BSHF7WHW",
    "scraped_at": "2026-03-21T16:00:00Z",
    "proxy": {
      "ip": "...",
      "country": "US",
      "carrier": null,
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "...",
    "network": "solana",
    "amount": 0.005,
    "settled": true
  }
}
```

## Anti-Bot Handling

- Mobile Safari User-Agent (blends with Amazon app traffic)
- CAPTCHA detection with automatic retry (3 attempts)
- Proxy pool rotation for IP diversity
- Per-IP rate limiting (20 proxy requests/min)

## Deploy

### Railway / Render / Fly.io
Just push the repo — Dockerfile detected automatically.

### Docker
```bash
docker build -t amazon-bsr-tracker .
docker run -p 3000:3000 --env-file .env amazon-bsr-tracker
```

### VPS (any Bun-supported host)
```bash
bun install --production
bun run start
```

## Environment Variables

```env
WALLET_ADDRESS=<your-solana-wallet>       # Required: where USDC payments go
WALLET_ADDRESS_BASE=<your-base-wallet>    # Optional: Base network wallet
PROXY_HOST=<proxy-host>                   # Required: Proxies.sx host
PROXY_HTTP_PORT=<proxy-port>              # Required: Proxies.sx port
PROXY_USER=<proxy-user>                   # Required: Proxies.sx username
PROXY_PASS=<proxy-pass>                   # Required: Proxies.sx password
PROXY_COUNTRY=US                          # Optional: default US
PORT=3000                                 # Optional: server port
RATE_LIMIT=60                             # Optional: requests/min per IP
```

Get proxy credentials at [client.proxies.sx](https://client.proxies.sx)

## Why Mobile Proxies?

Amazon runs ML-based anomaly detection in 2026. Datacenter IPs get CAPTCHA walls immediately. Mobile carrier IPs have the highest trust scores because Amazon's own shopping app generates massive mobile traffic — your requests blend seamlessly.

## Market Context

- Jungle Scout: $29-209/month
- Helium 10: $29-229/month
- Keepa: $19/month (price history only)
- **This service: $0.005/product** — perfect for AI agents and one-off lookups
