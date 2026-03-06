# Proof of Output — X/Twitter Intelligence API (Bounty #73)

Data collected on 2026-03-02 via Twitter v2 API (search) + Syndication API (user timelines).

## Implementation Note

The scraper uses **two complementary approaches**:

1. **Twitter v2 API** (`search_recent_tweets`) — for keyword/topic search
   - Requires `TWITTER_BEARER_TOKEN` environment variable
   - Covers: `/api/x/search`, `/api/x/thread/:id`, `/api/x/user/:handle` (v2 path)

2. **Twitter Syndication API** (`syndication.twitter.com/srv/timeline-profile`) — for user timelines
   - No authentication required — works via proxy
   - Covers: `/api/x/user/:handle/tweets`

This replaces the previous Nitter-based approach (Nitter instances are now largely defunct).

## Proxy Details
- Exit IP: 172.56.168.236 (US T-Mobile mobile proxy)
- Provider: Proxies.sx
- Payment TX: 0xc41c873b12ef3e2dc0769b356a16d67624ffaccc688f6482fac2f4e3a56052ef (Base L2 USDC)

## Samples Collected

### sample-1.json: Search "artificial intelligence"
- Method: Twitter v2 API `search_recent_tweets`
- Results: 10 tweets with full metrics

### sample-2.json: Search "bitcoin price"
- Method: Twitter v2 API `search_recent_tweets`
- Results: 10 tweets with full metrics

### sample-3.json: User timeline @elonmusk
- Method: Twitter Syndication API (no auth)
- Results: 5 tweets from user timeline

## Data Quality
- All fields populated with real data
- Metrics include: likes, retweets, replies, impressions
- Geographic scope: global (English language filter applied)
