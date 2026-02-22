/**
 * Reddit Intelligence API Routes (Bounty #68)
 *
 * GET /api/reddit/search?query=keyword&subreddit=all&sort=relevance&time=week&limit=25
 * GET /api/reddit/trending?limit=25
 * GET /api/reddit/subreddit/:name/top?time=day&limit=25
 * GET /api/reddit/thread/:id/comments?sort=best&limit=50
 * GET /api/reddit/health
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchRedditIntel,
  getRedditTrending,
  getSubredditTopIntel,
  getThreadComments,
  ScraperError,
} from '../scrapers/reddit-intel';

export const redditRouter = new Hono();

const SEARCH_PRICE = 0.005;
const THREAD_PRICE = 0.01;

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

const POST_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    subreddit: { type: 'string' },
    author: { type: 'string' },
    score: { type: 'number' },
    upvoteRatio: { type: 'number' },
    numComments: { type: 'number' },
    url: { type: 'string' },
    permalink: { type: 'string' },
    selftext: { type: 'string' },
    created: { type: 'string', format: 'date-time' },
    isNsfw: { type: 'boolean' },
    flair: { type: 'string', nullable: true },
    awards: { type: 'number' },
    crosspostCount: { type: 'number' },
    mediaType: { type: 'string', enum: ['text', 'image', 'video', 'link'] },
  },
};

const COMMENT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    author: { type: 'string' },
    body: { type: 'string' },
    score: { type: 'number' },
    created: { type: 'string', format: 'date-time' },
    isOp: { type: 'boolean' },
    depth: { type: 'number' },
    awards: { type: 'number' },
    replies: { type: 'number' },
  },
};

const SEARCH_OUTPUT_SCHEMA = {
  input: {
    query: 'string (required) — search keywords',
    subreddit: 'string (optional, default: "all") — restrict to subreddit',
    sort: '"relevance" | "hot" | "top" | "new" | "comments" (optional, default: "relevance")',
    time: '"hour" | "day" | "week" | "month" | "year" | "all" (optional, default: "week")',
    limit: 'number (optional, default: 25, max: 100)',
  },
  output: {
    results: { type: 'array', items: POST_SCHEMA, description: 'Array of matching Reddit posts' },
    query: { type: 'string' },
    subreddit: { type: 'string' },
    sort: { type: 'string' },
    time: { type: 'string' },
    resultCount: { type: 'number' },
  },
};

const TRENDING_OUTPUT_SCHEMA = {
  input: {
    limit: 'number (optional, default: 25, max: 100)',
  },
  output: {
    results: { type: 'array', items: POST_SCHEMA, description: 'Hot posts from r/all' },
    source: { type: 'string' },
    resultCount: { type: 'number' },
  },
};

const SUBREDDIT_TOP_OUTPUT_SCHEMA = {
  input: {
    name: 'string (required, in URL) — subreddit name',
    time: '"hour" | "day" | "week" | "month" | "year" | "all" (optional, default: "day")',
    limit: 'number (optional, default: 25, max: 100)',
  },
  output: {
    results: { type: 'array', items: POST_SCHEMA },
    subreddit: { type: 'string' },
    time: { type: 'string' },
    resultCount: { type: 'number' },
  },
};

const THREAD_OUTPUT_SCHEMA = {
  input: {
    id: 'string (required, in URL) — Reddit post ID (e.g., "1abc2de")',
    sort: '"best" | "top" | "new" | "controversial" | "old" | "qa" (optional, default: "best")',
    limit: 'number (optional, default: 50, max: 200)',
  },
  output: {
    post: POST_SCHEMA,
    comments: { type: 'array', items: COMMENT_SCHEMA },
    totalComments: { type: 'number' },
    commentCount: { type: 'number' },
  },
};

// ─── GET /reddit/search ──────────────────────

redditRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/reddit/search',
      'Search Reddit posts by keyword with subreddit filtering, sorting, and time range',
      SEARCH_PRICE, walletAddress, SEARCH_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/reddit/search?query=AI+agents&time=week' }, 400);

  try {
    const result = await searchRedditIntel(
      query,
      c.req.query('subreddit') || 'all',
      c.req.query('sort') || 'relevance',
      c.req.query('time') || 'week',
      parseInt(c.req.query('limit') || '25') || 25,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      resultCount: result.results.length,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Reddit search failed');
  }
});

// ─── GET /reddit/trending ────────────────────

redditRouter.get('/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/reddit/trending',
      'Get trending posts from r/all (hot)',
      SEARCH_PRICE, walletAddress, TRENDING_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getRedditTrending(parseInt(c.req.query('limit') || '25') || 25);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      resultCount: result.results.length,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Reddit trending failed');
  }
});

// ─── GET /reddit/subreddit/:name/top ─────────

redditRouter.get('/subreddit/:name/top', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/reddit/subreddit/:name/top',
      'Get top posts from a specific subreddit',
      SEARCH_PRICE, walletAddress, SUBREDDIT_TOP_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const name = c.req.param('name');
  if (!name || !/^[A-Za-z0-9_]{2,21}$/.test(name)) {
    return c.json({ error: 'Invalid subreddit name', hint: 'Use 2-21 alphanumeric characters' }, 400);
  }

  try {
    const result = await getSubredditTopIntel(
      name,
      c.req.query('time') || 'day',
      parseInt(c.req.query('limit') || '25') || 25,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      resultCount: result.results.length,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Subreddit top failed');
  }
});

// ─── GET /reddit/thread/:id/comments ─────────

redditRouter.get('/thread/:id/comments', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/reddit/thread/:id/comments',
      'Get post details and comments for a Reddit thread',
      THREAD_PRICE, walletAddress, THREAD_OUTPUT_SCHEMA,
    ), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, THREAD_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const id = c.req.param('id');
  if (!id || !/^[a-z0-9]{4,10}$/.test(id)) {
    return c.json({ error: 'Invalid thread ID', hint: 'Use the Reddit post ID (e.g., "1abc2de")' }, 400);
  }

  try {
    const result = await getThreadComments(
      id,
      c.req.query('sort') || 'best',
      parseInt(c.req.query('limit') || '50') || 50,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      commentCount: result.comments.length,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err) {
    return handleScraperError(c, err, 'Thread fetch failed');
  }
});

// ─── HEALTH ENDPOINT ────────────────────────

redditRouter.get('/health', async (c) => {
  const checks: Record<string, any> = {
    service: 'reddit-intelligence',
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

  // Check 2: Reddit reachability (lightweight HEAD)
  try {
    const r = await fetch('https://www.reddit.com/.json', {
      method: 'HEAD',
      headers: { 'User-Agent': 'HealthCheck/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    checks.checks.reddit = { status: r.ok ? 'reachable' : 'blocked', statusCode: r.status };
  } catch {
    checks.checks.reddit = { status: 'unreachable' };
  }

  // Check 3: Payment config
  const wallet = process.env.WALLET_ADDRESS;
  checks.checks.payment = { configured: !!wallet, network: ['solana', 'base'] };

  // Check 4: Endpoints available
  checks.checks.endpoints = {
    search: '/api/reddit/search',
    trending: '/api/reddit/trending',
    subredditTop: '/api/reddit/subreddit/:name/top',
    threadComments: '/api/reddit/thread/:id/comments',
  };

  const allChecks = checks.checks as Record<string, any>;
  checks.status = Object.values(allChecks).every((ch: any) => ch.status !== 'error') ? 'healthy' : 'degraded';
  return c.json(checks);
});
