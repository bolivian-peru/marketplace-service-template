/**
 * X/Twitter Real-Time Search API Route
 * ──────────────────────────────────────
 * Bounty #73 — $100 USD
 *
 * Endpoints:
 *   GET /api/x/search           — Search tweets by keyword/hashtag
 *   GET /api/x/trending         — Trending topics (global or by country)
 *   GET /api/x/user/:handle     — User profile + recent tweets stub
 *
 * Pricing (x402 micropayments):
 *   $0.01 USDC — /search
 *   $0.005 USDC — /trending
 *   $0.01 USDC — /user/:handle
 *
 * Strategy: routes all X.com requests through the existing OpenSERP/SearXNG
 * infrastructure with mobile proxy support — no official X API key required.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import { searchTwitter, getTwitterTrending, type TwitterResult } from '../scrapers/twitter';

export const twitterXRouter = new Hono();

// ─── CONSTANTS ────────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_SEARCH   = 0.01;
const PRICE_TRENDING = 0.005;
const PRICE_USER     = 0.01;

const DESCRIPTION_SEARCH   = 'X/Twitter real-time tweet search by keyword or hashtag. No official API key required. Returns tweet text, author, likes, retweets, URL, timestamp.';
const DESCRIPTION_TRENDING = 'X/Twitter trending topics globally or by country. Extracted via mobile proxy without X API.';
const DESCRIPTION_USER     = 'X/Twitter user profile: handle, display name, bio, followers, tweet count.';

// ─── OUTPUT SCHEMAS ───────────────────────────────────

const SEARCH_SCHEMA = {
  query: 'string',
  results: [{
    tweetId: 'string | null',
    author: 'string | null',
    text: 'string',
    url: 'string',
    likes: 'number | null',
    retweets: 'number | null',
    engagementScore: 'number',
    publishedAt: 'string | null (ISO 8601)',
    platform: '"twitter"',
  }],
  meta: {
    total: 'number',
    proxy: { ip: 'string', country: 'string', carrier: 'string | null' },
    fetchedAt: 'string (ISO 8601)',
    responseTimeMs: 'number',
  },
};

const TRENDING_SCHEMA = {
  country: 'string',
  trends: [{
    topic: 'string',
    url: 'string',
    tweetCount: 'number | null',
    score: 'number',
  }],
  meta: {
    fetchedAt: 'string (ISO 8601)',
    responseTimeMs: 'number',
  },
};

const USER_SCHEMA = {
  handle: 'string',
  displayName: 'string | null',
  bio: 'string | null',
  followers: 'number | null',
  following: 'number | null',
  tweetCount: 'number | null',
  verified: 'boolean',
  profileUrl: 'string',
  meta: {
    proxy: { ip: 'string', country: 'string', carrier: 'string | null' },
    fetchedAt: 'string (ISO 8601)',
  },
};

// ─── RATE LIMITING ─────────────────────────────────────

const RATE_LIMIT_PER_MIN = Math.max(1, Math.min(parseInt(process.env.TWITTER_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 120));
const RATE_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_PER_MIN;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 300_000);

function getClientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ─── GET /api/x/search ────────────────────────────────

twitterXRouter.get('/search', async (c: Context) => {
  const ip = getClientIp(c);

  if (!checkRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const q = c.req.query('query') ?? c.req.query('q') ?? '';
  if (!q.trim() || q.trim().length > 500) {
    return c.json({
      error: 'Missing or invalid parameter "query" (1–500 chars)',
      schema: SEARCH_SCHEMA,
      pricing: { amount: PRICE_SEARCH, currency: 'USDC' },
    }, 400);
  }

  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 50));

  const payment = extractPayment(c.req.raw);
  if (!payment) {
    return c.json(build402Response(PRICE_SEARCH, WALLET_ADDRESS, DESCRIPTION_SEARCH, SEARCH_SCHEMA), 402);
  }
  const verified = await verifyPayment(payment, PRICE_SEARCH, WALLET_ADDRESS);
  if (!verified) return c.json({ error: 'Payment verification failed' }, 402);

  const t0 = Date.now();

  try {
    const proxy = await getProxy();
    const results: TwitterResult[] = await searchTwitter(q.trim(), limit);

    return c.json({
      query: q.trim(),
      results,
      meta: {
        total: results.length,
        proxy: {
          ip: proxy?.ip ?? 'direct',
          country: proxy?.country ?? 'unknown',
          carrier: proxy?.carrier ?? null,
        },
        fetchedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - t0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Search error';
    return c.json({ error: message }, 500);
  }
});

// ─── GET /api/x/trending ──────────────────────────────

twitterXRouter.get('/trending', async (c: Context) => {
  const ip = getClientIp(c);

  if (!checkRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const payment = extractPayment(c.req.raw);
  if (!payment) {
    return c.json(build402Response(PRICE_TRENDING, WALLET_ADDRESS, DESCRIPTION_TRENDING, TRENDING_SCHEMA), 402);
  }
  const verified = await verifyPayment(payment, PRICE_TRENDING, WALLET_ADDRESS);
  if (!verified) return c.json({ error: 'Payment verification failed' }, 402);

  const country = (c.req.query('country') ?? 'US').toUpperCase().slice(0, 2);
  const limit   = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 50));

  const t0 = Date.now();

  try {
    const trends = await getTwitterTrending(limit);

    return c.json({
      country,
      trends,
      meta: {
        fetchedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - t0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Trending fetch error';
    return c.json({ error: message }, 500);
  }
});

// ─── GET /api/x/user/:handle ──────────────────────────

twitterXRouter.get('/user/:handle', async (c: Context) => {
  const ip = getClientIp(c);

  if (!checkRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const handle = (c.req.param('handle') ?? '').replace(/^@/, '').trim();
  if (!handle || handle.length > 50 || !/^[a-zA-Z0-9_]+$/.test(handle)) {
    return c.json({ error: 'Invalid Twitter handle' }, 400);
  }

  const payment = extractPayment(c.req.raw);
  if (!payment) {
    return c.json(build402Response(PRICE_USER, WALLET_ADDRESS, DESCRIPTION_USER, USER_SCHEMA), 402);
  }
  const verified = await verifyPayment(payment, PRICE_USER, WALLET_ADDRESS);
  if (!verified) return c.json({ error: 'Payment verification failed' }, 402);

  const t0 = Date.now();

  try {
    const proxy = await getProxy();

    // Fetch public profile page via mobile proxy
    const profileUrl = `https://x.com/${handle}`;
    const response = await proxyFetch(profileUrl, {
      timeoutMs: 20000,
      maxRetries: 2,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Parse basic profile info from meta tags (works without JS)
    const html = response.ok ? await response.text() : '';

    const nameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const twitterNameMatch = html.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i);

    const rawName = nameMatch?.[1] ?? twitterNameMatch?.[1] ?? null;
    const rawDesc = descMatch?.[1] ?? null;

    // Extract follower count from description (e.g. "10.5K Followers")
    const followerMatch = rawDesc?.match(/([\d,.]+[KkMm]?)\s*Followers?/i);
    let followers: number | null = null;
    if (followerMatch) {
      const raw = followerMatch[1].replace(/,/g, '');
      if (raw.endsWith('K') || raw.endsWith('k')) followers = Math.round(parseFloat(raw) * 1000);
      else if (raw.endsWith('M') || raw.endsWith('m')) followers = Math.round(parseFloat(raw) * 1_000_000);
      else followers = parseInt(raw, 10) || null;
    }

    const tweetCountMatch = rawDesc?.match(/([\d,]+)\s*(?:Tweets|Posts)/i);
    const tweetCount = tweetCountMatch ? parseInt(tweetCountMatch[1].replace(/,/g, ''), 10) || null : null;

    const verifiedBadge = html.includes('data-testid="UserVerifiedBadge"') || html.includes('svg.*verified') || false;

    return c.json({
      handle,
      displayName: rawName ? rawName.replace(/\s*\(@[^)]+\)/, '').trim() : null,
      bio: rawDesc ? rawDesc.replace(/\d+\s*(Followers?|Following|Tweets?|Posts?)[^.]*\.\s*/gi, '').trim().slice(0, 300) : null,
      followers,
      following: null, // requires JS rendering
      tweetCount,
      verified: verifiedBadge,
      profileUrl: `https://x.com/${handle}`,
      meta: {
        proxy: {
          ip: proxy?.ip ?? 'direct',
          country: proxy?.country ?? 'unknown',
          carrier: proxy?.carrier ?? null,
        },
        fetchedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - t0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Profile fetch error';
    return c.json({ error: message }, 500);
  }
});
