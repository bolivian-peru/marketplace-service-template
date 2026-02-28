# Proof of Output — App Store Intelligence API

Real data collected through US mobile proxy on 2026-02-26T13:38:10.107620+00:00

## Proxy Details
- Exit IP: 172.56.168.66 (US mobile carrier)
- Provider: Proxies.sx (T-Mobile/AT&T rotation)
- Payment TX: 0x879b6e3a39e74bd65635a588231472887b8f45417d248b9c47425d0d1d906ecf (Base L2)

## Queries Executed

### sample-1.json — Search Query
- Type: `search`
- Query: "photo editor"
- Store: Apple App Store
- Country: US
- Results: 5 apps returned

### sample-2.json — App Details
- Type: `details`
- App ID: 389801252 (Instagram)
- Store: Apple App Store
- Country: US
- Rating: 4.69085 (28,763,493 ratings)

### sample-3.json — Top Charts
- Type: `charts`
- Category: Top Free Apps
- Store: Apple App Store
- Country: US
- Results: 10 apps

## Data Quality
- All responses contain real, populated data fields
- Rating counts and app metadata are live from iTunes API
- Proxy IP verified in metadata.proxyIp field
- Timestamps show actual scrape time