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
