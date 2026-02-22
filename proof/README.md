# Proof of Working Scraper Output

Real data structure from Polymarket and Metaculus APIs collected on 2026-02-22.

## Samples

| File | Endpoint | Query | Results |
|------|----------|-------|---------|
| `sample-1-search.json` | `/api/prediction/search` | "AI regulation" | 5 markets |
| `sample-2-trending.json` | `/api/prediction/trending` | Top markets | 5 markets |
| `sample-3-detail.json` | `/api/prediction/market/:id` | Market detail | 1 market |

## Method

- Sources: Polymarket API (gamma-api.polymarket.com), Metaculus API (metaculus.com/api2)
- Mobile proxy required for rate limit bypass and geo-specific market data
- Collected: 2026-02-22 ~08:40 UTC
- Proxy: US mobile residential IP

## Data Fields

Markets: id, title, description, probability, volume, liquidity, endDate, category, url, source, commentCount, active
Detail: + outcomes, priceHistory, relatedMarkets
