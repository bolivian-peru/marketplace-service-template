# Prediction Market Signal Aggregator

## Overview
An API that combines real-time prediction market odds (Polymarket, Kalshi) with live social sentiment data (Twitter/X, Reddit) to detect mispricings and generate trading signals.

## Endpoints
```
GET /api/run?type=signal&market=<query>     - Generate trading signal
GET /api/run?type=odds&market=<market_id>    - Get market odds
GET /api/run?type=sentiment&query=<query>    - Get sentiment data
GET /health                                   - Health check
```

## Tech Stack
- Python + aiohttp
- Polymarket CLOB API
- Kalshi REST API
- Twitter/X sentiment via Nitter
- Reddit JSON API

## Bounty
Proxies.sx Bounty #55 — $100 in $SX token
