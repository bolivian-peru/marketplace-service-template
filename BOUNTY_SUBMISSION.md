# Bounty Submission: Instagram Intelligence + AI Vision Analysis API (Bounty #71)

**Issue:** https://github.com/bolivian-peru/marketplace-service-template/issues/71
**Branch:** `fix/issue-71`
**Bounty:** $200 in $SX token

## What Was Built

A full **Instagram Intelligence + AI Vision Analysis API** implementing all requirements from the bounty issue:

### Endpoints (all x402-gated with Solana USDC)

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/instagram/profile/:username` | $0.01 | Profile metrics: followers, engagement rate, posting frequency, bio |
| `GET /api/instagram/posts/:username` | $0.02 | Recent posts: captions, likes, comments, hashtags, timestamps |
| `GET /api/instagram/analyze/:username` | $0.15 | Full analysis: profile + posts + AI vision (account type, themes, sentiment, authenticity) |
| `GET /api/instagram/analyze/:username/images` | $0.08 | AI vision analysis of post images only |
| `GET /api/instagram/audit/:username` | $0.05 | Authenticity audit: fake follower detection, bot signals |
| `POST /api/instagram/filter` | $0.05 | **Smart filtering by AI-derived attributes** |

### AI Vision Analysis (GPT-4o / Claude / heuristic fallback)

Each full analysis returns:
- **Account type detection**: influencer / business / personal / bot_fake / meme_page / news_media
- **Content themes**: top 5 themes, visual style, aesthetic consistency, brand safety score
- **Sentiment analysis**: overall + breakdown (positive/neutral/negative %) + emotional themes
- **Authenticity scoring**: 0–100 score + verdict + face consistency + engagement pattern + bot signals
- **Brand recommendations**: good-for-brands list, estimated post value, risk level

### Smart Filtering Endpoint (`POST /api/instagram/filter`)

Filter a batch of up to 10 usernames by AI-derived attributes:
```json
{
  "usernames": ["cristiano", "natgeo", "someaccount"],
  "filters": {
    "account_type": "influencer",
    "min_followers": 100000,
    "min_engagement_rate": 2.5,
    "min_authenticity_score": 60,
    "max_risk_level": "medium",
    "niche": "fitness",
    "content_theme": "travel",
    "min_brand_safety_score": 70,
    "is_verified": true
  }
}
```

### Mobile Proxy + IP Metadata

All paid responses include proxy metadata:
```json
{
  "meta": {
    "proxy": { "country": "US", "type": "mobile" }
  }
}
```

### Infrastructure

- **Mobile proxy routing**: All Instagram requests go through `proxyFetch()` (Proxies.sx carrier IPs)
- **x402 payment flow**: Standard `extractPayment` → `verifyPayment` → `build402Response` pattern
- **Solana USDC**: `WALLET_ADDRESS` env var, verified on-chain
- **Rate limiting**: 20 proxy requests/min per IP (protects quota)

## Changes Made

1. **`src/scrapers/instagram-scraper.ts`** — Full implementation:
   - `getProfile(username)` — profile scraping via Instagram API + HTML fallback
   - `getPosts(username, limit)` — post extraction with engagement metrics
   - `analyzeProfile(username)` — full analysis orchestrator
   - `analyzeImages(username)` — image-only AI vision
   - `auditProfile(username)` — authenticity audit
   - AI vision: OpenAI GPT-4o → Anthropic Claude → heuristic fallback chain

2. **`src/service.ts`** — Integrated Instagram routes:
   - 5 existing Instagram endpoints (profile, posts, analyze, images, audit)
   - **NEW**: `POST /api/instagram/filter` — smart batch filtering by AI attributes
   - Fixed TypeScript error in SERP tracker call

## How to Test

```bash
# 402 response (no payment) — shows schema + pricing
curl -i "localhost:3000/api/instagram/profile/cristiano"

# Smart filter (batch 402 first)
curl -i -X POST "localhost:3000/api/instagram/filter" \
  -H "Content-Type: application/json" \
  -d '{"usernames":["cristiano"],"filters":{"min_followers":1000000}}'
```

## Reviewer Checklist

- [x] Mobile proxy routing via `proxyFetch` (carrier IPs for Instagram)
- [x] AI vision model integration (GPT-4o / Claude / heuristic fallback)
- [x] Account type detection (influencer/business/personal/bot_fake/meme_page/news_media)
- [x] Sentiment analysis (visual + caption data)
- [x] Authenticity scoring (visual + engagement signals)
- [x] Smart filtering by AI-derived attributes (`POST /api/instagram/filter`)
- [x] x402 payment flow on all endpoints
- [x] Solana USDC micropayments ($0.01–$0.15/endpoint)
- [x] Mobile proxy IP metadata in all responses
- [x] TypeScript compiles clean (`bun run typecheck`)
