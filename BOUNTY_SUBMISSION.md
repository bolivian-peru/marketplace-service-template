# Bounty Submission: Trend Intelligence (Bounty #70)

**PR:** https://github.com/bolivian-peru/marketplace-service-template/pull/192
**Branch:** `bounty-70-trend-intelligence`

## What I built

A production-ready **Trend Intelligence API** that synthesizes research across **Reddit, X/Twitter, YouTube, and the Web**. It uses **engagement-weighted scoring** and **cross-platform pattern detection** to identify emerging trends, all protected by an **x402 (USDC) payment gate**.

### Endpoint
- `GET /api/research?topic=<topic>&timeframe=24h|7d|30d`

### Output Features
- **Cross-Platform Results:** Aggregated data from Reddit, X, YouTube, and Google News.
- **Engagement Scoring:** Posts are ranked using a weighted formula (Comments > Shares > Likes > Views).
- **Pattern Detection:** Identifies trends appearing on 2+ platforms simultaneously.
- **Sentiment Analysis:** Provides overall sentiment (Positive/Negative/Neutral) for the topic.
- **Proxy Metadata:** Includes proxy exit IP and country (using Proxies.sx mobile proxies).

## Implementation Details

### Scrapers
1. **Reddit:** Scrapes `reddit.com/search.json` for real-time discussions.
2. **X/Twitter:** Uses Nitter as a robust public proxy for scraping without API keys.
3. **YouTube:** Extracts `ytInitialData` from search results for video metrics.
4. **Web (Google News):** Scrapes `google.com/search?tbm=nws` for news articles.

### Scoring Formula
`score = (likes * 1) + (comments * 2) + (shares * 3) + (views * 0.01)`

## Reviewer Requirements Checklist

1. **Cross-platform synthesis** ✅
   - Combined data from 4 major platforms in a single request.
2. **Engagement-weighted ranking** ✅
   - Results are sorted by a custom engagement score.
3. **Pattern detection (2+ platforms)** ✅
   - Trends are only flagged if they appear on multiple platforms.
4. **Proxy metadata in response** ✅
   - Paid `200` responses include `proxy.exit_ip` and `proxy.country`.

## How to Test

### 1) Health + Discovery
```bash
curl -sS http://localhost:3000/health
curl -sS http://localhost:3000/
```

### 2) Expected x402 Flow (HTTP 402)
```bash
curl -i "http://localhost:3000/api/research?topic=Bitcoin"
```

### 3) Proof Script
A proof script is included to run the research and save JSON evidence:

```bash
# Install dependencies
npm install

# Run research for a topic
npx tsx scripts/proof-trend.ts "Bitcoin"
# Writes results to: listings/trend-proof-<timestamp>.json
```

## Notes
- Deployment ready for Render/Vercel.
- Requires `WALLET_ADDRESS` in `.env`.
- Optimized for **Proxies.sx mobile proxies** to bypass anti-scraping measures.
