/**
 * Twitter/X Real-Time Search API Routes (Bounty #73)
 *
 * GET /api/twitter/search?query=keyword&limit=25&type=live
 * GET /api/twitter/trending?woeid=1
 * GET /api/twitter/user/:handle
 * GET /api/twitter/user/:handle/tweets?limit=25
 * GET /api/twitter/hashtag/:tag?limit=25
 * GET /api/twitter/health
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchTweets,
  getTrending,
  getUserProfile,
  getUserTweets,
  searchHashtag,
  ScraperError,
} from '../scrapers/twitter-search';

export const twitterSearchRouter = new Hono();

const PRICE = 0.01;

function proxyInfo() {
  try { const p = getProxy(); return { country: p.country, type: 'mobile' as const }; }
  catch { return { country: 'US', type: 'mobile' as const }; }
}

function handleScraperError(c: any, err: unknown, fallbackMsg: string) {
  if (err instanceof ScraperError) {
    if (err.retryable) c.header('Retry-After', '30');
    return c.json({ error: err.message, retryable: err.retryable }, err.statusCode);
  }
  return c.json({ error: fallbackMsg, message: (err as Error).message }, 500);
}

// ─── OUTPUT SCHEMAS ─────────────────────────

const TWEET_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    authorId: { type: 'string' },
    authorName: { type: 'string' },
    authorHandle: { type: 'string' },
    authorVerified: { type: 'boolean' },
    authorFollowers: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    likes: { type: 'number' },
    retweets: { type: 'number' },
    replies: { type: 'number' },
    views: { type: 'number' },
    url: { type: 'string' },
    mediaUrls: { type: 'array', items: { type: 'string' } },
    hashtags: { type: 'array', items: { type: 'string' } },
    language: { type: 'string' },
    isReply: { type: 'boolean' },
    isRetweet: { type: 'boolean' },
  },
};

const SEARCH_OUTPUT_SCHEMA = {
  input: {
    query: 'string (required) — search keywords, supports Twitter operators (from:user, #hashtag, etc.)',
    limit: 'number (optional, default: 25, max: 100)',
    type: '"live" | "top" (optional, default: "live") — live for chronological, top for popular',
  },
  output: {
    tweets: { type: 'array', items: TWEET_SCHEMA, description: 'Array of matching tweets' },
    query: { type: 'string' },
    resultCount: { type: 'number' },
    searchType: { type: 'string', enum: ['live', 'top'] },
    proxy: { type: 'object', properties: { country: { type: 'string' }, type: { type: 'string' } } },
  },
};

const TRENDING_OUTPUT_SCHEMA = {
  input: {
    woeid: 'number (optional, default: 1) — Where On Earth ID. 1=Worldwide, 23424977=US, 23424975=UK, 23424856=Japan',
  },
  output: {
    trends: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tweetCount: { type: 'number' },
          url: { type: 'string' },
          category: { type: 'string' },
        },
      },
    },
    location: { type: 'string' },
    resultCount: { type: 'number' },
  },
};

const USER_PROFILE_OUTPUT_SCHEMA = {
  input: {
    handle: 'string (required, in URL) — Twitter handle without @ (e.g., "elonmusk")',
  },
  output: {
    profile: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        handle: { type: 'string' },
        bio: { type: 'string' },
        followers: { type: 'number' },
        following: { type: 'number' },
        tweetCount: { type: 'number' },
        verified: { type: 'boolean' },
        joinedAt: { type: 'string', format: 'date-time' },
        profileImageUrl: { type: 'string' },
        bannerUrl: { type: 'string' },
        url: { type: 'string' },
        location: { type: 'string' },
      },
    },
  },
};

const USER_TWEETS_OUTPUT_SCHEMA = {
  input: {
    handle: 'string (required, in URL) — Twitter handle without @ (e.g., "elonmusk")',
    limit: 'number (optional, default: 25, max: 100)',
  },
  output: {
    tweets: { type: 'array', items: TWEET_SCHEMA },
    query: { type: 'string', description: '"from:{handle}"' },
    resultCount: { type: 'number' },
  },
};

const HASHTAG_OUTPUT_SCHEMA = {
  input: {
    tag: 'string (required, in URL) — hashtag without # (e.g., "AI")',
    limit: 'number (optional, default: 25, max: 100)',
  },
  output: {
    tweets: { type: 'array', items: TWEET_SCHEMA },
    query: { type: 'string', description: '"#{tag}"' },
    resultCount: { type: 'number' },
  },
};

// ─── SEARCH TWEETS ──────────────────────────

twitterSearchRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/twitter/search',
      'Real-time Twitter/X search — returns tweets with full metadata: text, author, stats (likes, retweets, replies, views), media, hashtags',
      PRICE, walletAddress, SEARCH_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/twitter/search?query=AI+agents&type=live' }, 400);

  const searchType = (c.req.query('type') || 'live') as 'live' | 'top';
  if (!['live', 'top'].includes(searchType)) {
    return c.json({ error: 'Invalid type parameter. Use: live or top' }, 400);
  }

  try {
    const result = await searchTweets(
      query,
      parseInt(c.req.query('limit') || '25') || 25,
      searchType,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Twitter search failed');
  }
});

// ─── TRENDING ───────────────────────────────

twitterSearchRouter.get('/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/twitter/trending',
      'Get Twitter/X trending topics by location (WOEID). Default: worldwide',
      PRICE, walletAddress, TRENDING_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const woeid = parseInt(c.req.query('woeid') || '1') || 1;
    const result = await getTrending(woeid);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Trending fetch failed');
  }
});

// ─── USER PROFILE ───────────────────────────

twitterSearchRouter.get('/user/:handle', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const handle = c.req.param('handle');

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/twitter/user/:handle',
      'Get Twitter/X user profile — name, bio, followers, following, tweet count, verified status',
      PRICE, walletAddress, USER_PROFILE_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return c.json({ error: 'Invalid handle', hint: 'Use 1-15 alphanumeric characters or underscores, without @' }, 400);
  }

  try {
    const profile = await getUserProfile(handle);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      handle,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'User profile fetch failed');
  }
});

// ─── USER TWEETS ────────────────────────────

twitterSearchRouter.get('/user/:handle/tweets', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/twitter/user/:handle/tweets',
      'Get recent tweets from a Twitter/X user',
      PRICE, walletAddress, USER_TWEETS_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const handle = c.req.param('handle');
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return c.json({ error: 'Invalid handle', hint: 'Use 1-15 alphanumeric characters or underscores, without @' }, 400);
  }

  try {
    const result = await getUserTweets(
      handle,
      parseInt(c.req.query('limit') || '25') || 25,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'User tweets fetch failed');
  }
});

// ─── HASHTAG SEARCH ─────────────────────────

twitterSearchRouter.get('/hashtag/:tag', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/twitter/hashtag/:tag',
      'Search Twitter/X tweets by hashtag',
      PRICE, walletAddress, HASHTAG_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const tag = c.req.param('tag');
  if (!tag || tag.length < 1 || tag.length > 200) {
    return c.json({ error: 'Invalid hashtag', hint: 'Provide 1-200 character hashtag without #' }, 400);
  }

  try {
    const result = await searchHashtag(
      tag,
      parseInt(c.req.query('limit') || '25') || 25,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Hashtag search failed');
  }
});

// ─── HEALTH ENDPOINT ────────────────────────

twitterSearchRouter.get('/health', async (c) => {
  const checks: Record<string, any> = {
    service: 'twitter-search-intelligence',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
  };

  // Check 1: Proxy connectivity
  try {
    const proxy = getProxy();
    checks.checks.proxy = { status: 'configured', country: proxy.country };
  } catch {
    checks.checks.proxy = { status: 'not_configured', fallback: 'direct' };
  }

  // Check 2: Twitter reachability (lightweight HEAD)
  try {
    const r = await fetch('https://twitter.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    checks.checks.twitter = { status: r.ok ? 'reachable' : 'blocked', statusCode: r.status };
  } catch {
    checks.checks.twitter = { status: 'unreachable' };
  }

  // Check 3: Payment config
  const wallet = process.env.WALLET_ADDRESS;
  checks.checks.payment = { configured: !!wallet, network: ['solana', 'base'] };

  // Check 4: Endpoints available
  checks.checks.endpoints = {
    search: '/api/twitter/search',
    trending: '/api/twitter/trending',
    userProfile: '/api/twitter/user/:handle',
    userTweets: '/api/twitter/user/:handle/tweets',
    hashtag: '/api/twitter/hashtag/:tag',
  };

  const allChecks = checks.checks as Record<string, any>;
  checks.status = Object.values(allChecks).every((ch: any) => ch.status !== 'error') ? 'healthy' : 'degraded';
  return c.json(checks);
});
