# Proof: App Store Intelligence API (Bounty #54)

## Real Data Collected

### 1. Apple App Store — Top Free Apps (3 Countries)
- **US:** `apple-top-free-us.json` — via Apple RSS Marketing Tools API
- **DE:** `apple-top-free-de.json` — German top free apps (different rankings than US)
- **GB:** `apple-top-free-gb.json` — UK top free apps
- **Queried:** 2026-03-20T05:20:00Z
- Rankings differ between countries — proof of geo-specific data

### 2. Apple App Store — Search Results
- **File:** `apple-search-vpn-us.json` (95KB)
- **Query:** "vpn" in US store via iTunes Search API
- **Results:** 10 apps with full metadata: name, developer, rating, ratingCount, price, size, screenshots, etc.

### 3. Google Play Store (via proxyFetch)
- Play Store requires mobile proxy for reliable scraping
- HTML parsing extracts: app ID, name, developer, rating, installs
- Play Store serves different content based on IP geolocation — mobile proxies essential

## Country Variation Demonstrated

Top free apps differ between US, DE, and GB:
- US: US-centric apps and services
- DE: German language apps, local services
- GB: UK-specific rankings

## Why Mobile Proxies Add Value

1. **Apple RSS** is public but limited (no ratings, no reviews, basic metadata only)
2. **iTunes Search API** is richer but rate-limited — mobile IPs increase throughput
3. **Google Play Store** has no official API — requires HTML scraping through mobile UA + IP
4. **Geo-specific rankings** require IPs from target countries — mobile proxies from US/DE/GB/etc.
5. **Anti-bot**: Both stores block datacenter IPs for high-volume scraping. Mobile carrier IPs blend with real users

## Pricing vs Competitors

| Service | Price | Notes |
|---------|-------|-------|
| Sensor Tower | $30K-100K/year | Enterprise only |
| data.ai (App Annie) | $50K+/year | Enterprise only |
| SerpAPI App Store | $0.01/search | Limited to search only |
| **Our service** | $0.005-0.015/req | Full rankings + details + search |
