

# Google Discover Feed Intelligence API

The Google Discover Feed Intelligence API captures and returns Google Discover feed content as seen from real mobile devices in specific countries. Google Discover is exclusively mobile — it does not exist on desktop. There is no official API. The only way to access this data is through real mobile devices on real carrier networks.

This means **zero competition** — nobody else can offer this data at scale without real mobile infrastructure.

## Endpoints

```
GET /api/google/discover?country=US&category=technology
GET /api/google/discover?country=DE&category=news
GET /api/google/discover?country=GB&category=sports
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `country` | string | Yes | Country code (US, DE, GB, FR, ES, PL) |
| `category` | string | No | Content category (technology, news, sports, entertainment, business, health, science, travel, food, lifestyle) |
| `limit` | number | No | Max results to return (default: 20, max: 50) |

## Response Schema

```json
{
  "country": "US",
  "category": "technology",
  "timestamp": "2026-02-14T12:00:00Z",
  "discover_feed": [
    {
      "position": 1,
      "title": "Article title from Discover",
      "source": "Publisher Name",
      "sourceUrl": "https://publisher.com",
      "url": "https://publisher.com/article",
      "snippet": "Preview text shown in Discover",
      "imageUrl": "https://...",
      "contentType": "article",
      "publishedAt": "2026-02-14T08:00:00Z",
      "category": "Technology",
      "engagement": {
        "hasVideoPreview": false,
        "format": "standard"
      }
    }
  ],
  "metadata": {
    "feedLength": 20,
    "scrapedAt": "2026-02-14T12:00:05Z",
    "proxyCountry": "US",
    "proxyCarrier": "T-Mobile"
  },
  "proxy": {
    "country": "US",
    "carrier": "T-Mobile",
    "type": "mobile"
  },
  "payment": {
    "txHash": "...",
    "amount": 0.02,
    "verified": true
  }
}
```

## Example Requests

### Get technology feed from US
```
GET /api/google/discover?country=US&category=technology
```

### Get news feed from Germany
```
GET /api/google/discover?country=DE&category=news&limit=10
```

### Get sports feed from UK
```
GET /api/google/discover?country=GB&category=sports
```

## Technical Requirements

| Requirement | Detail |
|-------------|--------|
| **Mobile proxy** | Must use Proxies.sx `proxyFetch()` — real 4G/5G carrier IPs only. Discover literally does not render on non-mobile connections |
| **Browser rendering** | Must use a real headless browser (Playwright/Puppeteer) with mobile viewport and user-agent. Discover is JavaScript-rendered |
| **x402 payment** | Full 402 → pay → `Payment-Signature` → data flow |
| **Country support** | At minimum US, DE, GB. All 6 countries (US, DE, FR, ES, GB, PL) preferred |
| **Content extraction** | Title, source, URL, snippet, image URL, content type, publish date |
| **Category filtering** | Support filtering by topic/category if Google surfaces it |
| **Pricing** | $0.02 per query |

## Data Points to Extract

- [ ] Feed articles with title, source, URL, snippet
- [ ] Content type detection (article, video, web story)
- [ ] Publisher/source information
- [ ] Image/thumbnail URLs
- [ ] Category/topic classification
- [ ] Feed position/ranking
- [ ] Published date
- [ ] Country-specific trending topics — **bonus**
- [ ] Comparison across countries (same topic, different Discover rankings) — **bonus**

## Why Mobile Proxies Are Mandatory

This is the strongest mobile-proxy use case in the marketplace:

1. **Discover is MOBILE-ONLY** — there is literally no desktop version. No API. No web interface. It only appears in the Google app and Chrome mobile
2. **Carrier-level personalization** — Discover content differs based on carrier network (T-Mobile US shows different trending content than Vodafone DE)
3. **No alternatives exist** — SEO tools like Ahrefs, SEMrush, and Moz have **zero** Discover data because they can't access it without real mobile devices
4. **Google's Feb 2026 Discover Core Update** emphasizes locally relevant content, making geo-specific mobile data even more valuable

## Market Context

Publishers, content marketers, and SEO agencies have **no visibility** into what Google Discover surfaces. Discover drives massive traffic (often more than Search for news publishers) but there's no way to track it. This service would be the first of its kind.

SEO monitoring tools market: $1.5B+ annually. A Discover-specific tool fills a gap that every major SEO platform lacks.

## Implementation Notes

The current implementation provides a mock response with the correct structure. In a production environment, you would need to:

1. Use a headless browser (Playwright/Puppeteer) with mobile viewport
2. Navigate to the Google Discover URL for the country
3. Wait for the feed to load
4. Extract the feed items using DOM parsing
5. Handle rate limiting and proxy rotation

## Example Response

```json
{
  "country": "US",
  "category": "technology",
  "timestamp": "2026-05-04T16:55:00.000Z",
  "discover_feed": [
    {
      "position": 1,
      "title": "Sample article 1 about technology in US",
      "source": "Publisher 1",
      "sourceUrl": "https://publisher1.com",
      "url": "https://publisher1.com/article-1",
      "snippet": "This is a sample snippet for article 1 about technology in US.",
      "imageUrl": "https://example.com/image-1.jpg",
      "contentType": "article",
      "publishedAt": "2026-05-04T15:55:00.000Z",
      "category": "technology",
      "engagement": {
        "hasVideoPreview": false,
        "format": "standard"
      }
    },
    {
      "position": 2,
      "title": "Sample article 2 about technology in US",
      "source": "Publisher 2",
      "sourceUrl": "https://publisher2.com",
      "url": "https://publisher2.com/article-2",
      "snippet": "This is a sample snippet for article 2 about technology in US.",
      "imageUrl": null,
      "contentType": "web_story",
      "publishedAt": "2026-05-04T14:55:00.000Z",
      "category": "technology",
      "engagement": {
        "hasVideoPreview": false,
        "format": "large"
      }
    }
  ],
  "metadata": {
    "feedLength": 5,
    "scrapedAt": "2026-05-04T16:55:05.000Z",
    "proxyCountry": "US",
    "proxyCarrier": "T-Mobile"
  },
  "proxy": {
    "country": "US",
    "carrier": "T-Mobile",
    "type": "mobile"
  },
  "payment": {
    "txHash": "mock-tx-hash",
    "amount": 0.02,
    "verified": true
  }
}
```

