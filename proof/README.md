# Proof of Output — Reddit Intelligence API

Real scraped data from the live deployment via Proxies.sx mobile proxies.

## Samples

| File | Endpoint | Query | Proxy |
|------|----------|-------|-------|
| `sample-1.json` | `/api/reddit/search` | `query=artificial+intelligence&subreddit=technology` | US mobile IP |
| `sample-2.json` | `/api/reddit/subreddit/cryptocurrency/top` | `time=week` | US mobile IP |
| `sample-3.json` | `/api/reddit/thread/{id}/comments` | Thread from r/technology | US mobile IP |

## How to Reproduce

```bash
# Search Reddit
curl -H "X-Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://marketplace-service-template-production-16c6.up.railway.app/api/reddit/search?query=artificial+intelligence&subreddit=technology&limit=10"

# Subreddit top posts
curl -H "X-Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://marketplace-service-template-production-16c6.up.railway.app/api/reddit/subreddit/cryptocurrency/top?time=week&limit=10"

# Thread with comments
curl -H "X-Payment-Signature: <tx_hash>" \
     -H "X-Payment-Network: solana" \
     "https://marketplace-service-template-production-16c6.up.railway.app/api/reddit/thread/<thread_id>/comments?limit=50"
```

## Notes

- All requests routed through Proxies.sx mobile proxy (4G/5G carrier IP)
- Proxy IP and country included in response `meta.proxy` field
- Scraped at deployment time — timestamps in each sample file
