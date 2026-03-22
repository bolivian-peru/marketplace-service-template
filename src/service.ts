/**
 * X/Twitter Real-Time Search API — Proxies.sx Bounty #73
 * ────────────────────────────────────────────────────────
 * Routes:
 *   GET /api/x/search?query=&sort=latest&limit=20
 *   GET /api/x/trending?country=US
 *   GET /api/x/user/:handle
 *   GET /api/x/user/:handle/tweets?limit=20
 *   GET /api/x/thread/:tweet_id
 *
 * All requests are routed through Proxies.sx mobile proxies.
 * All endpoints are gated with x402 USDC micropayments.
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import {
  searchTweets,
  getTrending,
  getUserProfile,
  getUserTweets,
  getThread,
} from './scrapers/x-scraper';

export const serviceRouter = new Hono();

// ─── PRICING ────────────────────────────────────────

const SEARCH_PRICE   = 0.01;   // $0.01 per search
const TRENDING_PRICE = 0.005;  // $0.005 per trending fetch
const PROFILE_PRICE  = 0.01;   // $0.01 per user profile
const THREAD_PRICE   = 0.02;   // $0.02 per thread extraction

// ─── RATE LIMITING (protect proxy quota) ────────────

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

// ─── HELPERS ────────────────────────────────────────

function getWallet(): string {
  const w = process.env.WALLET_ADDRESS;
  if (!w) throw new Error('WALLET_ADDRESS not set');
  return w;
}

function rateLimitCheck(c: any): boolean {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return checkProxyRateLimit(ip);
}

// ─── GET /api/x/search ──────────────────────────────

serviceRouter.get('/x/search', async (c) => {
  const walletAddress = getWallet();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/x/search',
        'Search X/Twitter in real-time by keyword, hashtag, or from:user. Returns full tweet data including text, engagement metrics, and author info.',
        SEARCH_PRICE,
        walletAddress,
        {
          input: {
            query: 'string (required) — search keyword, hashtag (#ai), or from:user',
            sort: '"latest" | "top" (default: "latest")',
            limit: 'number (default: 20, max: 40)',
            cursor: 'string (optional) — pagination cursor from previous response',
          },
          output: {
            query: 'string',
            sort: 'string',
            results: [{
              id: 'string',
              author: { handle: 'string', name: 'string', followers: 'number', verified: 'boolean' },
              text: 'string',
              created_at: 'string (RFC2822)',
              likes: 'number',
              retweets: 'number',
              replies: 'number',
              views: 'number',
              url: 'string',
              media: 'string[]',
              hashtags: 'string[]',
              is_retweet: 'boolean',
            }],
            meta: {
              total_results: 'number',
              cursor: 'string | undefined',
              proxy: { ip: 'string', country: 'string', carrier: 'string' },
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  if (!rateLimitCheck(c)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      example: '/api/x/search?query=bitcoin&sort=latest&limit=20',
    }, 400);
  }

  const sortParam = c.req.query('sort') || 'latest';
  const sort = (sortParam === 'top' ? 'top' : 'latest') as 'latest' | 'top';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 40);
  const cursor = c.req.query('cursor') || undefined;

  try {
    const proxy = getProxy();
    const result = await searchTweets(query, sort, limit, cursor);

    // Inject proxy metadata
    result.meta.proxy = {
      ip: result.meta.proxy.ip || proxy.host,
      country: proxy.country,
      carrier: 'T-Mobile (mobile)',
    };

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'X search failed',
      message: err.message,
      hint: 'X may have rotated its guest token. The service will auto-retry on the next request.',
    }, 502);
  }
});

// ─── GET /api/x/trending ────────────────────────────

serviceRouter.get('/x/trending', async (c) => {
  const walletAddress = getWallet();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/x/trending',
        'Get trending topics on X/Twitter by country. Returns top 20 trends with tweet volume.',
        TRENDING_PRICE,
        walletAddress,
        {
          input: {
            country: 'string (optional, default: "US") — 2-letter country code: US, GB, CA, AU, IN, DE, FR, JP, BR, MX, ES, IT, KR, ...',
          },
          output: {
            country: 'string',
            trends: [{
              name: 'string',
              tweet_count: 'string',
              url: 'string',
              category: 'string | undefined',
            }],
            meta: { proxy: { country: 'string' } },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, TRENDING_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  if (!rateLimitCheck(c)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const country = (c.req.query('country') || 'US').toUpperCase();

  try {
    const proxy = getProxy();
    const trends = await getTrending(country);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      country,
      trends,
      meta: {
        proxy: { country: proxy.country, type: 'mobile' },
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
      error: 'Trending fetch failed',
      message: err.message,
    }, 502);
  }
});

// ─── GET /api/x/user/:handle ────────────────────────

serviceRouter.get('/x/user/:handle', async (c) => {
  const walletAddress = getWallet();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/x/user/:handle',
        'Extract X/Twitter user profile: followers, bio, engagement metrics, verification status.',
        PROFILE_PRICE,
        walletAddress,
        {
          input: {
            handle: 'string (required, in URL path) — X/Twitter handle (with or without @)',
          },
          output: {
            profile: {
              handle: 'string',
              name: 'string',
              bio: 'string',
              followers: 'number',
              following: 'number',
              tweets_count: 'number',
              verified: 'boolean',
              created_at: 'string',
              location: 'string',
              website: 'string',
              profile_image_url: 'string',
              banner_url: 'string',
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PROFILE_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  if (!rateLimitCheck(c)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const handle = c.req.param('handle');
  if (!handle) {
    return c.json({ error: 'Missing handle in URL path', example: '/api/x/user/elonmusk' }, 400);
  }

  try {
    const proxy = getProxy();
    const profile = await getUserProfile(handle);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Profile fetch failed',
      message: err.message,
      hint: 'User may not exist or their account may be protected/suspended.',
    }, 502);
  }
});

// ─── GET /api/x/user/:handle/tweets ─────────────────

serviceRouter.get('/x/user/:handle/tweets', async (c) => {
  const walletAddress = getWallet();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/x/user/:handle/tweets',
        'Get recent tweets from an X/Twitter user. Returns tweet text, engagement metrics, and media.',
        PROFILE_PRICE,
        walletAddress,
        {
          input: {
            handle: 'string (required, in URL path) — X/Twitter handle',
            limit: 'number (default: 20, max: 40)',
          },
          output: {
            tweets: 'XTweet[] — list of tweets with full engagement metrics',
            meta: { handle: 'string', count: 'number', proxy: 'ProxyInfo' },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PROFILE_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  if (!rateLimitCheck(c)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const handle = c.req.param('handle');
  if (!handle) {
    return c.json({ error: 'Missing handle in URL path' }, 400);
  }

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 40);

  try {
    const proxy = getProxy();
    const tweets = await getUserTweets(handle, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      tweets,
      meta: {
        handle,
        count: tweets.length,
        proxy: { country: proxy.country, type: 'mobile' },
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
      error: 'Tweet fetch failed',
      message: err.message,
    }, 502);
  }
});

// ─── GET /api/x/thread/:tweet_id ────────────────────

serviceRouter.get('/x/thread/:tweet_id', async (c) => {
  const walletAddress = getWallet();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/x/thread/:tweet_id',
        'Extract full conversation thread from a tweet ID. Returns root tweet + all replies.',
        THREAD_PRICE,
        walletAddress,
        {
          input: {
            tweet_id: 'string (required, in URL path) — Tweet ID (numeric string)',
          },
          output: {
            root: 'XTweet — the original tweet',
            replies: 'XTweet[] — conversation replies (up to 20)',
            meta: { proxy: 'ProxyInfo' },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, THREAD_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  if (!rateLimitCheck(c)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const tweetId = c.req.param('tweet_id');
  if (!tweetId || !/^\d+$/.test(tweetId)) {
    return c.json({
      error: 'Invalid tweet_id — must be a numeric string',
      example: '/api/x/thread/1234567890123456789',
    }, 400);
  }

  try {
    const proxy = getProxy();
    const thread = await getThread(tweetId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...thread,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
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
      hint: 'Tweet may not exist, have been deleted, or X blocked the request.',
    }, 502);
  }
});
