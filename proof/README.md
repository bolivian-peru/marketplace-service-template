# Proof of Output — Instagram Intelligence API

## Mobile Proxy Verification

**Proxy purchased for this integration:**
- TX: [`0xbc596de14a26bf687cef58b4eda9c697a5b2d15af00aebaced4ca847d2a0bbc5`](https://basescan.org/tx/0xbc596de14a26bf687cef58b4eda9c697a5b2d15af00aebaced4ca847d2a0bbc5)
- Provider: Proxies.sx (x402 payment, $0.40 USDC on Base L2)
- Exit IP: `172.56.169.116` (T-Mobile USA, ASN 21928)
- Verified: `2026-02-28T17:18:00Z`

Full details: `proof/proxy-verification.json`

## Data Collection Method

All Instagram API calls in this service are routed through `proxyFetch()` from `src/proxy.ts`. See `instagram-scraper.ts` lines 89 and 109.

**Endpoint:** `https://i.instagram.com/api/v1/users/web_profile_info/?username={username}`

**Mobile app headers used:**
- `X-IG-App-ID: 936619743392459`
- `User-Agent: Instagram 269.0.0.18.75 Android (31/12; SM-G991B)`
- `X-IG-Capabilities: 3brTvw==`
- `X-IG-Connection-Type: WIFI`

Data collected via T-Mobile carrier IP on **2026-02-27T14:45:00Z**.

## Profiles Tested

### sample-1.json: @instagram (Official Instagram Account)
- Followers: 700,221,551
- Verified: true
- Posts: 8,349

### sample-2.json: @nasa (NASA)
- Followers: 98,980,372
- Verified: true (Business account)
- External: nasa.gov

### sample-3.json: @therock (Dwayne Johnson)
- Followers: 390,639,907
- Verified: true
- Engagement Rate: ~0.014%

## Error Handling
- 429 (rate limit) → `503 captcha_detected`, no charge to customer
- 403 (login wall) → `403 auth_required`
- Proxy failure → `502 proxy_error`
- AI vision analysis requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; falls back to heuristic analysis
