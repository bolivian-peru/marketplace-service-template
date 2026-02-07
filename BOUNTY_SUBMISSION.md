# Job Market Intelligence API - Bounty Submission

## 🎯 Bounty: Job Market Intelligence API ($50)
Issue: https://github.com/bolivian-peru/marketplace-service-template/issues/16

## ✅ Requirements Fulfilled

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Aggregate from LinkedIn + Indeed | ✅ | Both platforms implemented with parsing |
| Structured JSON output | ✅ | Full schema with all fields |
| Search by role | ✅ | `?role=Software+Engineer` |
| Search by location | ✅ | `?location=San+Francisco` |
| Search by company | ✅ | `?company=Google` (optional) |
| Extract salary when available | ✅ | Parses $, €, £ formats, K notation |
| Must use Proxies.sx mobile proxies | ✅ | Uses `proxyFetch()` from template |
| Must gate with x402 USDC payments | ✅ | Full x402 payment verification |
| Return structured JSON per listing | ✅ | See output schema below |

## 📋 Output Schema

```json
{
  "query": { "role": "string", "location": "string", "company": "string|null" },
  "results": [{
    "platform": "indeed | linkedin",
    "title": "string",
    "company": "string",
    "location": "string",
    "salaryRange": { "min": 120000, "max": 180000, "currency": "USD", "period": "year" },
    "postingDate": "string",
    "url": "string",
    "workType": "remote | hybrid | onsite",
    "skills": ["Python", "AWS", "Docker"],
    "applicantCount": "number | null",
    "description": "string"
  }],
  "metadata": {
    "totalResults": 45,
    "platformBreakdown": { "indeed": 20, "linkedin": 25 },
    "scrapedAt": "2025-02-07T10:58:00.000Z"
  }
}
```

## 🧪 Proof of Concept

Tested **3 job titles** across **7 locations**, found **45+ real job listings**.

### Job Titles Tested
1. **Software Engineer**
2. **Data Scientist**
3. **Product Manager**

### Locations Tested
1. San Francisco, CA
2. New York, NY
3. London, UK
4. Berlin, Germany
5. Singapore
6. Austin, TX
7. Toronto, Canada

### Sample Results

**Software Engineer @ San Francisco**
- Notion - Software Engineer, Fullstack, Early Career
- Stripe - Software Engineer, New Grad
- Anthropic - Senior Software Engineer
- Reddit - Software Engineer II
- OpenAI - Software Engineer

**Data Scientist @ Berlin**
- Delivery Hero - Data Scientist, Quick Commerce
- mediaire - Machine Learning Engineer
- Green Fusion - Machine Learning Engineer (m/f/d)
- Enpal - Data Science Intern

**Product Manager @ New York**
- Meta - Product Manager
- Google - Product Manager I, Search
- CHANEL - Assistant Manager, Product
- Ralph Lauren - Product Manager

See `proof-results.json` for complete JSON output.

## 🚀 API Usage

### Live Endpoint (with x402 payment)
```bash
curl "https://your-deployment/api/run?role=software+engineer&location=san+francisco" \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana"
```

### Demo Endpoint (no payment, limited)
```bash
curl "https://your-deployment/api/demo?role=data+scientist&location=berlin"
```

## 💰 Pricing
- **$0.003 per request** (covers ~10-20 listings per call)
- At $0.003/listing this is accessible to everyone vs $3K-20K/month for enterprise job APIs

## 🔧 Technical Details

### Salary Parsing
Extracts salary from various formats:
- `$120,000 - $180,000 a year`
- `$50K - $80K`
- `€60,000 - €90,000`
- `£45 - £55 an hour`

### Work Type Detection
Automatically detects:
- Remote (keywords: remote, work from home, wfh)
- Hybrid
- Onsite (default)

### Skills Extraction
Matches 50+ common tech/business skills including:
Python, JavaScript, AWS, Docker, Kubernetes, Machine Learning, etc.

## 📦 Fork URL
https://github.com/EugeneJarvis88/marketplace-service-template

## 💳 Wallet Address (for $50 $SX token payment)
**Solana USDC:** `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`

---
Built with Proxies.sx infrastructure + x402 payment rails 🚀
