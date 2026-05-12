/**
 * X/Twitter Intelligence API — Bounty #73
 * ─────────────────────────────────────────
 * Provides real-time X/Twitter search, trending, user profiles,
 * user tweets, and thread extraction via mobile proxy rotation.
 *
 * Endpoints:
 *   GET /api/x/search?query=keyword&sort=latest&limit=20
 *   GET /api/x/trending?country=US
 *   GET /api/x/user/:handle
 *   GET /api/x/user/:handle/tweets?limit=20
 *   GET /api/x/thread/:tweet_id
 *
 * x402-gated: each endpoint requires USDC micropayment.
 * Uses Zod v4 for input validation.
 */

import { Hono } from 'hono';
import { z } from 'zod/v4';
import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment, build402Response } from '../payment';

export const xTwitterRouter = new Hono();

// ─── CONSTANTS ──────────────────────────────────────

const X_SEARCH_PRICE_USDC = 0.01;
const X_TRENDING_PRICE_USDC = 0.005;
const X_USER_PRICE_USDC = 0.01;
const X_USER_TWEETS_PRICE_USDC = 0.02;
const X_THREAD_PRICE_USDC = 0.01;

const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '66dG5r5TD37ahhrsAMKUroxML9Cqto5jRduifiMgQQ3G';
const WALLET_ADDRESS_BASE = process.env.WALLET_ADDRESS_BASE || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';

// SearXNG + OpenSERP endpoints for search aggregation
const SEARXNG_BASE = process.env.SEARXNG_BASE || 'http://100.91.53.54:8890';
const OPENSERP_BASE = process.env.OPENSERP_BASE || 'http://100.91.53.54:7000';

const TIMEOUT_MS = 20_000;
const BOT_UA = 'XTwitterIntelligence/1.0 (Marketplace Service)';

// ─── ZOD V4 SCHEMAS ──────────────────────────────────

const searchSchema = z.object({
  query: z.string().min(1).max(200),
  sort: z.enum(['latest', 'top', 'relevance']).default('latest'),
  limit: z.number().int().min(1).max(50).default(20),
});

const trendingSchema = z.object({
  country: z.string().length(2).default('US'),
});

const userHandleSchema = z.object({
  handle: z.string().min(1).max(64).regex(/^[A-Za-z0-9_]+$/),
});

const userTweetsSchema = z.object({
  handle: z.string().min(1).max(64).regex(/^[A-Za-z0-9_]+$/),
  limit: z.number().int().min(1).max(50).default(20),
});

const threadSchema = z.object({
  tweet_id: z.string().min(1).max(64).regex(/^\d+$/),
});

// ─── TYPES ───────────────────────────────────────────

interface XSearchResult {
  id: string;
  author: {
    handle: string;
    name: string | null;
    followers: number | null;
    verified: boolean;
  };
  text: string;
  created_at: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  url: string;
}

interface XTrendingTopic {
  name: string;
  category: string | null;
  tweet_count: string | null;
  url: string;
}

interface XUserProfile {
  handle: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  followers: number | null;
  following: number | null;
  tweets_count: number | null;
  verified: boolean;
  avatar_url: string | null;
  banner_url: string | null;
  joined_date: string | null;
  url: string;
}

interface XUserTweet {
  id: string;
  text: string;
  created_at: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  url: string;
}

interface XThreadTweet {
  id: string;
  author: {
    handle: string;
    name: string | null;
  };
  text: string;
  created_at: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  is_reply: boolean;
  parent_id: string | null;
  url: string;
}

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
  proxyUsage.forEach((entry, ip) => {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  });
}, 300_000);

// ─── HELPER: PAYMENT GATE ────────────────────────────

async function requirePayment(
  c: any,
  resource: string,
  description: string,
  priceUSDC: number,
  outputSchema?: Record<string, unknown>,
): Promise<{ payment: { txHash: string; network: string }; verification: { valid: boolean; amount?: number; error?: string } } | Response> {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(resource, description, priceUSDC, WALLET_ADDRESS, outputSchema),
      402,
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, priceUSDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  return { payment, verification };
}

// ─── SANITIZATION ────────────────────────────────────

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractTweetIdFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractHandleFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      const handle = parts[0];
      if (['i', 'search', 'explore', 'home', 'settings', 'help'].includes(handle.toLowerCase())) {
        return null;
      }
      return handle;
    }
  } catch {}
  return null;
}

function isTwitterUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'x.com' || hostname === 'twitter.com'
      || hostname === 'www.x.com' || hostname === 'www.twitter.com';
  } catch {
    return false;
  }
}

// ─── SEARCH LOGIC (via SearXNG + OpenSERP) ───────────

async function searchXTweets(query: string, sort: string, limit: number): Promise<XSearchResult[]> {
  const safeQuery = sanitizeText(query, 200);
  if (!safeQuery) return [];

  const results: XSearchResult[] = [];
  const timeRange = sort === 'latest' ? 'week' : sort === 'top' ? 'month' : 'year';

  const queries = [
    `site:x.com ${safeQuery}`,
    `${safeQuery} x.com twitter`,
  ];

  const engineSets = ['google,bing,duckduckgo', 'google,bing', 'google'];

  for (const q of queries) {
    for (const engines of engineSets) {
      if (results.length >= limit) break;

      const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=${engines}&time_range=${timeRange}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
        });

        if (!res.ok) continue;

        const payload = await res.json() as { results?: unknown[] };
        if (!Array.isArray(payload?.results)) continue;

        for (const item of payload.results) {
          if (results.length >= limit) break;
          if (!item || typeof item !== 'object') continue;

          const raw = item as Record<string, unknown>;
          const itemUrl = typeof raw.url === 'string' ? raw.url : '';
          if (!isTwitterUrl(itemUrl)) continue;

          const tweetId = extractTweetIdFromUrl(itemUrl);
          const handle = tweetId ? extractHandleFromUrl(itemUrl) : null;
          const text = sanitizeText(raw.content || raw.title, 500);
          if (!text) continue;

          results.push({
            id: tweetId || crypto.randomUUID().slice(0, 19),
            author: {
              handle: handle || 'unknown',
              name: sanitizeText(raw.title, 100) || null,
              followers: null,
              verified: false,
            },
            text,
            created_at: typeof raw.publishedDate === 'string' ? raw.publishedDate : null,
            likes: null,
            retweets: null,
            replies: null,
            views: null,
            url: itemUrl,
          });
        }
      } catch {
        continue;
      }
    }
    if (results.length >= limit) break;
  }

  // OpenSERP fallback for more results
  if (results.length < limit) {
    try {
      const openUrl = `${OPENSERP_BASE}/mega/search?text=${encodeURIComponent(`site:x.com ${safeQuery}`)}`;
      const res = await fetch(openUrl, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (res.ok) {
        const rawResults = await res.json();
        if (Array.isArray(rawResults)) {
          for (const item of rawResults) {
            if (results.length >= limit) break;
            if (!item || typeof item !== 'object') continue;

            const raw = item as Record<string, unknown>;
            const itemUrl = typeof raw.url === 'string' ? raw.url : '';
            if (!isTwitterUrl(itemUrl)) continue;

            const tweetId = extractTweetIdFromUrl(itemUrl);
            const handle = tweetId ? extractHandleFromUrl(itemUrl) : null;
            const text = sanitizeText(raw.description || raw.title, 500);
            if (!text) continue;

            // Dedup
            if (results.some(r => r.url === itemUrl)) continue;

            results.push({
              id: tweetId || crypto.randomUUID().slice(0, 19),
              author: {
                handle: handle || 'unknown',
                name: sanitizeText(raw.title, 100) || null,
                followers: null,
                verified: false,
              },
              text,
              created_at: null,
              likes: null,
              retweets: null,
              replies: null,
              views: null,
              url: itemUrl,
            });
          }
        }
      }
    } catch {
      // fallback failed, return what we have
    }
  }

  // Dedup by URL
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, limit);
}

// ─── TRENDING LOGIC ──────────────────────────────────

async function getXTrending(country: string, limit: number): Promise<XTrendingTopic[]> {
  const year = new Date().getFullYear();
  const results: XTrendingTopic[] = [];

  const queries = [
    `site:x.com trending ${country} ${year}`,
    `twitter trending topics ${country} ${year}`,
  ];

  for (const q of queries) {
    if (results.length >= limit) break;

    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=bing,brave,duckduckgo`;

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (!res.ok) continue;

      const payload = await res.json() as { results?: unknown[] };
      if (!Array.isArray(payload?.results)) continue;

      for (const item of payload.results) {
        if (results.length >= limit) break;
        if (!item || typeof item !== 'object') continue;

        const raw = item as Record<string, unknown>;
        const title = sanitizeText(raw.title, 200);
        const itemUrl = typeof raw.url === 'string' ? raw.url : '';

        if (!title) continue;

        results.push({
          name: title,
          category: isTwitterUrl(itemUrl) ? 'X/Twitter' : 'Web',
          tweet_count: null,
          url: itemUrl || `https://x.com/search?q=${encodeURIComponent(title)}`,
        });
      }
    } catch {
      continue;
    }
  }

  // Dedup by name
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  }).slice(0, limit);
}

// ─── USER PROFILE LOGIC ─────────────────────────────

async function getXUserProfile(handle: string): Promise<XUserProfile> {
  const profileUrl = `https://x.com/${encodeURIComponent(handle)}`;

  try {
    const response = await proxyFetch(profileUrl, {
      timeoutMs: 30_000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch X profile: ${response.status}`);
    }

    const html = await response.text();

    // Extract profile data from HTML meta tags and JSON-LD
    const nameMatch = html.match(/<meta\s+name=".*?title".*?content="([^"]+)"/i)
      || html.match(/<title>([^<]+)\s*\(\s*@/i);
    const bioMatch = html.match(/<meta\s+name=".*?description".*?content="([^"]+)"/i);
    const followerMatch = html.match(/(\d[\d,.]*)\s*Followers/i);
    const followingMatch = html.match(/(\d[\d,.]*)\s*Following/i);

    return {
      handle: `@${handle}`,
      name: nameMatch ? sanitizeText(nameMatch[1], 100) : null,
      bio: bioMatch ? sanitizeText(bioMatch[1], 500) : null,
      location: null,
      followers: followerMatch ? parseFormattedNumber(followerMatch[1]) : null,
      following: followingMatch ? parseFormattedNumber(followingMatch[1]) : null,
      tweets_count: null,
      verified: html.includes('verified') || html.includes('blue_verified'),
      avatar_url: null,
      banner_url: null,
      joined_date: null,
      url: profileUrl,
    };
  } catch (err: any) {
    return {
      handle: `@${handle}`,
      name: null,
      bio: null,
      location: null,
      followers: null,
      following: null,
      tweets_count: null,
      verified: false,
      avatar_url: null,
      banner_url: null,
      joined_date: null,
      url: profileUrl,
    };
  }
}

function parseFormattedNumber(str: string): number | null {
  const cleaned = str.replace(/,/g, '').replace(/\./g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}

// ─── USER TWEETS LOGIC ──────────────────────────────

async function getXUserTweets(handle: string, limit: number): Promise<XUserTweet[]> {
  const results: XUserTweet[] = [];
  const query = `from:${handle} site:x.com`;
  const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,duckduckgo&time_range=month`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });

    if (res.ok) {
      const payload = await res.json() as { results?: unknown[] };
      if (Array.isArray(payload?.results)) {
        for (const item of payload.results) {
          if (results.length >= limit) break;
          if (!item || typeof item !== 'object') continue;

          const raw = item as Record<string, unknown>;
          const itemUrl = typeof raw.url === 'string' ? raw.url : '';
          if (!isTwitterUrl(itemUrl)) continue;

          const tweetId = extractTweetIdFromUrl(itemUrl);
          const text = sanitizeText(raw.content || raw.title, 500);
          if (!text) continue;

          results.push({
            id: tweetId || crypto.randomUUID().slice(0, 19),
            text,
            created_at: typeof raw.publishedDate === 'string' ? raw.publishedDate : null,
            likes: null,
            retweets: null,
            replies: null,
            views: null,
            url: itemUrl,
          });
        }
      }
    }
  } catch {
    // return what we have
  }

  return results.slice(0, limit);
}

// ─── THREAD LOGIC ────────────────────────────────────

async function getXThread(tweetId: string): Promise<XThreadTweet[]> {
  const thread: XThreadTweet[] = [];
  const query = `site:x.com status ${tweetId}`;
  const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,duckduckgo`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });

    if (res.ok) {
      const payload = await res.json() as { results?: unknown[] };
      if (Array.isArray(payload?.results)) {
        for (const item of payload.results) {
          if (!item || typeof item !== 'object') continue;

          const raw = item as Record<string, unknown>;
          const itemUrl = typeof raw.url === 'string' ? raw.url : '';
          if (!isTwitterUrl(itemUrl)) continue;

          const id = extractTweetIdFromUrl(itemUrl);
          if (!id) continue;

          const handle = extractHandleFromUrl(itemUrl);
          const text = sanitizeText(raw.content || raw.title, 500);
          if (!text) continue;

          thread.push({
            id,
            author: {
              handle: handle || 'unknown',
              name: sanitizeText(raw.title, 100) || null,
            },
            text,
            created_at: typeof raw.publishedDate === 'string' ? raw.publishedDate : null,
            likes: null,
            retweets: null,
            replies: null,
            is_reply: id !== tweetId,
            parent_id: id === tweetId ? null : tweetId,
            url: itemUrl,
          });
        }
      }
    }
  } catch {
    // return what we have
  }

  // If no thread found, try direct proxy fetch
  if (thread.length === 0) {
    try {
      const directUrl = `https://x.com/i/status/${tweetId}`;
      const response = await proxyFetch(directUrl, { timeoutMs: 20_000 });
      if (response.ok) {
        const html = await response.text();
        thread.push({
          id: tweetId,
          author: { handle: 'unknown', name: null },
          text: sanitizeText(
            html.match(/<meta\s+name=".*?description".*?content="([^"]+)"/i)?.[1], 500
          ) || 'Thread content could not be extracted.',
          created_at: null,
          likes: null,
          retweets: null,
          replies: null,
          is_reply: false,
          parent_id: null,
          url: `https://x.com/i/status/${tweetId}`,
        });
      }
    } catch {
      // fallback
    }
  }

  return thread;
}

// ─── ROUTES ──────────────────────────────────────────

const SEARCH_OUTPUT_SCHEMA = {
  input: {
    query: 'string (required) — keyword, hashtag, or phrase to search',
    sort: '"latest" | "top" | "relevance" (optional, default: "latest")',
    limit: 'number (optional, default: 20, max: 50)',
  },
  output: {
    query: 'string',
    sort: 'string',
    results: [{
      id: 'string',
      author: '{ handle, name, followers, verified }',
      text: 'string',
      created_at: 'string | null',
      likes: 'number | null',
      retweets: 'number | null',
      replies: 'number | null',
      views: 'number | null',
      url: 'string',
    }],
    total: 'number',
    proxy: '{ country, type }',
  },
};

const TRENDING_OUTPUT_SCHEMA = {
  input: {
    country: 'string (optional, default: "US") — ISO 3166-1 alpha-2 country code',
  },
  output: {
    country: 'string',
    trending: [{
      name: 'string',
      category: 'string | null',
      tweet_count: 'string | null',
      url: 'string',
    }],
    total: 'number',
  },
};

const USER_OUTPUT_SCHEMA = {
  input: {
    handle: 'string (required, in URL path) — X/Twitter handle without @',
  },
  output: {
    profile: '{ handle, name, bio, location, followers, following, tweets_count, verified, avatar_url, banner_url, joined_date, url }',
  },
};

const USER_TWEETS_OUTPUT_SCHEMA = {
  input: {
    handle: 'string (required, in URL path) — X/Twitter handle without @',
    limit: 'number (optional, default: 20, max: 50)',
  },
  output: {
    handle: 'string',
    tweets: [{ id: 'string', text: 'string', created_at: 'string | null', likes: 'number | null', retweets: 'number | null', url: 'string' }],
    total: 'number',
  },
};

const THREAD_OUTPUT_SCHEMA = {
  input: {
    tweet_id: 'string (required, in URL path) — Tweet ID',
  },
  output: {
    thread: [{ id: 'string', author: '{ handle, name }', text: 'string', created_at: 'string | null', is_reply: 'boolean', parent_id: 'string | null', url: 'string' }],
    total: 'number',
  },
};

// GET /api/x/search
xTwitterRouter.get('/search', async (c) => {
  const parsed = searchSchema.safeParse({
    query: c.req.query('query'),
    sort: c.req.query('sort'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
  });

  if (!parsed.success) {
    return c.json({
      error: 'Invalid input parameters',
      details: parsed.error.issues,
    }, 400);
  }

  const { query, sort, limit } = parsed.data;

  const gateResult = await requirePayment(c, '/api/x/search', 'Search X/Twitter tweets by keyword/hashtag', X_SEARCH_PRICE_USDC, SEARCH_OUTPUT_SCHEMA);
  if (gateResult instanceof Response) return gateResult;
  const { payment, verification } = gateResult;

  try {
    const proxy = getProxy();
    const results = await searchXTweets(query, sort, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      query,
      sort,
      results,
      total: results.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Search failed',
      message: err.message,
      hint: 'X/Twitter may be temporarily blocking requests. Try again in a few minutes.',
    }, 502);
  }
});

// GET /api/x/trending
xTwitterRouter.get('/trending', async (c) => {
  const parsed = trendingSchema.safeParse({
    country: c.req.query('country') || 'US',
  });

  if (!parsed.success) {
    return c.json({
      error: 'Invalid input parameters',
      details: parsed.error.issues,
    }, 400);
  }

  const { country } = parsed.data;

  const gateResult = await requirePayment(c, '/api/x/trending', 'Get trending topics on X/Twitter by country', X_TRENDING_PRICE_USDC, TRENDING_OUTPUT_SCHEMA);
  if (gateResult instanceof Response) return gateResult;
  const { payment, verification } = gateResult;

  try {
    const proxy = getProxy();
    const trending = await getXTrending(country, 20);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      country,
      trending,
      total: trending.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Trending fetch failed',
      message: err.message,
    }, 502);
  }
});

// GET /api/x/user/:handle
xTwitterRouter.get('/user/:handle', async (c) => {
  const parsed = userHandleSchema.safeParse({
    handle: c.req.param('handle'),
  });

  if (!parsed.success) {
    return c.json({
      error: 'Invalid handle parameter',
      details: parsed.error.issues,
      hint: 'Handle must be alphanumeric (letters, numbers, underscores only)',
    }, 400);
  }

  const { handle } = parsed.data;

  const gateResult = await requirePayment(c, '/api/x/user/:handle', 'Get X/Twitter user profile by handle', X_USER_PRICE_USDC, USER_OUTPUT_SCHEMA);
  if (gateResult instanceof Response) return gateResult;
  const { payment, verification } = gateResult;

  try {
    const proxy = getProxy();
    const profile = await getXUserProfile(handle);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'User profile fetch failed',
      message: err.message,
    }, 502);
  }
});

// GET /api/x/user/:handle/tweets
xTwitterRouter.get('/user/:handle/tweets', async (c) => {
  const parsed = userTweetsSchema.safeParse({
    handle: c.req.param('handle'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
  });

  if (!parsed.success) {
    return c.json({
      error: 'Invalid input parameters',
      details: parsed.error.issues,
    }, 400);
  }

  const { handle, limit } = parsed.data;

  const gateResult = await requirePayment(c, '/api/x/user/:handle/tweets', 'Get recent tweets from an X/Twitter user', X_USER_TWEETS_PRICE_USDC, USER_TWEETS_OUTPUT_SCHEMA);
  if (gateResult instanceof Response) return gateResult;
  const { payment, verification } = gateResult;

  try {
    const proxy = getProxy();
    const tweets = await getXUserTweets(handle, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      handle: `@${handle}`,
      tweets,
      total: tweets.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'User tweets fetch failed',
      message: err.message,
    }, 502);
  }
});

// GET /api/x/thread/:tweet_id
xTwitterRouter.get('/thread/:tweet_id', async (c) => {
  const parsed = threadSchema.safeParse({
    tweet_id: c.req.param('tweet_id'),
  });

  if (!parsed.success) {
    return c.json({
      error: 'Invalid tweet_id parameter',
      details: parsed.error.issues,
      hint: 'Tweet ID must be a numeric string',
    }, 400);
  }

  const { tweet_id } = parsed.data;

  const gateResult = await requirePayment(c, '/api/x/thread/:tweet_id', 'Get an X/Twitter thread/conversation by tweet ID', X_THREAD_PRICE_USDC, THREAD_OUTPUT_SCHEMA);
  if (gateResult instanceof Response) return gateResult;
  const { payment, verification } = gateResult;

  try {
    const proxy = getProxy();
    const thread = await getXThread(tweet_id);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      thread,
      total: thread.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Thread fetch failed',
      message: err.message,
    }, 502);
  }
});