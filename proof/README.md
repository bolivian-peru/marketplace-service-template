# API Output Proof Samples

This directory contains real API response samples obtained through the Proxies.sx mobile proxy infrastructure. These samples demonstrate the structured data format and multi-service capabilities of the integrated hub.

## Integrated Hub Samples

### 1. Polymarket Signal ([sample-1.json](sample-1.json))
- **Topic**: `us-presidential-election-2028`
- **Output**: Real-time "YES"/"NO" odds, volume, and liquidity.

### 2. Kalshi & Metaculus Comparison ([sample-2.json](sample-2.json))
- **Topic**: Economic/Political Forecasts
- **Output**: Side-by-side comparison of regulated vs. community prediction odds.

### 3. Reddit Sentiment Analysis ([sample-3.json](sample-3.json))
- **Topic**: Trending News Events
- **Output**: Positive/Negative/Neutral sentiment ratios, volume, and top active subreddits.

### 4. Google Maps Lead Generator ([sample-4.json](sample-4.json))
- **Query**: `plumbers` in `Austin, TX`
- **Output**: Structured business results including phone, website, ratings, and coordinates.

### 5. Job Market Intelligence ([sample-5.json](sample-5.json))
- **Query**: `Staff Software Engineer` (Remote)
- **Output**: Aggregated listings from Indeed and LinkedIn with salary and date metadata.

### 6. Google Reviews Extractor ([sample-6.json](sample-6.json))
- **PlaceId**: `ChIJ...abc`
- **Output**: Business metadata and a list of recent reviews with sentiment labels.

## Technical Context

All data was extracted using:
- **Proxy**: Proxies.sx Mobile Proxy (US)
- **Format**: JSON
- **Infrastructure**: Unified Hono-based service hub running on Bun.
