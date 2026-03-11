# Opus Review: Trend Intelligence Scaffold (Bounty #70)

**Reviewer**: Opus 4.6 senior review
**Date**: 2026-02-18
**Verdict**: **NO** - not ready to claim payment in current state

---

## 1. Acceptance-Gap Analysis

### What the issue requires vs. what exists

| Requirement | Status | Gap |
|---|---|---|
| Scrape Reddit | DONE | Working scraper with public JSON API |
| Scrape X/Twitter | MISSING | Not implemented. Issue explicitly lists X as a core platform. |
| Scrape YouTube (search + transcripts) | MISSING | Not implemented. Issue explicitly lists YouTube. |
| Scrape web | DONE (bonus) | DDG + Google Trends. Not in original spec but adds value. |
| Cross-platform pattern detection | DONE | Keyword frequency + bigram approach. Functional. |
| Engagement-weighted scoring | DONE | Reddit score/comments weighted. Web gets flat 20. |
| Sentiment analysis per platform | DONE | Word-list approach. Basic but functional. |
| 30-day recency enforcement | DONE | Time filter on Reddit. Web has no date filtering. |
| Structured JSON with evidence links | DONE | Clean response schema. |
| x402 payment flow with tiers | DONE | Three tiers wired correctly. |
| Live deployment URL | MISSING | No deployment evidence for bounty #70 endpoints. |
| Real research output for 2+ topics across 2+ platforms | MISSING | No proof artifacts exist. |
| Pattern detection working (cross-platform) | PARTIAL | Code exists but no demo output proving it works. |
| Solana USDC wallet address | DONE | Reuses existing wallet config. |

### Critical gaps

1. **X/Twitter scraper missing entirely.** The issue title says "Cross-Platform Research" and lists Reddit, X, and YouTube as the three core platforms. Delivering Reddit + Web (a substitute not in spec) without X or YouTube is a significant shortfall. The reviewer will notice immediately.

2. **YouTube scraper missing entirely.** Same issue. The bounty specifically calls out "YouTube (search + transcripts)."

3. **No live deployment.** The issue says "No merge without a working deployed instance." There is no Render/Railway/Fly deployment for the trend intelligence endpoints.

4. **No proof-of-concept output.** Submission requirements: "Real research output for 2+ topics across 2+ platforms." No JSON evidence files exist.

5. **Web scraper is a substitute, not an addition.** The issue never mentions DuckDuckGo or "web" as a platform. It lists Reddit, X/Twitter, YouTube. Web is a reasonable addition but cannot replace two of the three required platforms.

---

## 2. Prioritized Improvements

### Must-Have (blocks payment)

1. **Implement X/Twitter scraper.** Options:
   - Nitter instances (public, no auth) for search/trending. Fragile but functional for MVP.
   - Twitter syndication API (`syndication.twitter.com/srv/timeline-profile`) for public profiles.
   - `api.fxtwitter.com` or `api.vxtwitter.com` as relay proxies.
   - Direct `x.com/search` scrape with mobile proxy (hardest, most brittle).

2. **Implement YouTube scraper.** Options:
   - YouTube search via `youtube.com/results?search_query=` HTML scrape (parse initial data JSON blob).
   - `yt-dlp --dump-json` for metadata (already available on most systems).
   - YouTube Data API v3 free tier (100 units/day, enough for demos).
   - Transcript extraction: `youtube-transcript-api` npm package or manual caption URL fetch.

3. **Deploy to Render/Railway.** Create a deployment with the trend intelligence routes accessible. Update the submission doc with the live URL.

4. **Generate proof artifacts.** Run 2+ real queries, save JSON output to `evidence/` directory. Include in PR as demonstration.

### Should-Have (strengthens submission)

5. **Add `carrier` field to proxy metadata.** The issue example response shows `"carrier": "AT&T"` in meta. Current code returns `"type": "mobile"` but no carrier. Check if Proxies.sx API exposes carrier info.

6. **Improve pattern detection output quality.** Current patterns will be single keywords and bigrams like "coding assistants" or "cursor". The issue example shows human-readable patterns like "Cursor vs Claude Code adoption surge." Consider post-processing: group related keywords into named patterns, or use the highest-engagement post title as the pattern label.

7. **Add comment scraping for Reddit.** Issue says "Scrape Reddit (search + top posts + comments)." Current scraper only gets post titles and selftext, not comment threads.

8. **Web result date filtering.** The 30-day recency enforcement only applies to Reddit. Web results have no date check.

### Nice-to-Have (polish)

9. **Caching layer.** Even a simple in-memory Map with 5-minute TTL would prevent duplicate proxy usage for identical queries.

10. **Error recovery per platform.** If X fails but Reddit succeeds, return partial results with a `warnings` array instead of silent degradation.

11. **Rate limit headers.** Return `X-RateLimit-*` headers to help consumers pace requests.

12. **Tests.** At least unit tests for sentiment scoring and pattern detection. These are pure functions, easy to test.

---

## 3. Suggested PR Narrative and Evidence Package

### PR Title
`feat: Trend Intelligence API - cross-platform research synthesis (Bounty #70)`

### PR Body Structure

```markdown
## What this adds

Two new x402-gated endpoints for cross-platform trend intelligence:

- `POST /api/research` - scrape Reddit + X + YouTube simultaneously, 
  synthesize into structured intelligence with pattern detection
- `GET /api/trending` - real-time trending topics across platforms

### Live deployment
https://<your-deployment>.onrender.com

### Proof of concept

**Query 1: "AI coding assistants" across Reddit + X**
[Link to evidence JSON or inline truncated output]
- 3 cross-platform patterns detected
- Sentiment: 65% positive on Reddit, 72% positive on X
- Top discussion: [title] with 1,243 upvotes

**Query 2: "bitcoin ETF" across Reddit + YouTube**
[Link to evidence JSON]
- Pattern: "institutional adoption" (reinforced, 2 platforms)
- 47 sources checked

### Architecture
- `src/scrapers/reddit.ts` - Reddit public JSON API
- `src/scrapers/x.ts` - X/Twitter via [method]
- `src/scrapers/youtube.ts` - YouTube search + transcript extraction
- `src/analysis/sentiment.ts` - word-list sentiment scoring
- `src/analysis/patterns.ts` - cross-platform signal detection
- Payment tiers: $0.10 / $0.50 / $1.00 USDC

### How to test
[curl examples with actual working commands against the live deployment]
```

### Evidence package to include

1. `evidence/research-ai-coding.json` - full response for "AI coding assistants"
2. `evidence/research-bitcoin.json` - full response for second topic
3. `evidence/trending-us.json` - trending endpoint output
4. Screenshot or curl transcript showing 402 -> payment -> 200 flow
5. Proxy IP proof in response metadata

### Key narrative points

- Lead with the intelligence angle, not the scraping. The issue says "sell intelligence, not bandwidth."
- Show pattern detection actually finding cross-platform signals. This is the differentiator.
- Include real engagement numbers from real scrapes. No mocked data.
- Mention mobile proxy usage explicitly in every evidence file.

---

## 4. Verdict: Can current scaffold claim payment?

**NO.**

The code quality is solid. Architecture is clean. Types are well-defined. The sentiment analyzer and pattern detector are functional. Payment flow is correctly wired.

But two of the three required platforms (X/Twitter and YouTube) are completely missing. The issue is explicit about these. "Web" (DuckDuckGo + Google Trends) is not listed as a required platform in the bounty spec. Submitting Reddit + Web when the spec asks for Reddit + X + YouTube will not pass review.

Additionally, there is no deployment and no proof artifacts.

### What it would take to be submission-ready

1. Add X/Twitter scraper (even basic Nitter/syndication approach) - ~2-4 hours
2. Add YouTube scraper (search + basic transcript) - ~2-4 hours
3. Deploy to Render - ~30 minutes
4. Generate 2+ proof queries with real output - ~1 hour
5. Write PR with evidence - ~1 hour

**Estimated total to close all gaps: 6-10 hours of focused work.**

The scaffold is ~60% complete. The hardest architectural decisions are made. The remaining work is implementing two more scrapers and producing evidence. The pattern detection and sentiment analysis layers will work with any platform's data once fed to them, so adding X and YouTube is mostly a scraping exercise.
