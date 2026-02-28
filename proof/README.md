# Proof of Output — Reddit Intelligence API

Real data collected through US mobile proxy on 2026-02-26T13:40:28.829412+00:00

## Proxy Details
- Exit IP: 172.56.168.66 (US T-Mobile mobile carrier)
- Provider: Proxies.sx
- Payment TX: 0x879b6e3a39e74bd65635a588231472887b8f45417d248b9c47425d0d1d906ecf (Base L2 USDC)

## Queries Executed

### sample-1.json — Reddit Search
- Endpoint: `/reddit/search`
- Query: "artificial intelligence"
- Sort: hot | Time: week
- Results: 5 posts

### sample-2.json — Subreddit Posts
- Endpoint: `/reddit/subreddit/technology`
- Subreddit: r/technology
- Sort: hot
- Results: 5 posts

### sample-3.json — Trending (r/popular)
- Endpoint: `/reddit/trending`
- Source: r/popular (Reddit's global trending feed)
- Results: 5 posts

## Data Quality
- All responses contain real, populated Reddit post data
- Scores, comment counts, authors, and subreddit names are live
- Proxy IP verified in meta.proxyIp field
- All posts are real and verifiable via their URLs
