# Proof of Output — Amazon Product & BSR Tracker API

Real data collected through US T-Mobile mobile proxy (Proxies.sx).

## Proxy Details
- Exit IP: 172.56.169.60 (US T-Mobile mobile carrier)
- Provider: Proxies.sx
- Payment TX: 0xc655e656981acec60320149aaf98ecf8c2f03e52db36c0f1f5581054861f3c68 (Base L2 USDC)

## Endpoint Coverage (4/4 endpoints demonstrated)

### sample-1.json — `GET /api/amazon/search` (Product Search)
- Query: "wireless headphones"
- Marketplace: Amazon US
- HTTP Status: 200
- Products Found: 5 ASINs extracted with prices, ratings, BSR data
- Collected: 2026-03-02T12:45:00Z

### sample-2.json — `GET /api/amazon/product/:asin` (Product Detail)
- ASIN: B0BDHB9Y8H (Sony WH-1000XM5 headphones)
- Marketplace: Amazon US
- HTTP Status: 200
- Fields: price, was-price, discount, rating, BSR with category breakdowns, availability, brand
- Collected: 2026-03-02T12:50:00Z

### sample-3.json — `GET /api/amazon/bestsellers` (BSR Rankings)
- Category: electronics
- Marketplace: Amazon US
- HTTP Status: 200
- Products: Top 10 BSR with titles, ASINs, prices, rank positions
- Collected: 2026-03-02T12:55:00Z

### sample-4.json — `GET /api/amazon/reviews/:asin` (Customer Reviews)
- ASIN: B0BDHB9Y8H (Sony WH-1000XM5 headphones)
- Marketplace: Amazon US
- HTTP Status: 200
- Fields: summary stats, rating distribution, top themes, 3 verified reviews with sentiment
- Collected: 2026-03-04T10:15:00Z

## Notes
- All 9 supported marketplaces: US, UK, DE, FR, ES, IT, CA, JP, AU
- All requests routed through US T-Mobile mobile proxy (carrier: T-Mobile US, type: mobile)
- Proxy IP and carrier metadata included in every response under `proxy` field
- See `amazon-proxy-verification.json` for raw proxy validation data
