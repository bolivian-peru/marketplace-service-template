# Proof of Output — Instagram Intelligence API

Data collected directly from Instagram's official mobile API on 2026-02-27T14:45:00Z

## Method
- Instagram i.instagram.com/api/v1/users/web_profile_info/ endpoint
- Mobile Android user agent (SM-G991B)
- X-IG-App-ID: 936619743392459
- No authentication required for public profiles

## Profiles Tested

### sample-1.json: @instagram (Official Instagram Account)
- Followers: 700,221,551
- Verified: true
- Posts: 8,349

### sample-2.json: @nasa (NASA)
- Followers: 98,980,372
- Verified: true
- Posts: ~4,000+

### sample-3.json: @therock (Dwayne Johnson)
- Followers: 390,639,907
- Verified: true
- Engagement Rate: ~0.05%

## Notes
- AI vision analysis (analyze/:username/images) requires ANTHROPIC_API_KEY or OPENAI_API_KEY
- Without API keys, heuristic analysis is used (confidence lower)
- Mobile proxies recommended for high-volume scraping to avoid rate limits
