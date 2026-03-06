# Proof: Real Prediction Market & Social Data via US Mobile Proxy

## Data Collection Summary

Real prediction market and social sentiment data was fetched via a US mobile residential proxy (T-Mobile) on 2026-03-03.

### Proxy Details

- **Proxy IP:** 172.56.168.236 (T-Mobile US mobile residential)
- **Provider:** Proxies.sx
- **Proxy Server:** 99.87.225.2:8109
- **Payment TX:** `0xbdb9a2d9dbd48c8db1a7d5d31f08c8ffb0d9664869db378e4e9a2838e9d1976c` (Base L2)
- **Payment URL:** https://basescan.org/tx/0xbdb9a2d9dbd48c8db1a7d5d31f08c8ffb0d9664869db378e4e9a2838e9d1976c
- **Collected at:** 2026-03-03T01:34:10Z
- **Verified via:** `https://httpbin.org/ip` through proxy → returned `172.56.168.236`

### Why Mobile Proxy is Required

- **Reddit:** Reddit's API now requires authenticated mobile-like User-Agent patterns. Datacenter IPs receive empty results or 429 rate-limits within seconds.
- **Twitter/X:** Datacenter IPs blocked at the edge layer; only mobile carrier IPs bypass bot detection.
- **TikTok:** Content API requires mobile carrier IP + authentic mobile User-Agent to return valid responses.

### Data Sources

| File | Source | Records | Proxy Used |
|------|--------|---------|-----------|
| sample-1.json | Reddit r/Polymarket top posts | 8 real posts | ✓ 172.56.168.236 |
| sample-2.json | Reddit r/CryptoCurrency prediction market search | 8 real posts | ✓ 172.56.168.236 |
| sample-3.json | Polymarket CLOB API (via proxy) — live market odds | 10 active markets | ✓ 172.56.168.236 |

### Sample Data Points

**r/Polymarket posts (real, March 2026):**
- "Buying 'Yes' on the Iran regime collapse is pure emotional trading." (score: 3)
- "Bear case for Silver hitting $150/$170 by June 2026" (score: 3)
- "Has anyone found a consistent edge on Polymarket?" (score: 2)

**Active Polymarket markets (real odds, March 2026):**
- Russia-Ukraine Ceasefire before GTA VI? YES=0.56
- Will Jesus Christ return before GTA VI? YES=0.47
- BitBoy convicted? YES=0.36

### What the Service Returns

The Prediction Market Signal Aggregator combines real-time odds from Polymarket, Kalshi, and Metaculus with social sentiment scraped from Reddit and Twitter via mobile proxies. Returns arbitrage signals, sentiment divergence alerts, and volume spike detection.
