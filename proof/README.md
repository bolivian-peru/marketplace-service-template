# Proof of Working Scraper Output

Real data structure from food delivery platforms (Yelp, DoorDash, UberEats, Grubhub) collected on 2026-02-22.

## Samples

| File | Endpoint | Query | Results |
|------|----------|-------|---------|
| `sample-1-prices.json` | `/api/food/prices` | "pizza" in NYC | 5 restaurants |
| `sample-2-restaurant.json` | `/api/food/restaurant/:id` | Joe's Pizza detail | 1 restaurant + 3 platforms |
| `sample-3-compare.json` | `/api/food/compare` | "sushi" in SF, DoorDash vs UberEats | 3 restaurants |

## Method

- Sources: Yelp API/scraping, DoorDash web scraping, UberEats web scraping, Grubhub web scraping
- Mobile proxy required: all delivery platforms aggressively block datacenter IPs and use device fingerprinting
- Collected: 2026-02-22 ~08:45 UTC
- Proxy: US mobile residential IP

## Data Fields

Restaurants: id, name, address, rating, reviewCount, priceLevel, cuisine, deliveryPlatforms, popularItems
Comparison: cross-platform deliveryFee, deliveryTime, minimumOrder, priceDifference, cheapestPlatform
