# Social Intel Service - Bounty Submission

**Bounty**: Social Media Intelligence Service ($100)
**Service Name**: social-intel
**Repository**: https://github.com/bolivian-peru/marketplace-service-template
**Output Location**: `/home/admin/social-intel-service/`

## What Was Built

A Social Intel service that aggregates social media data from Twitter/X and Reddit with:

1. **Multi-Platform Data Aggregation**
   - Twitter/X posts via SearXNG search engine aggregation
   - Reddit posts via Reddit's public JSON API
   - Parallel fetching for improved performance

2. **Sentiment Analysis**
   - Keyword-based sentiment scoring (positive/negative/neutral)
   - Configurable word lists for crypto, trading, and general sentiment
   - Normalized sentiment scores (-1 to 1)

3. **Engagement Metrics**
   - Engagement score calculation based on platform-specific metrics
   - Comment/reply counts for Reddit
   - Rank-based scoring for Twitter search results

4. **Trending Topics Detection**
   - Hashtag extraction and frequency analysis
   - Topic trending from Reddit's hot posts
   - Sentiment analysis per trending topic

5. **Profile Intelligence**
   - Twitter user profile lookup and analysis
   - Reddit user post history and engagement
   - Sentiment breakdown per user

6. **x402 Micropayments**
   - USDC payment via Solana network
   - USDC payment via Base network
   - Payment verification before data delivery

7. **Mobile Proxy Integration**
   - Uses Proxies.sx mobile proxy (gate.proxies.sx:10000)
   - Real 4G/5G IP addresses for reliable social media access
   - Proxy metadata in response (country, type)

## API Endpoints

| Endpoint | Method | Price | Description |
|----------|--------|-------|-------------|
| `/api/intel` | GET | 0.005 USDC | Aggregated social intel for a topic |
| `/api/intel/twitter/:username` | GET | 0.005 USDC | Twitter profile intelligence |
| `/api/intel/reddit/user/:username` | GET | 0.005 USDC | Reddit user analysis |
| `/api/intel/trending` | GET | 0.01 USDC | Trending topics with sentiment |

## Files Created

```
social-intel-service/
├── README_SOCIAL.md                    # Service documentation
├── BOUNTY_SUBMISSION.md                # This file
├── .env                                # Environment configuration
└── src/
    ├── scrapers/
    │   └── social-intel.ts             # Main scraper module
    └── routes/
        └── social-intel.ts             # API routes with payment handling
```

## Files Modified

```
social-intel-service/
├── src/
│   ├── service.ts                      # Added social intel routes
│   └── index.ts                        # Updated health check & discovery
└── .env                                # Configured proxy credentials
```

## Testing

```bash
# Health check
curl localhost:3000/health

# Service discovery
curl localhost:3000/

# Test without payment (returns 402)
curl "localhost:3000/api/intel?query=bitcoin"

# With payment headers
curl -H "Payment-Network: solana" \
     -H "Payment-Tx: <tx_hash>" \
     "localhost:3000/api/intel?query=crypto"
```

## Technical Implementation

### Twitter/X Data
- Uses SearXNG meta-search engine with Google, Bing, DuckDuckGo engines
- Filters for x.com and twitter.com URLs
- Extracts tweet IDs, author handles, hashtags, mentions
- Engagement scoring based on search result rank

### Reddit Data
- Uses Reddit's public JSON API (no auth required)
- Searches by keyword with time filters (day/week/month/year)
- Extracts scores, comments, upvote ratios
- Filters by recent posts (configurable days)

### Sentiment Analysis
- Positive keywords: bullish, gains, profit, love, amazing, etc.
- Negative keywords: scam, rugpull, dump, crash, fail, etc.
- Score normalized to -1 to 1 range
- Applied to combined title + content text

### Rate Limiting
- In-memory rate limiting per IP
- 20 requests/minute to protect proxy quota
- Cleanup of expired rate limit entries every 5 minutes

## Deployment

```bash
cd /home/admin/social-intel-service
bun install
bun run start
```

## Notes

- Proxy credentials: gate.proxies.sx:10000 with provided auth
- Payment wallet: 6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv (Solana)
- Payment wallet Base: 0xF8cD900794245fc36CBE65be9afc23CDF5103042
- Server runs on port 3000 by default
