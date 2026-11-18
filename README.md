# Marketplace Service Template

**Turn AI agent traffic into passive USDC income.**

Fork this repo → edit one file → deploy → start earning.

Proxies.sx provides proxy connectivity and x402 payment support for USDC on Solana and Base. Check [dedicated-port availability](https://api.proxies.sx/v1/x402/countries) or [shared Pool Gateway stock](https://api.proxies.sx/v1/gateway/pool/stock) for the product you plan to use.

> **Reference implementation included:** This repo ships with a working **Google Maps Lead Generator** (`src/service.ts` + `src/scrapers/`) built by [@aliraza556](https://github.com/aliraza556). Use it as-is or replace with your own service logic.

## The Economics

You're arbitraging infrastructure. Buy proxy bandwidth wholesale, sell API calls retail.

The example below uses the dedicated-port traffic price of $4/GB. Check the [dedicated-port rate](https://api.proxies.sx/v1/x402/pricing) and the unsigned quote before funding a purchase. The [shared Pool Gateway](https://agents.proxies.sx/pool/skill.md) has separate rates and country availability.

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

The template includes the HTTP server, CORS, rate limiting, payment verifier and proxy helper. Review the [production payment requirements](./SECURITY.md#persistent-replay-prevention) before charging customers.

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
- **Replay tracking** — A single process remembers verified transaction hashes until it restarts. Before accepting real payments, reserve each transaction atomically in durable storage shared by every instance.
- **SSRF protection** — Private/internal URLs blocked
- **Rate limiting** — Per-IP, configurable (default 60/min)
- **Security headers** — nosniff, DENY framing, no-referrer

See [SECURITY.md](SECURITY.md) for production hardening.

## Service availability

The public [marketplace guide](https://agents.proxies.sx/marketplace/skill.md) documents Proxies.sx dedicated ports. Consult the [product index](https://agents.proxies.sx/llms.txt) for Pool Gateway access, private modems, and other products. [Community submissions](./listings/) describe services maintained by their authors. Confirm an individual service’s availability, quote and operator before paying.

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
curl "https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1"
# Returns 402 → pay USDC → get credentials
```

**Option C:** Install the [Proxies.sx MCP server](https://github.com/bolivian-peru/proxies-sx-mcp-server) in a client that supports local stdio. Its tool list depends on the selected profile and credentials.
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
