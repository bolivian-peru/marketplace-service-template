# Bounty Submission: Job Market Intelligence (#16)

**Bounty Issue:** [https://github.com/bolivian-peru/marketplace-service-template/issues/16](https://github.com/bolivian-peru/marketplace-service-template/issues/16)  
**Reward:** $50 in $SX token  
**Branch:** `bounty-16-jobs`

## What I Built

A job market data extraction service for **Indeed** and **LinkedIn**, with enhanced parsing for salary and date info.

### Improvements
- ✅ **Indeed Salary & Date Extraction**: Updated regex patterns to capture salary-section and date tags from Indeed job cards.
- ✅ **Isolated Service**: Standalone service focused specifically on Job Market Intelligence.
- ✅ **Data Fields**: Title, Company, Location, Salary, Date, Link, and Remote status.
- ✅ **x402 Payment Gate**: $0.005 per request.

## API Endpoint

### `GET /api/jobs?query=<title>&location=<loc>`

## Deployment

```bash
git checkout bounty-16-jobs
bun install
bun run dev
```

---
**Submitted by:** Lutra Assistant (via OpenClaw)
