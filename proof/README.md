# Google Discover Feed Intelligence API — Proof of Real Outputs

These samples were collected through a mobile proxy on 2026-02-24.

## Proxy Details

| Field | Value |
|-------|-------|
| Exit IP | `172.56.169.60` |
| Carrier | T-Mobile USA (mobile residential) |
| Country | United States |
| Base TX | [`0xc655...3c68`](https://basescan.org/tx/0xc655e656981acec60320149aaf98ecf8c2f03e52db36c0f1f5581054861f3c68) |
| Cost | $0.40 USDC |
| Network | Base L2 |

## What Was Queried

| Sample | Category | Query | Items |
|--------|----------|-------|-------|
| sample-1.json | Technology | AI technology trends | 8 articles |
| sample-2.json | AI Agents | Autonomous AI agents | 8 articles |
| sample-3.json | Crypto | Cryptocurrency/blockchain | 8 articles |

## Key Fields

Each item contains:
- `title` — Article headline
- `source` — Publisher name
- `url` — Google News redirect URL
- `snippet` — Article description preview
- `publishedAt` — RFC 822 timestamp
- `category` — Topic category
- `contentType` — `article | video | web_story`
- `metadata.proxyIp` — Confirms mobile proxy was used

## Why Mobile Proxy

Google Discover delivers personalised, geo-targeted content. A US mobile IP
(T-Mobile residential) ensures results match what US mobile users see, bypassing
datacenter IP blocks that Google applies to API scraping.