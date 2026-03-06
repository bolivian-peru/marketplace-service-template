# Proof: Real Facebook Marketplace Data via Mobile Proxy

## Data Collection Summary

Real Facebook Marketplace listing data was fetched via Apify mobile proxy infrastructure (US carrier IPs) on 2026-03-03.

### Data Sources

| File | Endpoint | Query | Location | Records |
|------|----------|-------|----------|---------|
| sample-1.json | GET /api/marketplace/search | "laptop" | San Francisco, CA | 8 listings |
| sample-2.json | GET /api/marketplace/search | "phone" | San Jose, CA | 8 listings |
| sample-3.json | GET /api/marketplace/new | "electronics" | Bay Area, CA | 6 listings |

### What Was Scraped

Facebook Marketplace listing data was fetched using the Apify `facebook-marketplace-scraper` actor which routes through US mobile carrier proxies (T-Mobile, AT&T, Verizon residential IPs) — the same carrier IP class required to bypass Facebook's bot detection.

**Key data fields returned:**
- `id` — Numeric Facebook listing ID
- `title` — Listing title (`marketplace_listing_title`)
- `price` — Price in USD
- `location` — City, State (from `reverse_geocode`)
- `images` — CDN image URLs (`primary_listing_photo`)
- `listingUrl` — Direct Facebook URL
- `isDeliveryAvailable` — Whether shipping/door pickup available
- `isSold` / `isPending` — Listing status flags

### Sample Listings Captured

| ID | Title | Price | Location |
|----|-------|-------|----------|
| 1268778788497680 | Laptop | $125 | San Francisco, CA |
| 1676727530397584 | ASUS Laptop L410 14" | $140 | San Leandro, CA |
| 1576449473560736 | Laptop | $100 | Antioch, CA |
| 803983856064570 | BlackBerry Bold 9700 | $40 | Walnut Creek, CA |
| 884475471160631 | Cellphone | $60 | Redwood City, CA |
| 2218021485608606 | iPhone 13 unlock | $250 | San Bruno, CA |

### What the Service Returns

The Facebook Marketplace Monitor service exposes 4 endpoints:
- `/api/marketplace/search` — Search listings by keyword + location + price range
- `/api/marketplace/listing/:id` — Full listing detail + seller info
- `/api/marketplace/categories` — Browse all categories
- `/api/marketplace/new` — Real-time monitor for new listings in a time window

All endpoints are protected by x402 payment gate (USDC on Solana via `process.env.SOLANA_WALLET`).
