# Proof of Output — App Store Intelligence API

All samples generated from **live Apple App Store data** via public RSS and Search APIs.
Google Play Store samples will be regenerated from the deployed service using Proxies.sx mobile proxies.

## Sample Files

| File | Type | Query | Apps |
|------|------|-------|------|
| `apple-rankings-us-topfree.json` | Rankings (Apple US) | Top Free Apps | 10 |
| `apple-rankings-de-toppaid.json` | Rankings (Apple DE) | Top Paid Apps | 10 |
| `apple-search-vpn.json` | Search (Apple US) | "vpn" | 5 |
| `apple-detail-spotify.json` | App Detail (Apple US) | Spotify (id=324684580) | 1 |

## Notes
- Samples were fetched from Apple's public RSS + Search APIs (no proxy needed for these)
- When deployed with Proxies.sx mobile proxy, the exact same data will be returned through `proxyFetch()`
- Google Play samples require deployment with mobile proxy (Google blocks datacenter IPs)
- Each paid response will include `proxy.country` and `proxy.type: "mobile"` in the response
