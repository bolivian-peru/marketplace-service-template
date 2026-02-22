# Proof of Working Scraper Output

Real data collected from Apple's iTunes Search/Lookup API on 2026-02-22.

## Samples

| File | Query | Endpoint | Results |
|------|-------|----------|---------|
| `sample-1-search.json` | Search "telegram" | `/search?term=telegram` | 5 apps |
| `sample-2-lookup.json` | Lookup ID 686449807 | `/lookup?id=686449807` | Telegram Messenger |
| `sample-3-search-ai.json` | Search "ai photo editor" | `/search?term=ai+photo+editor` | 4 apps |

## Method

- API: iTunes Search API (https://itunes.apple.com)
- No proxy required (public API)
- Country: US
- Collected: 2026-02-22 ~08:30 UTC
- Server IP: 79.137.184.124 (Aeza, Amsterdam)

## Data Fields

Each result includes: trackId, trackName, bundleId, sellerName, price, averageUserRating, userRatingCount, primaryGenreName, fileSizeBytes, version, releaseDate, currentVersionReleaseDate, description/releaseNotes.
