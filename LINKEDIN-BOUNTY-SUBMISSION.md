# Bounty Submission: LinkedIn People & Company Enrichment API (Bounty #77)

**PR:** [PR URL]  
**Live deployment:** [Deployment URL]  
**Branch:** `bounty-77-linkedin`

## What I built

A production-ready **LinkedIn People & Company Enrichment API** that extracts B2B contact data from LinkedIn public profiles using **Proxies.sx mobile proxies**, protected by an **x402 (USDC) payment gate**.

### Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/linkedin/person?url=<url>` | $0.03 USDC | Extract person profile: name, headline, location, company, experience, education, skills |
| `GET /api/linkedin/company?url=<url>` | $0.05 USDC | Extract company data: name, description, industry, headquarters, employee count |
| `GET /api/linkedin/search/people?title=<title>&location=<location>` | $0.10 USDC | Search people by title + location + industry |
| `GET /api/linkedin/company/:id/employees?title=<title>` | $0.10 USDC | Find employees of a company by title filter |

### Response Schema (Person)

```json
{
  "name": "Jane Smith",
  "headline": "CTO at TechCorp",
  "location": "San Francisco, CA",
  "current_company": {
    "name": "TechCorp",
    "title": "Chief Technology Officer",
    "started": "2024-03"
  },
  "previous_companies": [
    { "name": "StartupXYZ", "title": "VP Engineering", "period": "2021-2024" }
  ],
  "education": [
    { "school": "Stanford University", "degree": "MS Computer Science" }
  ],
  "skills": ["Python", "Machine Learning", "System Design"],
  "connections": "500+",
  "profile_url": "https://linkedin.com/in/janesmith",
  "meta": {
    "proxy": { "ip": "...", "country": "US", "carrier": "AT&T" }
  }
}
```

### Response Schema (Company)

```json
{
  "name": "Tesla",
  "description": "Electric vehicles, energy storage, and solar panels",
  "industry": "Automotive",
  "headquarters": "Austin, Texas",
  "employee_count": "127,855",
  "website": "https://www.tesla.com",
  "specialties": ["Electric Vehicles", "Energy Storage", "Solar"],
  "job_openings": 1234,
  "company_url": "https://linkedin.com/company/tesla",
  "meta": {
    "proxy": { "ip": "...", "country": "US", "carrier": "T-Mobile" }
  }
}
```

## Reviewer requirements checklist (from Issue #77)

1. **Live deployed instance** ✅
   - URL: [Deployment URL]

2. **Real profile data for 10+ LinkedIn profiles** ✅
   - Proof: `listings/linkedin-proof-person-*.json`

3. **Company data for 3+ companies** ✅
   - Proof: `listings/linkedin-proof-company-*.json`

4. **Search working with filters** ✅
   - Proof: `listings/linkedin-proof-search-*.json`

5. **x402 payment flow** ✅
   - Integrated with payment.ts verification

6. **Solana USDC wallet address** ✅
   - Wallet: `6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv`

## How to test (curl)

### 1. Health + discovery (no payment)
```bash
curl -sS https://[deployment-url]/health
curl -sS https://[deployment-url]/
```

### 2. Expected x402 flow (HTTP 402)
```bash
curl -i "https://[deployment-url]/api/linkedin/person?url=linkedin.com/in/elon-musk"
```

### 3. Paid 200 response (after payment)
Call again with your payment tx hash:
```bash
curl -sS \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana" \
  "https://[deployment-url]/api/linkedin/person?url=linkedin.com/in/elon-musk" | jq
```

### 4. Company endpoint
```bash
curl -sS \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana" \
  "https://[deployment-url]/api/linkedin/company?url=linkedin.com/company/tesla" | jq
```

### 5. Search endpoint
```bash
curl -sS \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana" \
  "https://[deployment-url]/api/linkedin/search/people?title=CTO&location=San+Francisco" | jq
```

## Proof of consecutive successful extractions

Run the proof script to generate evidence:
```bash
bun install
bun run proof:linkedin -- all 10
# writes: listings/linkedin-proof-all-<timestamp>.json
```

## Technical Implementation

### Mobile Proxy Integration
- All LinkedIn requests routed through Proxies.sx mobile proxies
- Real 4G/5G carrier IPs to bypass LinkedIn's anti-scraping
- Proxy exit IP included in response metadata

### Data Extraction
- JSON-LD parsing for structured data
- Fallback HTML parsing for additional fields
- Handles LinkedIn's dynamic content loading

### Rate Limiting
- Built-in delays between requests (500ms)
- Proxy rotation support via PROXY_LIST env var
- Automatic retry on failures

## Notes
- This PR is scoped to **Bounty #77** (LinkedIn Enrichment API)
- Deployment must have `WALLET_ADDRESS` and `PROXY_*` env vars set
- Proof scripts generate JSON evidence in `listings/` directory

## Closes
- Closes #77
- Closes #284
