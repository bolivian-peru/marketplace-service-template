

# Amazon Product & BSR Tracker API

The Amazon Product & BSR Tracker API provides real-time Amazon product data including prices, Best Sellers Rank (BSR), reviews, ratings, and buy box information. All requests are routed through mobile proxies to bypass Amazon's aggressive anti-bot systems.

## Authentication

All endpoints use the x402 payment protocol. You'll receive a 402 response with payment instructions, then include the transaction hash in subsequent requests.

## Endpoints

### 1. Get Product by ASIN

```
GET /api/amazon/product/:asin
```

**Parameters:**
- `asin` (required): Amazon Standard Identification Number
- `marketplace` (optional, default: "US"): Amazon marketplace (US, UK, DE)

**Example:**
```bash
curl -i "http://localhost:3000/api/amazon/product/B0BSHF7WHW?marketplace=US"
```

**Response (200):**
```json
{
  "asin": "B0BSHF7WHW",
  "title": "Apple AirPods Pro (2nd Generation)",
  "brand": "Apple",
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
      { "category": "Headphones", "rank": 1 }
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
  "images": ["https://..."],
  "meta": {
    "marketplace": "US",
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.005,
    "settled": true
  }
}
```

### 2. Get Best Sellers Rank (BSR) for Category

```
GET /api/amazon/bsr
```

**Parameters:**
- `category` (required): Amazon category (electronics, books, home, etc.)
- `marketplace` (optional, default: "US"): Amazon marketplace (US, UK, DE)
- `limit` (optional, default: 20): Max number of products to return

**Example:**
```bash
curl -i "http://localhost:3000/api/amazon/bsr?category=electronics&marketplace=US&limit=20"
```

**Response (200):**
```json
{
  "category": "electronics",
  "rank": 125,
  "subcategories": [
    { "name": "Headphones", "rank": 1, "url": "https://www.amazon.com/gp/bestsellers/electronics/headphones" },
    { "name": "Speakers", "rank": 2, "url": "https://www.amazon.com/gp/bestsellers/electronics/speakers" }
  ],
  "products": [
    {
      "asin": "B0BSHF7WHW",
      "title": "Apple AirPods Pro (2nd Generation)",
      "price": 189.99,
      "rating": 4.7,
      "reviews_count": 125432,
      "url": "https://www.amazon.com/dp/B0BSHF7WHW"
    }
  ],
  "meta": {
    "marketplace": "US",
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.01,
    "settled": true
  }
}
```

### 3. Search Products

```
GET /api/amazon/search
```

**Parameters:**
- `query` (required): Search keyword
- `category` (optional): Amazon category filter
- `marketplace` (optional, default: "US"): Amazon marketplace (US, UK, DE)
- `limit` (optional, default: 20): Max number of results to return

**Example:**
```bash
curl -i "http://localhost:3000/api/amazon/search?query=wireless+headphones&category=electronics&marketplace=US&limit=20"
```

**Response (200):**
```json
{
  "query": "wireless headphones",
  "category": "electronics",
  "results": [
    {
      "asin": "B0BSHF7WHW",
      "title": "Apple AirPods Pro (2nd Generation)",
      "price": 189.99,
      "rating": 4.7,
      "reviews_count": 125432,
      "url": "https://www.amazon.com/dp/B0BSHF7WHW"
    }
  ],
  "total_found": 1,
  "meta": {
    "marketplace": "US",
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.01,
    "settled": true
  }
}
```

### 4. Get Product Reviews

```
GET /api/amazon/reviews/:asin
```

**Parameters:**
- `asin` (required): Amazon Standard Identification Number
- `sort` (optional, default: "recent"): Sort by "recent" or "helpful"
- `limit` (optional, default: 10): Max number of reviews to return

**Example:**
```bash
curl -i "http://localhost:3000/api/amazon/reviews/B0BSHF7WHW?sort=recent&limit=10"
```

**Response (200):**
```json
{
  "asin": "B0BSHF7WHW",
  "reviews": [
    {
      "rating": 5,
      "title": "Amazing sound quality!",
      "content": "These AirPods have transformed my listening experience...",
      "author": "HappyCustomer123",
      "date": "2026-05-01",
      "verified_purchase": true
    }
  ],
  "total_reviews": 1,
  "meta": {
    "marketplace": "US",
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.02,
    "settled": true
  }
}
```

## Pricing

| Endpoint | Price (USDC) | Description |
|----------|--------------|-------------|
| `/api/amazon/product/:asin` | $0.005 | Get product data by ASIN |
| `/api/amazon/bsr` | $0.01 | Get BSR for a category |
| `/api/amazon/search` | $0.01 | Search products by keyword |
| `/api/amazon/reviews/:asin` | $0.02 | Get product reviews |

## Marketplaces

The API supports the following Amazon marketplaces:

- US: `www.amazon.com`
- UK: `www.amazon.co.uk`
- DE: `www.amazon.de`

## Proxy Information

Each response includes proxy metadata showing the mobile carrier IP used for the request:

```json
"meta": {
  "marketplace": "US",
  "proxy": {
    "ip": "123.45.67.89",
    "country": "US",
    "carrier": "AT&T",
    "type": "mobile"
  }
}
```

## Error Handling

Common error responses:

- **402 Payment Required**: You need to pay USDC to access the endpoint
- **429 Too Many Requests**: You've exceeded the proxy rate limit (20 requests/min)
- **502 Bad Gateway**: Amazon blocked the request or the ASIN/category is invalid

## Implementation Notes

1. **Mobile Proxies**: All requests are routed through mobile carrier IPs to bypass Amazon's anti-bot systems
2. **Retry Logic**: The API includes automatic retries for failed requests
3. **Rate Limiting**: 20 requests per minute per IP to protect proxy quota
4. **Error Handling**: Graceful handling of Amazon CAPTCHAs and blocks

## Example Usage with Payment

```bash
# First request - get payment instructions
curl -i "http://localhost:3000/api/amazon/product/B0BSHF7WHW?marketplace=US"

# Response will be 402 with payment details

# Second request - include payment signature
curl -i -H "Payment-Signature: 5x402..." \
     "http://localhost:3000/api/amazon/product/B0BSHF7WHW?marketplace=US"
```

## Integration with x402

The API follows the x402 payment protocol:

1. Client makes request
2. Server responds with 402 and payment instructions
3. Client sends USDC to the specified wallet
4. Client includes transaction hash in subsequent request
5. Server verifies payment and returns data

## Support

For issues or questions, please open an issue in the GitHub repository or contact the maintainers.

