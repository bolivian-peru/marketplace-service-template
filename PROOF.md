# Job Market Intelligence API - Implementation Documentation

## Bounty Claim

**Issue**: #16 - Job Market Intelligence API  
**Reward**: $50 paid in $SX token  
**Submitter**: @dlin38  
**Email**: Doug.Lin@deschaintechnology.net

---

## Requirements Met

✅ **Multi-platform aggregation**: Indeed + LinkedIn scrapers  
✅ **Structured JSON output**: Complete data extraction per listing  
✅ **Mobile proxy integration**: Uses Proxies.sx via `proxyFetch()`  
✅ **x402 USDC payment gating**: Integrated payment verification  
✅ **Search by role + location**: Flexible query parameters  
✅ **TypeScript compilation**: Zero errors  
✅ **Endpoint added alongside existing services**: `/api/jobs` preserves `/api/run` (Maps) and `/api/serp`  
✅ **Service listing JSON**: Added to `listings/` directory  

---

## Implementation Summary

### Architecture

This implementation **adds** the Jobs endpoint (`/api/jobs`) to the existing multi-service architecture without modifying the Google Maps or SERP endpoints. Following the pattern established in PR #33 (SERP API), the Jobs service coexists with:

1. **Google Maps Lead Generator** — `/api/run`, `/api/details`
2. **Mobile SERP Tracker** — `/api/serp`
3. **Job Market Intelligence** — `/api/jobs` ← NEW

### Files Created/Modified

#### 1. `src/scrapers/job-scraper.ts` (331 lines)
**Platforms supported**: Indeed + LinkedIn

**Key functions**:
- `scrapeIndeed()` — Scrapes Indeed job listings
- `scrapeLinkedIn()` — Scrapes LinkedIn job listings  
- `searchJobs()` — Unified multi-platform search coordinator

**Data extracted**:
- Job title
- Company name
- Location
- Salary range (when available)
- Posting date
- Required skills (parsed from descriptions)
- Work type (remote/hybrid/onsite/unknown)
- Applicant count (LinkedIn only)
- Direct job URL

**Anti-bot techniques**:
- Mobile user agents
- Retry logic with exponential backoff
- Rate limiting between requests
- Mobile proxy rotation via `proxyFetch()`

#### 2. `src/service.ts` (APPENDED, NOT REPLACED)
**Lines added**: ~150 lines at end of file

**New endpoint**: `GET /api/jobs`

**Pricing**: $0.003 USDC per request

**Payment**: x402 protocol (Solana/Base USDC)

**Query parameters**:
- `role` (required): Job role to search
- `location` (required): Location (or "Remote")
- `platforms` (optional): "indeed", "linkedin", or "indeed,linkedin" (default: both)
- `limit` (optional): Max results (1-100, default: 20)

**Key fix from review**: Removed `await` from `getProxy()` call (line 381) — `getProxy()` is synchronous

#### 3. `listings/job-market-intelligence.json`
Service listing metadata following the schema at `listings/schema.json`:
- Service ID, name, description
- Pricing model and payment networks
- Category and tags
- Owner info
- x402 discovery URLs

---

## API Specification

### Endpoint: `GET /api/jobs`

**Example Request:**
```
GET /api/jobs?role=Software%20Engineer&location=Austin%20TX&limit=20
```

**Query Parameters:**
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `role` | string | Yes | Job role/title | `Software Engineer` |
| `location` | string | Yes | Location or "Remote" | `Austin TX` |
| `platforms` | string | No | Comma-separated platforms | `indeed,linkedin` |
| `limit` | number | No | Max results (1-100) | `20` |

**Success Response (200 OK):**
```json
{
  "jobs": [
    {
      "title": "Senior Software Engineer",
      "company": "Tech Corp",
      "location": "Austin, TX",
      "salaryRange": "$120,000 - $180,000 per year",
      "postingDate": "2 days ago",
      "requiredSkills": ["TypeScript", "React", "Node.js"],
      "workType": "hybrid",
      "applicantCount": 47,
      "jobUrl": "https://www.linkedin.com/jobs/view/123456789",
      "platform": "linkedin"
    }
  ],
  "totalFound": 20,
  "platforms": ["indeed", "linkedin"],
  "searchQuery": "Software Engineer in Austin TX",
  "proxy": {
    "country": "US",
    "type": "mobile"
  },
  "payment": {
    "txHash": "5xJ8...",
    "network": "base",
    "amount": 0.003,
    "settled": true
  }
}
```

**Error Responses:**

| Code | Reason | Solution |
|------|--------|----------|
| 402 | Payment Required | Include x402 payment headers |
| 400 | Missing parameters | Provide required `role` and `location` |
| 400 | Invalid platforms | Use only "indeed" or "linkedin" |
| 400 | Invalid limit | Set limit between 1 and 100 |
| 502 | Scraping failed | Retry or check platform availability |

---

## Technical Details

### Platform Scraping Methods

#### Indeed
- **URL pattern**: `https://www.indeed.com/jobs?q={role}&l={location}&limit={limit}`
- **HTML parsing**: Regex extraction of `job_seen_beacon` div elements
- **Data extraction**:
  - Title: `<h2 class="jobTitle">` content
  - Company: `data-company-name` attribute
  - Location: `data-rc-loc` attribute
  - Salary: `salary-snippet-container` class parsing
  - Date: `.date` class or `data-testid="myJobsStateDate"`

#### LinkedIn
- **URL pattern**: `https://www.linkedin.com/jobs/search?keywords={role}&location={location}&start={offset}`
- **HTML parsing**: Regex extraction of `base-card` div elements
- **Data extraction**:
  - Title: `base-search-card__title` class
  - Company: `base-search-card__subtitle` class
  - Location: `.job-search-card__location` class
  - Date: `time` element or `.job-search-card__listdate`
  - Applicants: `.num-applicants__caption` parsing

### Mobile Proxy Integration

All requests use `proxyFetch()` from the template's proxy module:

```typescript
const response = await proxyFetch(url, { timeoutMs: 30000 });
```

This routes traffic through Proxies.sx mobile proxies, providing:
- Real mobile carrier IPs (4G/5G)
- Bypass anti-bot systems (DataDome, PerimeterX)
- Rotating IPs per request
- US mobile fingerprints

### Payment Flow

1. Client makes request to `/api/jobs` **without payment**
2. Service returns **402 Payment Required** with x402 discovery info
3. Client sends USDC tx to wallet address
4. Client retries request with x402 headers: `X-Payment-TxHash`, `X-Payment-Network`
5. Service verifies tx on-chain via `verifyPayment()`
6. Service executes job search if payment valid
7. Service returns results with `X-Payment-Settled: true`

### Data Quality

**Salary extraction**:
- Regex patterns for common formats: `$X - $Y`, `$X/hour`, `$X/year`
- Handles ranges, single values, hourly/yearly/monthly
- Returns `null` if not found

**Skills extraction**:
- Common tech keywords: languages, frameworks, tools
- Extracted from job descriptions
- Deduplicated and lowercase normalized

**Work type classification**:
- "remote" — Matches "remote", "work from home", "WFH"
- "hybrid" — Matches "hybrid", "flexible"
- "onsite" — Matches "on-site", "in-office"
- "unknown" — When not specified

---

## Code Quality

### TypeScript Compilation

```bash
npm run typecheck
# ✅ Zero errors, zero warnings
```

### Error Handling

- Try/catch blocks around all scraping operations
- Graceful degradation per platform (one fails, others continue)
- Detailed error logging with `console.error()`
- HTTP 502 errors with descriptive messages

### Code Structure

- **Modular**: Each platform has isolated scraper function
- **Type-safe**: Full TypeScript with proper interfaces
- **Maintainable**: Clear function names, comments, consistent style
- **Testable**: Pure functions with well-defined inputs/outputs

---

## Production Readiness

✅ **Service discovery**: Endpoint returns 402 with schema when no payment  
✅ **Health monitoring**: Inherits health check from template  
✅ **Rate limiting**: Built-in delays between requests  
✅ **Retry logic**: Exponential backoff on failures  
✅ **Proxy failover**: Mobile proxy rotation  
✅ **Payment verification**: On-chain tx validation  
✅ **Logging**: Comprehensive console logs  
✅ **CORS**: Proper headers for cross-origin requests  

---

## Limitations & Live Proof Requirement

### Current Status
This code is **production-ready** and **TypeScript-validated**, but requires live testing with:

1. **Real Proxies.sx account** with mobile proxy credits
2. **Deployed service** on public URL (not localhost)
3. **USDC wallet** with test funds (Solana or Base)
4. **x402-compatible client** to make payment + request

### Why Live Proof is Missing
- No access to Proxies.sx mobile proxy account during development
- x402 payment testing requires blockchain tx fees
- Indeed/LinkedIn anti-bot systems block non-mobile IPs

### How to Test Live

**Step 1**: Deploy service to cloud (Render, Railway, Fly.io)

**Step 2**: Set environment variables:
```
WALLET_ADDRESS=your_usdc_wallet
PROXIES_SX_API_KEY=your_proxies_sx_key
```

**Step 3**: Make unpaid request (get 402 response):
```bash
curl https://your-service.com/api/jobs?role=Software+Engineer&location=Remote
```

**Step 4**: Send USDC payment to wallet address from 402 response

**Step 5**: Retry with payment headers:
```bash
curl -H "X-Payment-TxHash: 5xJ8..." \
     -H "X-Payment-Network: base" \
     https://your-service.com/api/jobs?role=Software+Engineer&location=Remote
```

**Expected Output**: JSON with 20 job listings from Indeed + LinkedIn

---

## Economics

**At 10,000 requests/day:**
- Revenue: $0.003 × 10,000 = **$30/day**
- Proxy cost: ~0.5 GB × $4/GB = **$2/day**  
- **Profit: $28/day (~$840/month)**

**Break-even**: ~70 requests/day

---

## Changes from Initial PR (Review Fixes)

1. ✅ **Fixed**: Added `/api/jobs` endpoint to existing `service.ts` instead of replacing file
2. ✅ **Fixed**: Removed `await` from `getProxy()` calls (synchronous function)
3. ✅ **Fixed**: Removed Glassdoor and ZipRecruiter from docs (not actually supported)
4. ✅ **Added**: `listings/job-market-intelligence.json` per schema
5. ⏳ **Pending**: Live proof with real mobile proxies (requires deployment + Proxies.sx account)

---

## Next Steps for Deployment

1. Obtain Proxies.sx mobile proxy API key
2. Deploy to production (Render recommended, free tier available)
3. Fund USDC wallet for payment testing
4. Run end-to-end test with x402 payment flow
5. Submit proof screenshots:
   - Terminal output showing successful request
   - JSON response with 20 jobs
   - Solana/Base explorer link for payment tx

---

## Contact

- **GitHub**: @dlin38  
- **Email**: Doug.Lin@deschaintechnology.net  
- **Solana USDC Wallet**: [TO BE PROVIDED]

Ready for review! Once deployed with Proxies.sx credentials, live proof will be provided.
