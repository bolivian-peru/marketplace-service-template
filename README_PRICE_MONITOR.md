# Price Monitor Service

Track e-commerce product prices across Amazon, eBay, Walmart, Target, and BestBuy with real-time price scraping, historical tracking, and customizable alert thresholds.

## Features

- **Real-time Price Scraping**: Fetch current prices from major e-commerce sites using mobile proxies
- **Price History**: Track price changes over time (up to 365 days of history)
- **Automatic Discount Detection**: Calculate discount percentages automatically
- **Price Drop Alerts**: Set thresholds and get notified when prices drop
- **Multi-site Support**: Works with Amazon, eBay, Walmart, Target, BestBuy
- **x402 Micropayments**: Pay with USDC on Solana or Base

## API Endpoints

### GET /api/price

Get current price and price history for a product.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes* | Product URL (e.g., `https://www.amazon.com/dp/B09V3KXJPB`) |
| asin | string | Yes* | Amazon ASIN (alternative to url) |
| check_price | number | No | Alert threshold - get notified when price drops below this value |

*Either `url` or `asin` is required.

**Example:**
```bash
curl "http://localhost:3000/api/price?url=https://www.amazon.com/dp/B09V3KXJPB"
```

### GET /api/price/history

Get price history for a tracked product.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes* | Product URL |
| asin | string | Yes* | Amazon ASIN (alternative to url) |

### POST /api/price/alert

Set a price drop alert for a product.

**Body (JSON):**
```json
{
  "url": "https://www.amazon.com/dp/B09V3KXJPB",
  "targetPrice": 99.99
}
```

### GET /api/price/alerts

Get all alerts for a product.

### DELETE /api/price/alert

Remove a price alert.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| alert_id | string | Yes | The alert ID to remove |
| url | string | No | Product URL (for lookup) |
| asin | string | No | Amazon ASIN (for lookup) |

## Output Schema

```json
{
  "product": {
    "title": "Apple AirPods Pro (2nd Generation)",
    "currentPrice": 189.99,
    "originalPrice": 249.99,
    "discountPercent": 24,
    "currency": "USD",
    "url": "https://www.amazon.com/dp/B09V3KXJPB",
    "asin": "B09V3KXJPB",
    "availability": "in_stock",
    "rating": 4.7,
    "reviewCount": 45231,
    "site": "amazon"
  },
  "lastChecked": "2026-05-09T12:00:00.000Z",
  "priceHistory": [
    {
      "timestamp": "2026-05-09T12:00:00.000Z",
      "currentPrice": 189.99,
      "originalPrice": 249.99,
      "discountPercent": 24,
      "availability": "in_stock"
    }
  ],
  "alerts": [
    {
      "id": "alert_1234567890_abc123",
      "targetPrice": 150.00,
      "createdAt": "2026-05-09T12:00:00.000Z",
      "triggered": false,
      "triggeredAt": null
    }
  ],
  "triggeredAlerts": [],
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

## JSON Output Spec

### Product Fields
| Field | Type | Description |
|-------|------|-------------|
| title | string | Product title/name |
| currentPrice | number \| null | Current price |
| originalPrice | number \| null | Original/list price |
| discountPercent | number \| null | Discount percentage |
| currency | string | Currency code (USD, EUR, GBP) |
| url | string | Product URL |
| asin | string \| null | Amazon ASIN (if applicable) |
| itemId | string \| null | eBay item ID (if applicable) |
| availability | string | in_stock, out_of_stock, limited_stock, unknown |
| rating | number \| null | Product rating (0-5) |
| reviewCount | number \| null | Number of reviews |
| image | string \| null | Product image URL |
| site | string | amazon, ebay, walmart, target, bestbuy, unknown |

### Price History Fields
| Field | Type | Description |
|-------|------|-------------|
| timestamp | string | ISO timestamp |
| currentPrice | number \| null | Price at this time |
| originalPrice | number \| null | Original price at this time |
| discountPercent | number \| null | Discount % at this time |
| availability | string | Availability at this time |

### Alert Fields
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique alert ID |
| targetPrice | number | Price threshold |
| createdAt | string | ISO timestamp |
| triggered | boolean | Whether alert was triggered |
| triggeredAt | string \| null | When alert was triggered |

## Payment

Price: **$0.005 USDC** per request

Supports payments on:
- **Solana** (~400ms settlement)
- **Base** (~2s settlement)

### Payment Flow

1. Request endpoint without payment → Returns 402 with payment instructions
2. Send USDC to recipient address
3. Retry request with `Payment-Signature` header containing tx hash
4. Receive data on successful verification

## Deploy Instructions

### Prerequisites
- Bun or Node.js
- Proxies.sx mobile proxy credentials

### Quick Start

```bash
# Clone/fork the repository
git clone https://github.com/YOUR_USERNAME/marketplace-service-template
cd marketplace-service-template

# Install dependencies
bun install

# Copy and configure environment
cp .env.example .env
# Edit .env with your WALLET_ADDRESS and PROXY_* credentials

# Run development server
bun run dev

# Or run production
bun run start
```

### Docker Deployment

```bash
# Build image
docker build -t price-monitor .

# Run container
docker run -p 3000:3000 --env-file .env price-monitor
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| WALLET_ADDRESS | Yes | - | Your Solana wallet address for receiving payments |
| WALLET_ADDRESS_BASE | No | WALLET_ADDRESS | Your Base wallet address |
| PROXY_HOST | Yes* | - | Proxy hostname (e.g., gate.proxies.sx) |
| PROXY_HTTP_PORT | Yes* | - | Proxy HTTP port (e.g., 10000) |
| PROXY_USER | Yes* | - | Proxy username |
| PROXY_PASS | Yes* | - | Proxy password |
| PORT | No | 3000 | Server port |

*Or use `PROXY_LIST` for multiple proxies.

### Proxy Configuration (Proxies.sx)

Set the following in your `.env`:
```
PROXY_HOST=gate.proxies.sx
PROXY_HTTP_PORT=10000
PROXY_USER=your_username
PROXY_PASS=your_password
```

## Example Usage

### Track a Product Price
```bash
curl "http://localhost:3000/api/price?url=https://www.amazon.com/dp/B09V3KXJPB"
```

### Track with Alert
```bash
curl "http://localhost:3000/api/price?url=https://www.amazon.com/dp/B09V3KXJPB&check_price=150"
```

### Set Alert via POST
```bash
curl -X POST "http://localhost:3000/api/price/alert" \
  -H "Content-Type: application/json" \
  -d '{"asin": "B09V3KXJPB", "targetPrice": 150.00}'
```

### Get Price History
```bash
curl "http://localhost:3000/api/price/history?asin=B09V3KXJPB"
```

## Supported Sites

| Site | URL Patterns | Identifiers |
|------|-------------|-------------|
| Amazon | amazon.com, amazon.co.uk, etc. | ASIN |
| eBay | ebay.com, ebay.co.uk, etc. | Item ID |
| Walmart | walmart.com | - |
| Target | target.com | - |
| BestBuy | bestbuy.com | - |

## License

MIT
