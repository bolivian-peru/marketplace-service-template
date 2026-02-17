# Bounty Submission: LinkedIn Enrichment API (Bounty #77)

## Scope delivered in this PR

Implemented LinkedIn enrichment API wiring in `src/service.ts` with x402 payment flow and mobile proxy metadata:

- `GET /api/linkedin/person?url=linkedin.com/in/username` — **$0.03**
- `GET /api/linkedin/company?url=linkedin.com/company/name` — **$0.05**
- `GET /api/linkedin/search/people?title=CTO&location=San+Francisco&industry=SaaS&limit=10` — **$0.10**
- `GET /api/linkedin/company/:id/employees?title=engineer&limit=10` — **$0.10**

## Architecture details

Added `src/scrapers/linkedin.ts` with a provider abstraction:

- `LinkedInEnrichmentProvider` interface for mock/live provider swapping
- `MockLinkedInProvider` (default): deterministic mock data for local/test and CI
- `LiveLinkedInProvider` (opt-in): session-cookie-based HTML fetch scaffolding over Proxies.sx mobile proxy

Anti-rate-limit/session scaffolding included:

- Per-client LinkedIn route rate limit (`LINKEDIN_MAX_REQ_PER_MIN`, default 12/min)
- Session pool support via `LINKEDIN_SESSION_COOKIES` (split by `||`)
- Session backoff on LinkedIn anti-bot responses (HTTP 429 / 999)
- Mobile proxy metadata in responses (`ip`, `country`, `carrier`, `host`, `type: mobile`)

## x402 flow

All four LinkedIn endpoints:

1. Return standards-based `402` with `build402Response(...)` when no payment signature
2. Verify on-chain USDC payment via `verifyPayment(...)`
3. Return paid `200` with `X-Payment-Settled` and `X-Payment-TxHash`

## Config

- `WALLET_ADDRESS` required
- `LINKEDIN_PROVIDER=mock|live` (default `mock`)
- `LINKEDIN_SESSION_COOKIES` required when provider is `live`
- `PROXY_*` required for proxy routing
- Optional: `PROXY_CARRIER`, `LINKEDIN_MAX_REQ_PER_MIN`

## Validation run in this environment

Because `bun` is not installed in this execution environment, Bun runtime checks and full deployment run were not possible here.

Completed validation:

- `npm install` ✅
- `npx tsc --noEmit` ✅ (strict TypeScript compile passes)

## Candid status / blockers

- ✅ Endpoint wiring + provider abstraction + x402 payment flow implemented.
- ✅ Anti-rate-limit and session handling scaffolding implemented.
- ⚠️ Live production LinkedIn extraction quality depends on valid rotating LinkedIn sessions and environment-specific anti-bot behavior.
- ⚠️ Full bounty acceptance items (10+ real profile extractions, 3+ real company records, live deployed URL proof) are **not produced in this local environment** due missing Bun runtime + no production credentials/deployment target in-session.

## Deploy/test instructions for reviewer

1. Install Bun (required by repo runtime):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. Configure `.env` with:
   - `WALLET_ADDRESS`
   - `PROXY_HOST`, `PROXY_HTTP_PORT`, `PROXY_USER`, `PROXY_PASS`
   - `LINKEDIN_PROVIDER=live`
   - `LINKEDIN_SESSION_COOKIES="li_at=...; JSESSIONID=...||li_at=...; JSESSIONID=..."`
3. Start service:
   ```bash
   bun install
   bun run dev
   ```
4. Verify x402 preflight:
   ```bash
   curl -i "http://localhost:3000/api/linkedin/person?url=linkedin.com/in/janesmith"
   ```
5. Verify paid request:
   ```bash
   curl -sS \
     -H "Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "http://localhost:3000/api/linkedin/person?url=linkedin.com/in/janesmith" | jq
   ```

## Evidence path

- Compile evidence: local command output from `npx tsc --noEmit`
- API evidence path after deployment:
  - save 10 person JSON responses under `listings/linkedin-proof-person-*.json`
  - save 3 company JSON responses under `listings/linkedin-proof-company-*.json`
  - save search response under `listings/linkedin-proof-search-*.json`

## Solana USDC wallet

Uses service `WALLET_ADDRESS` env var (same x402 flow as template).
