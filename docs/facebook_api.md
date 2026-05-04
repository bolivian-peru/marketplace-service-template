

# Facebook Marketplace Monitor API

The Facebook Marketplace Monitor API allows you to search and monitor Facebook Marketplace listings with real-time updates. This API is designed to work with mobile proxies to avoid Facebook's detection systems.

## Overview

Facebook Marketplace has no official public API, so this service scrapes the marketplace directly using mobile proxies. The API provides endpoints for searching listings, getting listing details, browsing categories, and monitoring for new listings.

## Authentication

All endpoints require payment verification using the x402 protocol. You'll need to send a USDC payment on Solana or Base network and include the transaction hash in the `Payment-Signature` header.

## Endpoints

### 1. Search Listings

**Endpoint:** `GET /api/marketplace/search`

**Description:** Search Facebook Marketplace with filters for keyword, location, price range, and category.

**Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| query | string | No | Search query (e.g., "iPhone 15") | `iphone+15` |
| location | string | No | Location to search (e.g., "New York") | `New+York` |
| radius | string | No | Search radius (e.g., "25mi") | `25mi` |
| min_price | string | No | Minimum price | `500` |
| max_price | string | No | Maximum price | `1000` |
| category | string | No | Category ID | `1` |

**Example Request:**
```
GET /api/marketplace/search?query=iphone+15&location=New+York&min_price=500&max_price=1000
```

**Example Response:**
```json
{
  "results": [
    {
      "id": "123456789",
      "title": "iPhone 15 Pro Max 256GB",
      "price": 850,
      "currency": "USD",
      "location": "Brooklyn, NY",
      "seller": {
        "name": "John D.",
        "joined": "2019",
        "rating": "5/5"
      },
      "condition": "Used - Like New",
      "posted_at": "2026-02-15T08:30:00Z",
      "images": ["https://example.com/image1.jpg"],
      "url": "https://facebook.com/marketplace/item/123456789"
    }
  ],
  "total": 45,
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5xY...",
      "network": "solana",
      "amount": 0.01,
      "settled": true
    }
  }
}
```

**Price:** $0.01 USDC per search

---

### 2. Get Listing Details

**Endpoint:** `GET /api/marketplace/listing/:id`

**Description:** Get detailed information about a specific listing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Listing ID (in URL path) |

**Example Request:**
```
GET /api/marketplace/listing/123456789
```

**Example Response:**
```json
{
  "listing": {
    "id": "123456789",
    "title": "iPhone 15 Pro Max 256GB",
    "price": 850,
    "currency": "USD",
    "location": "Brooklyn, NY",
    "seller": {
      "name": "John D.",
      "joined": "2019",
      "rating": "5/5"
    },
    "condition": "Used - Like New",
    "posted_at": "2026-02-15T08:30:00Z",
    "images": [
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg"
    ],
    "url": "https://facebook.com/marketplace/item/123456789"
  },
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5xY...",
      "network": "solana",
      "amount": 0.005,
      "settled": true
    }
  }
}
```

**Price:** $0.005 USDC per listing detail

---

### 3. Get Categories

**Endpoint:** `GET /api/marketplace/categories`

**Description:** Get available categories for a location.

**Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| location | string | No | Location to search (e.g., "New York") | `New+York` |

**Example Request:**
```
GET /api/marketplace/categories?location=New+York
```

**Example Response:**
```json
{
  "categories": [
    {
      "id": "1",
      "name": "Vehicles",
      "url": "https://facebook.com/marketplace/vehicles"
    },
    {
      "id": "2",
      "name": "Housing",
      "url": "https://facebook.com/marketplace/housing"
    },
    {
      "id": "3",
      "name": "Electronics",
      "url": "https://facebook.com/marketplace/electronics"
    },
    {
      "id": "4",
      "name": "Clothing & Accessories",
      "url": "https://facebook.com/marketplace/clothing"
    },
    {
      "id": "5",
      "name": "Home & Garden",
      "url": "https://facebook.com/marketplace/home-garden"
    },
    {
      "id": "6",
      "name": "Sports & Leisure",
      "url": "https://facebook.com/marketplace/sports"
    },
    {
      "id": "7",
      "name": "Toys & Games",
      "url": "https://facebook.com/marketplace/toys"
    },
    {
      "id": "8",
      "name": "Other",
      "url": "https://facebook.com/marketplace/other"
    }
  ],
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5xY...",
      "network": "solana",
      "amount": 0.01,
      "settled": true
    }
  }
}
```

**Price:** $0.01 USDC per request

---

### 4. Monitor for New Listings

**Endpoint:** `GET /api/marketplace/new`

**Description:** Monitor for new listings matching a query within a time window.

**Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| query | string | Yes | Search query (e.g., "iPhone 15") | `iphone+15` |
| since | string | No | Time window for new listings (e.g., "1h", "24h") | `1h` |

**Example Request:**
```
GET /api/marketplace/new?query=iphone+15&since=1h
```

**Example Response:**
```json
{
  "new_listings": [
    {
      "id": "987654321",
      "title": "iPhone 15 128GB",
      "price": 750,
      "currency": "USD",
      "location": "Manhattan, NY",
      "seller": {
        "name": "Sarah K.",
        "joined": "2020",
        "rating": "4.8/5"
      },
      "condition": "New",
      "posted_at": "2026-05-04T14:25:00Z",
      "images": ["https://example.com/new_image.jpg"],
      "url": "https://facebook.com/marketplace/item/987654321"
    }
  ],
  "total_found": 3,
  "last_checked": "2026-05-04T14:25:00Z",
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5xY...",
      "network": "solana",
      "amount": 0.02,
      "settled": true
    }
  }
}
```

**Price:** $0.02 USDC per monitor check

## Error Responses

All endpoints return standard HTTP status codes:

- **402 Payment Required**: When no payment is provided or payment verification fails
- **400 Bad Request**: When required parameters are missing
- **429 Too Many Requests**: When proxy rate limit is exceeded
- **502 Bad Gateway**: When Facebook blocks the request

## Proxy Information

All requests are routed through mobile proxies to avoid detection. The proxy information is included in the response metadata:

```json
"meta": {
  "proxy": {
    "country": "US",
    "type": "mobile"
  }
}
```

## Rate Limiting

The API has a rate limit of 20 requests per minute per IP address to protect the proxy quota. If you exceed this limit, you'll receive a 429 response with a `Retry-After` header.

## Implementation Notes

1. **Mobile Proxies**: Facebook's detection system is sophisticated and blocks datacenter IPs. This API uses mobile carrier IPs to avoid detection.

2. **HTML Parsing**: The API scrapes Facebook Marketplace directly. In a production environment, you would want to use a proper HTML parser like Cheerio or Puppeteer for more reliable parsing.

3. **Pagination**: The search endpoint returns a total count, but doesn't currently support pagination. You can implement pagination by tracking the last listing ID and using it as a cursor.

4. **Real-time Monitoring**: The new listings monitor endpoint is designed for real-time monitoring. You can poll this endpoint periodically to detect new listings.

## Example Usage

Here's a complete example of how to use the API:

```javascript
// Step 1: Make a search request
const searchResponse = await fetch('http://localhost:3000/api/marketplace/search?query=iphone+15&location=New+York', {
  headers: {
    'Payment-Signature': 'YOUR_TX_HASH_HERE',
    'X-Payment-Network': 'solana'
  }
});

// Step 2: Get listing details for a specific listing
const listingId = '123456789';
const detailsResponse = await fetch(`http://localhost:3000/api/marketplace/listing/${listingId}`, {
  headers: {
    'Payment-Signature': 'YOUR_TX_HASH_HERE',
    'X-Payment-Network': 'solana'
  }
});

// Step 3: Monitor for new listings
const monitorResponse = await fetch('http://localhost:3000/api/marketplace/new?query=iphone+15&since=1h', {
  headers: {
    'Payment-Signature': 'YOUR_TX_HASH_HERE',
    'X-Payment-Network': 'solana'
  }
});
```

## Pricing Summary

| Endpoint | Price (USDC) |
|----------|--------------|
| Search | $0.01 |
| Listing Details | $0.005 |
| Categories | $0.01 |
| New Listings Monitor | $0.02 |

## Support

For issues or questions about the Facebook Marketplace Monitor API, please open an issue in the [marketplace-service-template](https://github.com/bolivian-peru/marketplace-service-template) repository.

