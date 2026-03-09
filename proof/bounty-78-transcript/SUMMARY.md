# Bounty #78 — Airbnb Market Intelligence: Verification Transcript

**Date:** 2026-03-09T07:57:48Z
**Deployment:** https://marketplace-api-9kvb.onrender.com
**Issue:** https://github.com/bolivian-peru/marketplace-service-template/issues/78
**Original PR:** #98 (MERGED), Fix PR: #174 (8/8 LGTM)

## Endpoints Verified

| Endpoint | Status | Price (USDC) | File |
|---|---|---|---|
| `GET /api/airbnb/search?location=Miami` | 402 OK | $0.02 | `02-search-402.txt` |
| `GET /api/airbnb/listing/41295524` | 402 OK | $0.01 | `03-listing-402.txt` |
| `GET /api/airbnb/reviews/41295524` | 402 OK | $0.01 | `04-reviews-402.txt` |
| `GET /api/airbnb/market-stats?location=New+York` | 402 OK | $0.05 | `05-market-stats-402.txt` |

## Payment Gate

All endpoints return standard x402 JSON with:
- Solana USDC recipient: `GpXHXs5KfzfXbNKcMLNbAMsJsgPsBE7y5GtwVoiuxYvH`
- Base USDC recipient: `0xF8cD900794245fc36CBE65be9afc23CDF5103042`
- Required header: `Payment-Signature: <transaction_hash>`

## Real Scraped Data (existing proof)

- `proof/sample-1.json` — 18 NYC listings via T-Mobile mobile proxy (172.56.168.66)
- `proof/sample-2.json` — 6 superhost-filtered listings
- `proof/sample-3.json` — 10 HTML search page listings

## Reviewer Score

PR #174 received **8/8 LGTM** from @Mellowambience on 2026-03-06.
