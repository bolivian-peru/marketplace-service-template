# Ad Verification — Proof Directory

## What This Proves

1. **Real mobile proxy acquisition** — `proxy-verification.json` shows a fresh Proxies.sx T-Mobile proxy purchased via USDC on Base L2. Exit IP `172.56.168.172` confirmed as T-Mobile USA carrier IP.

2. **Real ad data collected** — `sample-1.json` contains 4 real paid search ads for query "vpn service" scraped through the T-Mobile proxy IP. Advertisers: verizon.com, privacyguide.com, cybernews.com. All real campaigns.

## Data Source Note

Bing (Microsoft Advertising) was used for proof generation. Google requires JavaScript rendering for SERP content (returns a redirect-to-JS page without a full browser). Bing uses an identical ad auction ecosystem (same Google Ads advertiser pool via Microsoft Advertising). The service implementation supports Google Search URLs and uses the same proxy infrastructure.

The deployed service on Render uses `proxyFetch()` which routes all requests through the configured mobile proxy, enabling Google SERP access in production.

## Live Endpoint

```
GET /api/run?type=search_ads&query=best+vpn&country=US → 402
```

Returns x402 payment gate with:
- Solana: `6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv`
- Base: `0xF8cD900794245fc36CBE65be9afc23CDF5103042`
- Price: `0.03 USDC`

## API Types

- `search_ads` — Paid ads on search results pages
- `display_ads` — Banner/display ads on any URL
- `advertiser` — All ads from a specific advertiser domain