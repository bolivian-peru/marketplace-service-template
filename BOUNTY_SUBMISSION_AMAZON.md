# Bounty Submission: E-commerce Price Monitor

**PR:** [To be filled after creation]
**Branch:** `bounty-ecommerce-price-monitor`

## What I built

A production-grade **Amazon Price Monitor** script that leverages **Playwright-Stealth v2** with **persistent context** (developer profiles) and **mobile proxies** to bypass advanced bot detection systems.

### Features

- **Stealth Integration**: Uses `playwright-stealth` to mask automation signatures.
- **Persistent Context**: Uses a dedicated user data directory to maintain a "human-like" browser footprint across sessions.
- **Proxy Support**: Pre-configured for standard proxy authentication (optimized for Proxies.sx mobile proxies).
- **Resilient Extraction**: Targeted selectors for Amazon product titles and pricing, with error handling for common page states.

### Extraction Fields

- `Product Name`: Cleaned string from the product title.
- `Price`: Extracted whole price value.

## Technical Details

- **Language**: Python 3.x
- **Libraries**: `playwright`, `playwright-stealth`
- **Detection Bypass**: Persistent profiles + Stealth v2 + Random delays.

## Payment Information

- **Network**: Base L2 (Base Network)
- **Asset**: USDC
- **Wallet Address**: `0x6ce6962fC47b3f8d5e1a064be2659964b0a4215d`

## How to Run

1. Install dependencies:

   ```bash
   pip install playwright playwright-stealth
   playwright install chrome
   ```

2. Configure proxies in `scrapers/amazon_price_monitor.py`.
3. Execute the script:

   ```bash
   python scrapers/amazon_price_monitor.py
   ```
