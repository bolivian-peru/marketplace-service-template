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
  const payment = extractPayment(c);
  if (!payment) {
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

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.search, WALLET_ADDRESS);
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
      payment: { txHash: payment.txHash, amount: String(X_PRICES.search), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X search failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/trending ────────────────────────────
serviceRouter.get('/x/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/trending', 'Trending topics on X by country', X_PRICES.trending, WALLET_ADDRESS, {
        input: { country: 'string (optional: US|UK|CA|AU|IN|BR|JP|DE|FR|MX|WORLDWIDE, default: US)' },
        output: { trends: 'TrendingTopic[] — name, tweet_volume, rank, category' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.trending, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
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
      payment: { txHash: payment.txHash, amount: String(X_PRICES.trending), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X trending failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/user/:handle ────────────────────────
serviceRouter.get('/x/user/:handle', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/user/:handle', 'X user profile with metrics', X_PRICES.profile, WALLET_ADDRESS, {
        input: { handle: 'string (required) — X handle without @' },
        output: { profile: 'XUserProfile — handle, name, bio, followers, following, tweet_count, verified, location' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.profile, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
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
      payment: { txHash: payment.txHash, amount: String(X_PRICES.profile), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X user profile failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/user/:handle/tweets ─────────────────
serviceRouter.get('/x/user/:handle/tweets', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
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

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.tweets, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
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
      payment: { txHash: payment.txHash, amount: String(X_PRICES.tweets), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X user tweets failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/thread/:tweet_id ────────────────────
serviceRouter.get('/x/thread/:tweet_id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/thread/:tweet_id', 'Full conversation thread from a tweet', X_PRICES.thread, WALLET_ADDRESS, {
        input: { tweet_id: 'string (required) — Tweet ID' },
        output: { root: 'Tweet — the original tweet', conversation: 'Tweet[] — replies and thread', total: 'number' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.thread, WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
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
      payment: { txHash: payment.txHash, amount: String(X_PRICES.thread), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X thread fetch failed', details: err.message }, 500);
  }
});
