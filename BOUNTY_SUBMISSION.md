# Bounty Submission: TikTok Trend Intelligence (Bounty #50)

**Issue**: https://github.com/bolivian-peru/marketplace-service-template/issues/50  
**Bounty**: $10 USD (paid in $SX tokens)  
**Branch**: `bounty/T06-base`  
**Status**: 🔄 Base clone ready for work

## Task Summary

This is the base clone for Bounty #50 - TikTok Trend Intelligence API.

## What's Needed

1. Implement TikTok trend scraping using Proxies.sx mobile proxies
2. Add x402 payment gate ($0.05-$0.10 per request)
3. Return trending topics with engagement metrics
4. Deploy to Railway/Render
5. Submit PR with proof data

## Reference Implementation

See existing scrapers in `src/scrapers/` for patterns:
- `twitter.ts` - Twitter/X trending
- `youtube.ts` - YouTube trending
- `reddit.ts` - Reddit trending

## Next Steps

1. Create TikTok scraper module
2. Add `/api/tiktok/trending` endpoint
3. Test with mobile proxies
4. Deploy and collect proof data
5. Submit PR

---

**Author**: leonjiangcn  
**Date**: 2026-03-09
