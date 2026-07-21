# Demo Endpoints — Google Reviews & Business Data API

All endpoints require x402 USDC payment via `X-Payment-Signature` and `X-Payment-Network` headers.

---

## 1. Search Businesses

```
GET /api/reviews/search?query=pizza&location=New+York&limit=5
```

**Price:** $0.01 USDC  
**Response:** List of businesses matching the query + location.

```json
{
  "query": "pizza",
  "location": "New York",
  "businesses": [
    {
      "name": "Joe's Pizza",
      "placeId": "ChIJLbpEMNBZwokRt-hXPMGlkMo",
      "rating": 4.5,
      "totalReviews": 2341,
      "address": "7 Carmine St, New York, NY 10014",
      "category": "Pizza restaurant"
    }
  ],
  "totalFound": 5,
  "meta": { "proxy": { "country": "US", "type": "mobile" } },
  "payment": { "txHash": "...", "network": "solana", "amount": 0.01, "settled": true }
}
```

---

## 2. Fetch Reviews

```
GET /api/reviews/ChIJLbpEMNBZwokRt-hXPMGlkMo?sort=newest&limit=10
```

**Price:** $0.02 USDC  
**Response:** Individual reviews with author, rating, text, date, owner response.

```json
{
  "business": { "name": "Joe's Pizza", "placeId": "ChIJLbpEMNBZwokRt-hXPMGlkMo", "rating": 4.5 },
  "reviews": [
    {
      "author": "John D.",
      "rating": 5,
      "text": "Best pizza in NYC!",
      "date": "2026-02-01",
      "likes": 12,
      "ownerResponse": "Thank you for visiting!",
      "photos": []
    }
  ],
  "pagination": { "total": 2341, "returned": 10, "sort": "newest" }
}
```

---

## 3. Business Details

```
GET /api/business/ChIJLbpEMNBZwokRt-hXPMGlkMo
```

**Price:** $0.01 USDC  
**Response:** Full business info + review summary + rating distribution.

```json
{
  "business": {
    "name": "Joe's Pizza",
    "placeId": "ChIJLbpEMNBZwokRt-hXPMGlkMo",
    "rating": 4.5,
    "totalReviews": 2341,
    "address": "7 Carmine St, New York, NY 10014",
    "phone": "+1-212-366-1182",
    "website": "https://www.joespizzanyc.com",
    "hours": { "Monday": "10 AM–2 AM", "Tuesday": "10 AM–2 AM" },
    "category": "Pizza restaurant",
    "photos": ["https://lh5.googleusercontent.com/..."],
    "coordinates": { "latitude": 40.7303, "longitude": -74.0023 }
  },
  "summary": {
    "avgRating": 4.5,
    "totalReviews": 2341,
    "ratingDistribution": { "5": 1200, "4": 600, "3": 300, "2": 141, "1": 100 },
    "responseRate": 45,
    "sentimentBreakdown": { "positive": 77, "neutral": 13, "negative": 10 }
  }
}
```

---

## 4. Review Summary (Cheaper)

```
GET /api/reviews/summary/ChIJLbpEMNBZwokRt-hXPMGlkMo
```

**Price:** $0.005 USDC  
**Response:** Aggregated stats only (no individual reviews).

```json
{
  "business": { "name": "Joe's Pizza", "placeId": "ChIJLbpEMNBZwokRt-hXPMGlkMo", "rating": 4.5, "totalReviews": 2341 },
  "summary": {
    "avgRating": 4.5,
    "totalReviews": 2341,
    "ratingDistribution": { "5": 1200, "4": 600, "3": 300, "2": 141, "1": 100 },
    "responseRate": 45,
    "avgResponseTimeDays": null,
    "sentimentBreakdown": { "positive": 77, "neutral": 13, "negative": 10 }
  }
}
```

---

## 5. Health Check (Free)

```
GET /health
```

**Response:**

```json
{
  "status": "healthy",
  "service": "marketplace-service",
  "version": "1.0.0",
  "timestamp": "2026-02-07T12:00:00.000Z",
  "endpoints": ["/api/jobs", "/api/reviews/search", "/api/reviews/:place_id", "/api/reviews/summary/:place_id", "/api/business/:place_id"]
}
```

---

## Pricing Summary

| Endpoint | Price |
|----------|-------|
| `GET /api/reviews/search` | $0.01 USDC |
| `GET /api/reviews/:place_id` | $0.02 USDC |
| `GET /api/business/:place_id` | $0.01 USDC |
| `GET /api/reviews/summary/:place_id` | $0.005 USDC |

**Payment Networks:** Solana, Base  
**Infrastructure:** Proxies.sx mobile proxies (real 4G/5G carrier IPs)
