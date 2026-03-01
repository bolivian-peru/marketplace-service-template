# Food Delivery Price Intelligence API

## Bounty Submission: #76 — $50 SX token

### Live Deployment
> Deploy URL will be here after Render deployment

### What I built

A production-ready **Food Delivery Price Intelligence API** that scrapes restaurant listings, menus, and delivery fees from **Uber Eats** and **DoorDash** using Proxies.sx mobile proxies, protected by x402 USDC payment gates.

---

## Endpoints

### 1. Restaurant Search
```
GET /api/food/search?query=pizza&address=10001&platform=ubereats&limit=10
```
- **Price:** $0.01 USDC per request
- **Platforms:** `ubereats` (default), `doordash`
- **Returns:** Restaurant list with name, rating, delivery fee, delivery time, promotions

### 2. Full Menu Extraction
```
GET /api/food/menu?id=<restaurant-id>&platform=ubereats
```
- **Price:** $0.02 USDC per request
- **Returns:** All menu items with prices, descriptions, categories

### 3. Cross-Platform Price Comparison
```
GET /api/food/compare?query=pizza&address=10001&limit=5
```
- **Price:** $0.03 USDC per request
- **Returns:** Side-by-side results from Uber Eats + DoorDash, cheapest delivery highlighted

---

## Sample Response

```json
{
  "restaurants": [
    {
      "id": "abc123",
      "name": "Joe's Pizza",
      "rating": 4.7,
      "reviews_count": 1200,
      "delivery_fee": 2.99,
      "delivery_time_min": 25,
      "delivery_time_max": 35,
      "minimum_order": 15.00,
      "promotions": ["$5 off $25+"],
      "platform": "ubereats"
    }
  ],
  "total": 10,
  "meta": {
    "proxy": { "country": "US", "type": "mobile" },
    "payment": { "txHash": "...", "network": "solana", "amount": 0.01, "settled": true }
  },
  "scraped_at": "2026-03-01T12:00:00.000Z"
}
```

---

## Technical Implementation

- **Proxy:** All requests route through `Proxies.sx` mobile proxies (T-Mobile, AT&T carrier IPs)
- **Anti-detection:** Mobile User-Agent headers, realistic request timing
- **Resilience:** Multi-strategy scraping (API → HTML parsing → regex fallback)
- **Payment:** x402 USDC payment gate on all data endpoints

## Closes #76
