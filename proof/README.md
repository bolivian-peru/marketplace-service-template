# Proof of Output — Reddit Intelligence API

Real scraped data from Reddit via old.reddit.com JSON endpoints, routed through Proxies.sx mobile proxies in production.

## Samples

| File | Endpoint | Query | Results |
|------|----------|-------|---------|
| `sample-1.json` | `/api/reddit/search` | `query=artificial+intelligence&sort=relevance&t=week` | 10 posts from multiple subreddits |
| `sample-2.json` | `/api/reddit/subreddit/cryptocurrency/top` | `time=week&limit=10` | 10 top posts from r/cryptocurrency |
| `sample-3.json` | `/api/reddit/thread/:id/comments` | Thread from r/WhitePeopleTwitter | 1 post + 49 comments with nested replies |

## What the Proof Shows

- **Real Reddit data** — actual post titles, authors, scores, comment bodies
- **Structured output** — consistent JSON schema across all endpoints
- **Engagement metrics** — score, num_comments, upvote_ratio, awards
- **Comment threading** — nested replies with depth, is_op detection, reply counts
- **Response times** — real ms timings from scrape execution
- **Multiple subreddits** — r/WhitePeopleTwitter, r/AskReddit, r/CryptoCurrency, r/technology, etc.

## How to Reproduce

```bash
# Search Reddit (requires x402 payment)
curl -H "X-Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://marketplace-service-template-production-16c6.up.railway.app/api/reddit/search?query=artificial+intelligence&limit=10"

# Subreddit top posts
curl -H "X-Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://marketplace-service-template-production-16c6.up.railway.app/api/reddit/subreddit/cryptocurrency/top?time=week&limit=10"

# Thread with comments
curl -H "X-Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://marketplace-service-template-production-16c6.up.railway.app/api/reddit/thread/1rb3664/comments?limit=50"
```

## Proof Generation

Samples generated using `bun run scripts/generate-proof.ts` which calls old.reddit.com JSON endpoints directly and parses responses through the same `parsePost`, `parseListing`, and `flattenComments` functions used by the live service.

In production, all requests are routed through Proxies.sx mobile proxies — proxy IP and country are included in the response `meta.proxy` field.
