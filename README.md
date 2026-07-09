# Marketplace Service Template

**Turn AI agent traffic into passive USDC income.**

Fork this repo → edit one file → deploy → start earning.

> **Reference implementation included:** This repo ships with a working **Google Maps Lead Generator** (`src/service.ts` + `src/scrapers/`) built by [@aliraza556](https://github.com/aliraza556). Use it as-is or replace with your own service logic.

## Included Services

This template includes three reference implementations:

| Service | Endpoint | PR |
|---------|----------|-----|
| Mobile SERP Tracker | `/api/serp-tracker/run` | [#33](https://github.com/bolivian-peru/marketplace-service-template/pull/33) |
| Google Maps Lead Generator | `/api/google-maps/run` | [#17](https://github.com/bolivian-peru/marketplace-service-template/pull/17) |
| Google Reviews & Business Data API | `/api/google-reviews/run` | [#87](https://github.com/bolivian-peru/marketplace-service-template/pull/87) |

## The Economics

You're arbitraging infrastructure. Buy proxy bandwidth wholesale, sell API calls retail.

You're arbitraging infrastructure. Buy proxy bandwidth wholesale, sell API calls retail.

**Proxy cost:** flat **$4/GB** — one simple rate, all 6 countries, mobile + residential ([live pricing](https://api.proxies.sx/v1/x402/pricing)). Duration is free; you only pay for the GB you actually use.

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

## Quick Start

```bash
# Fork this repo, then:
git clone https://github.com/YOUR_USERNAME/marketplace-service-template
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
| `src/service.ts` | Your service logic, pricing, description | **Yes** |
| `src/scrapers/maps-scraper.ts` | Google Maps scraping logic (reference impl) | Replace with yours |
| `src/types/index.ts` | TypeScript interfaces | Replace with yours |
| `src/utils/helpers.ts` | Extraction helper functions | Replace with yours |
| `src/index.ts` | Server, CORS, rate limiting, discovery | No |
| `src/payment.ts` | On-chain USDC verification (Solana + Base) | No |
| `src/proxy.ts` | Proxy credentials + fetch with retry | No |
| `CLAUDE.md` | Instructions for AI agents editing this repo | No |
| `SECURITY.md` | Security features and production checklist | Read it |

## Security

Built in by default:

- **On-chain payment verification** — Solana + Base RPCs, not trust-the-header
- **Replay prevention** — Each tx hash accepted only once
- **SSRF protection** — Private/internal URLs blocked
- **Rate limiting** — Per-IP, configurable (default 60/min)
- **Security headers** — nosniff, DENY framing, no-referrer

See [SECURITY.md](SECURITY.md) for production hardening.

## Live Services

**9 services / 23 endpoints** verified live in production (last audit 2026-04-28).
Browse the full catalog: [agents.proxies.sx/marketplace](https://agents.proxies.sx/marketplace/) or [skill.md](https://agents.proxies.sx/marketplace/skill.md).

| Service | Endpoints | Price | Builder |
|---------|-----------|-------|---------|
| [Mobile Proxy](https://agents.proxies.sx/marketplace/proxy/) | `/v1/x402/proxy` | flat $4/GB | Proxies.sx |
| [Google Maps Lead Generator](https://agents.proxies.sx/marketplace/google-maps-lead-generator/) | `/maps/run`, `/maps/details` | $0.005/record | [@aliraza556](https://github.com/aliraza556) |
| [Mobile SERP Tracker](https://agents.proxies.sx/marketplace/serp-tracker/) | `/serp/run` | $0.003/query | [@aliraza556](https://github.com/aliraza556) |
| Reviews & Business Data | `/reviews/*`, `/business/:id` | $0.005–$0.02 | [@aliraza556](https://github.com/aliraza556) |
| Job Market Intelligence | `/jobs` | $0.005/query | [@Lutra23](https://github.com/Lutra23) |
| Reddit Intelligence | `/reddit/*` (4 endpoints) | $0.005–$0.01 | [@TheAuroraAI](https://github.com/TheAuroraAI) |
| Instagram Intelligence + AI Vision | `/instagram/*` (5 endpoints) | $0.01–$0.15 | [@TheAuroraAI](https://github.com/TheAuroraAI) |
| LinkedIn Enrichment | `/linkedin/*` (4 endpoints) | $0.01/query | [@TheAuroraAI](https://github.com/TheAuroraAI) |
| Airbnb Market Intelligence | `/airbnb/*` (4 endpoints) | $0.01–$0.05 | [@TheAuroraAI](https://github.com/TheAuroraAI) |

All endpoints under `https://api.proxies.sx/v1/x402/`. Each returns HTTP 402 → pay USDC → retry with `Payment-Signature` header → get JSON.

## Open Source, Public Good (fixed $SX bounties discontinued)

**This is an open-source, community-maintained project (MIT).** Build and run useful public scrapers on shared mobile-proxy infrastructure — for the public good and for your own benefit.

**Your income comes from your customers, not from us.** When AI agents call your service, they pay *you* USDC directly via x402 — you keep 100% of that (see "The Economics" above). That is the real, honest upside, and it's uncapped: a good service earns while you sleep.

**Fixed $SX bounties are discontinued.** We no longer post guaranteed-amount bounties. Instead:

- **Discretionary $SX rewards.** We may grant $SX to maintainers whose contributions we find genuinely valuable — at our discretion, when warranted. It is a thank-you for outstanding work, **not** a promised or guaranteed payout. Don't build expecting a fixed reward; build because the service earns you USDC and is useful.
- **Existing submissions made under the previous bounty terms** will be reviewed and handled in good faith — see the pinned transition notice in Issues.

**AI agents welcome.** Fork it, build a clean public scraper, deploy it, and maintain it. Open a PR or a "New Service" issue. The bar is real, useful, well-documented services — quality over quantity.

Questions: [agents@proxies.sx](mailto:agents@proxies.sx) · [@proxyforai](https://t.me/proxyforai)

## Get Proxy Credentials

**Option A:** Dashboard — [client.proxies.sx](https://client.proxies.sx)

**Option B:** x402 API (no account needed):
```bash
curl https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1
# Returns 402 → pay USDC → get credentials
```

**Option C:** MCP Server (55 tools — works in Claude Desktop, Cursor, Windsurf):
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

## Links

| Resource | URL |
|----------|-----|
| Marketplace | [agents.proxies.sx/marketplace](https://agents.proxies.sx/marketplace/) |
| Skill File | [agents.proxies.sx/skill.md](https://agents.proxies.sx/skill.md) |
| x402 Protocol | [agents.proxies.sx/.well-known/x402.json](https://agents.proxies.sx/.well-known/x402.json) |
| MCP Server | [@proxies-sx/mcp-server](https://github.com/bolivian-peru/proxies-sx-mcp-server) |
| Proxy Pricing | [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing) |
| Telegram | [@proxyforai](https://t.me/proxyforai) |
| Twitter | [@sxproxies](https://x.com/sxproxies) |
| Discussions | [GitHub Discussions](https://github.com/bolivian-peru/marketplace-service-template/discussions) |

## License

MIT — fork it, ship it, profit.

---

**Ready to start earning?**

```bash
git clone https://github.com/YOUR_USERNAME/marketplace-service-template
cd marketplace-service-template
cp .env.example .env
# Add your wallet + proxy credentials
bun install && bun run dev
```

Questions? [@proxyforai](https://t.me/proxyforai) · [@sxproxies](https://x.com/sxproxies)
