/**
 * Service Router — X/Twitter Real-Time Search API (Bounty #73)
 *
 * Endpoints:
 *   GET /api/x/search
 *   GET /api/x/trending
 *   GET /api/x/user/:handle
 *   GET /api/x/user/:handle/tweets
 *   GET /api/x/thread/:tweet_id
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchTweets, getTrending, getUserProfile, getUserTweets, getThread } from './scrapers/x-twitter-scraper';

export const serviceRouter = new Hono();

const WALLET_ADDRESS = '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
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

// ─── GET /api/x/search ──────────────────────────────

serviceRouter.get('/x/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/x/search',
      'Search X/Twitter tweets by keyword/hashtag. Returns tweet text, author, engagement metrics.',
      0.01,
      WALLET_ADDRESS,
      {
        input: {
          query: 'string (required) — search keywords or #hashtag',
          sort: '"latest" | "top" (optional, default: "latest")',
          limit: 'number (optional, default: 20, max: 50)',
        },
        output: {
          query: 'string',
          results: 'TweetResult[] — { id, author: { handle, name, verified }, text, created_at, likes, retweets, replies, url, hashtags }',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.01);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query' }, 400);
  const sort = (c.req.query('sort') || 'latest') as 'latest' | 'top';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const results = await searchTweets(query, sort, limit, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      query,
      results,
      meta: {
        total_results: results.length,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/x/trending ────────────────────────────

serviceRouter.get('/x/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/x/trending',
      'Get trending topics on X/Twitter by country.',
      0.005,
      WALLET_ADDRESS,
      {
        input: { country: 'string (optional, default: "US") — ISO 2-letter country code' },
        output: { country: 'string', topics: 'TrendingTopic[] — { name, tweet_count, category, url }' },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.005);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const country = c.req.query('country') || 'US';

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const topics = await getTrending(country, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      country,
      topics,
      meta: {
        total_topics: topics.length,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Trending fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/x/user/:handle ────────────────────────

serviceRouter.get('/x/user/:handle', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/x/user/:handle',
      'Get X/Twitter user profile with followers, bio, verification status.',
      0.01,
      WALLET_ADDRESS,
      {
        input: { handle: 'string (required, in URL path) — X/Twitter username without @' },
        output: { profile: 'XUserProfile — { handle, name, bio, location, followers, following, tweets_count, verified, joined, profile_image, banner_image }' },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.01);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const handle = c.req.param('handle');
  if (!handle) return c.json({ error: 'Missing handle in URL path' }, 400);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const profile = await getUserProfile(handle, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: { proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Profile fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/x/user/:handle/tweets ─────────────────

serviceRouter.get('/x/user/:handle/tweets', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/x/user/:handle/tweets',
      'Get recent tweets from an X/Twitter user.',
      0.01,
      WALLET_ADDRESS,
      {
        input: {
          handle: 'string (required, in URL path)',
          limit: 'number (optional, default: 20, max: 50)',
        },
        output: { handle: 'string', tweets: 'TweetResult[]' },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.01);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const handle = c.req.param('handle');
  if (!handle) return c.json({ error: 'Missing handle in URL path' }, 400);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const tweets = await getUserTweets(handle, limit, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      handle,
      tweets,
      meta: {
        total_tweets: tweets.length,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Tweets fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/x/thread/:tweet_id ────────────────────

serviceRouter.get('/x/thread/:tweet_id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/x/thread/:tweet_id',
      'Extract full conversation thread from a tweet ID.',
      0.02,
      WALLET_ADDRESS,
      {
        input: { tweet_id: 'string (required, in URL path) — numeric tweet/post ID' },
        output: { tweet_id: 'string', thread: 'ThreadTweet[] — { id, author, text, created_at, likes, retweets, replies }' },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.02);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const tweetId = c.req.param('tweet_id');
  if (!tweetId) return c.json({ error: 'Missing tweet_id in URL path' }, 400);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const thread = await getThread(tweetId, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      tweet_id: tweetId,
      thread,
      meta: {
        thread_length: thread.length,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Thread extraction failed', message: err?.message || String(err) }, 502);
  }
});
