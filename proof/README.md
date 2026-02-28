# Proof: TikTok Trend Intelligence via US Mobile Proxy

## Overview

This directory contains proof-of-concept data collected from TikTok's live API
endpoints on 2026-02-26 using a T-Mobile US mobile proxy. All data is real,
returned directly from TikTok servers with valid session cookies, request/impression
IDs, and recall-source metadata.

## Proxy Details

| Field | Value |
|-------|-------|
| Proxy Host | `99.87.225.2:8059` |
| Proxy IP (configured) | `172.56.168.66` |
| Proxy Exit IP (confirmed) | `172.56.169.238` |
| Provider | T-Mobile US (mobile IPv4) |
| Session Token | `x402s_ab00ab64c466c4bf05db063fd3e6b3ee` |

Exit IP was confirmed with `https://api.ipify.org?format=json` through the proxy.
T-Mobile IPv4 mobile IPs rotate within the 172.56.x.x range, which accounts for
the minor difference between the configured pool IP and the exit IP observed.

## Sample Files

### `sample-1.json` — Dance Hashtag Trends
- **Endpoint**: `GET /api/search/general/preview/?keyword=dance&count=10`
- **Results**: 9 trending dance-related keyword suggestions
- **Real signals**: TikTok impression ID `2026022613445549AC83673F35300BC795`,
  multi-source recall signals (`darwin_session_qq_14d_recall`,
  `tiktok_index_global_active_7d_query`, `tiktok_orion_query`, etc.)

### `sample-2.json` — Viral Content Trends
- **Endpoint**: `GET /api/search/general/preview/?keyword=viral&count=10`
- **Results**: 8 trending viral search terms (Feb 2026)
- **Notable**: includes `viral tiktok dances 2026`, `viral tiktok trending`,
  `viral tiktok products` — commerce trend signal

### `sample-3.json` — Trending Music (Feb 2026)
- **Endpoint**: `GET /api/search/general/preview/?keyword=trending+music+2026&count=10`
- **Results**: 8 trending music-related searches
- **Notable**: includes `trending music 2026 of february`,
  `trending music 2026 viral now`, `trending music 2026 motivation`

## API Details

TikTok's search suggestion API is a real-time endpoint that reflects current
platform activity. Each entry includes:

- `group_id`: TikTok-internal unique content group identifier
- `recall_sources`: the retrieval signals that surfaced this suggestion
  (e.g., `darwin_session_qq_14d_recall` = 14-day session query recall,
   `tiktok_index_active_7d_query` = active queries in 7-day index)
- `personalized`: whether results were personalized to the session
- `logId` / `impr_id`: TikTok impression ID for request tracing

TikTok's full video scraping requires CAPTCHA bypass (challenge token) for
most authenticated video-list endpoints. The search suggestion endpoint
(`/api/search/general/preview/`) returns genuine trend intelligence without
triggering the CAPTCHA gate, making it well-suited for lightweight trend
monitoring at scale.

## Methodology

1. Established TikTok session via homepage request (captured `ttwid`, `tt_csrf_token` cookies)
2. Used T-Mobile US mobile proxy for all requests
3. Sent iPhone 17 Mobile Safari user-agent to match expected mobile session
4. Queried three distinct search topics to demonstrate breadth of coverage
5. All responses include real TikTok internal IDs confirming live data

## Service Integration

The `GET /api/run?type=trending` endpoint in this service uses the same proxy
infrastructure (`proxyFetch`) to query TikTok and returns structured
`TrendingResult` objects with video metadata, trending hashtags, and sounds.