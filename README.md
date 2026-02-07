# 🔍 Google SERP + AI Search Scraper

Production-quality Google SERP scraping service with AI Overview extraction. Built for the Proxies.sx marketplace.

## ✨ Features

- **Browser Rendering** — Uses Playwright with stealth settings, not regex HTML parsing
- **AI Overview Extraction** — Captures JavaScript-rendered SGE/AI Overview content
- **Mobile Proxy Support** — Routes through real 4G/5G mobile IPs via Proxies.sx
- **x402 USDC Payments** — Pay-per-query via Solana (~400ms) or Base (~2s)
- **Multi-Geo Support** — US, UK, DE, FR, ES, IT, CA, AU
- **Structured JSON Output** — Organic results, ads, featured snippets, PAA, related searches

## 📊 Output Schema

```json
{
  "query": "best laptops 2025",
  "country": "US",
  "timestamp": "2025-02-07T14:00:00.000Z",
  "results": {
    "organic": [
      { "position": 1, "title": "...", "url": "...", "snippet": "..." }
    ],
    "ads": [
      { "position": 1, "title": "...", "url": "...", "displayUrl": "...", "description": "..." }
    ],
    "aiOverview": {
      "text": "AI-generated summary...",
      "sources": [{ "title": "...", "url": "..." }]
    },
    "featuredSnippet": {
      "text": "...",
      "source": "...",
      "sourceUrl": "..."
    },
    "peopleAlsoAsk": ["question1", "question2"],
    "relatedSearches": ["term1", "term2"],
    "knowledgePanel": { "title": "...", "description": "..." }
  },
  "metadata": {
    "totalResults": "1,234,567",
    "searchTime": "0.45s",
    "scrapedAt": "2025-02-07T14:00:00.000Z",
    "proxyCountry": "US"
  }
}
```

## 💰 Pricing

- **$0.008 USDC per query** (less than 1 cent)
- Accepts Solana USDC (~400ms settlement)
- Accepts Base USDC (~2s settlement)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/EugeneJarvis88/google-serp-ai-scraper
cd google-serp-ai-scraper
npm install
npx playwright install chromium
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your wallet and proxy credentials
```

### 3. Run

```bash
npm run dev
```

### 4. Test

```bash
# Health check
curl http://localhost:3000/health

# Demo endpoint (no payment required)
curl "http://localhost:3000/api/demo?q=best+laptops+2025&country=US"

# Production endpoint (requires x402 payment)
curl "http://localhost:3000/api/run?q=best+laptops+2025&country=US"
# Returns 402 with payment instructions
```

## 🔐 x402 Payment Flow

```
AI Agent                     SERP Service                  Blockchain
    │                             │                             │
    │─── GET /api/run ───────────►│                             │
    │◄── 402 {price, wallet} ─────│                             │
    │                             │                             │
    │─── Send USDC ──────────────────────────────────────────────►│
    │◄── tx confirmed ◄──────────────────────────────────────────│
    │                             │                             │
    │─── GET /api/run ───────────►│                             │
    │    Payment-Signature: <tx>  │─── verify on-chain ─────────►│
    │                             │◄── confirmed ◄──────────────│
    │◄── 200 {results} ───────────│                             │
```

## 🌐 Architecture

```
Client Request
      │
      ▼
┌─────────────────┐
│   x402 Gate     │ ← Verify USDC payment on-chain
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Playwright     │ ← Stealth browser with anti-detect
│  + Stealth      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Mobile Proxy   │ ← Real 4G/5G IP from Proxies.sx
│  (Proxies.sx)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     Google      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DOM Parser     │ ← Extract structured data
└────────┬────────┘
         │
         ▼
   JSON Response
```

## 🛡️ Edge Cases Handled

- ✅ **CAPTCHA Detection** — Detects and reports, retries with fresh IP
- ✅ **Cookie Consent** — Auto-accepts across all supported geos
- ✅ **Rate Limiting** — 60 requests/min per IP (configurable)
- ✅ **Pagination** — Supports pages 1-10 via `?page=N`
- ✅ **Replay Protection** — Each tx hash accepted only once
- ✅ **SSRF Protection** — Private/internal URLs blocked

## 📁 Project Structure

```
src/
├── index.ts      # Server, CORS, rate limiting, discovery
├── service.ts    # SERP scraping logic + x402 gate
├── browser.ts    # Playwright stealth configuration
├── parser.ts     # Google SERP DOM parser
├── payment.ts    # On-chain USDC verification
└── proxy.ts      # Mobile proxy configuration
```

## 🔧 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `WALLET_ADDRESS` | Solana wallet for receiving USDC | Yes |
| `WALLET_ADDRESS_BASE` | Base wallet (if different) | No |
| `PROXY_HOST` | Proxies.sx host | Yes |
| `PROXY_HTTP_PORT` | Proxy port | Yes |
| `PROXY_USER` | Proxy username | Yes |
| `PROXY_PASS` | Proxy password | Yes |
| `PROXY_COUNTRY` | Default country (US, UK, DE, etc) | No |
| `PORT` | Server port (default: 3000) | No |
| `RATE_LIMIT` | Requests per minute (default: 60) | No |

## 📝 API Reference

### GET /api/run

Scrape Google SERP for a query.

**Parameters:**
- `q` (required) — Search query
- `country` (optional) — Country code: US, UK, DE, FR, ES, IT, CA, AU
- `page` (optional) — Page number 1-10

**Headers:**
- `Payment-Signature` — Transaction hash (Solana or Base)
- `X-Payment-Network` — Optional: "solana" or "base"

**Response:** Full SERP JSON (see schema above)

### GET /api/demo

Demo endpoint without payment (uses datacenter IP, may trigger CAPTCHA).

### GET /health

Health check and service info.

## 🚢 Deployment

### Docker

```bash
docker build -t serp-scraper .
docker run -p 3000:3000 --env-file .env serp-scraper
```

### Railway / Fly.io / Render

Connect repo → auto-detects Dockerfile → deploy

## 💡 Why Mobile Proxy is Required

Google aggressively blocks datacenter IPs. Without a real mobile IP:
- CAPTCHA appears within 1-2 requests
- No AI Overview (JavaScript not fully rendered)
- Inconsistent results

With Proxies.sx mobile proxy:
- Real 4G/5G residential IP
- Appears as normal mobile user
- Full JavaScript rendering
- AI Overview extraction works

## 📜 License

MIT — fork it, ship it, profit.

## 🔗 Links

- [Proxies.sx Marketplace](https://agents.proxies.sx/marketplace/)
- [x402 SDK](https://www.npmjs.com/package/@proxies-sx/x402-core)
- [Bounty Issue](https://github.com/bolivian-peru/marketplace-service-template/issues/1)
