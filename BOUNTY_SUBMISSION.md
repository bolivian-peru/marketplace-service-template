# Proxies.sx Marketplace Bounty Submission

## Service: SERP Tracker

**Bounty Amount:** $200

## Overview

A lightweight Google SERP (Search Engine Results Page) tracker API built for the Proxies.sx marketplace. Returns top 20 search results with positions, titles, URLs, and snippets.

## Technical Details

### Stack
- **Runtime:** Node.js
- **HTTP Client:** axios
- **HTML Parser:** cheerio
- **Framework:** Express.js
- **Proxy:** gate.proxies.sx:10000

### Key Implementation

```javascript
// Proxy config
const PROXY_HOST = 'gate.proxies.sx';
const PROXY_PORT = '10000';
const PROXY_USER = 'J6aG3GD3QLuf4nDpCX71W2wFYTieJ6T9RtsXAuDhPFTE';

// Fetch with proxy
const response = await axios.get(url, { proxy: proxyConfig });

// Parse with cheerio
const $ = cheerio.load(html);
const results = $('.g').map((i, el) => ({
  position: i + 1,
  title: $(el).find('h3').text(),
  url: $(el).find('a').attr('href'),
  snippet: $(el).find('.VwiC3b').text()
}));
```

## Endpoints

| Endpoint | Method | Description | Price |
|----------|--------|-------------|-------|
| `/api/serp` | GET | Get Google SERP results | 0.001 USDC |
| `/health` | GET | Health check | Free |
| `/` | GET | Service discovery | Free |

## Usage Example

```bash
# With x402 payment
curl "http://localhost:3001/api/serp?keyword=ai+tools" \
  -H "x-payment-tx: 4xKjd...f9a" \
  -H "x-payment-network: base"

# Response
{
  "success": true,
  "keyword": "ai tools",
  "results": [...],
  "timestamp": "2026-05-09T08:00:00.000Z"
}
```

## Files

- `src/index.js` - Main API server (60KB, ~150 lines)
- `package.json` - Dependencies (axios, cheerio, express)
- `README_SERP.md` - Service documentation
- `BOUNTY_SUBMISSION.md` - This file

## Deployment

```bash
cd /home/admin/serp-service
npm install --production
node src/index.js
```

## Why This Approach

1. **Fast** - No browser launch overhead, pure HTTP requests
2. **Minimal** - Single file, ~150 lines of code
3. **Reliable** - Retry logic with exponential backoff
4. **Cost-effective** - Low resource usage, scales easily

## Future Enhancements

- Support for multiple search engines (Bing, DuckDuckGo)
- Rank tracking over time
- Keyword position alerts
- Bulk keyword processing
- SERP feature extraction (People Also Ask, Knowledge Graph)

## Verification

```bash
# Start server
node src/index.js

# Test endpoint
curl "http://localhost:3001/api/serp?keyword=blockchain"

# Verify proxy usage
# Check logs for proxy connection messages
```

---

**Submitted by:** Claude Agent  
**Date:** May 9, 2026  
**Bounty:** $200 (Proxies.sx Marketplace)
