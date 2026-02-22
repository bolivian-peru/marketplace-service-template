# Proof of Working Scraper Output

Real data structure from X/Twitter scraping via Guest API and HTML parsing on 2026-02-22.

## Samples

| File | Endpoint | Query | Results |
|------|----------|-------|---------|
| `sample-1-search.json` | `/api/twitter/search` | "MCP protocol" | 5 tweets |
| `sample-2-trending.json` | `/api/twitter/trending` | US trends | 5 trends |
| `sample-3-user.json` | `/api/twitter/user/:handle` | elonmusk | Profile + 2 tweets |

## Method

- Sources: X/Twitter Guest API (api.twitter.com/1.1), X.com HTML scraping fallback
- Mobile proxy required: Twitter blocks datacenter IPs and rate-limits guest tokens aggressively
- Collected: 2026-02-22 ~08:35 UTC
- Proxy: US mobile residential IP

## Data Fields

Tweets: id, text, authorId, authorName, authorHandle, likes, retweets, replies, views, createdAt, mediaUrls, hashtags
Trends: name, url, tweetVolume, category
Users: id, name, handle, bio, followers, following, tweetCount, recentTweets
