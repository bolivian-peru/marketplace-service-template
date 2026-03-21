# Submission — Trend Intelligence API (Bounty #70)

**Bounty:** $100 in $SX tokens  
**Issue:** https://github.com/bolivian-peru/marketplace-service-template/issues/70  
**Platform:** proxies.sx marketplace  

---

## What I Built

A cross-platform trend intelligence API that scrapes Reddit, X/Twitter, and YouTube **simultaneously** for any topic, then synthesizes results into structured intelligence reports with engagement-weighted scoring, pattern detection, and per-platform sentiment analysis.

This is NOT a scraper — it's a **synthesis engine** built on top of scrapers.

---

## Architecture

```
POST /api/research  →  3 scrapers run in parallel
                    →  evidence aggregated by platform
                    →  synthesis engine: patterns + sentiment + emerging topics
                    →  structured JSON intelligence report
```

### Files Built

| File | Purpose |
|------|---------|
| `src/routes/research.ts` | POST /api/research — main intelligence endpoint |
| `src/routes/trending.ts` | GET /api/trending — cross-platform trending |
| `src/scrapers/reddit-scraper.ts` | Reddit public JSON API via mobile proxy |
| `src/scrapers/x-scraper.ts` | Nitter instances + Twitter syndication API |
| `src/scrapers/youtube-scraper.ts` | YouTube search page parser (ytInitialData) |
| `src/utils/synthesis.ts` | Pattern detection, sentiment analysis, emerging topics |
| `src/types/index.ts` | TypeScript interfaces for all data types |

---

## Key Technical Features

### Pattern Detection
- Extracts bigrams and unigrams from all evidence
- Groups posts/tweets/videos by recurring phrases
- Classifies signal strength: `established` (3+ platforms, high engagement), `reinforced` (2+), `emerging` (1 platform spike)

### Engagement-Weighted Scoring
- Reddit: `score + log(comments) × 10`
- X/Twitter: `likes + retweets × 2 + replies × 0.5`
- YouTube: `views × 0.001` (views are primary signal)

### Sentiment Analysis
- 80+ word positive/negative lexicon
- Per-platform breakdown with sample size
- Overall: positive/negative/neutral/mixed

### Scraping Strategy
- Reddit: public `.json` API (no auth) via mobile proxy — bypasses 429s
- X/Twitter: Nitter instance rotation (5 instances) + Twitter syndication API fallback
- YouTube: ytInitialData JSON extraction from search page — no API key needed

### x402 Payment Flow
- Tiered pricing: $0.10 (single), $0.50 (2 platforms), $1.00 (all 3)
- On-chain verification via Solana + Base RPCs
- Replay protection via in-memory Set

---

## API Responses

### 402 Payment Required (correct x402 format)
```json
{
  "status": 402,
  "message": "Payment required",
  "resource": "/api/research",
  "price": { "amount": "1", "currency": "USDC" },
  "networks": [
    { "network": "solana", "recipient": "6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv" },
    { "network": "base", "recipient": "0xF8cD900794245fc36CBE65be9afc23CDF5103042" }
  ]
}
```

### 200 Intelligence Report (after payment)
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
        { "platform": "reddit", "title": "Switched from Cursor to Claude Code...", "score": 1243 }
      ],
      "totalEngagement": 15420
    }
  ],
  "sentiment": {
    "overall": "positive",
    "by_platform": {
      "reddit": { "positive": 65, "neutral": 25, "negative": 10, "sampleSize": 40 }
    }
  },
  "top_discussions": [...],
  "emerging_topics": ["Claude Code", "Cursor adoption", "GitHub Copilot"],
  "meta": {
    "sources_checked": 85,
    "platforms_used": ["reddit", "x", "youtube"],
    "proxy": { "ip": "...", "country": "US" }
  }
}
```

---

## Testing Results

```
✓ TypeScript compiles clean (tsc --noEmit)
✓ Server boots: http://localhost:3000
✓ GET /health → 200 OK
✓ GET / → 200 with full service discovery
✓ POST /api/research (no payment) → 402 with correct x402 structure
✓ GET /api/trending (no payment) → 402 with correct x402 structure
✓ Synthesis engine: 8 patterns detected, sentiment analysis working
✓ Cross-platform pattern detection working
✓ Engagement-weighted scoring working
```

---

## Solana USDC Wallet Address

```
6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv
```

---

## Deploy Instructions

```bash
# Railway / Render / Fly.io — connect repo, Dockerfile auto-detected
# Or:
docker build -t trend-intel .
docker run -p 3000:3000 \
  -e WALLET_ADDRESS=6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv \
  -e PROXY_HOST=... \
  -e PROXY_HTTP_PORT=... \
  -e PROXY_USER=... \
  -e PROXY_PASS=... \
  trend-intel
```

---

## Why This Wins

- **Synthesis > scraping** — this is the value proposition. Raw data → intelligence.
- **Tiered pricing** — $0.10 → $1.00 depending on research depth
- **Mobile proxies critical** — Reddit/X/YouTube all rate-limit non-mobile IPs
- **No API keys needed** — uses public endpoints + Nitter for X
- **Production ready** — proper error handling, fallbacks, TypeScript, Dockerfile
