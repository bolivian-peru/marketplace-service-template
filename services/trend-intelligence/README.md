# Trend Intelligence API

## Overview
A cross-platform research API that scrapes Reddit, X/Twitter, YouTube, and the web simultaneously for any topic, then synthesizes the results into a structured intelligence report with engagement-weighted scoring.

## Endpoints

GET /api/research?query=<topic>&depth=<shallow|deep>
GET /api/trending?platform=<reddit|youtube|twitter|all>
GET /api/sentiment?query=<topic>
GET /health

## Tech Stack
- Python + aiohttp
- Reddit JSON API
- DuckDuckGo HTML
- Nitter RSS (Twitter/X fallback)
- Invidious (YouTube)

## Bounty
Proxies.sx Bounty #70 — $100 in $SX token
