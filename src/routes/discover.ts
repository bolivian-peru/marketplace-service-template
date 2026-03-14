/**
 * Google Discover Feed Intelligence Routes
 * ─────────────────────────────────────────
 * Endpoints:
 *   GET /api/discover/feed      — Monitor Discover-eligible content by topics
 *   GET /api/discover/trending  — Detect trending topics from Google Trends
 *   GET /api/discover/analyze   — Analyze a URL's Discover eligibility
 *   GET /api/discover/topics    — Get topic clusters from current news
 *
 * Price: $0.01-0.03 USDC per request
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import {
  monitorDiscoverFeed,
  detectTrendingTopics,
  estimateContentPerformance,
  scrapeGoogleNewsTopics,
  clusterByTopic,
} from '../scrapers/discover-scraper';
import type {
  DiscoverFeedResponse,
  DiscoverTrendingResponse,
  DiscoverAnalyzeResponse,
  DiscoverTopicsResponse,
} from '../types';

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

// Pricing per endpoint
const PRICE_FEED = 0.02;
const PRICE_TRENDING = 0.01;
const PRICE_ANALYZE = 0.03;
const PRICE_TOPICS = 0.015;

// Rate limiting
const DISCOVER_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(parseInt(process.env.DISCOVER_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 300),
);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

// ─── HELPERS ────────────────────────────────────────

function normalizeClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = c.req.header('x-real-ip')?.trim();
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  const candidate = forwarded || realIp || cfIp || 'unknown';
  if (!candidate || candidate.length > 64 || /[\r\n]/.test(candidate)) return 'unknown';
  return candidate;
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();

  if (rateLimits.size > 10_000) {
    for (const [key, value] of rateLimits) {
      if (now > value.resetAt) rateLimits.delete(key);
    }
  }

  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count += 1;
  if (entry.count > DISCOVER_RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}

function toSafeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '').slice(0, 256);
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const ipRes = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 5_000,
    });
    if (!ipRes.ok) return null;
    const ipData = await ipRes.json() as { ip?: string };
    const ip = typeof ipData?.ip === 'string' ? ipData.ip.trim() : '';
    if (!ip || ip.length > 64) return null;
    return ip;
  } catch {
    return null;
  }
}

// ─── OUTPUT SCHEMAS ─────────────────────────────────

const FEED_DESCRIPTION =
  'Google Discover Feed Intelligence: monitor Discover-eligible content across topics. ' +
  'Returns articles ranked by freshness and eligibility score with topic clustering.';

const FEED_OUTPUT_SCHEMA = {
  input: {
    topics: 'string (required) - comma-separated topics to monitor (max 5)',
    country: 'string (optional, default: "US") - ISO country code',
    language: 'string (optional, default: "en") - language code',
    limit: 'number (optional, default: 10, max: 30) - articles per topic',
  },
  output: {
    topics: 'string[]',
    items: 'DiscoverFeedItem[] - ranked articles with eligibility scores',
    clusters: 'TopicCluster[] - grouped articles by topic similarity',
    topSources: '{ source, count }[] - most active publishers',
    avgEligibilityScore: 'number (0-100)',
    meta: '{ proxy, generated_at }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const TRENDING_DESCRIPTION =
  'Google Discover Trending Topics: detect trending and emerging topics from Google Trends. ' +
  'Returns real-time trends with traffic estimates, velocity, and related news coverage.';

const TRENDING_OUTPUT_SCHEMA = {
  input: {
    country: 'string (optional, default: "US") - ISO country code',
    category: 'string (optional, default: "all") - category filter: all, business, technology, entertainment, sports, health, science',
    limit: 'number (optional, default: 20, max: 50) - max trending topics',
  },
  output: {
    country: 'string',
    category: 'string',
    trends: 'TrendSignal[] - { topic, traffic, velocity, relatedArticles }',
    clusters: 'TopicCluster[] - grouped by topic similarity',
    emergingTopics: 'string[] - high-velocity emerging topics',
    meta: '{ totalSignals, clusterCount, topCategories, proxy, generated_at }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const ANALYZE_DESCRIPTION =
  'Google Discover Content Analyzer: evaluate a URL\'s potential to appear in Google Discover. ' +
  'Returns eligibility score, content signals, and actionable improvement suggestions.';

const ANALYZE_OUTPUT_SCHEMA = {
  input: {
    url: 'string (required) - URL to analyze for Discover eligibility',
  },
  output: {
    url: 'string',
    title: 'string',
    overallScore: 'number (0-100)',
    signals: '{ factor, score, weight }[] - individual scoring factors',
    recommendation: 'string - summary assessment',
    improvements: 'string[] - actionable improvement suggestions',
    metadata: '{ hasStructuredData, hasAmpVersion, hasMobileViewport, hasLargeImage, ... }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const TOPICS_DESCRIPTION =
  'Google Discover Topic Clusters: fetch and cluster news articles by topic for content intelligence. ' +
  'Returns clustered articles with velocity indicators and source analysis.';

const TOPICS_OUTPUT_SCHEMA = {
  input: {
    query: 'string (required) - topic or search query',
    country: 'string (optional, default: "US") - ISO country code',
    limit: 'number (optional, default: 15, max: 30) - max articles',
  },
  output: {
    query: 'string',
    articles: 'DiscoverFeedItem[]',
    clusters: 'TopicCluster[]',
    topSources: '{ source, count }[]',
    meta: '{ proxy, generated_at }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── ROUTER ─────────────────────────────────────────

export const discoverRouter = new Hono();

// ─── GET /api/discover/feed ─────────────────────────

discoverRouter.get('/feed', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rateStatus.retryAfter }, 429);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/discover/feed', FEED_DESCRIPTION, PRICE_FEED, WALLET_ADDRESS, FEED_OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_FEED);
  } catch (error) {
    console.error('[discover/feed] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  // Parse inputs
  const topicsParam = c.req.query('topics');
  if (!topicsParam) {
    return c.json({ error: 'Missing required parameter: topics (comma-separated list)' }, 400);
  }

  const topics = topicsParam
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .slice(0, 5);

  if (topics.length === 0) {
    return c.json({ error: 'At least one topic is required' }, 400);
  }

  const country = (c.req.query('country') || 'US').trim().toUpperCase().slice(0, 2);
  const language = (c.req.query('language') || 'en').trim().toLowerCase().slice(0, 2);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 30);

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  try {
    const result = await monitorDiscoverFeed(topics, country, language, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

    const response: DiscoverFeedResponse = {
      topics,
      items: result.items,
      clusters: result.clusters,
      topSources: result.topSources,
      avgEligibilityScore: result.avgEligibilityScore,
      meta: {
        proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
        generated_at: new Date().toISOString(),
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_FEED,
        settled: true,
      },
    };

    return c.json(response);
  } catch (error: any) {
    console.error('[discover/feed] Error:', error.message);
    return c.json({ error: 'Failed to fetch Discover feed data', details: error.message }, 502);
  }
});

// ─── GET /api/discover/trending ─────────────────────

discoverRouter.get('/trending', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rateStatus.retryAfter }, 429);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/discover/trending', TRENDING_DESCRIPTION, PRICE_TRENDING, WALLET_ADDRESS, TRENDING_OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_TRENDING);
  } catch (error) {
    console.error('[discover/trending] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const country = (c.req.query('country') || 'US').trim().toUpperCase().slice(0, 2);
  const validCategories = ['all', 'business', 'technology', 'entertainment', 'sports', 'health', 'science', 'top'];
  const category = validCategories.includes(c.req.query('category')?.toLowerCase() || '')
    ? c.req.query('category')!.toLowerCase()
    : 'all';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 50);

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  try {
    const result = await detectTrendingTopics(country, category, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

    const response: DiscoverTrendingResponse = {
      country,
      category,
      trends: result.trends,
      clusters: result.clusters,
      emergingTopics: result.emergingTopics,
      meta: {
        totalSignals: result.meta.totalSignals,
        clusterCount: result.meta.clusterCount,
        topCategories: result.meta.topCategories,
        proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
        generated_at: new Date().toISOString(),
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_TRENDING,
        settled: true,
      },
    };

    return c.json(response);
  } catch (error: any) {
    console.error('[discover/trending] Error:', error.message);
    return c.json({ error: 'Failed to detect trending topics', details: error.message }, 502);
  }
});

// ─── GET /api/discover/analyze ──────────────────────

discoverRouter.get('/analyze', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rateStatus.retryAfter }, 429);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/discover/analyze', ANALYZE_DESCRIPTION, PRICE_ANALYZE, WALLET_ADDRESS, ANALYZE_OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_ANALYZE);
  } catch (error) {
    console.error('[discover/analyze] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing required parameter: url' }, 400);
  }

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return c.json({ error: 'URL must use http or https protocol' }, 400);
    }
    // Block private/internal URLs (SSRF protection)
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') || hostname.startsWith('172.') || hostname === '0.0.0.0') {
      return c.json({ error: 'Internal/private URLs are not allowed' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  try {
    const result = await estimateContentPerformance(url);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

    const response: DiscoverAnalyzeResponse = {
      ...result,
      meta: {
        proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
        generated_at: new Date().toISOString(),
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_ANALYZE,
        settled: true,
      },
    };

    return c.json(response);
  } catch (error: any) {
    console.error('[discover/analyze] Error:', error.message);
    return c.json({ error: 'Failed to analyze URL', details: error.message }, 502);
  }
});

// ─── GET /api/discover/topics ───────────────────────

discoverRouter.get('/topics', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rateStatus.retryAfter }, 429);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/discover/topics', TOPICS_DESCRIPTION, PRICE_TOPICS, WALLET_ADDRESS, TOPICS_OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_TOPICS);
  } catch (error) {
    console.error('[discover/topics] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const query = c.req.query('query');
  if (!query) {
    return c.json({ error: 'Missing required parameter: query' }, 400);
  }

  const country = (c.req.query('country') || 'US').trim().toUpperCase().slice(0, 2);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '15', 10) || 15, 1), 30);

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  try {
    const articles = await scrapeGoogleNewsTopics(query, country, 'en', limit);
    const clusters = clusterByTopic(articles);

    // Top sources
    const sourceCounts = new Map<string, number>();
    for (const item of articles) {
      if (item.source) {
        sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
      }
    }
    const topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

    const response: DiscoverTopicsResponse = {
      query,
      articles,
      clusters,
      topSources,
      meta: {
        proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
        generated_at: new Date().toISOString(),
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_TOPICS,
        settled: true,
      },
    };

    return c.json(response);
  } catch (error: any) {
    console.error('[discover/topics] Error:', error.message);
    return c.json({ error: 'Failed to fetch topic data', details: error.message }, 502);
  }
});
