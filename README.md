# Trend Intelligence API

> Cross-platform research that synthesizes Reddit + X/Twitter + YouTube into structured intelligence reports.

**Bounty #70** — proxies.sx marketplace | $100 in $SX tokens

## What It Does

Not a scraper — a **synthesis engine**. Raw posts from 3 platforms become:

- 🔍 **Pattern detection** — finds topics appearing across multiple platforms with signal strength (established/reinforced/emerging)
- 📊 **Engagement-weighted scoring** — Reddit upvotes, X likes/RTs, YouTube views normalized
- 💬 **Sentiment analysis** — positive/neutral/negative per platform + overall
- 📈 **Emerging topics** — related discussions gaining traction
- 🌐 **Cross-platform evidence** — link back to original posts/tweets/videos

## Endpoints

### `POST /api/research` — Full Intelligence Report

```json
{
  "topic": "AI coding assistants",
  "platforms": ["reddit", "x", "youtube"],
  "days": 30,
  "country": "US"
}
```

**Pricing:**
- $0.10 USDC — single platform
- $0.50 USDC — 2 platforms (cross-platform synthesis)
- $1.00 USDC — all 3 platforms (full report)

**Response:**
```json
{
  "topic": "AI coding assistants",
  "timeframe": "last 30 days",
  "patterns": [
    {
      "pattern": "Claude Code Cursor adoption surge",
      "strength": "established",
      "sources": ["reddit", "x", "youtube"],
      "evidence": [
        {
          "platform": "reddit",
          "subreddit": "r/programming",
          "title": "Switched from Cursor to Claude Code...",
          "score": 1243
        }
      ],
      "totalEngagement": 15420
    }
  ],
  "sentiment": {
    "overall": "positive",
    "by_platform": {
      "reddit": { "positive": 65, "neutral": 25, "negative": 10, "sampleSize": 40 },
      "x": { "positive": 72, "neutral": 18, "negative": 10, "sampleSize": 25 },
      "youtube": { "positive": 78, "neutral": 15, "negative": 7, "sampleSize": 20 }
    }
  },
  "top_discussions": [...],
  "emerging_topics": ["Claude Code", "Cursor adoption", "GitHub Copilot"],
  "meta": {
    "sources_checked": 85,
    "platforms_used": ["reddit", "x", "youtube"],
    "query_time_ms": 3240,
    "proxy": { "ip": "...", "country": "US" }
  }
}
```

### `GET /api/trending` — Cross-Platform Trending Topics

```
GET /api/trending?country=US&platforms=reddit,x
```

**Pricing:** $0.10 USDC

Returns trending topics with cross-platform volume and sentiment.

## Signal Strength Classification

| Strength | Criteria |
|----------|----------|
| `established` | 3+ platforms, >1000 total engagement |
| `reinforced` | 2+ platforms, >200 total engagement |
| `emerging` | Notable spike on 1+ platform |

## x402 Payment Flow

```
AI Agent → POST /api/research → 402 { price: $1.00, walletAddress }
         → Send USDC on Solana/Base → GET with Payment-Signature header
         → 200 { intelligence report }
```

Supports: Solana (~400ms) and Base (~2s)

## Why Mobile Proxies

Reddit → 429s datacenter IPs instantly  
X/Twitter → 5-10x more headroom on mobile IPs  
YouTube → serves bot-detection content to datacenter IPs  

## Setup

```bash
git clone <repo>
cd trend-intelligence-api
cp .env.example .env
# Edit .env: set WALLET_ADDRESS + proxy credentials
bun install
bun run dev
```

```bash
# Test it
curl http://localhost:3000/health
curl http://localhost:3000/

# Research query (returns 402 - send payment first)
curl -X POST http://localhost:3000/api/research \
  -H "Content-Type: application/json" \
  -d '{"topic":"bitcoin ETF","platforms":["reddit","youtube"],"days":30}'
```

## Deploy

```bash
# Docker
docker build -t trend-intel .
docker run -p 3000:3000 --env-file .env trend-intel

# Railway / Render / Fly.io — connect repo, auto-detected Dockerfile
```

## File Structure

```
src/
  index.ts              # Server entry (cors, rate limiting, discovery)
  service.ts            # Router mounting
  payment.ts            # x402 on-chain verification (Solana + Base)
  proxy.ts              # Mobile proxy pool rotation
  routes/
    research.ts         # POST /api/research
    trending.ts         # GET /api/trending
  scrapers/
    reddit-scraper.ts   # Reddit JSON API
    x-scraper.ts        # Nitter instances + Twitter syndication API
    youtube-scraper.ts  # YouTube search page parser
  utils/
    synthesis.ts        # Pattern detection, sentiment, emerging topics
  types/
    index.ts            # TypeScript interfaces
```

## Bounty

- **Issue:** [#70](https://github.com/bolivian-peru/marketplace-service-template/issues/70)
- **Reward:** $100 in $SX tokens
- **Platform:** proxies.sx marketplace
