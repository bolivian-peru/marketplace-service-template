/**
 * Reddit Intelligence API Routes (Bounty #68)
 *
 * GET /api/reddit/search?query=keyword&subreddit=all&sort=relevance&time=week&limit=25
 * GET /api/reddit/trending?limit=25
 * GET /api/reddit/subreddit/:name/top?time=day&limit=25
 * GET /api/reddit/thread/:id/comments?sort=best&limit=50
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchRedditIntel,
  getRedditTrending,
  getSubredditTopIntel,
  getThreadComments,
} from '../scrapers/reddit-intel';

export const redditRouter = new Hono();

const SEARCH_PRICE = 0.005;
const THREAD_PRICE = 0.01;

// ─── GET /reddit/search ──────────────────────

redditRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/search', 'Search Reddit posts by keyword with subreddit filtering, sorting, and time range', SEARCH_PRICE, walletAddress, {
      input: {
        query: 'string (required) — search keywords',
        subreddit: 'string (optional, default: "all") — restrict to subreddit',
        sort: '"relevance" | "hot" | "top" | "new" | "comments" (optional, default: "relevance")',
        time: '"hour" | "day" | "week" | "month" | "year" | "all" (optional, default: "week")',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        results: 'RedditPost[] — id, title, subreddit, author, score, upvoteRatio, numComments, url, permalink, selftext, created, isNsfw, flair, awards, crosspostCount, mediaType',
        query: 'string',
        subreddit: 'string',
        sort: 'string',
        time: 'string',
      },
    }), 402);
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

    let proxyInfo = { country: 'US', type: 'mobile' as const };
    try { const p = getProxy(); proxyInfo = { country: p.country, type: 'mobile' }; } catch {}

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      resultCount: result.results.length,
      proxy: proxyInfo,
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reddit search failed', message: err.message }, 502);
  }
});

// ─── GET /reddit/trending ────────────────────

redditRouter.get('/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/trending', 'Get trending posts from r/all (hot)', SEARCH_PRICE, walletAddress, {
      input: { limit: 'number (optional, default: 25, max: 100)' },
      output: { results: 'RedditPost[]', source: 'string' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getRedditTrending(parseInt(c.req.query('limit') || '25') || 25);

    let proxyInfo = { country: 'US', type: 'mobile' as const };
    try { const p = getProxy(); proxyInfo = { country: p.country, type: 'mobile' }; } catch {}

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      resultCount: result.results.length,
      proxy: proxyInfo,
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reddit trending failed', message: err.message }, 502);
  }
});

// ─── GET /reddit/subreddit/:name/top ─────────

redditRouter.get('/subreddit/:name/top', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/subreddit/:name/top', 'Get top posts from a specific subreddit', SEARCH_PRICE, walletAddress, {
      input: {
        name: 'string (required, in URL) — subreddit name',
        time: '"hour" | "day" | "week" | "month" | "year" | "all" (optional, default: "day")',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: { results: 'RedditPost[]', subreddit: 'string', time: 'string' },
    }), 402);
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

    let proxyInfo = { country: 'US', type: 'mobile' as const };
    try { const p = getProxy(); proxyInfo = { country: p.country, type: 'mobile' }; } catch {}

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      resultCount: result.results.length,
      proxy: proxyInfo,
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Subreddit top failed', message: err.message }, 502);
  }
});

// ─── GET /reddit/thread/:id/comments ─────────

redditRouter.get('/thread/:id/comments', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/thread/:id/comments', 'Get post details and comments for a Reddit thread', THREAD_PRICE, walletAddress, {
      input: {
        id: 'string (required, in URL) — Reddit post ID (e.g., "1abc2de")',
        sort: '"best" | "top" | "new" | "controversial" | "old" | "qa" (optional, default: "best")',
        limit: 'number (optional, default: 50, max: 200)',
      },
      output: {
        post: 'RedditPost — full post data',
        comments: 'RedditComment[] — id, author, body, score, created, isOp, depth, awards, replies',
        totalComments: 'number',
      },
    }), 402);
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

    let proxyInfo = { country: 'US', type: 'mobile' as const };
    try { const p = getProxy(); proxyInfo = { country: p.country, type: 'mobile' }; } catch {}

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      commentCount: result.comments.length,
      proxy: proxyInfo,
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Thread fetch failed', message: err.message }, 502);
  }
});
