# Proof: Real App Store Data via US Mobile Proxy

See `appstore-README.md` for full details on scraped App Store data.

## Sample Files

| File | Description | Source |
|------|-------------|--------|
| `sample-apple-rankings-us-games.json` | Top 10 free games, US | iTunes RSS + Lookup API |
| `sample-apple-rankings-de-games.json` | Top 5 free games, Germany | iTunes RSS |
| `sample-apple-app-spotify.json` | Spotify full details + reviews | iTunes Lookup |
| `sample-apple-search-vpn-gb.json` | Search "vpn" in UK | iTunes Search API |

## Proxy Details

- **Provider**: Proxies.sx mobile residential proxy
- **Carrier**: T-Mobile (US)
- **Type**: Mobile (4G)
- **All requests**: routed via `proxyFetch()` through carrier IP
