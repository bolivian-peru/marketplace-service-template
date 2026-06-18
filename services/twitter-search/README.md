# X/Twitter Real-Time Search API

## Overview
Search tweets by keyword/hashtag, get trending topics, extract user profiles, and monitor conversations — all without X's $42,000/year official API.

## Endpoints
```
GET /api/search?q=<keyword>&limit=<n>     - Search tweets
GET /api/trending?region=<region>           - Get trending topics
GET /api/user/<username>                    - Get user profile
GET /api/reddit/search?q=<keyword>          - Search Reddit
GET /health                                  - Health check
```

## Data Sources
- Xpoz API (free tier: 5000 credits) — recommended
- Nitter RSS (fallback, unreliable in 2026)
- Reddit JSON API (no auth required)

## Tech Stack
- Python + aiohttp
- Xpoz API / Nitter / Reddit JSON API

## Bounty
Proxies.sx Bounty #73 — $100 in $SX token
