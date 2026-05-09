/**
 * SERP Service - Skill File
 * For AI agents to discover and use this service
 * 
 * Price: 0.003 USDC per query
 * Payment: Solana or Base USDC transfer
 */

# SERP Tracker Service

Scrape Google search results (top 20) via real 4G/5G mobile proxies.

## Endpoint

```
GET /api/serp?query=<search_term>&location=<optional_location>
```

## Price
- **0.003 USDC** per request
- Pay via Solana or Base USDC

## Payment Instructions

Send USDC to service wallet, then retry with transaction hash:

```javascript
// Send 0.003 USDC on Solana or Base
// Then request with headers:
headers: {
  'Payment-Signature': '<your_tx_hash>',
  'X-Payment-Network': 'solana' // or 'base'
}
```

## Response Schema

```json
{
  "query": "search term",
  "results": {
    "organic": [
      {
        "position": 1,
        "title": "Result Title",
        "url": "https://example.com",
        "snippet": "Description text...",
        "sitelinks": [],
        "date": null
      }
    ],
    "ads": [],
    "peopleAlsoAsk": [],
    "featuredSnippet": null,
    "aiOverview": null,
    "mapPack": [],
    "knowledgePanel": null,
    "relatedSearches": []
  },
  "meta": {
    "location": null,
    "num": 10,
    "proxy": {
      "ip": "x.x.x.x",
      "country": "US",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "...",
    "network": "solana",
    "amount": 0.003,
    "settled": true
  }
}
```

## Example

```bash
# Without payment (returns 402 with payment instructions)
curl "http://localhost:3000/api/serp?query=coffee+shops"

# With payment
curl -H "Payment-Signature: <tx_hash>" \
     "http://localhost:3000/api/serp?query=coffee+shops"
```

## Use Cases

- Competitive analysis
- SEO tracking
- Brand monitoring
- Market research
