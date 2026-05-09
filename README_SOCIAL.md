# Social Intel Service

Social media intelligence API that aggregates data from Twitter/X and Reddit with sentiment analysis, engagement metrics, and trending topics detection.

## Features

- **Multi-Platform Aggregation**: Fetches data from Twitter/X and Reddit in parallel
- **Sentiment Analysis**: Keyword-based sentiment scoring (positive/negative/neutral)
- **Engagement Metrics**: Tracks likes, retweets, comments, and scores
- **Trending Topics**: Identifies trending hashtags and topics
- **Profile Intelligence**: Twitter and Reddit user profile analysis
- **x402 Micropayments**: USDC payment via Solana or Base network
- **Mobile Proxy**: Uses real 4G/5G mobile proxies for reliable access

## API Endpoints

### Social Intelligence

```
GET /api/intel?query=<topic>&twitterLimit=20&redditLimit=20
```

Aggregated social media intelligence for a topic/keyword.

**Parameters:**
- `query` (required): Topic/keyword to search
- `twitterLimit` (optional, default: 20, max: 50): Max Twitter results
- `redditLimit` (optional, default: 20, max: 50): Max Reddit results

**Response:**
```json
{
  "query": "bitcoin",
  "posts": [
    {
      "id": "1234567890",
      "platform": "twitter",
      "author": "@elonmusk",
      "text": "Post content...",
      "url": "https://x.com/...",
      "likes": null,
      "retweets": null,
      "comments": null,
      "score": null,
      "engagementScore": 85,
      "sentiment": "positive",
      "sentimentScore": 0.8,
      "publishedAt": "2024-01-15T12:00:00Z",
      "hashtags": ["#bitcoin", "#crypto"],
      "mentions": ["@satoshi"]
    }
  ],
  "summary": {
    "totalPosts": 40,
    "twitterCount": 20,
    "redditCount": 20,
    "avgEngagement": 45.5,
    "sentimentBreakdown": { "positive": 15, "negative": 5, "neutral": 20 },
    "topHashtags": [{ "tag": "#bitcoin", "count": 12 }],
    "trendingTopics": ["bitcoin", "crypto", "btc"]
  },
  "timestamp": "2024-01-15T12:00:00Z",
  "proxy": { "country": "US", "type": "mobile" },
  "payment": { "txHash": "...", "network": "solana", "amount": "0.005", "settled": true }
}
```

### Twitter Profile Intel

```
GET /api/intel/twitter/:username
```

Get Twitter/X profile intelligence with recent posts and engagement.

### Reddit User Intel

```
GET /api/intel/reddit/user/:username
```

Get Reddit user profile analysis with recent posts.

### Trending Topics

```
GET /api/intel/trending?limit=10
```

Get trending topics with sentiment analysis.

## Pricing

| Endpoint | Price |
|----------|-------|
| `/api/intel` | 0.005 USDC |
| `/api/intel/twitter/:username` | 0.005 USDC |
| `/api/intel/reddit/user/:username` | 0.005 USDC |
| `/api/intel/trending` | 0.01 USDC |

## Payment

x402 micropayment protocol supported:
- **Solana**: USDC via Solana network
- **Base**: USDC via Base (Ethereum L2)

Include payment headers:
```
Payment-Network: solana
Payment-Tx: <transaction_hash>
```

## Setup

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your wallet and proxy credentials

# Run development server
bun run dev

# Run production
bun run start
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `WALLET_ADDRESS` | Solana wallet for USDC payments | Yes |
| `WALLET_ADDRESS_BASE` | Base wallet (defaults to SOL address) | No |
| `PROXY_HOST` | Proxy server host | Yes |
| `PROXY_HTTP_PORT` | Proxy server port | Yes |
| `PROXY_USER` | Proxy authentication user | Yes |
| `PROXY_PASS` | Proxy authentication password | Yes |
| `PORT` | Server port (default: 3000) | No |
| `RATE_LIMIT` | Requests per minute (default: 60) | No |

## Testing

```bash
# Health check
curl localhost:3000/health

# Service discovery
curl localhost:3000/

# Test endpoint (returns 402 payment required)
curl "localhost:3000/api/intel?query=bitcoin"
```

## Architecture

```
src/
├── scrapers/
│   └── social-intel.ts     # Main scraper with Twitter/Reddit aggregation
├── routes/
│   └── social-intel.ts     # API routes and payment handling
├── service.ts              # Main service router
├── proxy.ts                # Proxy configuration
├── payment.ts             # x402 payment verification
└── index.ts               # Server entry point
```

## License

MIT
