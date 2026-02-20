# BUILD PLAN: Trend Intelligence API (Bounty #70)

## Overview

A cross-platform research API that scrapes Reddit and the web (MVP), then synthesizes results
into structured intelligence reports with engagement-weighted scoring and pattern detection.

**Bounty:** $100 in $SX token
**Issue:** https://github.com/bolivian-peru/marketplace-service-template/issues/70
**Stack:** TypeScript, Bun, Hono, x402 payment flow (matches existing template)

---

## Architecture

```
POST /api/research        - Cross-platform synthesis (tier: $0.10 / $0.50 / $1.00 USDC)
GET  /api/trending        - Trending topics by country/platform ($0.10 USDC)
```

### Request/Response

**POST /api/research**
```json
{
  "topic": "AI coding assistants",
  "platforms": ["reddit", "web"],
  "days": 30,
  "country": "US"
}
```

**GET /api/trending**
```
?country=US&platforms=reddit,web
```

### Pricing Tiers (matches bounty spec)
- Single platform: $0.10 USDC
- Cross-platform synthesis (2-3 platforms): $0.50 USDC
- Full report (all platforms + synthesis): $1.00 USDC

---

## File Map

```
src/
  routes/
    research.ts        - POST /api/research handler
    trending.ts        - GET /api/trending handler
  scrapers/
    reddit.ts          - Reddit JSON API scraper (no auth needed)
    web.ts             - DuckDuckGo/Bing web trend scraper
  analysis/
    sentiment.ts       - Word-list sentiment scoring (no external API)
    patterns.ts        - Cross-platform pattern detection
  types/
    index.ts           - Extended with trend intelligence types (additive)
  service.ts           - Mount new routes here
```

---

## Detailed Component Specs

### 1. `src/scrapers/reddit.ts`

Uses `reddit.com/search.json` and `/r/all/hot.json` - both public, no API key needed.

**Functions:**
- `searchReddit(topic, days, limit)` - search posts by topic, filter by recency
- `getRedditTrending(country, limit)` - fetch hot posts from r/all
- Returns `RedditPost[]` with: title, subreddit, score, numComments, url, created, selftext

**URLs:**
- `https://www.reddit.com/search.json?q={topic}&sort=top&t=month&limit=50`
- `https://www.reddit.com/r/all/hot.json?limit=50`
- Headers: `User-Agent: TrendBot/1.0` (Reddit requires non-empty UA)

### 2. `src/scrapers/web.ts`

Scrapes DuckDuckGo HTML search results (no API key, lighter than Google).

**Functions:**
- `searchWeb(topic, days, limit)` - fetch and parse DDG search results
- `getTrendingWeb(country, limit)` - Google Trends RSS feed (public, no auth)

**Sources:**
- DuckDuckGo: `https://html.duckduckgo.com/html/?q={topic}`
- Google Trends RSS: `https://trends.google.com/trends/trendingsearches/daily/rss?geo={country}`

### 3. `src/analysis/sentiment.ts`

Word-list approach. No external API. Fast, deterministic, good enough for MVP.

**Word lists:**
- Positive: love, great, amazing, excellent, best, perfect, helpful, recommend, brilliant, works, solved...
- Negative: hate, terrible, broken, worst, awful, disappointing, scam, waste, failed, bug, crash...
- Neutral: interesting, okay, fine, average, decent, mixed...

**Scoring:** (positiveCount - negativeCount) / totalWords
- > 0.05: positive
- < -0.05: negative
- otherwise: neutral

**Output:** `{ overall: 'positive' | 'neutral' | 'negative', score: number, positive: number, neutral: number, negative: number }`

### 4. `src/analysis/patterns.ts`

Cross-platform pattern detection. Core of the intelligence layer.

**Algorithm:**
1. Extract keywords from each platform's results (TF-IDF simplified: word frequency weighted by engagement)
2. Find keywords appearing across multiple platforms = "signal"
3. Score signal strength:
   - Established: keyword in 3+ platforms, high engagement
   - Reinforced: keyword in 2+ platforms, moderate engagement
   - Emerging: keyword in 1 platform, engagement velocity spike
4. Group evidence by pattern keyword
5. Return top N patterns with source evidence

**Key functions:**
- `extractKeywords(posts, platform)` - tokenize, remove stopwords, frequency + engagement weight
- `detectPatterns(platformResults)` - find cross-platform signals
- `classifyStrength(signal)` - established/reinforced/emerging

### 5. `src/routes/research.ts`

POST /api/research with three payment tiers:

```typescript
// Tier detection from request body
const tier = platforms.length >= 3 ? 1.00 : platforms.length >= 2 ? 0.50 : 0.10;
```

Flow:
1. Extract + verify payment (reuse existing `extractPayment`/`verifyPayment`)
2. Parse request body (topic, platforms, days, country)
3. Scrape in parallel: `Promise.allSettled([scrapeReddit(...), scrapeWeb(...)])`
4. Run sentiment analysis per platform
5. Run pattern detection across platforms
6. Return structured intelligence report

### 6. `src/routes/trending.ts`

GET /api/trending - simpler, always $0.10 USDC.

Fetches trending topics from each requested platform, runs basic pattern detection,
returns deduplicated trending list with engagement scores.

---

## Integration: `src/service.ts`

Add at bottom of existing service.ts:

```typescript
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';

serviceRouter.route('/research', researchRouter);
serviceRouter.route('/trending', trendingRouter);
```

Wait - the service uses `serviceRouter` exported as Hono instance. New routes go directly on it:

```typescript
serviceRouter.post('/research', researchHandler);
serviceRouter.get('/trending', trendingHandler);
```

---

## Type Additions (`src/types/index.ts`)

New interfaces to add:

```typescript
// Platform types
export type Platform = 'reddit' | 'web' | 'x' | 'youtube';
export type SignalStrength = 'established' | 'reinforced' | 'emerging';
export type Sentiment = 'positive' | 'neutral' | 'negative';

// Scraper output
export interface RedditPost { ... }
export interface WebResult { ... }

// Analysis output
export interface SentimentScore { ... }
export interface TrendPattern { ... }

// API response
export interface ResearchResponse { ... }
export interface TrendingResponse { ... }
```

---

## MVP vs Stretch

**MVP (building now):**
- Reddit scraper (public JSON API)
- Web scraper (DuckDuckGo HTML + Google Trends RSS)
- Sentiment analysis (word lists)
- Pattern detection (keyword frequency + cross-platform)
- Both endpoints wired with x402 payment

**Stretch:**
- X/Twitter (requires more careful proxy rotation)
- YouTube (search + transcript via yt-dlp or captions API)
- Smarter NLP (bigram extraction, named entity recognition)
- Caching layer (Redis or in-memory LRU)

---

## Proxy Usage

Reddit and DuckDuckGo are both relatively tolerant but will 429 on rapid requests from
datacenter IPs. Route through `proxyFetch` from `src/proxy.ts` exactly as the existing scrapers do.

Reddit-specific: set `User-Agent` to something non-empty or you get a 429 immediately.

---

## Submission Checklist

- [ ] POST /api/research working with real Reddit + web data
- [ ] GET /api/trending working
- [ ] Pattern detection returning cross-platform signals
- [ ] Sentiment scoring per platform
- [ ] x402 payment gates at correct tiers
- [ ] Proof-of-concept output for 2+ topics
- [ ] Build compiles clean with `bun run typecheck`

---

*Built by xavier-fuentes-ai for bolivian-peru/marketplace-service-template bounty #70*
