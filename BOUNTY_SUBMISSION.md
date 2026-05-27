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
## Bounty Claim

**Which bounty are you claiming?**

### Wave 1 — $200 bounties
- [ ] Google SERP + AI Search Scraper ($200)
- [ ] Gmail Account Creator + Warmer ($200)
- [ ] Instagram Account Creator + Warmer ($200)

### Wave 2 — $50 bounties
- [x] Mobile SERP Tracker ($50)
- [x] Google Maps Lead Generator ($50)
- [x] Google Reviews & Business Data API ($50)
- [ ] E-Commerce Price & Stock Monitor ($50)
- [ ] Social Profile Intelligence API ($50)
- [ ] Ad Spy & Creative Intelligence ($50)
- [ ] Travel Price Tracker API ($50)
- [ ] Ad Verification & Brand Safety ($50)
- [ ] Review & Reputation Monitor ($50)
- [ ] Real Estate Listing Aggregator ($50)
- [ ] Job Market Intelligence API ($50)

## Your Service

**Endpoint URL:** https://agents.proxies.sx/marketport/serp-tracker/
**Endpoint URL:** https://agents.proxies.sx/marketplace/google-maps-lead-generator/
**Endpoint URL:** https://marketplace-service-template-production.up.railway.app/

## Merged PRs Link:

- [x] Mobile SERP Tracker ($50) : https://github.com/bolivian-peru/marketplace-service-template/pull/33
- [x] Google Maps Lead Generator ($50): https://github.com/bolivian-peru/marketplace-service-template/pull/17
- [x] Google Reviews & Business Data API ($50): https://github.com/bolivian-peru/marketplace-service-template/pull/87

## Checklist

- [x] Uses Proxies.sx mobile proxies (`/v1/x402/proxy` or existing port)
- [x] Gated with x402 USDC payments (returns 402 without payment)
- [x] Working and deployed at a reachable endpoint
- [x] Returns structured data (JSON)

## Payout

**Solana USDC Wallet Address:**  `FGwFKvS9MNFdEJDWBB4VAqFakdV1BAjHudyDYmBWNJRJ`

<img width="638" height="836" alt="Image" src="https://github.com/user-attachments/assets/a5285f9a-9867-4909-ae80-21a6a504595b" />

Maya will review your submission and respond within 48 hours. $SX tokens sent to your wallet upon approval.


- Render must have `WALLET_ADDRESS` set for proper 402 responses.
