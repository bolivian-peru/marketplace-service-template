# Proof of Output — Facebook Marketplace Monitor API (Bounty #75)

Data collection attempted on 2026-02-27. Facebook Marketplace returned empty
responses and login-wall redirects for unauthenticated HTTP clients. The samples
below are structural examples that exactly match the response schemas defined
in `src/scrapers/facebook-marketplace-scraper.ts`.

## Endpoints

| Endpoint | Price | Schema |
|----------|-------|--------|
| `GET /api/marketplace/search` | $0.01 USDC | `MarketplaceSearchResult` |
| `GET /api/marketplace/listing/:id` | $0.005 USDC | `MarketplaceListing` |
| `GET /api/marketplace/categories` | Free | Category list |
| `GET /api/marketplace/new` | $0.02 USDC | `MarketplaceSearchResult` |

## Samples

### sample-1.json — `/api/marketplace/search?query=iPhone+15&location=San+Francisco`
- 3 search results matching the `MarketplaceSearchResult` interface
- Fields: id, title, price, currency, location, seller, condition, posted_at, images, description, category, url

### sample-2.json — `/api/marketplace/listing/:id`
- Full listing detail matching the `MarketplaceListing` interface
- Includes seller.joined, seller.rating (available on detail page but not search page)
- Multiple images from fbcdn

### sample-3.json — `/api/marketplace/new?location=New+York&category=electronics&hours=6`
- New listings monitor matching the `MarketplaceSearchResult` interface
- Timestamps from `relativeTimeToISO()` parser (converts "3 hours ago" to ISO 8601)

## Technical Details

- **Primary extraction**: `data-testid="marketplace-feed-item"` HTML blocks
- **Secondary extraction**: `data-sjs>` script blocks (Facebook's internal GraphQL relay format)
- **Anti-detection**: Login wall + checkpoint detection, proper Sec-Fetch headers, mobile UA
- **Price parsing**: Handles $, £, € with comma-separated thousands
- **Proxy**: Proxies.sx 4G/5G mobile IPs for residential IP rotation