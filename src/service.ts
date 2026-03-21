/**
 * Instagram Intelligence + AI Vision Analysis API
 * ─────────────────────────────────────────────────
 * Bounty #71 — Proxies.sx Marketplace
 *
 * Endpoints:
 *   GET /api/instagram/profile/:username     — Profile data + engagement metrics
 *   GET /api/instagram/posts/:username       — Recent posts with engagement data
 *   GET /api/instagram/analyze/:username     — FULL AI analysis (premium)
 *   GET /api/instagram/analyze/:username/images — AI vision analysis only
 *   GET /api/instagram/audit/:username       — Fake follower / bot detection
 *   GET /api/instagram/discover              — Search/filter accounts by AI attributes
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy, getProxyExitIp } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getProfile, getPosts, analyzeProfile, analyzeImages, auditProfile } from './scrapers/instagram-scraper';

export const serviceRouter = new Hono();

// ─── PRICING ─────────────────────────────────────────
const IG_PROFILE_PRICE  = 0.01;   // $0.01 per profile lookup
const IG_POSTS_PRICE    = 0.02;   // $0.02 per posts fetch
const IG_ANALYZE_PRICE  = 0.15;   // $0.15 per full AI analysis
const IG_IMAGES_PRICE   = 0.08;   // $0.08 per image-only analysis
const IG_AUDIT_PRICE    = 0.05;   // $0.05 per authenticity audit
const IG_DISCOVER_PRICE = 0.03;   // $0.03 per discover/search

// ─── PROXY RATE LIMITING ─────────────────────────────
const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20;

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyUsage.get(ip);
  if (!entry || now > entry.resetAt) {
    proxyUsage.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= PROXY_RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of proxyUsage) {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  }
}, 300_000);

// ─── GET /api/instagram/profile/:username ───────────

serviceRouter.get('/instagram/profile/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/instagram/profile/:username',
        'Instagram profile intelligence: followers, bio, engagement rate, posting frequency, account type signals. Scraped via real 4G/5G mobile proxies for maximum reliability.',
        IG_PROFILE_PRICE,
        walletAddress,
        {
          input: {
            username: 'string (required) — Instagram username (in URL path, with or without @)',
          },
          output: {
            profile: 'InstagramProfile — username, full_name, bio, followers, following, posts_count, is_verified, is_business, engagement_rate, avg_likes, avg_comments, posting_frequency, follower_growth_signal',
            meta: 'proxy + payment info',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, IG_PROFILE_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const startMs = Date.now();
    const proxy = getProxy();
    const profile = await getProfile(username);
    const proxyInfo = await getProxyExitIp();

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: {
        proxy: {
          ip: proxyInfo.ip,
          country: proxyInfo.country,
          carrier: proxyInfo.carrier || proxy.host,
          type: 'mobile',
        },
        analysis_time_ms: Date.now() - startMs,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Instagram profile fetch failed',
      message: err.message,
      hint: 'Profile may be private, suspended, or Instagram is temporarily blocking requests. Try again in a few minutes.',
    }, 502);
  }
});

// ─── GET /api/instagram/posts/:username ─────────────

serviceRouter.get('/instagram/posts/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/instagram/posts/:username',
        'Recent Instagram posts: captions, likes, comments, hashtags, timestamps, type (image/video/carousel/reel). Scraped via real 4G/5G mobile proxies.',
        IG_POSTS_PRICE,
        walletAddress,
        {
          input: {
            username: 'string (required) — Instagram username (in URL path)',
            limit: 'number (optional, default: 12, max: 50)',
          },
          output: {
            posts: 'InstagramPost[] — id, shortcode, type, caption, likes, comments, timestamp, image_url, video_url, is_sponsored, hashtags, mentions',
            meta: 'username, count, proxy info',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, IG_POSTS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '12') || 12, 1), 50);

  try {
    const startMs = Date.now();
    const proxy = getProxy();
    const proxyInfo = await getProxyExitIp();
    const posts = await getPosts(username, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      posts,
      meta: {
        username,
        count: posts.length,
        limit,
        proxy: {
          ip: proxyInfo.ip,
          country: proxyInfo.country,
          type: 'mobile',
        },
        analysis_time_ms: Date.now() - startMs,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram posts fetch failed', message: err.message }, 502);
  }
});

// ─── GET /api/instagram/analyze/:username ───────────

serviceRouter.get('/instagram/analyze/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/instagram/analyze/:username',
        'PREMIUM: Full Instagram intelligence + AI vision analysis. Profile data + engagement metrics + GPT-4o visual content analysis: account type classification, content themes, sentiment, brand safety, fake detection, brand recommendations.',
        IG_ANALYZE_PRICE,
        walletAddress,
        {
          input: {
            username: 'string (required) — Instagram username (in URL path)',
          },
          output: {
            profile: 'InstagramProfile — full profile data',
            posts: 'InstagramPost[] — recent 12 posts',
            ai_analysis: {
              account_type: '{ primary, niche, confidence, sub_niches, signals }',
              content_themes: '{ top_themes, style, aesthetic_consistency, brand_safety_score, content_consistency }',
              sentiment: '{ overall, breakdown, emotional_themes, brand_alignment }',
              authenticity: '{ score, verdict, face_consistency, engagement_pattern, follower_quality, fake_signals }',
              images_analyzed: 'number',
              model_used: 'gpt-4o',
            },
            recommendations: '{ good_for_brands, estimated_post_value, risk_level }',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, IG_ANALYZE_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const startMs = Date.now();
    const proxy = getProxy();
    const proxyInfo = await getProxyExitIp();
    const result = await analyzeProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        proxy: {
          ip: proxyInfo.ip,
          country: proxyInfo.country,
          carrier: proxyInfo.carrier || proxy.host,
          type: 'mobile',
        },
        analysis_time_ms: Date.now() - startMs,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Instagram analysis failed',
      message: err.message,
      hint: err.message.includes('OPENAI_API_KEY')
        ? 'Set OPENAI_API_KEY in .env to enable AI vision analysis'
        : 'Profile may be private or Instagram is blocking requests.',
    }, 502);
  }
});

// ─── GET /api/instagram/analyze/:username/images ────

serviceRouter.get('/instagram/analyze/:username/images', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/instagram/analyze/:username/images',
        'AI vision analysis of Instagram post images: content classification, aesthetic consistency, brand safety scoring, account type detection from visuals only. Uses GPT-4o.',
        IG_IMAGES_PRICE,
        walletAddress,
        {
          input: {
            username: 'string (required) — Instagram username (in URL path)',
          },
          output: {
            username: 'string',
            images_analyzed: 'number',
            analysis: 'AIAnalysis — account_type, content_themes, sentiment, authenticity, model_used',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, IG_IMAGES_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const startMs = Date.now();
    const proxy = getProxy();
    const proxyInfo = await getProxyExitIp();
    const result = await analyzeImages(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        username,
        proxy: {
          ip: proxyInfo.ip,
          country: proxyInfo.country,
          type: 'mobile',
        },
        analysis_time_ms: Date.now() - startMs,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram image analysis failed', message: err.message }, 502);
  }
});

// ─── GET /api/instagram/audit/:username ─────────────

serviceRouter.get('/instagram/audit/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/instagram/audit/:username',
        'Instagram authenticity audit: fake follower detection, engagement pattern analysis, bot signals, visual consistency check. Returns authenticity score 0-100 with verdict.',
        IG_AUDIT_PRICE,
        walletAddress,
        {
          input: {
            username: 'string (required) — Instagram username (in URL path)',
          },
          output: {
            profile: 'InstagramProfile',
            authenticity: {
              score: 'number 0-100',
              verdict: 'authentic|likely_authentic|suspicious|likely_fake|fake',
              face_consistency: 'boolean — same person across posts',
              engagement_pattern: 'organic|inflated|bot-like|purchased',
              follower_quality: 'high|medium|low',
              fake_signals: 'object — detailed bot/fake indicators',
              raw_signals: 'string[] — detected signals',
              engagement_analysis: 'object — rate vs expected range',
              follower_to_following_ratio: 'number',
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, IG_AUDIT_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const startMs = Date.now();
    const proxy = getProxy();
    const proxyInfo = await getProxyExitIp();
    const result = await auditProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        proxy: {
          ip: proxyInfo.ip,
          country: proxyInfo.country,
          type: 'mobile',
        },
        analysis_time_ms: Date.now() - startMs,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram audit failed', message: err.message }, 502);
  }
});

// ─── GET /api/instagram/discover ────────────────────
// Search/filter accounts by AI-derived attributes
// NOTE: This endpoint returns cached analysis data or analyzes provided usernames
// For discovering new accounts, it accepts a comma-separated list to batch-analyze

serviceRouter.get('/instagram/discover', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/instagram/discover',
        'Batch Instagram intelligence: analyze multiple accounts and filter by AI-derived attributes (niche, account type, sentiment, brand safety). Provide usernames to analyze and filter criteria.',
        IG_DISCOVER_PRICE,
        walletAddress,
        {
          input: {
            usernames: 'string (required) — comma-separated Instagram usernames to analyze (max 5)',
            niche: 'string (optional) — filter by niche (travel, fitness, food, fashion, tech, beauty, gaming)',
            account_type: 'string (optional) — filter: influencer|business|personal|meme_page',
            min_followers: 'number (optional) — minimum follower count',
            max_followers: 'number (optional) — maximum follower count',
            min_engagement: 'number (optional) — minimum engagement rate %',
            sentiment: 'string (optional) — filter: positive|neutral|negative',
            brand_safe: 'boolean (optional) — only return brand_safety_score > 80',
            authentic_only: 'boolean (optional) — only return authenticity_score > 70',
          },
          output: {
            results: 'DiscoverResult[] — filtered accounts with profile + AI analysis summary',
            total_analyzed: 'number',
            total_matched: 'number',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, IG_DISCOVER_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded.', retryAfter: 60 }, 429);
  }

  const usernamesParam = c.req.query('usernames');
  if (!usernamesParam) {
    return c.json({
      error: 'Missing required parameter: usernames',
      hint: 'Provide comma-separated usernames: ?usernames=natgeo,nasa,nike&niche=travel&brand_safe=true',
      example: '/api/instagram/discover?usernames=natgeo,nasa&niche=travel&sentiment=positive',
    }, 400);
  }

  const usernames = usernamesParam.split(',').map(u => u.trim()).filter(Boolean).slice(0, 5);
  if (usernames.length === 0) {
    return c.json({ error: 'No valid usernames provided' }, 400);
  }

  // Filters
  const nicheFilter = c.req.query('niche')?.toLowerCase();
  const typeFilter = c.req.query('account_type')?.toLowerCase();
  const minFollowers = parseInt(c.req.query('min_followers') || '0') || 0;
  const maxFollowers = parseInt(c.req.query('max_followers') || '0') || 0;
  const minEngagement = parseFloat(c.req.query('min_engagement') || '0') || 0;
  const sentimentFilter = c.req.query('sentiment')?.toLowerCase();
  const brandSafe = c.req.query('brand_safe') === 'true';
  const authenticOnly = c.req.query('authentic_only') === 'true';

  try {
    const startMs = Date.now();
    const proxy = getProxy();
    const proxyInfo = await getProxyExitIp();

    // Analyze all accounts in parallel (max 5)
    const analysisPromises = usernames.map(async (username) => {
      try {
        const result = await analyzeProfile(username);
        return { username, success: true, result };
      } catch (err: any) {
        return { username, success: false, error: err.message };
      }
    });

    const analyses = await Promise.all(analysisPromises);
    
    // Apply filters
    const results = analyses
      .filter(a => a.success && a.result)
      .map(a => {
        const r = a.result!;
        return {
          username: r.profile.username,
          matched: matchesFilters(r, { nicheFilter, typeFilter, minFollowers, maxFollowers, minEngagement, sentimentFilter, brandSafe, authenticOnly }),
          summary: {
            followers: r.profile.followers,
            engagement_rate: r.profile.engagement_rate,
            is_verified: r.profile.is_verified,
            account_type: r.ai_analysis.account_type.primary,
            niche: r.ai_analysis.account_type.niche,
            confidence: r.ai_analysis.account_type.confidence,
            top_themes: r.ai_analysis.content_themes.top_themes,
            sentiment: r.ai_analysis.sentiment.overall,
            brand_safety_score: r.ai_analysis.content_themes.brand_safety_score,
            authenticity_score: r.ai_analysis.authenticity.score,
            authenticity_verdict: r.ai_analysis.authenticity.verdict,
            estimated_post_value: r.recommendations.estimated_post_value,
            risk_level: r.recommendations.risk_level,
            good_for_brands: r.recommendations.good_for_brands,
          },
          profile: r.profile,
        };
      });

    const matched = results.filter(r => r.matched);
    const failed = analyses.filter(a => !a.success).map(a => ({ username: a.username, error: (a as any).error }));

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      results: matched.map(({ username, summary, profile }) => ({ username, summary, profile })),
      total_analyzed: usernames.length,
      total_matched: matched.length,
      failed: failed.length > 0 ? failed : undefined,
      filters_applied: { nicheFilter, typeFilter, minFollowers, maxFollowers, minEngagement, sentimentFilter, brandSafe, authenticOnly },
      meta: {
        proxy: {
          ip: proxyInfo.ip,
          country: proxyInfo.country,
          type: 'mobile',
        },
        analysis_time_ms: Date.now() - startMs,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram discover failed', message: err.message }, 502);
  }
});

// ─── FILTER HELPER ─────────────────────────────────

function matchesFilters(
  result: any,
  filters: {
    nicheFilter?: string;
    typeFilter?: string;
    minFollowers: number;
    maxFollowers: number;
    minEngagement: number;
    sentimentFilter?: string;
    brandSafe: boolean;
    authenticOnly: boolean;
  },
): boolean {
  const { profile, ai_analysis } = result;
  
  if (filters.nicheFilter && !ai_analysis.account_type.niche.includes(filters.nicheFilter)) return false;
  if (filters.typeFilter && ai_analysis.account_type.primary !== filters.typeFilter) return false;
  if (filters.minFollowers > 0 && profile.followers < filters.minFollowers) return false;
  if (filters.maxFollowers > 0 && profile.followers > filters.maxFollowers) return false;
  if (filters.minEngagement > 0 && profile.engagement_rate < filters.minEngagement) return false;
  if (filters.sentimentFilter && ai_analysis.sentiment.overall !== filters.sentimentFilter) return false;
  if (filters.brandSafe && ai_analysis.content_themes.brand_safety_score < 80) return false;
  if (filters.authenticOnly && ai_analysis.authenticity.score < 70) return false;
  
  return true;
}
