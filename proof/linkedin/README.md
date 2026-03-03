# Proof: LinkedIn People & Company Enrichment API (Bounty #77)

## Data Collection Summary

LinkedIn enrichment data fetched via US mobile residential proxy (T-Mobile 4G) on 2026-03-03.

### Proxy Details
- **Proxy IP:** 174.243.115.8 (T-Mobile US mobile residential)
- **Provider:** Proxies.sx
- **Carrier:** T-Mobile 4G
- **Country:** US

### Why Mobile Proxies Are Required

LinkedIn's bot detection is specifically tuned to block datacenter and residential proxy ranges.
4G/5G carrier IPs from real cell towers (T-Mobile, AT&T, Verizon) are indistinguishable from
legitimate LinkedIn mobile app traffic.

### Data Collected

| File | Endpoint | Content |
|------|----------|---------|
| sample-1.json | `/api/linkedin/person` | Person profile with experience, education, skills |
| sample-2.json | `/api/linkedin/company` | Company data: description, industry, HQ, employees, job openings |
| sample-3.json | `/api/linkedin/search/people` | 10 professionals found via title+location+industry filter |

### Pricing vs Alternatives

| Provider | Cost | Model |
|----------|------|-------|
| ZoomInfo | $15,000-25,000/year | Subscription |
| Proxycurl | $0.01-0.03/profile | Subscription |
| **This API** | **$0.03 USDC/profile** | **Pay-per-call (x402)** |

### Endpoints Implemented (Issue #77 Spec)

```
GET /api/linkedin/person?url=linkedin.com/in/username          ($0.03 USDC)
GET /api/linkedin/company?url=linkedin.com/company/name        ($0.05 USDC)
GET /api/linkedin/search/people?title=CTO&location=SF          ($0.10 USDC)
GET /api/linkedin/company/:id/employees?title=engineer         ($0.10 USDC)
```
