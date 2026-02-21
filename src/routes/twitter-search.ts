/**
 * Twitter/X Real-Time Search API Routes (Bounty #73)
 *
 * GET /api/twitter-search/search?query=keyword&limit=25&type=live
 * GET /api/twitter-search/trending?woeid=1
 * GET /api/twitter-search/user/:handle
 * GET /api/twitter-search/user/:handle/tweets?limit=25
 * GET /api/twitter-search/hashtag/:tag?limit=25
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
} from '../scrapers/twitter-search';

export const twitterSearchRouter = new Hono();

const PRICE = 0.01;

function proxyInfo() {
  try { const p = getProxy(); return { country: p.country, type: 'mobile' as const }; }
  catch { return { country: 'US', type: 'mobile' as const }; }
}

// ─── SEARCH TWEETS ──────────────────────────

twitterSearchRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/twitter-search/search', 'Real-time Twitter/X search — returns tweets with full metadata: text, author, stats (likes, retweets, replies, views), media, hashtags', PRICE, walletAddress, {
      input: {
        query: 'string (required) — search keywords, supports Twitter operators (from:user, #hashtag, etc.)',
        limit: 'number (optional, default: 25, max: 100)',
        type: '"live" | "top" (optional, default: "live") — live for chronological, top for popular',
      },
      output: {
        tweets: 'Tweet[] — id, text, authorId, authorName, authorHandle, authorVerified, authorFollowers, createdAt, likes, retweets, replies, views, url, mediaUrls, hashtags, language, isReply, isRetweet',
        query: 'string',
        resultCount: 'number',
        searchType: 'string',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/twitter-search/search?query=AI+agents&type=live' }, 400);

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
  } catch (err: any) {
    return c.json({ error: 'Twitter search failed', message: err.message }, 502);
  }
});

// ─── TRENDING ───────────────────────────────

twitterSearchRouter.get('/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/twitter-search/trending', 'Get Twitter/X trending topics by location (WOEID). Default: worldwide', PRICE, walletAddress, {
      input: {
        woeid: 'number (optional, default: 1) — Where On Earth ID. 1=Worldwide, 23424977=US, 23424975=UK, 23424856=Japan',
      },
      output: {
        trends: 'Trend[] — name, tweetCount, url, category',
        location: 'string',
        resultCount: 'number',
      },
    }), 402);
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
  } catch (err: any) {
    return c.json({ error: 'Trending fetch failed', message: err.message }, 502);
  }
});

// ─── USER PROFILE ───────────────────────────

twitterSearchRouter.get('/user/:handle', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  // Check if it's the /tweets sub-route (Hono matches greedily)
  const handle = c.req.param('handle');

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/twitter-search/user/:handle', 'Get Twitter/X user profile — name, bio, followers, following, tweet count, verified status', PRICE, walletAddress, {
      input: {
        handle: 'string (required, in URL) — Twitter handle without @ (e.g., "elonmusk")',
      },
      output: {
        profile: 'UserProfile | null — id, name, handle, bio, followers, following, tweetCount, verified, joinedAt, profileImageUrl, bannerUrl, url, location',
      },
    }), 402);
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
  } catch (err: any) {
    return c.json({ error: 'User profile fetch failed', message: err.message }, 502);
  }
});

// ─── USER TWEETS ────────────────────────────

twitterSearchRouter.get('/user/:handle/tweets', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/twitter-search/user/:handle/tweets', 'Get recent tweets from a Twitter/X user', PRICE, walletAddress, {
      input: {
        handle: 'string (required, in URL) — Twitter handle without @ (e.g., "elonmusk")',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        tweets: 'Tweet[] — id, text, authorName, authorHandle, createdAt, likes, retweets, replies, views, url, mediaUrls, hashtags',
        query: 'string — "from:{handle}"',
        resultCount: 'number',
      },
    }), 402);
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
  } catch (err: any) {
    return c.json({ error: 'User tweets fetch failed', message: err.message }, 502);
  }
});

// ─── HASHTAG SEARCH ─────────────────────────

twitterSearchRouter.get('/hashtag/:tag', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/twitter-search/hashtag/:tag', 'Search Twitter/X tweets by hashtag', PRICE, walletAddress, {
      input: {
        tag: 'string (required, in URL) — hashtag without # (e.g., "AI")',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        tweets: 'Tweet[] — id, text, authorName, authorHandle, createdAt, likes, retweets, replies, views, url, mediaUrls, hashtags',
        query: 'string — "#hashtag"',
        resultCount: 'number',
      },
    }), 402);
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
  } catch (err: any) {
    return c.json({ error: 'Hashtag search failed', message: err.message }, 502);
  }
});
