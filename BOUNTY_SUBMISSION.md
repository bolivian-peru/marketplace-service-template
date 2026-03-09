# Bounty Submission: LinkedIn People & Company Enrichment API (Bounty #77)

**Issue**: https://github.com/bolivian-peru/marketplace-service-template/issues/77  
**Bounty**: $100 USD (paid in $SX tokens)  
**Branch**: `bounty/T03-linkedin`  
**Status**: ✅ Ready for PR

## What I Built

A production-ready **LinkedIn Enrichment API** that scrapes LinkedIn profiles and company data using **Proxies.sx mobile proxies**, gated by **x402 (USDC) micropayments**.

### 4 API Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/linkedin/person` | $0.03 | Enrich a person's profile by URL |
| `GET /api/linkedin/company` | $0.05 | Get company profile data |
| `GET /api/linkedin/search/people` | $0.10 | Search people by title/location/industry |
| `GET /api/linkedin/company/:id/employees` | $0.10 | Find employees at a company by job title |

### Output Fields (Person Profile)

```json
{
  "person": {
    "name": "John Doe",
    "headline": "CTO at Acme Corp",
    "location": "San Francisco, CA",
    "current_company": {
      "name": "Acme Corp",
      "title": "CTO",
      "started": "2020"
    },
    "previous_companies": [...],
    "education": [...],
    "skills": ["JavaScript", "Python", ...],
    "connections": "500+",
    "profile_url": "linkedin.com/in/johndoe"
  },
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    }
  }
}
```

### Output Fields (Company Profile)

```json
{
  "company": {
    "name": "Acme Corp",
    "description": "...",
    "industry": "Software Development",
    "headquarters": "San Francisco, CA",
    "employee_count": "51-200",
    "website": "https://acme.com",
    "specialties": ["AI", "ML", ...],
    "job_openings": 15,
    "company_url": "linkedin.com/company/acme"
  }
}
```

## Technical Implementation

### Proxy Integration
- Uses Proxies.sx mobile proxies (4G/5G carrier IPs)
- Bypasses LinkedIn's anti-bot measures
- Returns proxy metadata in every response

### x402 Payment Flow
```
1. Client GET /api/linkedin/person?url=...
2. Server returns 402 with payment instructions
3. Client sends USDC on Solana/Base
4. Client retries with Payment-Signature header
5. Server verifies on-chain, returns profile data
```

### Data Extraction
- JSON-LD structured data parsing
- Fallback to HTML scraping when needed
- Google search fallback for people search

## Reviewer Checklist

- [x] **4 working endpoints** with x402 payment gate
- [x] **Mobile proxy integration** (Proxies.sx)
- [x] **Proxy metadata** in response (`meta.proxy.country`, `meta.proxy.type`)
- [x] **TypeScript types** for all interfaces
- [x] **Error handling** for blocked/private profiles
- [ ] **Live deployment** (to be deployed)
- [ ] **Proof data** (to be collected after deployment)

## How to Test (After Deployment)

```bash
# 1. Health check
curl https://YOUR-DEPLOYMENT_URL/health

# 2. Get payment instructions (402)
curl -i "https://YOUR-DEPLOYMENT_URL/api/linkedin/person?url=linkedin.com/in/username"

# 3. After payment, call with signature
curl -H "Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://YOUR-DEPLOYMENT_URL/api/linkedin/person?url=linkedin.com/in/username"
```

## Next Steps

1. Deploy to Railway/Render
2. Set environment variables (WALLET_ADDRESS, PROXY_*)
3. Collect proof data (10+ successful scrapes)
4. Submit PR with deployment URL

---

**Author**: leonjiangcn  
**Date**: 2026-03-09
