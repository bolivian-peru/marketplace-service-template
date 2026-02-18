# Security Hardening Review, Trend Intelligence Scaffold

Date: 2026-02-18
Repo: `/workspace/bounties/marketplace-service-template`
Scope:
- `src/routes/research.ts`
- `src/routes/trending.ts`
- `src/scrapers/reddit.ts`
- `src/scrapers/web.ts`
- `src/analysis/patterns.ts`
- `src/analysis/sentiment.ts`

## Static review findings

### 1) Input validation gaps
- `research` accepted unbounded topic/body size and loose platform validation.
- `trending` accepted unbounded `platforms` query length and weak platform filtering.
- scraper entry points accepted weak/unbounded input values.

### 2) Abuse control gaps
- Route-level limit existed globally, but no endpoint-specific guard on higher-cost Trend Intelligence endpoints.
- Potential header injection risk when echoing `payment.txHash` into response headers.

### 3) Payload and loop bounds
- Parsing logic in web and analysis layers could process overly large payloads and term sets.
- RSS article extraction had no per-topic cap.
- Pattern extraction could grow maps with excessive keywords.

### 4) External request hardening
- Core scraper requests already had timeout support through `proxyFetch`, but not all pathways reused the same hardened flow.
- Needed stronger body-size checks and parse guards on fetched content.

## Concrete fixes implemented

## Routes

### `src/routes/research.ts`
- Added endpoint-specific in-memory rate limiter for `/api/research`:
  - default `12 req/min` per client IP
  - configurable via `RESEARCH_RATE_LIMIT_PER_MIN`
- Added strict request checks:
  - `Content-Type` validation (`application/json`)
  - max body size `8KB` (`413` on overflow)
  - JSON object-only body validation
  - bounded `topic` validation (`2..200 chars`, control chars blocked)
  - validated `platforms` as supported set only
  - bounded numeric `days` parsing
  - country normalization to strict ISO-2 fallback
- Switched proxy exit IP lookup to hardened `proxyFetch` path with timeout and retry controls.
- Added payment verification error handling when verifier is unavailable.
- Sanitized `X-Payment-TxHash` response header value.
- Added defensive truncation before sentiment aggregation.

### `src/routes/trending.ts`
- Added endpoint-specific in-memory rate limiter for `/api/trending`:
  - default `30 req/min` per client IP
  - configurable via `TRENDING_RATE_LIMIT_PER_MIN`
- Added strict query parsing and validation:
  - `country` normalized to strict ISO-2 fallback
  - `platforms` query max length check and allowlist filtering
  - deduped requested platforms
  - bounded `limit` (`1..50`)
- Switched proxy exit IP lookup to hardened `proxyFetch` path.
- Added payment verifier availability handling.
- Sanitized `X-Payment-TxHash` response header value.

## Scrapers

### `src/scrapers/reddit.ts`
- Added input bounds and sanitization for:
  - topic length
  - subreddit format (`^[A-Za-z0-9_]{2,21}$`)
  - days and limit clamping
- Added safe mapping and normalization:
  - text cleanup
  - URL normalization to `http/https` only
  - numeric clamping for score/comment/upvote ratio
- Added defensive JSON parsing with explicit error messages.
- Ensured all proxy requests keep timeout + retry settings.

### `src/scrapers/web.ts`
- Added strict bounds:
  - topic length, limit, title/snippet/source/url lengths
  - max articles per trend item (`5`)
- Added URL normalization to allow only `http/https` URLs in parsed output.
- Added upstream payload size checks before processing:
  - DDG max `1.5MB`
  - Trends RSS max `1MB`
- Added response body read guard (`arrayBuffer`) with explicit size enforcement.
- Kept timeout and retry settings on all external calls.

## Analysis

### `src/analysis/patterns.ts`
- Added bounded processing controls:
  - max items per platform
  - max text length, token count, terms per text
  - max keyword map size per platform
  - max merged signal keyword count
- Added keyword normalization and allowlist checks.
- Deduped per-document terms to reduce amplification/noise.
- Bounded top keyword output size for helper method.

### `src/analysis/sentiment.ts`
- Added bounded processing controls:
  - max text length per input
  - max tokens per text
  - max texts per aggregate batch
- Added text sanitization before tokenization.
- Added stronger guard behavior for empty/invalid input arrays.

## SSRF and scraping safety status

- No direct user-supplied outbound URL fetch path was present in this scope.
- Scrapers fetch only fixed upstream domains:
  - `reddit.com`
  - `html.duckduckgo.com`
  - `trends.google.com`
  - `api.ipify.org`
- Parsed URLs are now normalized to `http/https` only before returning.
- Added stricter payload size and parsing limits to reduce parser abuse risk.

## Verification commands

Executed:

```bash
bun run typecheck
```

Result: pass.

Executed:

```bash
bun test
```

Result: no tests found in repo (`bun` exited with code 1).

## Notes
- Changes were kept practical and low-risk.
- No architectural rewrites were introduced.
