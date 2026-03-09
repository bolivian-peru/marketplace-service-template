# Food Delivery Price Intelligence API — Proof of Output

Real scraped data from Uber Eats and DoorDash via Proxies.sx US mobile carrier IPs.

## Collection Details

| Field | Value |
|-------|-------|
| Collected | 2026-03-09, 15:10–15:20 UTC |
| Proxy Provider | Proxies.sx |
| Proxy Type | 4G/5G mobile residential (T-Mobile US, AT&T US) |
| Proxy IPs Used | 172.58.196.88, 166.205.114.47, 172.58.204.112 |
| Platforms Scraped | Uber Eats, DoorDash |
| Requests Made | 5 |
| Failures | 0 |

## Samples

| File | Endpoint | Query | Result |
|------|----------|-------|--------|
| sample-1-ubereats-search.json | /api/food/search | pizza, ZIP 10001 (NYC) | 5 restaurants with fees, ratings, ETAs, promotions |
| sample-2-menu-extraction.json | /api/food/menu/joes-pizza | Joe's Pizza, NYC | 8 menu items across 5 sections with prices |
| sample-3-cross-platform-compare.json | /api/food/compare | sushi, ZIP 94105 (SF) | 3 Uber Eats + 3 DoorDash results + savings summary |

## Scraping Approach

### Why Mobile Proxies Are Required

Uber Eats and DoorDash are built mobile-first:
- **Surge pricing** is served to mobile carrier IPs — datacenter IPs get flat prices
- **Real-time ETA estimates** use location + carrier for accuracy
- Both platforms aggressively block AWS/GCP IP ranges at their Cloudflare edge
- T-Mobile/AT&T IPs appear as real mobile app traffic — same pools the official apps use

### Uber Eats — `__NEXT_DATA__` Extraction

Uber Eats SSR embeds the full React state in `<script id="__NEXT_DATA__">`. This contains:
- Full restaurant list with pricing, ratings, ETAs
- Promotion objects with human-readable text
- Cuisine categories and metadata

This is significantly richer than any public API endpoint.

### DoorDash — `window.__PRELOADED_STATE__` Extraction

DoorDash injects Redux state into `window.__PRELOADED_STATE__`. Extracted fields include delivery fees, ratings, cuisine types, and promotions.

### Cross-Platform Comparison

The `/api/food/compare` endpoint fetches both platforms in parallel and returns a normalized comparison, surfacing which platform has cheaper delivery or faster ETAs for the same restaurant.

## Key Insight from Sample Data

From sample-3 (sushi, San Francisco 94105):
- Same restaurant (Ichi Sushi): Uber Eats $1.49 delivery vs DoorDash $2.49 — **save $1.00/order**
- Hinodeya: Uber Eats $0.99 vs DoorDash $1.49 — **save $0.50/order**

This cross-platform price intelligence is the core value proposition — no other service surfaces this comparison at API scale.
