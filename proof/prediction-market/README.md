# Proof: Prediction Market Signal Aggregator (Bounty #55)

## Data Sources Verified

### 1. Polymarket (Public API — No Proxy Needed)
- **File:** `polymarket-top-markets.json`
- **Endpoint:** `https://gamma-api.polymarket.com/markets?closed=false&limit=10&order=volume24hr&ascending=false`
- **Queried:** 2026-03-20T05:13:00Z
- **Results:** 10 active markets with real-time odds, volume, liquidity
- **Top market:** Netanyahu out by March 31? — $49.5M volume, YES=0.0175

### 2. Kalshi (Public API — No Auth for Market Data)
- **File:** `kalshi-markets.json`
- **Endpoint:** `https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=10`
- **Queried:** 2026-03-20T05:13:00Z
- **Results:** 10 open markets with pricing data

### 3. Reddit Sentiment (Requires Mobile Proxy)
- **File:** `reddit-sentiment-sample.json`
- Reddit's `.json` API requires mobile proxy IPs to avoid rate limiting
- Proxies.sx mobile carrier IPs bypass Reddit's anti-bot detection
- Sample output shows real subreddit discussion sentiment for prediction market topics

### 4. Twitter/X Sentiment (Requires Mobile Proxy)
- Twitter/X aggressively blocks datacenter IPs
- Mobile proxy required for real-time tweet scraping
- Sentiment analysis uses keyword-based positive/negative/neutral classification

## Why Mobile Proxies Are Required

The market data APIs (Polymarket, Kalshi) are public. The value-add requiring mobile proxies is the **sentiment layer**:

1. **Twitter/X**: Blocks datacenter IPs. Mobile carrier IPs required for search scraping
2. **Reddit**: New anti-scraping measures target datacenter traffic. Mobile IPs bypass this
3. **Speed advantage**: Higher success rate with mobile IPs = faster sentiment signals = earlier mispricing detection

## Cross-Platform Arbitrage Detection

The service detects price spreads between Polymarket and Kalshi for the same events:
- Matches events by keyword similarity (3+ shared words)
- Flags spreads > 2% as potential arbitrage
- Confidence score based on spread magnitude and keyword match quality

## How to Test

```bash
# Health check
curl https://<deployment>/health

# 402 payment flow (returns pricing)
curl https://<deployment>/api/prediction/signal?market=bitcoin

# With payment
curl -H "Payment-Signature: <tx_hash>" https://<deployment>/api/prediction/signal?market=bitcoin
```
