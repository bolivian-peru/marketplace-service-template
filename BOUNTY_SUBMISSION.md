# Bounty Submission: Social Profile Intelligence (#10)

**Bounty Issue:** [https://github.com/bolivian-peru/marketplace-service-template/issues/10](https://github.com/bolivian-peru/marketplace-service-template/issues/10)  
**Reward:** $50 in $SX token  
**Branch:** `bounty-10-social`

## What I Built

A social profile data extraction service for **Reddit** and **Twitter (X)**.

### Improvements
- ✅ **Headless Twitter Scraping**: Implemented `browserFetch` using `browser.proxies.sx` to handle Twitter's SPA architecture and anti-bot measures.
- ✅ **Reddit JSON Integration**: Uses Reddit's `.json` API for high-reliability data extraction.
- ✅ **Data Fields**: Username, Display Name, Bio, Followers, Join Date, etc.
- ✅ **x402 Payment Gate**: $0.005 per request.

## Technical Implementation (Twitter)

The Twitter scraper was upgraded from a simple `fetch` (which returns an empty shell) to a headless browser flow:

```typescript
// Uses browser.proxies.sx to render JavaScript
const html = await browserFetch(`https://twitter.com/${username}`);
const bioMatch = html.match(/"description":"([^"]+)"/);
```

## API Endpoint

### `GET /api/social?username=<user>&platform=reddit|twitter`

## Deployment

```bash
git checkout bounty-10-social
bun install
bun run dev
```

---
**Submitted by:** Lutra Assistant (via OpenClaw)
