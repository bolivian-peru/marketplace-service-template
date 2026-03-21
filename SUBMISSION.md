# Instagram Intelligence + AI Vision Analysis API
## Proxies.sx Bounty #71 — $200 in $SX token

### Live Deployment
> **Deploy to Railway/Render/Fly.io** — See deploy instructions below.
> All code is production-ready and passes TypeScript typecheck.

---

## What Was Built

A complete Instagram Intelligence API combining **mobile proxy scraping** with **GPT-4o vision analysis** — the full stack from bounty spec #71.

### Architecture
- **Runtime**: Bun + Hono (TypeScript)
- **Proxy**: Proxies.sx mobile 4G/5G (round-robin pool, auto-retry)
- **AI Vision**: GPT-4o (OpenAI) — analyzes actual post images
- **Payment**: x402 USDC on Solana + Base (on-chain verification)

---

## Endpoints

| Endpoint | Price | What It Does |
|----------|-------|--------------|
| `GET /api/instagram/profile/:username` | $0.01 | Profile data + engagement metrics |
| `GET /api/instagram/posts/:username` | $0.02 | Recent posts with full engagement data |
| `GET /api/instagram/analyze/:username` | $0.15 | **PREMIUM**: Full AI analysis (GPT-4o vision) |
| `GET /api/instagram/analyze/:username/images` | $0.08 | AI vision analysis of images only |
| `GET /api/instagram/audit/:username` | $0.05 | Fake follower + bot detection |
| `GET /api/instagram/discover` | $0.03 | Batch analyze + filter by AI attributes |

---

## AI Analysis Features (All From Bounty Spec)

### ✅ Account Type Detection
```json
{
  "account_type": {
    "primary": "influencer",
    "niche": "travel_lifestyle",
    "confidence": 0.94,
    "sub_niches": ["luxury_travel", "photography"],
    "signals": ["consistent_aesthetic", "brand_collaboration_posts_detected"]
  }
}
```
Account types: `influencer`, `business`, `personal`, `bot_fake`, `meme_page`, `news_media`

### ✅ Content Theme Detection (from actual images, not just hashtags)
```json
{
  "content_themes": {
    "top_themes": ["travel", "food", "architecture", "nature"],
    "style": "professional_photography",
    "aesthetic_consistency": "high",
    "brand_safety_score": 95,
    "content_consistency": "high"
  }
}
```

### ✅ Sentiment Analysis (image mood + caption text)
```json
{
  "sentiment": {
    "overall": "positive",
    "breakdown": { "positive": 78, "neutral": 18, "negative": 4 },
    "emotional_themes": ["aspirational", "adventurous", "joyful"],
    "brand_alignment": ["luxury", "wellness", "outdoor"]
  }
}
```

### ✅ Fake Account Detection (AI-enhanced)
```json
{
  "authenticity": {
    "score": 92,
    "verdict": "authentic",
    "face_consistency": true,
    "engagement_pattern": "organic",
    "follower_quality": "high",
    "comment_analysis": "mostly_genuine",
    "fake_signals": {
      "stock_photo_detected": false,
      "engagement_vs_followers": "healthy",
      "follower_growth_pattern": "natural",
      "posting_pattern": "consistent"
    }
  }
}
```

### ✅ Smart Filters (Discover endpoint)
```
GET /api/instagram/discover?usernames=natgeo,nike,nasa&niche=travel&min_followers=10000&account_type=influencer&sentiment=positive&brand_safe=true
```

### ✅ Brand Recommendations
```json
{
  "recommendations": {
    "good_for_brands": ["travel_agencies", "hotels", "airlines", "camera_brands"],
    "estimated_post_value": "$800-2000",
    "risk_level": "low"
  }
}
```

### ✅ Mobile Proxy IP in Response Metadata
```json
{
  "meta": {
    "proxy": {
      "ip": "174.xxx.xxx.xxx",
      "country": "US",
      "carrier": "T-Mobile",
      "type": "mobile"
    },
    "analysis_time_ms": 4200
  }
}
```

---

## Technical Implementation

### Instagram Scraping Strategy (3-Layer Fallback)
1. **Instagram JSON API** (`/api/v1/users/web_profile_info/`) — most reliable
2. **Instagram GraphQL** (`/?__a=1`) — fallback
3. **HTML page + meta tag extraction** — final fallback

All requests route through Proxies.sx mobile proxies with Instagram-authentic User-Agents:
```
Instagram 303.0.0.30.110 (iPhone14,3; iOS 17_0; en_US; ...)
```

### AI Vision Pipeline
```
Posts scraped via mobile proxy
  → Image URLs extracted (up to 12)
  → GPT-4o vision API with structured JSON prompt
  → Account type + themes + sentiment + authenticity returned
  → Brand recommendations generated
```

Uses `detail: "low"` for images (sufficient for style analysis, 10x cheaper than `high`).

### x402 Payment Flow
- Supports Solana (~400ms) and Base (~2s)
- On-chain USDC verification (no trust-the-header)
- Replay prevention (tx hash deduplication)
- Returns `X-Payment-Settled: true` header

---

## Deployment

### Railway (Recommended)
```bash
# 1. Fork/clone this repo
# 2. Create Railway project
# 3. Set environment variables:
WALLET_ADDRESS=your_solana_wallet
OPENAI_API_KEY=sk-...
PROXY_HOST=your_proxy_host
PROXY_HTTP_PORT=your_proxy_port
PROXY_USER=your_proxy_user
PROXY_PASS=your_proxy_pass
```
Railway auto-detects the Dockerfile.

### Render
Connect GitHub repo → Docker → Add env vars → Deploy

### Local Testing
```bash
cp .env.example .env
# Edit .env with your credentials
bun install
bun run dev
```

---

## Market Comparison

| Service | Price | What You Get |
|---------|-------|-------------|
| HypeAuditor | $199-499/month | Influencer analytics + fake detection |
| Modash | $199-999/month | Influencer search + analytics |
| **This service** | **$0.15/analysis** | **Full AI-powered profile + vision + authenticity** |

At $0.15 per analysis, brands can analyze **1,000 influencers for $150** vs $499/month for HypeAuditor's limited plan.

---

## Files

```
src/
  index.ts              — Server entry point, discovery JSON, middleware
  service.ts            — All 6 x402-gated endpoints
  proxy.ts              — Proxies.sx mobile proxy pool
  payment.ts            — x402 on-chain USDC verification
  scrapers/
    instagram-scraper.ts — Instagram scraping + GPT-4o vision analysis
  types/
    instagram.ts         — TypeScript interfaces
Dockerfile              — Production container (oven/bun:1.1)
.env.example            — Configuration template
```

---

## Solana Wallet Address
> Set via `WALLET_ADDRESS` env var — your USDC payments go here.
