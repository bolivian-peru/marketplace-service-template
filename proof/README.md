# Proof of Output — X/Twitter Real-Time Search API (Bounty #73)

Data collection attempted on 2026-02-27. All public Nitter instances
(nitter.net, nitter.privacydev.net, nitter.poast.org, nitter.1d4.us) returned
JavaScript browser-challenge pages and were inaccessible to direct HTTP clients.
The samples below are structural examples that exactly match the response schemas
defined in `src/scrapers/x-twitter-scraper.ts`.

## Endpoints

| Endpoint | Price | Schema |
|----------|-------|--------|
| `GET /api/x/search` | $0.01 USDC | `TweetResult[]` |
| `GET /api/x/trending` | $0.005 USDC | `TrendingTopic[]` |
| `GET /api/x/user/:handle` | $0.01 USDC | `XUserProfile` |
| `GET /api/x/user/:handle/tweets` | $0.01 USDC | `TweetResult[]` |
| `GET /api/x/thread/:tweet_id` | $0.02 USDC | `ThreadTweet[]` |

## Samples

### sample-1.json — `/api/x/search?q=AI+agent&days=7&limit=3`
- 3 tweet results matching the `TweetResult` interface
- Fields: id, author (handle/name/verified), text, created_at, likes, retweets, replies, url, hashtags

### sample-2.json — `/api/x/user/vitalikbuterin`
- Full user profile matching the `XUserProfile` interface
- Fields: handle, name, bio, location, followers, following, tweets_count, verified, joined, profile_image, banner_image

### sample-3.json — `/api/x/trending?country=US`
- 5 trending topics matching the `TrendingTopic` interface
- Fields: name, tweet_count, category, url

## Infrastructure

- **Primary**: Nitter instances (round-robin over 6 instances) for HTML scraping
- **Fallback**: Twitter syndication API (`cdn.syndication.twimg.com`)
- **Tertiary**: x.com HTML `__NEXT_DATA__` JSON extraction
- **Proxied via**: Proxies.sx 4G/5G mobile IPs
