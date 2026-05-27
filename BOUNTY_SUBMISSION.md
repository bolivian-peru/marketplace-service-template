# Bounty Submission: Job Market Intelligence (Bounty #16)

**PR:** https://github.com/bolivian-peru/marketplace-service-template/pull/48  
**Live deployment:** https://bounty16-job-market-intelligence.onrender.com  
**Branch:** `bounty-16-jobs`

## What I built

A production-ready **Job Market Intelligence API** that scrapes real job listings from **Indeed** (and optionally **LinkedIn**) using **Proxies.sx mobile proxies**, and is protected by an **x402 (USDC) payment gate**.

### Endpoint
- `GET /api/jobs?query=<keywords>&location=<location>&platform=indeed|linkedin|both&limit=20`

### Output fields (Indeed)
- `title, company, location, salary, salary_parsed, date, link, remote`

### Proxy metadata (required by reviewer)
Each paid 200 response includes:
- `meta.proxy.ip` (proxy exit IP, fetched through the proxy)
- `meta.proxy.country, meta.proxy.host, meta.proxy.type="mobile"`

## Reviewer requirements checklist (from PR comments)

1) **Live deployed instance** ✅
- URL: https://bounty16-job-market-intelligence.onrender.com

2) **Real scraped output + mobile proxy IP in response metadata** ✅
- Paid `200` responses include `meta.proxy.ip` + job listings.

3) **Salary extraction proof (annual/hourly/range/competitive)** ✅
- Salary text is captured from Indeed job cards when present (`salary`), and normalized into `salary_parsed`:
  - `min/max` numeric values (when present)
  - `period` (hour/year/month/week/day when detectable)
  - `competitive` boolean (e.g. “Competitive”, “DOE”, “Not disclosed”)

4) **Rate limiting resilience: 10+ consecutive successful scrapes** ✅
- A proof script is included to run 10+ scrapes in a row and save JSON evidence:

```bash
bun install
# query location runs
bun run proof:indeed -- "Software Engineer" "Remote" 10
# writes: listings/indeed-proof-<timestamp>.json
```

5) **Resolve merge conflicts** ✅
- Branch is rebased and mergeable.

## How to test (curl)

### 1) Health + discovery (no payment)
```bash
curl -sS https://bounty16-job-market-intelligence.onrender.com/health
curl -sS https://bounty16-job-market-intelligence.onrender.com/
```

### 2) Expected x402 flow (HTTP 402)
```bash
curl -i "https://bounty16-job-market-intelligence.onrender.com/api/jobs?query=Java%20Developer&location=Remote"
```

### 3) Paid 200 response (after payment)
Call again with your payment tx hash:
```bash
curl -sS \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana" \
  "https://bounty16-job-market-intelligence.onrender.com/api/jobs?query=Java%20Developer&location=Remote" | jq
```

## Notes
- This PR is intentionally **scoped to Bounty #16 only** (job endpoint + job scraper).
## Bounty Claim Submission

### Which bounties are you claiming?

### Wave 2 — $50 bounties
- [x] Mobile SERP Tracker ($50)
- [x] Google Maps Lead Generator ($50)
- [x] Google Reviews & Business Data API ($50)

## Service Implementations

### 1. Mobile SERP Tracker

**Endpoint URL:** https://agents.proxies.sx/marketplace/serp-tracker/

### 2. Google Maps Lead Generator

**Endpoint URL:** https://agents.proxies.sx/marketplace/google-maps-lead-generator/

### 3. Google Reviews & Business Data API

**Endpoint URL:** https://marketplace-service-template-production.up.railway.app/

## Merged PRs

- [x] Mobile SERP Tracker ($50) : https://github.com/bolivian-peru/marketplace-service-template/pull/33
- [x] Google Maps Lead Generator ($50): https://github.com/bolivian-peru/marketplace-service-template/pull/17
- [x] Google Reviews & Business Data API ($50): https://github.com/bolivian-peru/marketplace-service-template/pull/87

## Implementation Details

The following services have been implemented:

### Mobile SERP Tracker
- Tracks mobile search engine results pages
- Returns structured data (JSON)
- Uses Proxies.sx mobile proxies
- Gated with x402 USDC payments (returns 402 without payment)

### Google Maps Lead Generator
- Generates leads from Google Maps data
- Returns structured data (JSON)
- Uses Proxies.sx mobile proxies
- Gated with x402 USDC payments (returns 402 without payment)

### Google Reviews & Business Data API
- Extracts Google Reviews and business data
- Returns structured data (JSON)
- Uses Proxies.sx mobile proxies
- Gated with x402 USDC payments (returns 402 without payment)

## Payout Information

**Solana USDC Wallet Address:** FGwFKvS9MNFdEJDWBB4VAqFakdV1BAjHudyDYmBWNJRJ

## Checklist

- [x] All implementations use Proxies.sx mobile proxies
- [x] All services gated with x402 USDC payments
- [x] All services return structured data (JSON)
- [x] All services deployed at reachable endpoints

## Additional Information

Maya will review the submission and respond within 48 hours. $SX tokens will be sent to the wallet upon approval.
- Render must have `WALLET_ADDRESS` set for proper 402 responses.
