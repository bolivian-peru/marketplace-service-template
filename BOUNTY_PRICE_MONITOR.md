# Price Monitor Bounty Submission

## Bounty Details
- **Bounty**: Price Monitor ($100)
- **Service**: E-commerce price tracking service
- **Status**: ✅ Complete

## Requirements Checklist

| Requirement | Status | Implementation |
|------------|--------|----------------|
| Fork template repository | ✅ | Forked from https://github.com/bolivian-peru/marketplace-service-template |
| Track e-commerce prices | ✅ | Amazon, eBay, Walmart, Target, BestBuy |
| Input: URL or ASIN | ✅ | `?url=` or `?asin=` parameters |
| Output: current price | ✅ | `currentPrice` field |
| Output: original price | ✅ | `originalPrice` field |
| Output: discount % | ✅ | `discountPercent` field |
| Output: availability | ✅ | `availability` field |
| Output: last_checked | ✅ | `lastChecked` ISO timestamp |
| Uses Proxies.sx mobile proxy | ✅ | gate.proxies.sx:10000 via proxyFetch |
| Price history storage | ✅ | In-memory + extensible |
| Alert threshold support | ✅ | POST /api/price/alert with targetPrice |
| x402 micropayment | ✅ | Solana + Base USDC verification |

## Files Created

### Core Service Files
- `src/scrapers/price-scraper.ts` - Main scraper logic for Amazon, eBay, etc.
- `src/routes/price-monitor.ts` - API routes and endpoints
- `src/types/index.ts` - Added PriceData, ProductInfo, PriceAlert interfaces

### Documentation
- `README_PRICE_MONITOR.md` - Complete documentation
- `listings/price-monitor.json` - Marketplace listing

### Configuration
- `listings/index.json` - Updated with new service entry

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/price` | GET | Get current price and history |
| `/api/price/history` | GET | Get price history |
| `/api/price/alert` | POST | Set price alert |
| `/api/price/alerts` | GET | Get alerts |
| `/api/price/alert` | DELETE | Remove alert |

## JSON Output Specification

```json
{
  "product": {
    "title": "string",
    "currentPrice": "number | null",
    "originalPrice": "number | null",
    "discountPercent": "number | null",
    "currency": "string",
    "url": "string",
    "asin": "string | null",
    "availability": "string",
    "rating": "number | null",
    "reviewCount": "number | null",
    "site": "string"
  },
  "lastChecked": "ISO timestamp",
  "priceHistory": [
    {
      "timestamp": "ISO timestamp",
      "currentPrice": "number | null",
      "originalPrice": "number | null",
      "discountPercent": "number | null",
      "availability": "string"
    }
  ],
  "alerts": [...],
  "triggeredAlerts": [...],
  "proxy": {
    "country": "string",
    "type": "mobile"
  },
  "payment": {
    "txHash": "string",
    "network": "string",
    "amount": "number",
    "settled": "boolean"
  }
}
```

## Deploy Instructions

```bash
# 1. Clone/fork the repository
git clone https://github.com/bolivian-peru/marketplace-service-template
cd marketplace-service-template

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example .env
# Edit .env:
# - WALLET_ADDRESS=your_solana_wallet
# - PROXY_HOST=gate.proxies.sx
# - PROXY_HTTP_PORT=10000
# - PROXY_USER=your_username
# - PROXY_PASS=your_password

# 4. Run development
bun run dev

# 5. Or run production
bun run start

# Docker deployment:
docker build -t price-monitor .
docker run -p 3000:3000 --env-file .env price-monitor
```

## Example Usage

```bash
# Get current price
curl "http://localhost:3000/api/price?asin=B09V3KXJPB"

# Get price with alert
curl "http://localhost:3000/api/price?url=https://amazon.com/dp/B09V3KXJPB&check_price=150"

# Set alert
curl -X POST "http://localhost:3000/api/price/alert" \
  -H "Content-Type: application/json" \
  -d '{"asin": "B09V3KXJPB", "targetPrice": 150}'
```

## Price

- **$0.005 USDC** per request
- Payment via Solana (~400ms) or Base (~2s)
- x402 protocol with on-chain verification

## Notes

- Price history stored in-memory (up to 365 entries per product)
- Alert thresholds persist in-memory (resets on server restart)
- Mobile proxy rotation for reliable scraping
- Automatic discount calculation from original/current prices
