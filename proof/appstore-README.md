# App Store Intelligence — Proof of Output

Real data scraped from Apple App Store and Google Play Store via iTunes APIs routed through mobile proxy.

## Sample Files

| File | Query | Source |
|------|-------|--------|
| `sample-apple-rankings-us-games.json` | Top 10 free games, US | iTunes RSS + Lookup API |
| `sample-apple-rankings-de-games.json` | Top 5 free games, Germany | iTunes RSS |
| `sample-apple-app-spotify.json` | Spotify details + reviews | iTunes Lookup + Reviews RSS |
| `sample-apple-search-vpn-gb.json` | Search "vpn" in UK | iTunes Search API |

## Country Differences Demonstrated

**US vs Germany — Top Free Games (2026-03-02):**

| Rank | United States | Germany |
|------|--------------|---------|
| #1 | Rainbow Six Mobile | Subway Surfers City |
| #2 | Block Blast! | Disney Solitaire |
| #3 | Solitaire Associations Journey | **Brawl Stars** (not in US top 10) |
| #4 | Disney Solitaire | Game is Hard |
| #5 | Vita Mahjong | Magic Sort! |

Key differences:
- **Rainbow Six Mobile** is #1 in US but absent from DE top 5
- **Brawl Stars** (Supercell) appears at DE #3 but not in US top 10
- **Subway Surfers City** is #7 in US but #1 in Germany
- Same apps appear in different positions between countries

## Data Sources

### Apple App Store
- **Rankings**: iTunes RSS Feed — `https://itunes.apple.com/{cc}/rss/topfreeapplications/limit=50/genre={genreId}/json`
- **App Details**: iTunes Lookup API — `https://itunes.apple.com/lookup?id={appId}&country={cc}`
- **Search**: iTunes Search API — `https://itunes.apple.com/search?term={query}&country={cc}&entity=software`
- **Reviews**: Customer Reviews RSS — `https://itunes.apple.com/{cc}/rss/customerreviews/id={appId}/sortBy=mostRecent/json`
- **Trending**: New Apps RSS — `https://itunes.apple.com/{cc}/rss/newfreeapplications/limit=50/json`

### Google Play Store
- **Rankings**: HTML scraping via mobile proxy — `https://play.google.com/store/apps/category/{CAT}?hl={lang}&gl={country}`
- **App Details**: HTML scraping with meta tag + structured data extraction — `https://play.google.com/store/apps/details?id={appId}`
- **Search**: HTML scraping — `https://play.google.com/store/search?q={query}&c=apps`
- **Trending**: HTML scraping of new apps page — `https://play.google.com/store/apps/new`

## Why Mobile Proxy Is Required

1. **Google Play blocks datacenter IPs** — rate limits at 500-1,000 apps/day from datacenter IPs
2. **Apple geo-fences by carrier** — different carriers see different featured apps and promotions
3. **Rankings differ by country** — demonstrated above with US vs DE comparison
4. **Authentic user perspective** — mobile carrier IPs are treated as legitimate app store users

## Scraping Approach

- Apple: Structured JSON APIs (iTunes RSS + Lookup + Search) return clean, typed data
- Google Play: Server-rendered HTML parsed via regex extraction of meta tags, structured data, and DOM patterns
- Both stores queried through Proxies.sx 4G/5G mobile carrier IPs
- Enrichment: Apple rankings from RSS are enriched with ratings/size via batch Lookup API call

Scraped: 2026-03-02 ~15:30 UTC
