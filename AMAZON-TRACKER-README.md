# Amazon Product & BSR Tracker API

**Bounty:** $75 USDC - Issue #72

Real-time Amazon product data extraction API with Best Seller Rank (BSR), price, reviews, and buy box data. Supports 6 marketplaces (US, UK, DE, FR, ES, IT) via mobile proxies.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export AMAZON_PROXY_URL="http://your-proxy.proxies.sx:8080"
export AMAZON_USDC_TREASURY="0xYourWalletAddress"

# Run server
python amazon_tracker.py
```

Server starts at `http://localhost:8000`

## Endpoints

### Product Lookup
```bash
GET /api/amazon/product/:asin?marketplace=US
```
Price: 0.005 USDC

### Search Products
```bash
GET /api/amazon/search?query=laptop&category=electronics&marketplace=US
```
Price: 0.01 USDC

### Bestsellers
```bash
GET /api/amazon/bestsellers?category=electronics&marketplace=US
```
Price: 0.01 USDC

### Reviews
```bash
GET /api/amazon/reviews/:asin?sort=recent&limit=10&marketplace=US
```
Price: 0.02 USDC

### x402 Info
```bash
GET /x402/info
```
Free - Returns payment protocol details

### Health Check
```bash
GET /health
```
Free

## x402 Payment Flow

1. Call any `/api/amazon/*` endpoint
2. Receive HTTP 402 with payment details
3. Send USDC on Base or Ethereum
4. Retry with `X-PAYMENT` header
5. Get product data

### Payment Header Example
```json
{
  "tx_hash": "0x...",
  "network": "base",
  "recipient": "0xd10A6AbFED84dDD28F89bB3d836BD20D5da8fEBf",
  "amount": "0.005"
}
```

## Example Response

```json
{
  "asin": "B0BSHF7WHW",
  "title": "Apple AirPods Pro (2nd Generation)",
  "price": {
    "current": 189.99,
    "currency": "USD",
    "was": 249.00,
    "discount_pct": 24
  },
  "bsr": {
    "rank": 1,
    "category": "Electronics",
    "sub_category_ranks": [
      {"category": "Headphones", "rank": 1}
    ]
  },
  "rating": 4.7,
  "reviews_count": 125432,
  "buy_box": {
    "seller": "Amazon.com",
    "is_amazon": true,
    "fulfilled_by": "Amazon"
  },
  "availability": "In Stock",
  "brand": "Apple",
  "images": ["https://..."],
  "meta": {
    "marketplace": "US",
    "proxy": {"ip": "mobile", "country": "US", "carrier": "Mobile"},
    "timestamp": "2026-03-14T..."
  }
}
```

## Testing

```bash
python test_script.py  # Full test suite
```

## Deployment

### Render
1. Create Web Service
2. Build: `pip install -r requirements.txt`
3. Start: `uvicorn amazon_tracker:app --host 0.0.0.0 --port $PORT`
4. Set env vars

### Railway
```bash
railway up
railway variables set AMAZON_PROXY_URL=... AMAZON_USDC_TREASURY=...
```

## Market Context

- Jungle Scout: $29-209/month
- Helium 10: $29-229/month
- This service: $0.005/product via micropayment

Perfect for AI agents and one-off lookups.

## License

MIT
