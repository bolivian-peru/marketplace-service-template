# Bounty #78 — Airbnb Market Intelligence: Curl Verification Transcript

**Date:** 2026-03-09T08:04 UTC
**Base URL:** https://marketplace-api-9kvb.onrender.com
**PR:** https://github.com/bolivian-peru/marketplace-service-template/pull/198
**Branch:** fix/bounty-78-carrier-metadata (genesis-ai-labs-star fork)

---

## 1. Health Check

```
$ curl -s https://marketplace-api-9kvb.onrender.com/health | jq .status
"healthy"
```

**Result:** HTTP 200 — service healthy, all 4 Airbnb endpoints listed in endpoint registry.

---

## 2. GET /api/airbnb/search

```
$ curl -s -w "\nHTTP_CODE: %{http_code}\n" \
  "https://marketplace-api-9kvb.onrender.com/api/airbnb/search?location=Miami&checkin=2026-03-15&checkout=2026-03-20&adults=2"
```

**Result:** HTTP 402 — Payment required
- Price: **$0.02 USDC**
- Networks: Solana + Base
- Solana recipient: `GpXHXs5KfzfXbNKcMLNbAMsJsgPsBE7y5GtwVoiuxYvH`
- Base recipient: `0xF8cD900794245fc36CBE65be9afc23CDF5103042`
- Input schema: location (required), checkin, checkout, guests, price_min, price_max, limit
- Output schema: `AirbnbListing[]`

---

## 3. GET /api/airbnb/listing/:id

```
$ curl -s -w "\nHTTP_CODE: %{http_code}\n" \
  "https://marketplace-api-9kvb.onrender.com/api/airbnb/listing/12345"
```

**Result:** HTTP 402 — Payment required
- Price: **$0.01 USDC**
- Output schema: `AirbnbListingDetail`

---

## 4. GET /api/airbnb/reviews/:listing_id

```
$ curl -s -w "\nHTTP_CODE: %{http_code}\n" \
  "https://marketplace-api-9kvb.onrender.com/api/airbnb/reviews/12345"
```

**Result:** HTTP 402 — Payment required
- Price: **$0.01 USDC**
- Output schema: `AirbnbReview[]`

---

## 5. GET /api/airbnb/market-stats

```
$ curl -s -w "\nHTTP_CODE: %{http_code}\n" \
  "https://marketplace-api-9kvb.onrender.com/api/airbnb/market-stats?location=Miami"
```

**Result:** HTTP 402 — Payment required
- Price: **$0.05 USDC**
- Output schema: `{ avg_daily_rate, median_daily_rate, total_listings, price_distribution, property_types }`

---

## Summary

| Endpoint | HTTP | Price | x402 Gate |
|---|---|---|---|
| `GET /api/airbnb/search` | 402 | $0.02 USDC | ✅ |
| `GET /api/airbnb/listing/:id` | 402 | $0.01 USDC | ✅ |
| `GET /api/airbnb/reviews/:listing_id` | 402 | $0.01 USDC | ✅ |
| `GET /api/airbnb/market-stats` | 402 | $0.05 USDC | ✅ |

All endpoints return correct x402 payment gate with Solana + Base dual-network support, proper pricing, and schema documentation.
