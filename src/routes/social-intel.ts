/**
 * Social Intel API Routes
 * Aggregates Twitter/X and Reddit data with sentiment analysis
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  getSocialIntel,
  getTwitterProfile,
  getRedditUser,
  getTrendingTopicsAnalysis,
} from '../scrapers/social-intel';

export const socialIntelRouter = new Hono();

// ─── CONFIGURATION ───────────────────────────────────────

const PRICE_USDC = 0.005;
const PRICE_TRENDING = 0.01;

const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Topic/keyword to search across social platforms (required)',
    twitterLimit: 'number — Max Twitter results (default: 20, max: 50)',
    redditLimit: 'number — Max Reddit results (default: 20, max: 50)',
  },
  output: {
    query: 'string — Searched topic',
    posts: 'array of post objects with id, platform, author, text, url, engagementScore, sentiment, etc.',
    summary: {
      totalPosts: 'number',
      twitterCount: 'number',
      redditCount: 'number',
      avgEngagement: 'number',
      sentimentBreakdown: '{ positive, negative, neutral }',
      topHashtags: 'array of { tag, count }',
      trendingTopics: 'string[]',
    },
    timestamp: 'string — ISO timestamp',
  },
};

// ─── HELPER: Payment Check ────────────────────────────────

async function checkPayment(c: any, walletAddress: string, price: number = PRICE_USDC) {
  if (!walletAddress) {
    return { error: { error: 'Service misconfigured: WALLET_ADDRESS not set' }, status: 500 };
  }

  const payment = extractPayment(c);
  if (!payment) {
    return {
      error: build402Response('/api/intel', 'Social media intelligence with sentiment analysis', price, walletAddress, OUTPUT_SCHEMA),
      status: 402 as const,
      paymentRequired: true,
    };
  }

  const verification = await verifyPayment(payment, walletAddress, price);
  if (!verification.valid) {
    return {
      error: {
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount.',
      },
      status: 402 as const,
    };
  }

  return { payment, verification };
}

// ─── RATE LIMITING ────────────────────────────────────────

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20;

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  
  if (entry.count >= PROXY_RATE_LIMIT) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Cleanup rate limits periodically
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  rateLimits.forEach((entry, ip) => {
    if (now > entry.resetAt) keysToDelete.push(ip);
  });
  keysToDelete.forEach(ip => rateLimits.delete(ip));
}, 300_000);

// ─── ENDPOINTS ────────────────────────────────────────────

// GET /api/intel - Main social intelligence endpoint
socialIntelRouter.get('/intel', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS!;
  
  const paymentCheck = await checkPayment(c, walletAddress);
  if (paymentCheck.error) {
    const status = paymentCheck.status === 402 && (paymentCheck as any).paymentRequired
      ? 402
      : paymentCheck.status;
    return c.json(paymentCheck.error, status as 402 | 500);
  }
  const { payment, verification } = paymentCheck;

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a topic/keyword: /api/intel?query=bitcoin&twitterLimit=20&redditLimit=20',
      example: '/api/intel?query=AI+trading+bot&twitterLimit=25&redditLimit=25',
    }, 400);
  }

  const twitterLimit = Math.min(parseInt(c.req.query('twitterLimit') || '20') || 20, 50);
  const redditLimit = Math.min(parseInt(c.req.query('redditLimit') || '20') || 20, 50);

  try {
    const proxy = getProxy();
    const result = await getSocialIntel(query, twitterLimit, redditLimit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
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
      error: 'Social intel aggregation failed',
      message: err.message,
      hint: 'Try again or reduce limits.',
    }, 502);
  }
});

// GET /api/intel/twitter/:username - Twitter profile intel
socialIntelRouter.get('/intel/twitter/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS!;
  
  const paymentCheck = await checkPayment(c, walletAddress);
  if (paymentCheck.error) {
    return c.json(paymentCheck.error, paymentCheck.status as 402 | 500);
  }
  const { payment, verification } = paymentCheck;

  const username = c.req.param('username');
  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  try {
    const proxy = getProxy();
    const profile = await getTwitterProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    if (!profile) {
      return c.json({
        error: 'No data found for this Twitter user',
        username,
        hint: 'Ensure the username is correct and try again.',
      }, 404);
    }

    return c.json({
      ...profile,
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
      error: 'Twitter profile lookup failed',
      message: err.message,
    }, 502);
  }
});

// GET /api/intel/reddit/user/:username - Reddit user intel
socialIntelRouter.get('/intel/reddit/user/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS!;
  
  const paymentCheck = await checkPayment(c, walletAddress);
  if (paymentCheck.error) {
    return c.json(paymentCheck.error, paymentCheck.status as 402 | 500);
  }
  const { payment, verification } = paymentCheck;

  const username = c.req.param('username');
  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  try {
    const proxy = getProxy();
    const profile = await getRedditUser(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    if (!profile) {
      return c.json({
        error: 'No data found for this Reddit user',
        username,
        hint: 'Ensure the username is correct and try again.',
      }, 404);
    }

    return c.json({
      ...profile,
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
      error: 'Reddit user lookup failed',
      message: err.message,
    }, 502);
  }
});

// GET /api/intel/trending - Trending topics analysis
socialIntelRouter.get('/intel/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS!;
  
  const paymentCheck = await checkPayment(c, walletAddress, PRICE_TRENDING);
  if (paymentCheck.error) {
    return c.json(paymentCheck.error, paymentCheck.status as 402 | 500);
  }
  const { payment, verification } = paymentCheck;

  const limit = Math.min(parseInt(c.req.query('limit') || '10') || 10, 20);

  try {
    const proxy = getProxy();
    const trending = await getTrendingTopicsAnalysis(limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...trending,
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
      error: 'Trending analysis failed',
      message: err.message,
    }, 502);
  }
});
