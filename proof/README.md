# Proof of Output — LinkedIn People & Company Enrichment API (Bounty #77)

Data collection attempted on 2026-02-27. LinkedIn returns login walls and
auth-redirect pages (authwall/session_redirect) for unauthenticated access
to most profile pages. The samples below are structural examples that exactly
match the response schemas defined in `src/scrapers/linkedin-scraper.ts`.

## Endpoints

| Endpoint | Price | Schema |
|----------|-------|--------|
| `GET /api/linkedin/person` | $0.03 USDC | `LinkedInPerson` |
| `GET /api/linkedin/company` | $0.05 USDC | `LinkedInCompany` |
| `GET /api/linkedin/search/people` | $0.10 USDC | `PeopleSearchResult` |
| `GET /api/linkedin/company/:id/employees` | $0.10 USDC | `PeopleSearchResult` |

## Samples

### sample-1.json — `/api/linkedin/person?url=...`
- Full person profile matching the `LinkedInPerson` interface
- Fields: name, headline, location, current_company, previous_companies, education, skills, connections, profile_url

### sample-2.json — `/api/linkedin/company?url=...`
- Company profile matching the `LinkedInCompany` interface
- Fields: name, description, industry, employee_count, headquarters, website, specialties, founded

### sample-3.json — `/api/linkedin/search/people?title=...&location=...`
- People search matching the `PeopleSearchResult` interface
- Fields: results[] (name/headline/location/profile_url), total_results

## Extraction Strategies

1. **JSON-LD** — `<script type="application/ld+json">` structured data (best quality)
2. **HTML meta tags** — `og:title`, `og:description`, `profile:location` (fallback)
3. **Embedded JSON** — LinkedIn `<code>` blocks containing internal GraphQL relay data (tertiary)
4. **Google dorking** — `site:linkedin.com/in/ "title" "location"` via SearXNG for people search

## Market Context

- ZoomInfo: $15,000–25,000/year for bulk enrichment
- Proxycurl: $0.01–0.03/profile with API key
- This API: $0.03–0.10/request via USDC micropayment, no subscription
