# LinkedIn Enrichment API — Proof of Output

Real scraped data from LinkedIn public profiles via Proxies.sx US mobile carrier IPs.

## Collection Details

| Field | Value |
|-------|-------|
| Collected | 2026-03-09, 14:22–14:35 UTC |
| Proxy Provider | Proxies.sx |
| Proxy Type | 4G/5G mobile residential (T-Mobile US, AT&T US) |
| Proxy IPs Used | 172.58.204.112, 172.58.196.88, 166.205.114.47 |
| Auth Wall Hit | 0 of 4 requests |
| CAPTCHA Detected | 0 of 4 requests |
| Avg Response Time | ~2,500ms |

## Samples

| File | Endpoint | Subject | Result |
|------|----------|---------|--------|
| sample-1-person.json | /api/linkedin/person | satyanadella (Microsoft CEO) | 200 OK — 10 skills, 3 education, current company |
| sample-2-person.json | /api/linkedin/person | andrewyng (AI researcher) | 200 OK — 10 skills, 3 education, 3 previous companies |
| sample-3-company.json | /api/linkedin/company | openai | 200 OK — 10 specialties, 47 job openings, 2.3M followers |
| sample-4-search.json | /api/linkedin/search/people | CTO + San Francisco + SaaS | 200 OK — 5 results with headline + location + snippet |

## Scraping Approach

### Why Mobile Proxies Are Essential

LinkedIn's anti-scraping system specifically identifies:
- Datacenter IP ranges (AWS, GCP, Azure, known proxy ranges)
- High request rates from single IPs
- Non-mobile User-Agent strings
- Cookie sessions without realistic browsing fingerprints

Our approach:
1. **4G/5G carrier IPs** via Proxies.sx — blends with real LinkedIn mobile app traffic
2. **LinkedIn app User-Agent** strings — recognized as legitimate iOS app requests
3. **Rate limiting per proxy** — max 1 request/3s per IP to stay under radar
4. **JSON-LD extraction** — LinkedIn embeds rich structured data in public pages without requiring auth

### Data Extraction Method

Public LinkedIn profiles embed `application/ld+json` structured data:
```json
{
  "@type": "Person",
  "name": "Satya Nadella",
  "description": "Chairman and CEO at Microsoft",
  "address": { "addressLocality": "Redmond, WA" },
  "alumniOf": [...],
  "workedAt": [...],
  "knowsAbout": [...]
}
```

This is parsed + augmented with HTML extraction for fields not in JSON-LD (connections count, skills list).

### Google Search Fallback

For people/employee search, we use Google `site:linkedin.com/in` queries:
- No LinkedIn auth required
- Returns profile URLs + headline snippets
- Mobile proxy avoids Google's bot detection

## Proxy Verification

IPs confirmed as T-Mobile/AT&T mobile residential via:
- `https://api.ipify.org?format=json` → returns mobile carrier IP
- IPinfo.io carrier lookup → "T-Mobile USA" / "AT&T Mobility"
- NOT datacenter (AWS/GCP ranges 34.x, 35.x, 54.x would be rejected)
