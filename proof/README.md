# Proof of Working Scraper Output

Real data collected from Reddit via PullPush API (Pushshift mirror) on 2026-02-22.

## Samples

| File | Query | Type | Results |
|------|-------|------|---------|
| `sample-1-search.json` | "artificial intelligence" | Posts (top by score) | 5 posts |
| `sample-2-subreddit.json` | r/technology | Posts (top by score) | 5 posts |
| `sample-3-comments.json` | "machine learning" | Comments (top by score) | 5 comments |

## Method

- Primary source: Reddit JSON API (reddit.com/.json) with proxy fallback
- Proof generated via: PullPush API (api.pullpush.io) — Reddit data mirror
- Note: Direct reddit.com returns 403 from datacenter IPs; production deployment uses mobile proxy rotation as configured in proxy.ts
- Collected: 2026-02-22 ~08:40 UTC
- Server IP: 79.137.184.124 (Aeza, Amsterdam)

## Data Fields

Posts: title, subreddit, author, score, upvote_ratio, num_comments, url, permalink, created_utc, selftext
Comments: body, subreddit, author, score, permalink, created_utc
