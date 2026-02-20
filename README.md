# Marketplace Service Template

**Turn AI agent traffic into passive USDC income.**

Fork this repo → edit one file → deploy → start earning.

You provide the idea. We provide 155+ mobile devices across 6 countries, x402 payment rails, and the marketplace to find customers.

> **Reference implementation included:** This repo ships with a working **Google Maps Lead Generator** (`src/service.ts` + `src/scrapers/`) built by [@aliraza556](https://github.com/aliraza556). Use it as-is or replace with your own service logic.

## The Economics

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

These services are live on the marketplace right now:

| Service | Price | Builder | Status |
|---------|-------|---------|--------|
| [Mobile Proxy](https://agents.proxies.sx/marketplace/proxy/) | $4/GB shared, $8/GB private | Proxies.sx | Live |
| [Antidetect Browser](https://agents.proxies.sx/marketplace/browser/) | $0.005/min | Proxies.sx | Live |
| [Google Maps Lead Generator](https://agents.proxies.sx/marketplace/google-maps-lead-generator/) | $0.005/record | [@aliraza556](https://github.com/aliraza556) | Live |
| [Mobile SERP Tracker](https://agents.proxies.sx/marketplace/serp-tracker/) | $0.003/query | [@aliraza556](https://github.com/aliraza556) | Live |
| [Job Market Intelligence](https://bounty16-job-market-intelligence.onrender.com) | $0.005/query | [@Lutra23](https://github.com/Lutra23) | Live |
| [Prediction Market Aggregator](https://marketplace-service-template.onrender.com) | $0.05/query | [@rakesh0x](https://github.com/rakesh0x) | Live |

## Quality & Transparency

This service adheres to the [Marketplace Quality Standards (#112)](https://github.com/bolivian-peru/marketplace-service-template/issues/112):

1.  **[Proof of Output](proof/)**: Real JSON response samples for all integrated scrapers.
2.  **[Technical Necessity](whyMobileProxy.md)**: Why mobile proxies are required for Polymarket, Kalshi, and Reddit.
3.  **Enhanced Health**: `/health` endpoint checks connectivity to proxies and target sites.
4.  **Full Schema**: Root discovery route (`/`) provides field-level documentation.

## AI Readiness (MCP)

This project includes a Model Context Protocol (MCP) server wrapper in `src/mcp.ts`. This allows AI agents (like Claude or ChatGPT) to interact with the aggregator through a standardized interface.

To run the MCP server:
```bash
bun src/mcp.ts
```

## Open Bounties — $1,200+ in $SX Tokens

Build a service, earn $SX tokens. Full specs in each issue.

| Bounty | Amount | Difficulty | Issue |
|--------|--------|------------|-------|
| Instagram Intelligence + AI Vision | $200 | Hard | [#71](https://github.com/bolivian-peru/marketplace-service-template/issues/71) |
| X/Twitter Real-Time Search | $100 | Hard | [#73](https://github.com/bolivian-peru/marketplace-service-template/issues/73) |
| LinkedIn People Enrichment | $100 | Hard | [#77](https://github.com/bolivian-peru/marketplace-service-template/issues/77) |
| Trend Intelligence (Cross-Platform) | $100 | Hard | [#70](https://github.com/bolivian-peru/marketplace-service-template/issues/70) |
| Prediction Market Aggregator | $100 | Hard | [#55](https://github.com/bolivian-peru/marketplace-service-template/issues/55) |
| Amazon Product & BSR Tracker | $75 | Medium | [#72](https://github.com/bolivian-peru/marketplace-service-template/issues/72) |
| Facebook Marketplace Monitor | $75 | Medium-Hard | [#75](https://github.com/bolivian-peru/marketplace-service-template/issues/75) |
| Airbnb Market Intelligence | $75 | Medium-Hard | [#78](https://github.com/bolivian-peru/marketplace-service-template/issues/78) |
| Real Estate Intelligence (Zillow) | $75 | Medium-Hard | [#79](https://github.com/bolivian-peru/marketplace-service-template/issues/79) |
| TikTok Trend Intelligence | $75 | Hard | [#51](https://github.com/bolivian-peru/marketplace-service-template/issues/51) |
| Google Discover Feed Intel | $75 | Hard | [#52](https://github.com/bolivian-peru/marketplace-service-template/issues/52) |
| Reddit Intelligence | $50 | Easy-Medium | [#68](https://github.com/bolivian-peru/marketplace-service-template/issues/68) |
| Google Reviews Extractor | $50 | Medium | [#74](https://github.com/bolivian-peru/marketplace-service-template/issues/74) |
| Food Delivery Price Intel | $50 | Medium | [#76](https://github.com/bolivian-peru/marketplace-service-template/issues/76) |
| App Store Intelligence | $50 | Medium | [#54](https://github.com/bolivian-peru/marketplace-service-template/issues/54) |
| Ad Verification & Creative Intel | $50 | Medium | [#53](https://github.com/bolivian-peru/marketplace-service-template/issues/53) |

**Rules:**
1. Must use Proxies.sx mobile proxies
2. Must gate with x402 USDC payments
3. Must deploy a live, working service
4. Submit a PR with deployment URL + proof data
5. $SX tokens paid after merge and verification

See [CONTRIBUTING.md](CONTRIBUTING.md) for full submission guide.

## Get Proxy Credentials

**Option A:** Dashboard — [client.proxies.sx](https://client.proxies.sx)

**Option B:** x402 API (no account needed):
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
