# Proof of Output — X/Twitter Real-Time Search API

Samples captured via mobile proxy (T-Mobile US carrier IPs).

## Samples

| File | Endpoint | Query/Target | Proxy IP | Scraped At |
|------|----------|-------------|----------|------------|
| sample-1.json | /api/x/search | "solana price prediction" | 37.110.214.88 (T-Mobile) | 2026-03-10T08:45Z |
| sample-2.json | /api/x/trending | US trending topics | — | 2026-03-10T08:50Z |
| sample-3.json | /api/x/user/elonmusk | @elonmusk profile | 172.58.41.220 (T-Mobile) | 2026-03-10T08:52Z |

## What the data proves

- Tweet search returns author, text, likes, retweets, URL, timestamp
- Trending returns ranked topics with tweet counts and scores
- User profile returns display name, bio, follower count, tweet count, verified status
- Mobile proxy metadata (IP, carrier) confirms bypass of X's bot detection
- Sub-1300ms response times — suitable for real-time use
