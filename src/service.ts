/**
 * Service Router — Instagram Intelligence + AI Vision Analysis (Bounty #71)
 *
 * Endpoints:
 * GET /api/instagram/profile/:username     — Profile + engagement ($0.01)
 * GET /api/instagram/posts/:username       — Recent posts with metrics ($0.02)
 * GET /api/instagram/analyze/:username     — Full AI analysis ($0.15)
 * GET /api/instagram/analyze/:username/images — Vision-only analysis ($0.08)
 * GET /api/instagram/audit/:username       — Fake/bot detection ($0.05)
 * GET /api/instagram/discover              — Search by AI attributes ($0.03)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeProfile, scrapePosts, getPostImageUrls, scrapeAll } from './scrapers/instagram';
import { analyzeImages, type VisionAnalysisResult } from './analysis/vision';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'instagram-intelligence';
const DESCRIPTION = 'Instagram Intelligence + AI Vision Analysis API: profile analytics, content classification, sentiment analysis, fake account detection, and influencer discovery — powered by mobile proxies and AI vision models.';
const WALLET_ADDRESS = 'A6M8icBwgDPwYhaWAjhJw267nbtkuivKH2q6sKPZgQEf';

// ═══════════════════════════════════════════════════════
// Pricing
// ═══════════════════════════════════════════════════════
const PRICES = {
  profile: 0.01,
  posts: 0.02,
  analyze: 0.15,
  images: 0.08,
  audit: 0.05,
  discover: 0.03,
};

// ═══════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════
const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 15;

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

function getClientIp(c: any): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// In-Memory Cache for AI Analysis Results
// ═══════════════════════════════════════════════════════
const analysisCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 3600_000; // 1 hour

function getCached(key: string): any | null {
  const entry = analysisCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    analysisCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any): void {
  analysisCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

// ═══════════════════════════════════════════════════════
// GET /api/instagram/profile/:username
// ═══════════════════════════════════════════════════════
serviceRouter.get('/instagram/profile/:username', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/instagram/profile/:username', 'Profile data + engagement metrics', PRICES.profile, WALLET_ADDRESS, {
        input: { username: 'string (required) — Instagram username without @' },
        output: { profile: 'InstagramProfile — full_name, bio, followers, following, posts_count, engagement_rate, avg_likes, avg_comments, posting_frequency, is_verified, is_business' },
      }),
      402
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICES.profile);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username' }, 400);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const profile = await scrapeProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Scrape failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/instagram/posts/:username
// ═══════════════════════════════════════════════════════
serviceRouter.get('/instagram/posts/:username', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/instagram/posts/:username', 'Recent posts with engagement metrics', PRICES.posts, WALLET_ADDRESS, {
        input: { username: 'string (required)', limit: 'number (optional, default: 12, max: 50)' },
        output: { posts: 'InstagramPost[] — id, caption, likes, comments, timestamp, is_video, image_url, engagement_rate' },
      }),
      402
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICES.posts);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded' }, 429);

  const username = c.req.param('username');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '12') || 12, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const posts = await scrapePosts(username, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      posts,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' }, count: posts.length },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Scrape failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/instagram/analyze/:username — FULL AI ANALYSIS (premium)
// ═══════════════════════════════════════════════════════
serviceRouter.get('/instagram/analyze/:username', async (c) => {
  // Check if this is requesting /images sub-route  
  // (handled by separate route below)

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/instagram/analyze/:username', 'FULL AI analysis: profile + vision + sentiment + authenticity + recommendations', PRICES.analyze, WALLET_ADDRESS, {
        input: { username: 'string (required)' },
        output: {
          profile: 'InstagramProfile',
          ai_analysis: 'VisionAnalysisResult — account_type, content_themes, sentiment, authenticity, recommendations',
          meta: '{ proxy, analysis_time_ms }',
        },
      }),
      402
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICES.analyze);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded' }, 429);

  const username = c.req.param('username');

  try {
    const startTime = Date.now();
    const proxy = getProxy();
    const ip = await getProxyExitIp();

    // Check cache first
    const cached = getCached(`analyze:${username}`);
    if (cached) {
      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);
      return c.json({ ...cached, _cached: true, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
    }

    // Scrape everything
    const { profile, posts, image_urls } = await scrapeAll(username, 12);

    // Build profile context for AI
    const profileContext = `Username: @${profile.username}, Name: ${profile.full_name}, Bio: "${profile.bio}", Followers: ${profile.followers}, Following: ${profile.following}, Posts: ${profile.posts_count}, Engagement Rate: ${profile.engagement_rate}%, Verified: ${profile.is_verified}, Business: ${profile.is_business}, Category: ${profile.category || 'N/A'}`;

    // Run AI vision analysis
    const aiAnalysis = await analyzeImages(image_urls, profileContext);

    const analysisTimeMs = Date.now() - startTime;

    const result = {
      profile,
      ai_analysis: aiAnalysis,
      recent_posts: posts.slice(0, 6).map(p => ({
        caption: p.caption.slice(0, 200),
        likes: p.likes,
        comments: p.comments,
        engagement_rate: p.engagement_rate,
      })),
      meta: {
        proxy: { ip, country: proxy.country, type: 'mobile' },
        analysis_time_ms: analysisTimeMs,
      },
    };

    setCache(`analyze:${username}`, result);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Analysis failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/instagram/analyze/:username/images — Vision only
// ═══════════════════════════════════════════════════════
serviceRouter.get('/instagram/analyze/:username/images', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/instagram/analyze/:username/images', 'AI vision analysis of recent post images only', PRICES.images, WALLET_ADDRESS, {
        input: { username: 'string (required)', limit: 'number (optional, default: 12)' },
        output: { vision_analysis: 'VisionAnalysisResult — content_themes, account_type, sentiment from images' },
      }),
      402
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICES.images);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded' }, 429);

  const username = c.req.param('username');
  const limit = Math.min(parseInt(c.req.query('limit') || '12') || 12, 20);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const imageUrls = await getPostImageUrls(username, limit);

    if (imageUrls.length === 0) {
      return c.json({ error: 'No images found for this account' }, 404);
    }

    const analysis = await analyzeImages(imageUrls, `Instagram account @${username}`);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      vision_analysis: analysis,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' }, images_analyzed: imageUrls.length },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Vision analysis failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/instagram/audit/:username — Fake/bot detection
// ═══════════════════════════════════════════════════════
serviceRouter.get('/instagram/audit/:username', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/instagram/audit/:username', 'AI-enhanced fake follower and bot detection', PRICES.audit, WALLET_ADDRESS, {
        input: { username: 'string (required)' },
        output: { audit: '{ authenticity_score, verdict, fake_signals, engagement_analysis }' },
      }),
      402
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICES.audit);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded' }, 429);

  const username = c.req.param('username');

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const { profile, posts, image_urls } = await scrapeAll(username, 12);

    // Calculate engagement-based signals
    const engagementHealthy = profile.engagement_rate >= 1 && profile.engagement_rate <= 10;
    const followRatio = profile.followers > 0 ? profile.following / profile.followers : 0;
    const suspiciousFollowRatio = followRatio > 2.5 || (profile.followers > 10000 && followRatio > 1.5);

    // Get AI vision analysis for visual authenticity
    let aiAuth: any = {};
    if (image_urls.length > 0) {
      try {
        const analysis = await analyzeImages(image_urls, `Audit @${username}: ${profile.followers} followers, ${profile.engagement_rate}% engagement`);
        aiAuth = analysis.authenticity;
      } catch { /* vision analysis optional for audit */ }
    }

    const authenticity_score = Math.round(
      (engagementHealthy ? 30 : 10) +
      (!suspiciousFollowRatio ? 20 : 5) +
      (profile.posts_count > 10 ? 15 : 5) +
      (aiAuth.score ? aiAuth.score * 0.35 : 20)
    );

    const verdict = authenticity_score >= 80 ? 'authentic'
      : authenticity_score >= 60 ? 'likely_authentic'
      : authenticity_score >= 40 ? 'suspicious'
      : 'likely_fake';

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      audit: {
        username: profile.username,
        authenticity_score,
        verdict,
        engagement_analysis: {
          rate: profile.engagement_rate,
          healthy: engagementHealthy,
          avg_likes: profile.avg_likes,
          avg_comments: profile.avg_comments,
        },
        follow_ratio: {
          ratio: Math.round(followRatio * 100) / 100,
          suspicious: suspiciousFollowRatio,
        },
        content_analysis: {
          posts_count: profile.posts_count,
          posting_frequency: profile.posting_frequency,
          has_profile_pic: !!profile.profile_pic_url,
          has_bio: profile.bio.length > 0,
          has_external_url: !!profile.external_url,
        },
        ai_vision: aiAuth.score ? {
          face_consistency: aiAuth.face_consistency,
          stock_photo_detected: aiAuth.fake_signals?.stock_photo_detected ?? false,
          visual_verdict: aiAuth.verdict,
        } : null,
        fake_signals: {
          low_engagement: profile.engagement_rate < 0.5,
          suspicious_follow_ratio: suspiciousFollowRatio,
          no_posts: profile.posts_count < 3,
          stock_photos: aiAuth.fake_signals?.stock_photo_detected ?? false,
          generic_bio: profile.bio.length < 10,
        },
      },
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Audit failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/instagram/discover — Search by AI attributes
// ═══════════════════════════════════════════════════════
serviceRouter.get('/instagram/discover', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/instagram/discover', 'Search cached analyzed accounts by AI-derived attributes', PRICES.discover, WALLET_ADDRESS, {
        input: {
          niche: 'string (optional) — filter by niche',
          account_type: 'string (optional) — influencer|business|personal',
          min_followers: 'number (optional)',
          max_followers: 'number (optional)',
          sentiment: 'string (optional) — positive|neutral|negative',
          brand_safe: 'boolean (optional) — filter for brand-safe accounts',
          min_engagement: 'number (optional) — minimum engagement rate %',
        },
        output: { results: 'AnalyzedAccount[] — matching accounts from cache' },
      }),
      402
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICES.discover);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  // Search through cached analyses
  const niche = c.req.query('niche')?.toLowerCase();
  const accountType = c.req.query('account_type')?.toLowerCase();
  const minFollowers = parseInt(c.req.query('min_followers') || '0');
  const maxFollowers = parseInt(c.req.query('max_followers') || '999999999');
  const sentiment = c.req.query('sentiment')?.toLowerCase();
  const brandSafe = c.req.query('brand_safe') === 'true';
  const minEngagement = parseFloat(c.req.query('min_engagement') || '0');

  const results: any[] = [];
  const now = Date.now();

  for (const [key, entry] of analysisCache) {
    if (!key.startsWith('analyze:') || now > entry.expiresAt) continue;

    const { profile, ai_analysis } = entry.data;
    if (!profile || !ai_analysis) continue;

    // Apply filters
    if (niche && !ai_analysis.account_type?.niche?.toLowerCase().includes(niche)) continue;
    if (accountType && ai_analysis.account_type?.primary?.toLowerCase() !== accountType) continue;
    if (profile.followers < minFollowers || profile.followers > maxFollowers) continue;
    if (sentiment && ai_analysis.sentiment?.overall?.toLowerCase() !== sentiment) continue;
    if (brandSafe && (ai_analysis.content_themes?.brand_safety_score ?? 0) < 70) continue;
    if (profile.engagement_rate < minEngagement) continue;

    results.push({
      username: profile.username,
      followers: profile.followers,
      engagement_rate: profile.engagement_rate,
      account_type: ai_analysis.account_type?.primary,
      niche: ai_analysis.account_type?.niche,
      sentiment: ai_analysis.sentiment?.overall,
      brand_safety_score: ai_analysis.content_themes?.brand_safety_score,
      authenticity_score: ai_analysis.authenticity?.score,
    });
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);

  return c.json({
    results,
    total: results.length,
    note: results.length === 0
      ? 'No cached analyses match your filters. Analyze accounts first via /api/instagram/analyze/:username to populate the discovery index.'
      : undefined,
    payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
  });
});


// ═══════════════════════════════════════════════════════
// Reddit Intelligence API (Bounty #68) — $50
// ═══════════════════════════════════════════════════════

import { searchReddit, getTrending, getSubredditTop, getThread } from './scrapers/reddit';

const REDDIT_PRICES = {
  search: 0.005,
  trending: 0.005,
  subredditTop: 0.005,
  thread: 0.01,
};

// ─── GET /api/reddit/search ─────────────────────────
serviceRouter.get('/reddit/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/reddit/search', 'Search Reddit posts by keyword', REDDIT_PRICES.search, WALLET_ADDRESS, {
        input: {
          query: 'string (required) — Search keyword or phrase',
          subreddit: 'string (optional, default: all) — Restrict to subreddit',
          sort: 'string (optional: relevance|hot|new|top|comments, default: relevance)',
          time: 'string (optional: hour|day|week|month|year|all, default: week)',
        },
        output: { results: 'RedditPost[] — title, subreddit, author, score, num_comments, url, body_preview', meta: 'proxy info' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, REDDIT_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const query = c.req.query('query');
    if (!query) return c.json({ error: 'query parameter is required' }, 400);

    const subreddit = c.req.query('subreddit') || 'all';
    const sort = (c.req.query('sort') as any) || 'relevance';
    const time = (c.req.query('time') as any) || 'week';

    const proxyIp = await getProxyExitIp();
    const data = await searchReddit(query, subreddit, sort, time);

    return c.json({
      ...data,
      meta: {
        query,
        subreddit,
        sort,
        time,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(REDDIT_PRICES.search), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reddit search failed', details: err.message }, 500);
  }
});

// ─── GET /api/reddit/trending ───────────────────────
serviceRouter.get('/reddit/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/reddit/trending', 'Trending topics on Reddit', REDDIT_PRICES.trending, WALLET_ADDRESS, {
        input: { country: 'string (optional, default: US) — Country filter' },
        output: { topics: 'TrendingTopic[] — title, subreddit, rank, score, num_comments' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, REDDIT_PRICES.trending, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const country = c.req.query('country') || 'US';
    const proxyIp = await getProxyExitIp();
    const topics = await getTrending(country);

    return c.json({
      topics,
      meta: {
        country,
        total_results: topics.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(REDDIT_PRICES.trending), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reddit trending failed', details: err.message }, 500);
  }
});

// ─── GET /api/reddit/subreddit/:name/top ────────────
serviceRouter.get('/reddit/subreddit/:name/top', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/reddit/subreddit/:name/top', 'Top posts from a subreddit', REDDIT_PRICES.subredditTop, WALLET_ADDRESS, {
        input: {
          name: 'string (required) — Subreddit name without r/',
          time: 'string (optional: hour|day|week|month|year|all, default: day)',
        },
        output: { posts: 'RedditPost[] — title, author, score, num_comments, url, body_preview, upvote_ratio' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, REDDIT_PRICES.subredditTop, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const name = c.req.param('name');
    if (!name) return c.json({ error: 'Subreddit name is required' }, 400);

    const time = (c.req.query('time') as any) || 'day';
    const proxyIp = await getProxyExitIp();
    const posts = await getSubredditTop(name, time);

    return c.json({
      subreddit: `r/${name}`,
      posts,
      meta: {
        subreddit: name,
        time,
        total_results: posts.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(REDDIT_PRICES.subredditTop), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Subreddit top failed', details: err.message }, 500);
  }
});

// ─── GET /api/reddit/thread/:id/comments ────────────
serviceRouter.get('/reddit/thread/:id/comments', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/reddit/thread/:id/comments', 'Full thread with nested comments', REDDIT_PRICES.thread, WALLET_ADDRESS, {
        input: {
          id: 'string (required) — Reddit thread ID (e.g., "1abcd2e")',
          sort: 'string (optional: best|top|new|controversial|old, default: best)',
        },
        output: { post: 'RedditPost', comments: 'RedditComment[] — author, body, score, depth, is_op', total_comments: 'number' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, REDDIT_PRICES.thread, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Thread ID is required' }, 400);

    const sort = (c.req.query('sort') as any) || 'best';
    const proxyIp = await getProxyExitIp();
    const thread = await getThread(id, sort);

    return c.json({
      ...thread,
      meta: {
        thread_id: id,
        sort,
        comments_returned: thread.comments.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(REDDIT_PRICES.thread), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Thread fetch failed', details: err.message }, 500);
  }
});


// ═══════════════════════════════════════════════════════
// X/Twitter Real-Time Search API (Bounty #73) — $100
// ═══════════════════════════════════════════════════════

import { searchTweets, getTrending as getXTrending, getUserProfile, getUserTweets, getThread as getXThread, COUNTRY_WOEIDS } from './scrapers/twitter';

const X_PRICES = {
  search: 0.01,
  trending: 0.005,
  profile: 0.01,
  tweets: 0.01,
  thread: 0.02,
};

// ─── GET /api/x/search ──────────────────────────────
serviceRouter.get('/x/search', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/x/search', 'Search tweets by keyword or hashtag', X_PRICES.search, WALLET_ADDRESS, {
        input: {
          query: 'string (required) — Search keyword, hashtag, or from:user',
          sort: 'string (optional: latest|top|people|media, default: latest)',
          limit: 'number (optional, default: 20, max: 100)',
        },
        output: { results: 'Tweet[] — id, author, text, likes, retweets, replies, views, url, media, hashtags', meta: 'proxy info' },
      }),
      402,
    );
  }

  if (!testMode) {
    const verified = await verifyPayment(payment!.txHash, payment!.network, X_PRICES.search, WALLET_ADDRESS);
    if (!verified.valid) {
      return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
    }
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const query = c.req.query('query');
    if (!query) return c.json({ error: 'query parameter is required' }, 400);

    const sort = (c.req.query('sort') as any) || 'latest';
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const proxyIp = await getProxyExitIp();
    const data = await searchTweets(query, sort, limit);

    return c.json({
      query,
      ...data,
      meta: {
        sort,
        total_results: data.total_results,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(X_PRICES.search), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X search failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/trending ────────────────────────────
serviceRouter.get('/x/trending', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/x/trending', 'Trending topics on X by country', X_PRICES.trending, WALLET_ADDRESS, {
        input: { country: 'string (optional: US|UK|CA|AU|IN|BR|JP|DE|FR|MX|WORLDWIDE, default: US)' },
        output: { trends: 'TrendingTopic[] — name, tweet_volume, rank, category' },
      }),
      402,
    );
  }

  if (!testMode) {
    const verified = await verifyPayment(payment!.txHash, payment!.network, X_PRICES.trending, WALLET_ADDRESS);
    if (!verified.valid) {
      return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
    }
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const country = (c.req.query('country') || 'US').toUpperCase();
    const woeid = COUNTRY_WOEIDS[country] || COUNTRY_WOEIDS.US;
    const proxyIp = await getProxyExitIp();
    const trends = await getXTrending(woeid);

    return c.json({
      country,
      trends,
      meta: {
        woeid,
        total_trends: trends.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(X_PRICES.trending), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X trending failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/user/:handle ────────────────────────
serviceRouter.get('/x/user/:handle', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/x/user/:handle', 'X user profile with metrics', X_PRICES.profile, WALLET_ADDRESS, {
        input: { handle: 'string (required) — X handle without @' },
        output: { profile: 'XUserProfile — handle, name, bio, followers, following, tweet_count, verified, location' },
      }),
      402,
    );
  }

  if (!testMode) {
    const verified = await verifyPayment(payment!.txHash, payment!.network, X_PRICES.profile, WALLET_ADDRESS);
    if (!verified.valid) {
      return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
    }
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const handle = c.req.param('handle');
    if (!handle) return c.json({ error: 'handle is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const profile = await getUserProfile(handle);

    return c.json({
      profile,
      meta: {
        handle,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(X_PRICES.profile), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X user profile failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/user/:handle/tweets ─────────────────
serviceRouter.get('/x/user/:handle/tweets', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/x/user/:handle/tweets', 'Recent tweets from a user', X_PRICES.tweets, WALLET_ADDRESS, {
        input: {
          handle: 'string (required) — X handle without @',
          limit: 'number (optional, default: 20, max: 200)',
        },
        output: { tweets: 'Tweet[] — full tweet data with engagement metrics' },
      }),
      402,
    );
  }

  if (!testMode) {
    const verified = await verifyPayment(payment!.txHash, payment!.network, X_PRICES.tweets, WALLET_ADDRESS);
    if (!verified.valid) {
      return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
    }
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const handle = c.req.param('handle');
    if (!handle) return c.json({ error: 'handle is required' }, 400);

    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 200);
    const proxyIp = await getProxyExitIp();
    const tweets = await getUserTweets(handle, limit);

    return c.json({
      handle,
      tweets,
      meta: {
        total_tweets: tweets.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(X_PRICES.tweets), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X user tweets failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/thread/:tweet_id ────────────────────
serviceRouter.get('/x/thread/:tweet_id', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/x/thread/:tweet_id', 'Full conversation thread from a tweet', X_PRICES.thread, WALLET_ADDRESS, {
        input: { tweet_id: 'string (required) — Tweet ID' },
        output: { root: 'Tweet — the original tweet', conversation: 'Tweet[] — replies and thread', total: 'number' },
      }),
      402,
    );
  }

  if (!testMode) {
    const verified = await verifyPayment(payment!.txHash, payment!.network, X_PRICES.thread, WALLET_ADDRESS);
    if (!verified.valid) {
      return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
    }
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const tweetId = c.req.param('tweet_id');
    if (!tweetId) return c.json({ error: 'tweet_id is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const thread = await getXThread(tweetId);

    return c.json({
      ...thread,
      meta: {
        tweet_id: tweetId,
        conversation_size: thread.total,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(X_PRICES.thread), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X thread fetch failed', details: err.message }, 500);
  }
});


// ═══════════════════════════════════════════════════════
// LinkedIn People & Company Enrichment API (Bounty #77) — $100
// ═══════════════════════════════════════════════════════

import { getPersonProfile, getCompanyProfile, searchPeople, getCompanyEmployees } from './scrapers/linkedin';

const LI_PRICES = {
  person: 0.03,
  company: 0.05,
  search: 0.10,
  employees: 0.10,
};

// ─── GET /api/linkedin/person ───────────────────────
serviceRouter.get('/linkedin/person', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/linkedin/person', 'LinkedIn person profile enrichment', LI_PRICES.person, WALLET_ADDRESS, {
        input: { url: 'string (required) — LinkedIn profile URL or username' },
        output: { person: 'LinkedInPerson — name, headline, company, experience, education, skills, connections' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, LI_PRICES.person, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);

  try {
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'url parameter is required (LinkedIn profile URL or username)' }, 400);

    const proxyIp = await getProxyExitIp();
    const person = await getPersonProfile(url);

    return c.json({
      ...person,
      meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'AT&T' } },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(LI_PRICES.person), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn person profile failed', details: err.message }, 500);
  }
});

// ─── GET /api/linkedin/company ──────────────────────
serviceRouter.get('/linkedin/company', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/linkedin/company', 'LinkedIn company profile enrichment', LI_PRICES.company, WALLET_ADDRESS, {
        input: { url: 'string (required) — LinkedIn company URL or slug' },
        output: { company: 'LinkedInCompany — name, description, employee_count, headquarters, industry, specialties' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, LI_PRICES.company, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);

  try {
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'url parameter is required (LinkedIn company URL or slug)' }, 400);

    const proxyIp = await getProxyExitIp();
    const company = await getCompanyProfile(url);

    return c.json({
      ...company,
      meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'AT&T' } },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(LI_PRICES.company), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn company profile failed', details: err.message }, 500);
  }
});

// ─── GET /api/linkedin/search/people ────────────────
serviceRouter.get('/linkedin/search/people', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/linkedin/search/people', 'Search LinkedIn people by criteria', LI_PRICES.search, WALLET_ADDRESS, {
        input: {
          title: 'string (optional) — Job title filter',
          location: 'string (optional) — Location filter',
          industry: 'string (optional) — Industry filter',
          limit: 'number (optional, default: 10, max: 25)',
        },
        output: { results: 'LinkedInSearchResult[] — name, headline, profile_url, current_company' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, LI_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);

  try {
    const title = c.req.query('title');
    const location = c.req.query('location');
    const industry = c.req.query('industry');
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25);

    if (!title && !location && !industry) {
      return c.json({ error: 'At least one filter required: title, location, or industry' }, 400);
    }

    const proxyIp = await getProxyExitIp();
    const results = await searchPeople(title, location, industry, limit);

    return c.json({
      results,
      meta: {
        filters: { title, location, industry },
        total_results: results.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'AT&T' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(LI_PRICES.search), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn people search failed', details: err.message }, 500);
  }
});

// ─── GET /api/linkedin/company/:id/employees ────────
serviceRouter.get('/linkedin/company/:id/employees', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/linkedin/company/:id/employees', 'Search company employees by title', LI_PRICES.employees, WALLET_ADDRESS, {
        input: {
          id: 'string (required) — Company LinkedIn slug',
          title: 'string (optional) — Filter by job title',
          limit: 'number (optional, default: 10, max: 25)',
        },
        output: { employees: 'LinkedInSearchResult[] — name, headline, profile_url' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, LI_PRICES.employees, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);

  try {
    const companyId = c.req.param('id');
    if (!companyId) return c.json({ error: 'company id is required' }, 400);

    const title = c.req.query('title');
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25);
    const proxyIp = await getProxyExitIp();
    const employees = await getCompanyEmployees(companyId, title, limit);

    return c.json({
      company: companyId,
      employees,
      meta: {
        title_filter: title || null,
        total_results: employees.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'AT&T' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(LI_PRICES.employees), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn employee search failed', details: err.message }, 500);
  }
});


// ═══════════════════════════════════════════════════════
// TikTok Trend Intelligence API (Bounty #51) — $75
// ═══════════════════════════════════════════════════════

import { getTrending as getTTTrending, getHashtagData, getCreatorProfile as getTTCreator, getSoundData, TT_COUNTRY_CODES } from './scrapers/tiktok';

const TT_PRICES = {
  trending: 0.02,
  hashtag: 0.01,
  creator: 0.02,
  sound: 0.01,
};

// ─── GET /api/tiktok/trending ───────────────────────
serviceRouter.get('/tiktok/trending', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/tiktok/trending', 'Trending TikTok videos and hashtags by country', TT_PRICES.trending, WALLET_ADDRESS, {
        input: { country: 'string (optional: US|UK|DE|FR|ES|PL|JP|BR|IN|CA|AU|MX, default: US)' },
        output: { videos: 'TikTokVideo[]', trending_hashtags: 'TikTokTrendingHashtag[]' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, TT_PRICES.trending, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const country = (c.req.query('country') || 'US').toUpperCase();
    const proxyIp = await getProxyExitIp();
    const data = await getTTTrending(country);

    return c.json({
      type: 'trending',
      country,
      timestamp: new Date().toISOString(),
      data,
      proxy: { country, carrier: 'T-Mobile', type: 'mobile', ip: proxyIp || 'mobile' },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(TT_PRICES.trending), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'TikTok trending failed', details: err.message }, 500);
  }
});

// ─── GET /api/tiktok/hashtag/:tag ───────────────────
serviceRouter.get('/tiktok/hashtag/:tag', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/tiktok/hashtag/:tag', 'TikTok hashtag analytics and top videos', TT_PRICES.hashtag, WALLET_ADDRESS, {
        input: { tag: 'string (required) — Hashtag without #', country: 'string (optional, default: US)' },
        output: { hashtag: 'string', views: 'number', videos: 'TikTokVideo[]' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, TT_PRICES.hashtag, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const tag = c.req.param('tag');
    if (!tag) return c.json({ error: 'tag is required' }, 400);

    const country = c.req.query('country') || 'US';
    const proxyIp = await getProxyExitIp();
    const data = await getHashtagData(tag, country);

    return c.json({
      type: 'hashtag',
      country,
      timestamp: new Date().toISOString(),
      data,
      proxy: { country, carrier: 'T-Mobile', type: 'mobile', ip: proxyIp || 'mobile' },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(TT_PRICES.hashtag), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'TikTok hashtag failed', details: err.message }, 500);
  }
});

// ─── GET /api/tiktok/creator/:username ──────────────
serviceRouter.get('/tiktok/creator/:username', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/tiktok/creator/:username', 'TikTok creator profile with engagement metrics and recent posts', TT_PRICES.creator, WALLET_ADDRESS, {
        input: { username: 'string (required) — Creator username without @' },
        output: { creator: 'TikTokCreator — username, bio, followers, likes, video_count, recent_posts[]' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, TT_PRICES.creator, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const username = c.req.param('username');
    if (!username) return c.json({ error: 'username is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const creator = await getTTCreator(username);

    return c.json({
      type: 'creator',
      timestamp: new Date().toISOString(),
      data: creator,
      proxy: { country: 'US', carrier: 'T-Mobile', type: 'mobile', ip: proxyIp || 'mobile' },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(TT_PRICES.creator), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'TikTok creator profile failed', details: err.message }, 500);
  }
});

// ─── GET /api/tiktok/sound/:id ──────────────────────
serviceRouter.get('/tiktok/sound/:id', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/tiktok/sound/:id', 'TikTok sound/audio analytics and top videos using the sound', TT_PRICES.sound, WALLET_ADDRESS, {
        input: { id: 'string (required) — Sound/music ID' },
        output: { id: 'string', name: 'string', author: 'string', uses: 'number', videos: 'TikTokVideo[]' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, TT_PRICES.sound, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const soundId = c.req.param('id');
    if (!soundId) return c.json({ error: 'sound id is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const data = await getSoundData(soundId);

    return c.json({
      type: 'sound',
      timestamp: new Date().toISOString(),
      data,
      proxy: { country: 'US', carrier: 'T-Mobile', type: 'mobile', ip: proxyIp || 'mobile' },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(TT_PRICES.sound), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'TikTok sound data failed', details: err.message }, 500);
  }
});\n

// ═══════════════════════════════════════════════════════
// Facebook Marketplace Monitor API (Bounty #75) — $75
// ═══════════════════════════════════════════════════════

import { searchMarketplace, getListingDetails, getCategories as getFbCategories, getNewListings } from './scrapers/facebook-marketplace';

const FB_PRICES = {
  search: 0.01,
  listing: 0.005,
  categories: 0.005,
  monitor: 0.02,
};

// ─── GET /api/marketplace/search ────────────────────
serviceRouter.get('/marketplace/search', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/marketplace/search', 'Search Facebook Marketplace listings', FB_PRICES.search, WALLET_ADDRESS, {
        input: {
          query: 'string (required) — Search keyword',
          location: 'string (optional) — City name',
          min_price: 'number (optional) — Minimum price',
          max_price: 'number (optional) — Maximum price',
          radius: 'string (optional, e.g., "25mi")',
          limit: 'number (optional, default: 20)',
        },
        output: { results: 'MarketplaceListing[] — id, title, price, seller, condition, images, url' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, FB_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const query = c.req.query('query');
    if (!query) return c.json({ error: 'query parameter is required' }, 400);

    const location = c.req.query('location');
    const minPrice = c.req.query('min_price') ? parseFloat(c.req.query('min_price')!) : undefined;
    const maxPrice = c.req.query('max_price') ? parseFloat(c.req.query('max_price')!) : undefined;
    const radius = c.req.query('radius');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
    const proxyIp = await getProxyExitIp();

    const data = await searchMarketplace(query, location, minPrice, maxPrice, radius, limit);

    return c.json({
      ...data,
      meta: {
        query, location, min_price: minPrice, max_price: maxPrice, radius,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FB_PRICES.search), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'FB Marketplace search failed', details: err.message }, 500);
  }
});

// ─── GET /api/marketplace/listing/:id ───────────────
serviceRouter.get('/marketplace/listing/:id', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/marketplace/listing/:id', 'Full details of a Marketplace listing', FB_PRICES.listing, WALLET_ADDRESS, {
        input: { id: 'string (required) — Listing ID' },
        output: { listing: 'MarketplaceListing — full details with images, seller, condition' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, FB_PRICES.listing, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const listingId = c.req.param('id');
    if (!listingId) return c.json({ error: 'listing id is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const listing = await getListingDetails(listingId);

    return c.json({
      listing,
      meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' } },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FB_PRICES.listing), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'FB Marketplace listing failed', details: err.message }, 500);
  }
});

// ─── GET /api/marketplace/categories ────────────────
serviceRouter.get('/marketplace/categories', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/marketplace/categories', 'Marketplace categories for a location', FB_PRICES.categories, WALLET_ADDRESS, {
        input: { location: 'string (optional) — City name' },
        output: { categories: 'MarketplaceCategory[] — id, name, url' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, FB_PRICES.categories, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  try {
    const location = c.req.query('location');
    const proxyIp = await getProxyExitIp();
    const categories = await getFbCategories(location);

    return c.json({
      categories,
      meta: { location, total: categories.length, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' } },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FB_PRICES.categories), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'FB Marketplace categories failed', details: err.message }, 500);
  }
});

// ─── GET /api/marketplace/new ───────────────────────
serviceRouter.get('/marketplace/new', async (c) => {
  const testMode = process.env.TEST_MODE === 'true';
  const payment = testMode ? { txHash: 'test-mode', network: 'solana' as const } : extractPayment(c);
  if (!testMode && !payment) {
    return c.json(
      build402Response('/api/marketplace/new', 'Monitor new Marketplace listings', FB_PRICES.monitor, WALLET_ADDRESS, {
        input: {
          query: 'string (required) — Search keyword',
          since: 'string (optional, e.g., "1h", "6h", "24h", default: "1h")',
          limit: 'number (optional, default: 20)',
        },
        output: { results: 'MarketplaceListing[] — new listings since timeframe', since: 'ISO timestamp' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, FB_PRICES.monitor, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed', details: verified.error }, 402);

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);

  try {
    const query = c.req.query('query');
    if (!query) return c.json({ error: 'query parameter is required' }, 400);

    const sinceStr = c.req.query('since') || '1h';
    const sinceHours = parseFloat(sinceStr.replace('h', ''));
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
    const proxyIp = await getProxyExitIp();

    const data = await getNewListings(query, sinceHours, limit);

    return c.json({
      ...data,
      meta: {
        query, since_hours: sinceHours,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' },
      },
      payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FB_PRICES.monitor), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'FB Marketplace monitor failed', details: err.message }, 500);
  }
});

// ═══ Food Delivery Price Intelligence API (Bounty #76) — $50 ═══

import { searchRestaurants, getRestaurantDetails, getMenu, comparePrices } from './scrapers/food-delivery';

const FOOD_PRICES = { search: 0.01, restaurant: 0.02, menu: 0.02, compare: 0.03 };

serviceRouter.get('/food/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/food/search', 'Search restaurants by keyword and location', FOOD_PRICES.search, WALLET_ADDRESS, { input: { query: 'string', address: 'string (ZIP or city)', platform: 'ubereats|doordash (default: ubereats)' }, output: { restaurants: 'FoodRestaurant[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, FOOD_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) return c.json({ error: 'Rate limit exceeded.' }, 429);
  try {
    const query = c.req.query('query'); const address = c.req.query('address'); const platform = c.req.query('platform') || 'ubereats';
    if (!query || !address) return c.json({ error: 'query and address required' }, 400);
    const proxyIp = await getProxyExitIp();
    const results = await searchRestaurants(query, address, platform);
    return c.json({ results, meta: { query, address, platform, total: results.length, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FOOD_PRICES.search), verified: true } });
  } catch (err: any) { return c.json({ error: 'Restaurant search failed', details: err.message }, 500); }
});

serviceRouter.get('/food/restaurant/:id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/food/restaurant/:id', 'Full restaurant details + menu', FOOD_PRICES.restaurant, WALLET_ADDRESS, { input: { id: 'string', platform: 'ubereats (default)' }, output: { restaurant: 'FoodRestaurant', menu: 'FoodMenuItem[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, FOOD_PRICES.restaurant, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const id = c.req.param('id'); const platform = c.req.query('platform') || 'ubereats';
    const proxyIp = await getProxyExitIp();
    const data = await getRestaurantDetails(id, platform);
    return c.json({ ...data, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FOOD_PRICES.restaurant), verified: true } });
  } catch (err: any) { return c.json({ error: 'Restaurant details failed', details: err.message }, 500); }
});

serviceRouter.get('/food/menu/:restaurant_id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/food/menu/:restaurant_id', 'Full menu extraction', FOOD_PRICES.menu, WALLET_ADDRESS, { input: { restaurant_id: 'string', platform: 'ubereats (default)' }, output: { menu: 'FoodMenuItem[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, FOOD_PRICES.menu, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const id = c.req.param('restaurant_id'); const platform = c.req.query('platform') || 'ubereats';
    const proxyIp = await getProxyExitIp();
    const menu = await getMenu(id, platform);
    return c.json({ menu, meta: { total_items: menu.length, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FOOD_PRICES.menu), verified: true } });
  } catch (err: any) { return c.json({ error: 'Menu extraction failed', details: err.message }, 500); }
});

serviceRouter.get('/food/compare', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/food/compare', 'Cross-platform price comparison', FOOD_PRICES.compare, WALLET_ADDRESS, { input: { query: 'string', address: 'string' }, output: { ubereats: 'FoodRestaurant[]', doordash: 'FoodRestaurant[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, FOOD_PRICES.compare, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const query = c.req.query('query'); const address = c.req.query('address');
    if (!query || !address) return c.json({ error: 'query and address required' }, 400);
    const proxyIp = await getProxyExitIp();
    const data = await comparePrices(query, address);
    return c.json({ ...data, meta: { query, address, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(FOOD_PRICES.compare), verified: true } });
  } catch (err: any) { return c.json({ error: 'Price comparison failed', details: err.message }, 500); }
});


// ═══ Airbnb & Short-Term Rental Intelligence API (Bounty #78) — $75 ═══

import { searchListings as searchAirbnb, getListingDetail as getAirbnbListing, getMarketStats as getAirbnbStats, getListingReviews as getAirbnbReviews } from './scrapers/airbnb';

const ABB_PRICES = { search: 0.02, listing: 0.01, market: 0.05, reviews: 0.01 };

serviceRouter.get('/airbnb/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/airbnb/search', 'Search Airbnb listings by location/dates/guests', ABB_PRICES.search, WALLET_ADDRESS, { input: { location: 'string', checkin: 'YYYY-MM-DD', checkout: 'YYYY-MM-DD', guests: 'number', min_price: 'number', max_price: 'number' }, output: { results: 'AirbnbListing[]', market_overview: 'AirbnbMarketStats' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, ABB_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const location = c.req.query('location'); if (!location) return c.json({ error: 'location required' }, 400);
    const checkin = c.req.query('checkin'); const checkout = c.req.query('checkout');
    const guests = parseInt(c.req.query('guests') || '2');
    const minPrice = c.req.query('min_price') ? parseFloat(c.req.query('min_price')!) : undefined;
    const maxPrice = c.req.query('max_price') ? parseFloat(c.req.query('max_price')!) : undefined;
    const proxyIp = await getProxyExitIp();
    const data = await searchAirbnb(location, checkin, checkout, guests, minPrice, maxPrice);
    return c.json({ ...data, meta: { location, checkin, checkout, guests, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(ABB_PRICES.search), verified: true } });
  } catch (err: any) { return c.json({ error: 'Airbnb search failed', details: err.message }, 500); }
});

serviceRouter.get('/airbnb/listing/:id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/airbnb/listing/:id', 'Full Airbnb listing details', ABB_PRICES.listing, WALLET_ADDRESS, { input: { id: 'string' }, output: { listing: 'AirbnbListing' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, ABB_PRICES.listing, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const id = c.req.param('id'); const proxyIp = await getProxyExitIp();
    const listing = await getAirbnbListing(id);
    return c.json({ listing, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(ABB_PRICES.listing), verified: true } });
  } catch (err: any) { return c.json({ error: 'Listing fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/airbnb/market-stats', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/airbnb/market-stats', 'Market statistics for a location', ABB_PRICES.market, WALLET_ADDRESS, { input: { location: 'string' }, output: { stats: 'AirbnbMarketStats — avg_daily_rate, median, listing count, price range' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, ABB_PRICES.market, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const location = c.req.query('location'); if (!location) return c.json({ error: 'location required' }, 400);
    const proxyIp = await getProxyExitIp();
    const stats = await getAirbnbStats(location);
    return c.json({ location, stats, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(ABB_PRICES.market), verified: true } });
  } catch (err: any) { return c.json({ error: 'Market stats failed', details: err.message }, 500); }
});

serviceRouter.get('/airbnb/reviews/:listing_id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/airbnb/reviews/:listing_id', 'Listing reviews', ABB_PRICES.reviews, WALLET_ADDRESS, { input: { listing_id: 'string', limit: 'number (default: 10)' }, output: { reviews: 'AirbnbReview[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, ABB_PRICES.reviews, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const id = c.req.param('listing_id'); const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
    const proxyIp = await getProxyExitIp();
    const reviews = await getAirbnbReviews(id, limit);
    return c.json({ listing_id: id, reviews, meta: { total: reviews.length, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'Verizon' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(ABB_PRICES.reviews), verified: true } });
  } catch (err: any) { return c.json({ error: 'Reviews fetch failed', details: err.message }, 500); }
});


// ═══════════════════════════════════════════════════════════════
// ZILLOW / REAL ESTATE INTELLIGENCE API — Bounty #79
// ═══════════════════════════════════════════════════════════════

import { getZillowProperty, searchZillow, getZillowMarketStats, getZillowComps } from './scrapers/zillow';

const RE_PRICES = { property: 0.02, search: 0.01, market: 0.05, comps: 0.03 };

serviceRouter.get('/realestate/property/:zpid', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/realestate/property/:zpid', 'Property details, Zestimate, price history', RE_PRICES.property, WALLET_ADDRESS, { input: { zpid: 'string' }, output: { property: 'ZillowProperty — address, price, zestimate, price_history, details, neighborhood, photos' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, RE_PRICES.property, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const zpid = c.req.param('zpid');
    const proxyIp = await getProxyExitIp();
    const property = await getZillowProperty(zpid);
    if (!property) return c.json({ error: 'Property not found or blocked' }, 404);
    return c.json({ ...property, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(RE_PRICES.property), verified: true } });
  } catch (err: any) { return c.json({ error: 'Property fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/realestate/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/realestate/search', 'Search properties by address, ZIP, or city', RE_PRICES.search, WALLET_ADDRESS, { input: { address: 'string?', zip: 'string?', type: 'for_sale|for_rent|sold?', min_price: 'number?', max_price: 'number?', beds: 'number?' }, output: { results: 'ZillowSearchResult[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, RE_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const query = c.req.query('address') || c.req.query('zip') || c.req.query('city') || '';
    if (!query) return c.json({ error: 'address, zip, or city required' }, 400);
    const filters = { type: c.req.query('type'), min_price: c.req.query('min_price') ? parseInt(c.req.query('min_price')!) : undefined, max_price: c.req.query('max_price') ? parseInt(c.req.query('max_price')!) : undefined, beds: c.req.query('beds') ? parseInt(c.req.query('beds')!) : undefined };
    const proxyIp = await getProxyExitIp();
    const results = await searchZillow(query, filters);
    return c.json({ query, results, meta: { total: results.length, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(RE_PRICES.search), verified: true } });
  } catch (err: any) { return c.json({ error: 'Search failed', details: err.message }, 500); }
});

serviceRouter.get('/realestate/market', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/realestate/market', 'Market statistics by ZIP code', RE_PRICES.market, WALLET_ADDRESS, { input: { zip: 'string' }, output: { stats: 'ZillowMarketStats — median values, inventory, price range' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, RE_PRICES.market, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const zip = c.req.query('zip'); if (!zip) return c.json({ error: 'zip required' }, 400);
    const proxyIp = await getProxyExitIp();
    const stats = await getZillowMarketStats(zip);
    return c.json({ ...stats, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(RE_PRICES.market), verified: true } });
  } catch (err: any) { return c.json({ error: 'Market stats failed', details: err.message }, 500); }
});

serviceRouter.get('/realestate/comps/:zpid', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/realestate/comps/:zpid', 'Comparable sales near a property', RE_PRICES.comps, WALLET_ADDRESS, { input: { zpid: 'string', radius: 'string? (default: 0.5mi)' }, output: { comps: 'ZillowSearchResult[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, RE_PRICES.comps, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const zpid = c.req.param('zpid');
    const radius = parseFloat(c.req.query('radius') || '0.5');
    const proxyIp = await getProxyExitIp();
    const comps = await getZillowComps(zpid, radius);
    return c.json({ zpid, comps, meta: { total: comps.length, radius: `${radius}mi`, proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(RE_PRICES.comps), verified: true } });
  } catch (err: any) { return c.json({ error: 'Comps fetch failed', details: err.message }, 500); }
});


// ═══════════════════════════════════════════════════════════════
// AMAZON PRODUCT & BSR TRACKER API — Bounty #72
// ═══════════════════════════════════════════════════════════════

import { getAmazonProduct, searchAmazon, getAmazonBestsellers, getAmazonReviews } from './scrapers/amazon';

const AMZ_PRICES = { product: 0.005, search: 0.01, bestsellers: 0.01, reviews: 0.02 };

serviceRouter.get('/amazon/product/:asin', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/amazon/product/:asin', 'Product details, BSR, price, buy box', AMZ_PRICES.product, WALLET_ADDRESS, { input: { asin: 'string', marketplace: 'US|UK|DE|FR|CA? (default: US)' }, output: { product: 'AmazonProduct — price, bsr, rating, buy_box, availability' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, AMZ_PRICES.product, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const asin = c.req.param('asin');
    const marketplace = c.req.query('marketplace') || 'US';
    const proxyIp = await getProxyExitIp();
    const product = await getAmazonProduct(asin, marketplace);
    if (!product) return c.json({ error: 'Product not found or CAPTCHA blocked' }, 404);
    return c.json({ ...product, meta: { marketplace, proxy: { ip: proxyIp || 'mobile', country: marketplace, carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(AMZ_PRICES.product), verified: true } });
  } catch (err: any) { return c.json({ error: 'Product fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/amazon/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/amazon/search', 'Search Amazon products by keyword', AMZ_PRICES.search, WALLET_ADDRESS, { input: { query: 'string', category: 'string?', marketplace: 'US|UK|DE? (default: US)' }, output: { results: 'AmazonSearchResult[] — up to 20' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, AMZ_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const query = c.req.query('query'); if (!query) return c.json({ error: 'query required' }, 400);
    const category = c.req.query('category');
    const marketplace = c.req.query('marketplace') || 'US';
    const proxyIp = await getProxyExitIp();
    const results = await searchAmazon(query, marketplace, category || undefined);
    return c.json({ query, results, meta: { total: results.length, marketplace, proxy: { ip: proxyIp || 'mobile', country: marketplace, carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(AMZ_PRICES.search), verified: true } });
  } catch (err: any) { return c.json({ error: 'Search failed', details: err.message }, 500); }
});

serviceRouter.get('/amazon/bestsellers', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/amazon/bestsellers', 'Best sellers by category', AMZ_PRICES.bestsellers, WALLET_ADDRESS, { input: { category: 'string? (default: electronics)', marketplace: 'US|UK|DE? (default: US)' }, output: { results: 'AmazonSearchResult[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, AMZ_PRICES.bestsellers, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const category = c.req.query('category') || 'electronics';
    const marketplace = c.req.query('marketplace') || 'US';
    const proxyIp = await getProxyExitIp();
    const results = await getAmazonBestsellers(category, marketplace);
    return c.json({ category, results, meta: { total: results.length, marketplace, proxy: { ip: proxyIp || 'mobile', country: marketplace, carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(AMZ_PRICES.bestsellers), verified: true } });
  } catch (err: any) { return c.json({ error: 'Bestsellers fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/amazon/reviews/:asin', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/amazon/reviews/:asin', 'Product reviews', AMZ_PRICES.reviews, WALLET_ADDRESS, { input: { asin: 'string', sort: 'recent|helpful? (default: recent)', limit: 'number? (default: 10, max: 50)', marketplace: 'US|UK|DE? (default: US)' }, output: { reviews: 'AmazonReview[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, AMZ_PRICES.reviews, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const asin = c.req.param('asin');
    const sort = c.req.query('sort') || 'recent';
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
    const marketplace = c.req.query('marketplace') || 'US';
    const proxyIp = await getProxyExitIp();
    const reviews = await getAmazonReviews(asin, marketplace, sort, limit);
    return c.json({ asin, reviews, meta: { total: reviews.length, sort, marketplace, proxy: { ip: proxyIp || 'mobile', country: marketplace, carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(AMZ_PRICES.reviews), verified: true } });
  } catch (err: any) { return c.json({ error: 'Reviews fetch failed', details: err.message }, 500); }
});


// ═══════════════════════════════════════════════════════════════
// GOOGLE DISCOVER FEED INTELLIGENCE API — Bounty #52
// ═══════════════════════════════════════════════════════════════

import { getDiscoverFeed } from './scrapers/discover';

const DISCOVER_PRICES = { feed: 0.02 };

serviceRouter.get('/discover/feed', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/discover/feed', 'Google Discover feed by country and category', DISCOVER_PRICES.feed, WALLET_ADDRESS, { input: { country: 'US|UK|DE|FR|ES|PL? (default: US)', category: 'technology|science|business|entertainment|sports|health|news?' }, output: { discover_feed: 'DiscoverArticle[] — title, source, url, snippet, imageUrl, contentType, publishedAt' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, DISCOVER_PRICES.feed, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const country = c.req.query('country') || 'US';
    const category = c.req.query('category');
    const proxyIp = await getProxyExitIp();
    const feed = await getDiscoverFeed(country, category || undefined);
    return c.json({ ...feed, proxy: { ip: proxyIp || 'mobile', country, carrier: 'Mobile', type: 'mobile' }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(DISCOVER_PRICES.feed), verified: true } });
  } catch (err: any) { return c.json({ error: 'Discover feed fetch failed', details: err.message }, 500); }
});


// ═══════════════════════════════════════════════════════════════
// TREND INTELLIGENCE CROSS-PLATFORM RESEARCH API — Bounty #70
// ═══════════════════════════════════════════════════════════════

import { researchTopic, getTrending } from './scrapers/trend';

const TREND_PRICES = { single: 0.10, cross: 0.50, full: 1.00, trending: 0.05 };

serviceRouter.post('/research', async (c) => {
  const payment = extractPayment(c);
  const body = await c.req.json().catch(() => ({}));
  const platforms = body.platforms || ['reddit', 'x', 'youtube'];
  const price = platforms.length >= 3 ? TREND_PRICES.full : platforms.length >= 2 ? TREND_PRICES.cross : TREND_PRICES.single;
  if (!payment) return c.json(build402Response('/api/research', 'Cross-platform trend research + synthesis', price, WALLET_ADDRESS, { input: { topic: 'string', platforms: 'string[] (reddit, x, youtube)', days: 'number? (default: 30)', country: 'string? (default: US)' }, output: { patterns: 'TrendPattern[]', sentiment: 'TrendSentiment', top_discussions: 'Discussion[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, price, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const topic = body.topic; if (!topic) return c.json({ error: 'topic required' }, 400);
    const days = body.days || 30;
    const proxyIp = await getProxyExitIp();
    const report = await researchTopic(topic, platforms, days);
    return c.json({ ...report, meta: { platforms_used: platforms, proxy: { ip: proxyIp || 'mobile', country: body.country || 'US', carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(price), verified: true } });
  } catch (err: any) { return c.json({ error: 'Research failed', details: err.message }, 500); }
});

serviceRouter.get('/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/trending', 'Trending topics across platforms', TREND_PRICES.trending, WALLET_ADDRESS, { input: { country: 'string? (default: US)', platforms: 'string? (comma-separated, default: reddit,x)' }, output: { trending: 'TrendingItem[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, TREND_PRICES.trending, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const country = c.req.query('country') || 'US';
    const platforms = (c.req.query('platforms') || 'reddit,x').split(',');
    const proxyIp = await getProxyExitIp();
    const result = await getTrending(country, platforms);
    return c.json({ ...result, meta: { proxy: { ip: proxyIp || 'mobile', country, carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(TREND_PRICES.trending), verified: true } });
  } catch (err: any) { return c.json({ error: 'Trending fetch failed', details: err.message }, 500); }
});


// ═══════════════════════════════════════════════════════════════
// PREDICTION MARKET SIGNAL AGGREGATOR API — Bounty #55
// ═══════════════════════════════════════════════════════════════

import { getPredictionSignal, getArbitrage } from './scrapers/prediction';

const PRED_PRICES = { signal: 0.05, arbitrage: 0.10, sentiment: 0.03 };

serviceRouter.get('/prediction/signal', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/prediction/signal', 'Prediction market signal with odds + sentiment', PRED_PRICES.signal, WALLET_ADDRESS, { input: { market: 'string (topic/event name)' }, output: { odds: 'MarketOdds (Polymarket, Kalshi, Metaculus)', sentiment: 'SocialSentiment (Reddit, Twitter)', signals: 'TradingSignal[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, PRED_PRICES.signal, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const market = c.req.query('market'); if (!market) return c.json({ error: 'market query required' }, 400);
    const proxyIp = await getProxyExitIp();
    const signal = await getPredictionSignal(market);
    return c.json({ ...signal, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(PRED_PRICES.signal), verified: true } });
  } catch (err: any) { return c.json({ error: 'Signal fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/prediction/arbitrage', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/prediction/arbitrage', 'Cross-platform prediction market arbitrage detection', PRED_PRICES.arbitrage, WALLET_ADDRESS, { input: {}, output: { opportunities: 'ArbitrageOpportunity[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, PRED_PRICES.arbitrage, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const proxyIp = await getProxyExitIp();
    const result = await getArbitrage();
    return c.json({ ...result, meta: { proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'AT&T' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(PRED_PRICES.arbitrage), verified: true } });
  } catch (err: any) { return c.json({ error: 'Arbitrage scan failed', details: err.message }, 500); }
});


// ═══════════════════════════════════════════════════════════════
// APP STORE INTELLIGENCE API — Bounty #54
// ═══════════════════════════════════════════════════════════════

import { getAppleRankings, getAppleApp, searchAppleApps, getPlayStoreApp, searchPlayStore, getAppleReviews } from './scrapers/appstore';

const APP_PRICES = { rankings: 0.01, app: 0.01, search: 0.01, reviews: 0.02 };

serviceRouter.get('/appstore/rankings', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/appstore/rankings', 'Top app rankings by store, category, country', APP_PRICES.rankings, WALLET_ADDRESS, { input: { store: 'apple|google? (default: apple)', category: 'string? (default: games)', country: 'string? (default: us)' }, output: { rankings: 'AppInfo[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, APP_PRICES.rankings, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const store = c.req.query('store') || 'apple';
    const category = c.req.query('category') || 'games';
    const country = c.req.query('country') || 'us';
    const proxyIp = await getProxyExitIp();
    const rankings = store === 'apple' ? await getAppleRankings(category, country) : [];
    return c.json({ store, category, country, rankings, meta: { total: rankings.length, proxy: { ip: proxyIp || 'mobile', country: country.toUpperCase(), carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(APP_PRICES.rankings), verified: true } });
  } catch (err: any) { return c.json({ error: 'Rankings fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/appstore/app', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/appstore/app', 'App details + metadata', APP_PRICES.app, WALLET_ADDRESS, { input: { store: 'apple|google', appId: 'string', country: 'string? (default: us)' }, output: { app: 'AppInfo' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, APP_PRICES.app, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const store = c.req.query('store') || 'apple';
    const appId = c.req.query('appId'); if (!appId) return c.json({ error: 'appId required' }, 400);
    const country = c.req.query('country') || 'us';
    const proxyIp = await getProxyExitIp();
    const app = store === 'google' ? await getPlayStoreApp(appId, country) : await getAppleApp(appId, country);
    if (!app) return c.json({ error: 'App not found' }, 404);
    return c.json({ ...app, meta: { store, proxy: { ip: proxyIp || 'mobile', country: country.toUpperCase(), carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(APP_PRICES.app), verified: true } });
  } catch (err: any) { return c.json({ error: 'App fetch failed', details: err.message }, 500); }
});

serviceRouter.get('/appstore/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/appstore/search', 'Search apps by keyword', APP_PRICES.search, WALLET_ADDRESS, { input: { store: 'apple|google', query: 'string', country: 'string? (default: us)' }, output: { results: 'AppInfo[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, APP_PRICES.search, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const store = c.req.query('store') || 'apple';
    const query = c.req.query('query'); if (!query) return c.json({ error: 'query required' }, 400);
    const country = c.req.query('country') || 'us';
    const proxyIp = await getProxyExitIp();
    const results = store === 'google' ? await searchPlayStore(query, country) : await searchAppleApps(query, country);
    return c.json({ store, query, results, meta: { total: results.length, proxy: { ip: proxyIp || 'mobile', country: country.toUpperCase(), carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(APP_PRICES.search), verified: true } });
  } catch (err: any) { return c.json({ error: 'Search failed', details: err.message }, 500); }
});

serviceRouter.get('/appstore/reviews', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return c.json(build402Response('/api/appstore/reviews', 'App reviews', APP_PRICES.reviews, WALLET_ADDRESS, { input: { store: 'apple', appId: 'string', country: 'string? (default: us)' }, output: { reviews: 'AppReview[]' } }), 402);
  const verified = await verifyPayment(payment.txHash, payment.network, APP_PRICES.reviews, WALLET_ADDRESS);
  if (!verified.valid) return c.json({ error: 'Payment verification failed' }, 402);
  try {
    const appId = c.req.query('appId'); if (!appId) return c.json({ error: 'appId required' }, 400);
    const country = c.req.query('country') || 'us';
    const proxyIp = await getProxyExitIp();
    const reviews = await getAppleReviews(appId, country);
    return c.json({ appId, reviews, meta: { total: reviews.length, proxy: { ip: proxyIp || 'mobile', country: country.toUpperCase(), carrier: 'T-Mobile' } }, payment: { txHash: testMode ? 'test-mode' : payment!.txHash, amount: String(APP_PRICES.reviews), verified: true } });
  } catch (err: any) { return c.json({ error: 'Reviews fetch failed', details: err.message }, 500); }
});
