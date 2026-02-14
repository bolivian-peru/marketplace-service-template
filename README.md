# Marketplace Service Template

**Turn AI agent traffic into passive USDC income.**

Fork this repo → edit one file → deploy → start earning.

You provide the idea. We provide 145+ mobile devices across 6 countries, x402 payment rails, and the marketplace to find customers.

> **Reference implementation included:** This repo ships with a working **Google Maps Lead Generator** (`src/service.ts` + `src/scrapers/`) built by [@aliraza556](https://github.com/aliraza556). Use it as-is or replace with your own service logic.

## 💰 The Economics

You're arbitraging infrastructure. Buy proxy bandwidth wholesale, sell API calls retail.

**Proxy cost:** $4/GB shared, $8/GB private ([live pricing](https://api.proxies.sx/v1/x402/pricing))

Your margin depends on what you're scraping:

| Use Case | Avg Size | Reqs/GB | Cost/Req | You Charge | Margin |
|----------|----------|---------|----------|------------|--------|
| JSON APIs | ~10 KB | 100k | $0.00004 | $0.001 | **97%** |
| Text extraction | ~50 KB | 20k | $0.0002 | $0.005 | **96%** |
| HTML (no images) | ~200 KB | 5k | $0.0008 | $0.005 | **84%** |
| Full pages | ~2 MB | 500 | $0.008 | $0.02 | **60%** |

**Example: Text scraper at 10k req/day**
- Traffic: ~0.5 GB/day → $2/day proxy cost
- Revenue: $0.005 × 10k = $50/day
- **Profit: $48/day (~$1,400/mo)**

**Key:** Optimize response size. Return text, not full HTML. Skip images. The template's `proxyFetch()` returns text by default (50KB cap).

### Why This Works

1. **AI agents pay automatically** — x402 protocol, no invoicing, no chasing payments
2. **Real mobile IPs** — bypass blocks that kill datacenter scrapers
3. **Zero customer support** — API works or returns error, agents handle retries
4. **Passive income** — deploy once, earn while you sleep

## 🛠️ What to Build

Services that need real browser + real IP. AI agents will pay for these:

| Service Idea | Complexity | Price Range | Why Mobile IP Matters |
|--------------|------------|-------------|----------------------|
| **SERP Scraper** | Easy | $0.005-0.02/query | Google blocks datacenter IPs |
| **Social Media Scraper** | Easy | $0.01-0.05/profile | Twitter/LinkedIn/Instagram detection |
| **Price Monitor** | Easy | $0.005-0.01/check | E-commerce anti-bot systems |
| **Ad Verification** | Medium | $0.02-0.10/check | Must appear as real mobile user |
| **Review Scraper** | Easy | $0.01-0.03/page | Yelp/TripAdvisor/Amazon blocks |
| **Lead Generator** | Medium | $0.05-0.20/lead | Directory scraping + enrichment |
| **Screenshot Service** | Medium | $0.01-0.05/shot | Needs real browser fingerprint |
| **Form Submitter** | Medium | $0.10-0.50/submit | Account creation, signups |
| **Captcha Page Solver** | Hard | $0.05-0.20/solve | Cloudflare/Akamai challenges |

**Pro tip:** Start simple. A focused SERP scraper making $5/day beats a complex service making $0/day.

## Quick Start

```bash
# Fork this repo, then:
git clone https://github.com/bolivian-peru/marketplace-service-template
# Or your fork: git clone https://github.com/YOUR_USERNAME/marketplace-service-template
cd marketplace-service-template

cp .env.example .env
# Edit .env: set WALLET_ADDRESS + PROXY_* credentials

bun install
bun run dev
```

Test it:
```bash
curl http://localhost:3000/health
# → {"status":"healthy","service":"my-service",...}

curl http://localhost:3000/
# → Service discovery JSON (AI agents read this)

curl "http://localhost:3000/api/run?query=plumbers&location=Austin+TX"
# → 402 with payment instructions (this is correct!)
```

## Edit One File

**`src/service.ts`** — change three values and the handler:

```typescript
const SERVICE_NAME = 'my-scraper';       // Your service name
const PRICE_USDC = 0.005;               // Price per request ($)
const DESCRIPTION = 'What it does';      // For AI agents

serviceRouter.get('/run', async (c) => {
  // ... payment check + verification (already wired) ...

  // YOUR LOGIC HERE:
  const result = await proxyFetch('https://target.com');
  return c.json({ data: await result.text() });
});
```

Everything else (server, CORS, rate limiting, payment verification, proxy helper) works out of the box.

## How x402 Payment Works

```
AI Agent                         Your Service                    Blockchain
   │                                  │                              │
   │─── GET /api/run ────────────────►│                              │
   │◄── 402 {price, wallet, nets} ────│                              │
   │                                  │                              │
   │─── Send USDC ──────────────────────────────────────────────────►│
   │◄── tx confirmed ◄──────────────────────────────────────────────│
   │                                  │                              │
   │─── GET /api/run ────────────────►│                              │
   │    Payment-Signature: <tx_hash>  │─── verify tx on-chain ──────►│
   │                                  │◄── confirmed ◄──────────────│
   │◄── 200 {result} ────────────────│                              │
```

Supports **Solana** (~400ms, ~$0.0001 gas) and **Base** (~2s, ~$0.01 gas).

## What's Included

| File | Purpose | Edit? |
|------|---------|-------|
| `src/service.ts` | Your service logic, pricing, description | **✏️ YES** |
| `src/scrapers/maps-scraper.ts` | Google Maps scraping logic (reference impl) | Replace with yours |
| `src/types/index.ts` | TypeScript interfaces | Replace with yours |
| `src/utils/helpers.ts` | Extraction helper functions | Replace with yours |
| `src/index.ts` | Server, CORS, rate limiting, discovery | No |
| `src/payment.ts` | On-chain USDC verification (Solana + Base) | No |
| `src/proxy.ts` | Proxy credentials + fetch with retry | No |
| `CLAUDE.md` | Instructions for AI agents editing this repo | No |
| `SECURITY.md` | Security features and production checklist | Read it |
| `Dockerfile` | Multi-stage build, non-root, health check | No |

## Browser Identity Bundles (v1.1.0)

The [Proxies.sx Browser API](https://browser.proxies.sx) now supports **Identity Bundles** — save and restore a complete browser identity across sessions.

### What Are Identity Bundles?

An Identity Bundle captures everything that makes a browser session unique:

- **Cookies** — login sessions, consent states, tracking cookies
- **localStorage / sessionStorage** — app preferences, cached tokens
- **Browser fingerprint** — canvas, WebGL, fonts, screen resolution
- **Proxy device binding** — same mobile IP device across sessions

This means an AI agent can log into a site on Day 1, save the identity, then return on Day 30 with the exact same browser — same cookies, same fingerprint, same device IP. The site sees a returning user, not a new visitor.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/sessions` | Create session (accepts `profile_id` to restore identity) |
| `POST` | `/v1/sessions/:id/profile` | Save current session as an Identity Bundle |
| `POST` | `/v1/sessions/:id/profile/load` | Load a saved Identity Bundle into active session |
| `GET` | `/v1/profiles` | List all saved Identity Bundles |
| `DELETE` | `/v1/profiles/:id` | Delete an Identity Bundle |

### Workflow Example

**Day 1 — Create identity and log in:**
```bash
# 1. Create a new browser session
POST /v1/sessions
Payment-Signature: <tx_hash>
Body: { "country": "US" }
# → { "sessionId": "sess_abc", ... }

# 2. Navigate, log in, do work via CDP/commands
POST /v1/sessions/sess_abc/command
Body: { "action": "navigate", "url": "https://example.com/login" }

# 3. Save the identity bundle (cookies, storage, fingerprint, device)
POST /v1/sessions/sess_abc/profile
# → { "profileId": "prof_xyz", "size": 48210, ... }
```

**Day 30 — Restore identity and continue:**
```bash
# 1. Create session WITH the saved profile — identity fully restored
POST /v1/sessions
Payment-Signature: <tx_hash>
Body: { "country": "US", "profile_id": "prof_xyz" }
# → Session starts with same cookies, fingerprint, and proxy device

# 2. Navigate — site sees a returning user
POST /v1/sessions/sess_abc/command
Body: { "action": "navigate", "url": "https://example.com/dashboard" }
# → Already logged in, no re-authentication needed
```

### Anti-Lock Rules

Identity Bundles are designed to avoid account locks and detection. Follow these rules:

| Rule | Why |
|------|-----|
| **One account = one Identity Bundle** | Never reuse a bundle across different site accounts |
| **Consistent proxy device** | The bundle binds to a specific proxy device for IP consistency |
| **Never geo-teleport** | If your bundle was created with a US proxy, always restore with a US proxy |
| **Don't share bundles** | Each bundle should be used by a single agent/workflow |

### Use Cases for Service Builders

- **Account management services** — maintain persistent logins across sessions
- **Social media monitors** — check feeds without re-authenticating
- **E-commerce scrapers** — preserve cart state and price history cookies
- **Form automation** — multi-step flows that span multiple sessions

## Security

Built in by default:

- ✅ **On-chain payment verification** — Solana + Base RPCs, not trust-the-header
- ✅ **Replay prevention** — Each tx hash accepted only once
- ✅ **SSRF protection** — Private/internal URLs blocked
- ✅ **Rate limiting** — Per-IP, configurable (default 60/min)
- ✅ **Security headers** — nosniff, DENY framing, no-referrer

See [SECURITY.md](SECURITY.md) for production hardening.

## Get Proxy Credentials

**Option A:** Dashboard → [client.proxies.sx](https://client.proxies.sx)

**Option B:** x402 API (no account):
```bash
curl https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1
# Returns 402 → pay USDC → get credentials
```

**Option C:** MCP Server (59 tools):
```bash
npx -y @proxies-sx/mcp-server
```

## Deploy

```bash
# Docker
docker build -t my-service .
docker run -p 3000:3000 --env-file .env my-service

# Any VPS with Bun
bun install --production && bun run start

# Railway / Fly.io / Render
# Just connect the repo — Dockerfile detected automatically
```

## 🚀 List on Marketplace = Get Discovered

Your service needs customers. The [Proxies.sx Marketplace](https://agents.proxies.sx/marketplace/) is where AI agents discover services to pay for.

**How to get listed:**

1. Deploy your service (any public URL)
2. DM [@proxyforai](https://t.me/proxyforai) or [@sxproxies](https://x.com/sxproxies) with:
   - Service URL
   - What it does
   - Price per request
   - Your wallet address
3. We verify it works → list it → AI agents start paying you

**What you get:**
- Featured in marketplace skill file (AI agents read this)
- Included in MCP server tool discovery
- Promoted to our agent network

## Bounty Board

Build a service, earn $SX tokens. See [agents.proxies.sx/marketplace/#bounties](https://agents.proxies.sx/marketplace/#bounties) for the full board.

### Wave 1 — $200 Bounties

| # | Service | Reward | Required | Issue | Status |
|---|---------|--------|----------|-------|--------|
| 1 | ~~YouTube Transcript Scraper~~ | $200 | proxy + x402 | — | **DONE** |
| 2 | **Google SERP + AI Search Scraper** | $200 | proxy + browser + x402 | [#1](https://github.com/bolivian-peru/marketplace-service-template/issues/1) | OPEN |
| 3 | **Gmail Account Creator + Warmer** | $200 | proxy + browser + x402 | [#2](https://github.com/bolivian-peru/marketplace-service-template/issues/2) | IN REVIEW |
| 4 | **Instagram Account Creator + Warmer** | $200 | proxy + browser + x402 | [#3](https://github.com/bolivian-peru/marketplace-service-template/issues/3) | IN REVIEW |

### Wave 2 — $50 Bounties

| # | Service | Reward | Issue | Status |
|---|---------|--------|-------|--------|
| 7 | Mobile SERP Tracker | $50 | [#7](https://github.com/bolivian-peru/marketplace-service-template/issues/7) | OPEN |
| 8 | E-Commerce Price & Stock Monitor | $50 | [#8](https://github.com/bolivian-peru/marketplace-service-template/issues/8) | OPEN |
| 9 | ~~Google Maps Lead Generator~~ | $50 | [#9](https://github.com/bolivian-peru/marketplace-service-template/issues/9) | **DONE** ([PR #17](https://github.com/bolivian-peru/marketplace-service-template/pull/17)) |
| 10 | Social Profile Intelligence API | $50 | [#10](https://github.com/bolivian-peru/marketplace-service-template/issues/10) | OPEN |
| 11 | Ad Spy & Creative Intelligence | $50 | [#11](https://github.com/bolivian-peru/marketplace-service-template/issues/11) | OPEN |
| 12 | Travel Price Tracker API | $50 | [#12](https://github.com/bolivian-peru/marketplace-service-template/issues/12) | OPEN |
| 13 | Ad Verification & Brand Safety | $50 | [#13](https://github.com/bolivian-peru/marketplace-service-template/issues/13) | OPEN |
| 14 | Review & Reputation Monitor | $50 | [#14](https://github.com/bolivian-peru/marketplace-service-template/issues/14) | OPEN |
| 15 | Real Estate Listing Aggregator | $50 | [#15](https://github.com/bolivian-peru/marketplace-service-template/issues/15) | OPEN |
| 16 | Job Market Intelligence API | $50 | [#16](https://github.com/bolivian-peru/marketplace-service-template/issues/16) | OPEN |

**Rules:**
1. Must use Proxies.sx mobile proxies
2. Must gate with x402 USDC payments
3. Must be a working, deployable service
4. Claim by commenting on the issue linked above
5. $SX tokens paid after Maya reviews and approves

## Links

| Resource | URL |
|----------|-----|
| Marketplace | [agents.proxies.sx/marketplace](https://agents.proxies.sx/marketplace/) |
| Skill File | [agents.proxies.sx/skill.md](https://agents.proxies.sx/skill.md) |
| x402 SDK | [@proxies-sx/x402-core](https://www.npmjs.com/package/@proxies-sx/x402-core) |
| MCP Server | [@proxies-sx/mcp-server](https://www.npmjs.com/package/@proxies-sx/mcp-server) |
| Proxy Pricing | [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing) |
| API Docs | [api.proxies.sx/docs/api](https://api.proxies.sx/docs/api) |
| Telegram | [@proxyforai](https://t.me/proxyforai) |
| Twitter | [@sxproxies](https://x.com/sxproxies) |

## License

MIT — fork it, ship it, profit.

---

**Ready to start earning?**

```bash
git clone https://github.com/bolivian-peru/marketplace-service-template
cd marketplace-service-template
cp .env.example .env
# Add your wallet + proxy credentials
bun install && bun run dev
```

Questions? [@proxyforai](https://t.me/proxyforai) · [@sxproxies](https://x.com/sxproxies)
