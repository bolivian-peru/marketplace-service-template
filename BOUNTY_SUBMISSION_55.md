# Bounty Submission: Prediction Market Signal Aggregator (Bounty #55)

**Bounty Issue:** https://github.com/bolivian-peru/marketplace-service-template/issues/55  
**Reward:** $100 (paid in $SX token)

## What I built

A unified **Prediction Market Signal Aggregator** that detects arbitrage opportunities between major markets (Polymarket, Kalshi, Metaculus) and identifies sentiment divergence using real-time social data (X/Twitter, Reddit).

### Core Features
- **Multi-Market Scraping**: Real-time integration with Polymarket Gamma API, Kalshi v2 API, and Metaculus.
- **Sentiment Layer**: Scrapes latest social discussions to determine "Social Bullishness" vs "Market Price".
- **Divergence Logic**: Automatically identifies "underpriced" or "overpriced" outcomes where social sentiment significantly outpaces market odds.
- **Arbitrage Detection**: Real-time spread calculation between Polymarket and Kalshi.
- **x402 Payment Gating**: Integrated with the template's payment system ($0.05/query).

### Endpoints
- `GET /api/prediction/run?market=<slug>`
  - Example slug: `us-presidential-election-2028`
  - Example output:
    ```json
    {
      "type": "signal",
      "market": "us-presidential-election-2028",
      "odds": { "polymarket": { "yes": 0.45, "no": 0.55 }, "kalshi": { "yes": 0.48, ... } },
      "sentiment": { "twitter": { "positive": 0.65, ... }, "reddit": { "positive": 0.72, ... } },
      "signals": {
        "arbitrage": { "detected": true, "spread": 0.03, "direction": "Kalshi YES overpriced vs Polymarket" },
        "sentimentDivergence": { "detected": true, "description": "Social sentiment 68% bullish but market only 45%" }
      }
    }
    ```

## Reviewer requirements checklist

1) **Aggregate odds from Polymarket, Kalshi, Metaculus** ✅
- Implemented in `src/scrapers/prediction.ts`.

2) **Sentiment from X/Reddit via proxies** ✅
- Re-uses mobile proxy infrastructure for scraping social feeds.

3) **Divergence Signal Implementation** ✅
- Logic in `src/analysis/prediction-logic.ts`.

4) **x402 payment gating ($0.05/query)** ✅
- Integrated in `src/routes/prediction.ts`.

## How to test (Mocked payment for review)

1) **402 Required**
```bash
curl -i "http://localhost:3000/api/prediction/run?market=us-presidential-election-2028"
```

2) **Signal Generation (After Payment)**
```bash
curl -sS \
  -H "Payment-Signature: <tx_hash>" \
  -H "X-Payment-Network: solana" \
  "http://localhost:3000/api/prediction/run?market=us-presidential-election-2028"
```
