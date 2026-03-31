/**
 * GET /api/x/search         — Search tweets by keyword/hashtag ($0.01 USDC)
 * GET /api/x/trending       — Trending topics by region ($0.005 USDC)
 * GET /api/x/user/:handle   — User profile with engagement metrics ($0.01 USDC)
 * GET /api/x/user/:handle/tweets — User timeline ($0.01 USDC)
 * GET /api/x/thread/:tweet_id    — Thread/conversation extraction ($0.02 USDC)
 *
 * All endpoints use x402 payment flow and route through the self-hosted
 * SearXNG / OpenSERP scraping layer (no Twitter API key required).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchTwitter,
  getTwitterTrending,
  getUserProfile,
  getUserTimeline,
  getThread,
} from '../scrapers/twitter';

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_SEARCH    = 0.01;
const PRICE_TRENDING  = 0.005;
const PRICE_USER      = 0.01;
const PRICE_TIMELINE  = 0.01;
const PRICE_THREAD    = 0.02;

const MAX_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_QUERY_LENGTH = 200;
const MAX_HANDLE_LENGTH = 64;
const MAX_TWEET_ID_LENGTH = 20;

// ─── RATE LIMITING ────────────────────────────────────────────────────────────

const X_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(parseInt(process.env.X_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 300),
);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function normalizeClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp    = c.req.header('x-real-ip')?.trim();
  const cfIp      = c.req.header('cf-connecting-ip')?.trim();
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
  if (entry.count > X_RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────

function parseLimit(limitParam: string | undefined, defaultVal = 20): number {
  const parsed = Number.parseInt(limitParam ?? String(defaultVal), 10);
  if (!Number.isFinite(parsed)) return defaultVal;
  return Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
}

function parseDays(daysParam: string | undefined, defaultVal = 30): number {
  const parsed = Number.parseInt(daysParam ?? String(defaultVal), 10);
  if (!Number.isFinite(parsed)) return defaultVal;
  return Math.min(Math.max(parsed, 1), 365);
}

function parseCountry(countryParam: string | undefined): string {
  if (!countryParam) return 'US';
  const normalized = countryParam.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return 'US';
  return normalized;
}

function toSafeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '').slice(0, 256);
}

/**
 * Shared middleware checks: WALLET_ADDRESS, rate limit, payment.
 * Returns null to continue, or a Response to short-circuit.
 */
async function requirePayment(
  c: Context,
  path: string,
  description: string,
  price: number,
  outputSchema: Record<string, unknown>,
): Promise<Response | null> {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      { error: `Rate limit exceeded for ${path}`, retryAfter: rateStatus.retryAfter },
      429,
    );
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(path, description, price, WALLET_ADDRESS, outputSchema),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, price);
  } catch (error) {
    console.error(`[x-twitter] Payment verification error on ${path}:`, error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  // Attach verified payment info to context for handler use
  c.set('payment', payment);
  c.set('verification', verification);

  return null; // proceed
}

// ─── OUTPUT SCHEMAS ───────────────────────────────────────────────────────────

const SEARCH_SCHEMA = {
  input: {
    q:     'string (required) — keyword, phrase, or hashtag to search',
    limit: 'number (optional, default: 20, max: 50)',
    days:  'number (optional, default: 30) — recency window in days',
  },
  output: {
    query:        'string',
    results:      'TwitterResult[] — { tweetId, author, text, url, likes, retweets, engagementScore, publishedAt, platform }',
    count:        'number',
    generated_at: 'string (ISO 8601)',
    meta:         '{ proxy: { ip, country, type }, payment: { txHash, network, amount, settled } }',
  },
};

const TRENDING_SCHEMA = {
  input: {
    country: 'string (optional, default: "US") — ISO-3166-1 alpha-2 country code',
    limit:   'number (optional, default: 20, max: 50)',
  },
  output: {
    country:      'string',
    results:      'TwitterResult[]',
    count:        'number',
    generated_at: 'string (ISO 8601)',
    meta:         '{ proxy: { ip, country, type }, payment: { txHash, network, amount, settled } }',
  },
};

const USER_PROFILE_SCHEMA = {
  input: {
    handle: 'string (path param) — Twitter/X username without @',
  },
  output: {
    profile: '{ handle, displayName, bio, followersEstimate, tweetsFound, profileUrl, platform }',
    generated_at: 'string (ISO 8601)',
    meta: '{ proxy: { ip, country, type }, payment: { txHash, network, amount, settled } }',
  },
};

const USER_TWEETS_SCHEMA = {
  input: {
    handle: 'string (path param) — Twitter/X username without @',
    limit:  'number (optional, default: 20, max: 50)',
    days:   'number (optional, default: 30) — recency window in days',
  },
  output: {
    handle:       'string',
    results:      'TwitterResult[]',
    count:        'number',
    generated_at: 'string (ISO 8601)',
    meta:         '{ proxy: { ip, country, type }, payment: { txHash, network, amount, settled } }',
  },
};

const THREAD_SCHEMA = {
  input: {
    tweet_id: 'string (path param) — numeric tweet/status ID',
  },
  output: {
    tweetId:      'string',
    results:      'TwitterResult[]',
    count:        'number',
    generated_at: 'string (ISO 8601)',
    meta:         '{ proxy: { ip, country, type }, payment: { txHash, network, amount, settled } }',
  },
};

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const xTwitterRouter = new Hono();

// ─── GET /api/x/search ───────────────────────────────────────────────────────

xTwitterRouter.get('/search', async (c) => {
  const path = '/api/x/search';
  const description =
    'X/Twitter Real-Time Search: search tweets and posts by keyword, phrase, or hashtag. ' +
    'Returns engagement-ranked tweet results with text, author, URL, and timestamps.';

  const early = await requirePayment(c, path, description, PRICE_SEARCH, SEARCH_SCHEMA);
  if (early) return early;

  const payment      = c.get('payment') as ReturnType<typeof extractPayment>;
  const verification = c.get('verification') as Awaited<ReturnType<typeof verifyPayment>>;

  const rawQ = c.req.query('q') ?? '';
  const q = rawQ.replace(/[\r\n\0]+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);

  if (!q) {
    return c.json({ error: 'Query parameter "q" is required.' }, 400);
  }

  const limit = parseLimit(c.req.query('limit'));
  const days  = parseDays(c.req.query('days'));

  const proxyConfig = getProxy();

  let results: Awaited<ReturnType<typeof searchTwitter>>;
  try {
    results = await searchTwitter(q, days, limit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[x-twitter] searchTwitter error:', msg);
    return c.json({ error: 'Upstream search failed', detail: msg }, 502);
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment!.txHash));

  return c.json({
    query:        q,
    results,
    count:        results.length,
    generated_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip:      null,
        country: proxyConfig.country,
        type:    'mobile',
      },
      payment: {
        txHash:  payment!.txHash,
        network: payment!.network,
        amount:  verification.amount ?? PRICE_SEARCH,
        settled: true,
      },
    },
  });
});

// ─── GET /api/x/trending ─────────────────────────────────────────────────────

xTwitterRouter.get('/trending', async (c) => {
  const path = '/api/x/trending';
  const description =
    'X/Twitter Trending Topics: fetch what is trending on Twitter/X for a given region. ' +
    'Returns engagement-ranked tweet results representing trending signals.';

  const early = await requirePayment(c, path, description, PRICE_TRENDING, TRENDING_SCHEMA);
  if (early) return early;

  const payment      = c.get('payment') as ReturnType<typeof extractPayment>;
  const verification = c.get('verification') as Awaited<ReturnType<typeof verifyPayment>>;

  const country = parseCountry(c.req.query('country'));
  const limit   = parseLimit(c.req.query('limit'));

  const proxyConfig = getProxy();

  let results: Awaited<ReturnType<typeof getTwitterTrending>>;
  try {
    results = await getTwitterTrending(country, limit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[x-twitter] getTwitterTrending error:', msg);
    return c.json({ error: 'Upstream trending fetch failed', detail: msg }, 502);
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment!.txHash));

  return c.json({
    country,
    results,
    count:        results.length,
    generated_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip:      null,
        country: proxyConfig.country,
        type:    'mobile',
      },
      payment: {
        txHash:  payment!.txHash,
        network: payment!.network,
        amount:  verification.amount ?? PRICE_TRENDING,
        settled: true,
      },
    },
  });
});

// ─── GET /api/x/user/:handle ─────────────────────────────────────────────────

xTwitterRouter.get('/user/:handle', async (c) => {
  const rawHandle = c.req.param('handle') ?? '';
  const handle    = rawHandle.replace(/^@/, '').replace(/[\r\n\0]+/g, '').trim().slice(0, MAX_HANDLE_LENGTH);

  const path        = `/api/x/user/${handle}`;
  const description =
    'X/Twitter User Profile: retrieve public profile information and engagement metrics for a given handle. ' +
    'Returns display name, bio, estimated follower signals, and recent tweet count.';

  const early = await requirePayment(c, '/api/x/user/:handle', description, PRICE_USER, USER_PROFILE_SCHEMA);
  if (early) return early;

  const payment      = c.get('payment') as ReturnType<typeof extractPayment>;
  const verification = c.get('verification') as Awaited<ReturnType<typeof verifyPayment>>;

  if (!handle) {
    return c.json({ error: 'Path parameter "handle" is required.' }, 400);
  }

  const proxyConfig = getProxy();

  let profile: Awaited<ReturnType<typeof getUserProfile>>;
  try {
    profile = await getUserProfile(handle);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[x-twitter] getUserProfile error for @${handle}:`, msg);
    return c.json({ error: 'Upstream profile fetch failed', detail: msg }, 502);
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment!.txHash));

  return c.json({
    profile,
    generated_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip:      null,
        country: proxyConfig.country,
        type:    'mobile',
      },
      payment: {
        txHash:  payment!.txHash,
        network: payment!.network,
        amount:  verification.amount ?? PRICE_USER,
        settled: true,
      },
    },
  });
});

// ─── GET /api/x/user/:handle/tweets ──────────────────────────────────────────

xTwitterRouter.get('/user/:handle/tweets', async (c) => {
  const rawHandle = c.req.param('handle') ?? '';
  const handle    = rawHandle.replace(/^@/, '').replace(/[\r\n\0]+/g, '').trim().slice(0, MAX_HANDLE_LENGTH);

  const description =
    'X/Twitter User Timeline: fetch recent tweets from a given handle. ' +
    'Returns engagement-ranked tweet results with text, URL, and timestamps.';

  const early = await requirePayment(c, '/api/x/user/:handle/tweets', description, PRICE_TIMELINE, USER_TWEETS_SCHEMA);
  if (early) return early;

  const payment      = c.get('payment') as ReturnType<typeof extractPayment>;
  const verification = c.get('verification') as Awaited<ReturnType<typeof verifyPayment>>;

  if (!handle) {
    return c.json({ error: 'Path parameter "handle" is required.' }, 400);
  }

  const limit = parseLimit(c.req.query('limit'));
  const days  = parseDays(c.req.query('days'));

  const proxyConfig = getProxy();

  let results: Awaited<ReturnType<typeof getUserTimeline>>;
  try {
    results = await getUserTimeline(handle, limit, days);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[x-twitter] getUserTimeline error for @${handle}:`, msg);
    return c.json({ error: 'Upstream timeline fetch failed', detail: msg }, 502);
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment!.txHash));

  return c.json({
    handle,
    results,
    count:        results.length,
    generated_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip:      null,
        country: proxyConfig.country,
        type:    'mobile',
      },
      payment: {
        txHash:  payment!.txHash,
        network: payment!.network,
        amount:  verification.amount ?? PRICE_TIMELINE,
        settled: true,
      },
    },
  });
});

// ─── GET /api/x/thread/:tweet_id ─────────────────────────────────────────────

xTwitterRouter.get('/thread/:tweet_id', async (c) => {
  const rawId  = c.req.param('tweet_id') ?? '';
  const tweetId = rawId.replace(/\D/g, '').slice(0, MAX_TWEET_ID_LENGTH);

  const description =
    'X/Twitter Thread Extraction: fetch all publicly indexed tweets in a thread or conversation ' +
    'anchored at a given tweet ID. Returns deduplicated tweet results with text and URLs.';

  const early = await requirePayment(c, '/api/x/thread/:tweet_id', description, PRICE_THREAD, THREAD_SCHEMA);
  if (early) return early;

  const payment      = c.get('payment') as ReturnType<typeof extractPayment>;
  const verification = c.get('verification') as Awaited<ReturnType<typeof verifyPayment>>;

  if (!tweetId) {
    return c.json({ error: 'Path parameter "tweet_id" must be a numeric tweet/status ID.' }, 400);
  }

  const proxyConfig = getProxy();

  let results: Awaited<ReturnType<typeof getThread>>;
  try {
    results = await getThread(tweetId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[x-twitter] getThread error for tweet ${tweetId}:`, msg);
    return c.json({ error: 'Upstream thread fetch failed', detail: msg }, 502);
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment!.txHash));

  return c.json({
    tweetId,
    results,
    count:        results.length,
    generated_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip:      null,
        country: proxyConfig.country,
        type:    'mobile',
      },
      payment: {
        txHash:  payment!.txHash,
        network: payment!.network,
        amount:  verification.amount ?? PRICE_THREAD,
        settled: true,
      },
    },
  });
});
