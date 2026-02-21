/**
 * Google Discover Feed Intelligence Routes (Bounty #52)
 *
 * GET /api/discover/search?query=keyword&limit=25&geo=US    — search Google News
 * GET /api/discover/trending?limit=25&geo=US                — trending topics
 * GET /api/discover/daily?geo=US                            — daily trends
 * GET /api/discover/category/:category?limit=25&geo=US      — category news
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchGoogleNews,
  getTrendingTopics,
  getDailyTrends,
  getCategoryNews,
} from '../scrapers/google-discover';

export const googleDiscoverRouter = new Hono();

const PRICE = 0.005;

function proxyInfo() {
  try { const p = getProxy(); return { country: p.country, type: 'mobile' as const }; }
  catch { return { country: 'US', type: 'mobile' as const }; }
}

// ─── SEARCH GOOGLE NEWS ─────────────────────

googleDiscoverRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/discover/search', 'Search Google News articles by keyword — returns titles, sources, snippets, publish dates, and related queries', PRICE, walletAddress, {
      input: {
        query: 'string (required) — search keywords',
        limit: 'number (optional, default: 25, max: 100)',
        geo: 'string (optional, default: "US") — ISO 2-letter country code',
      },
      output: {
        articles: 'DiscoverArticle[] — title, url, source, publishedAt, snippet, category, imageUrl, traffic, relatedQueries',
        query: 'string',
        resultCount: 'number',
        geo: 'string',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/discover/search?query=artificial+intelligence' }, 400);

  try {
    const result = await searchGoogleNews(
      query,
      parseInt(c.req.query('limit') || '25') || 25,
      c.req.query('geo') || 'US',
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Google News search failed', message: err.message }, 502);
  }
});

// ─── TRENDING TOPICS ────────────────────────

googleDiscoverRouter.get('/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/discover/trending', 'Get real-time trending topics from Google Trends — includes search traffic volume and related news', PRICE, walletAddress, {
      input: {
        limit: 'number (optional, default: 25, max: 100)',
        geo: 'string (optional, default: "US") — ISO 2-letter country code',
      },
      output: {
        trends: 'DiscoverArticle[] — title, url, source, publishedAt, snippet, traffic, relatedQueries',
        geo: 'string',
        resultCount: 'number',
        date: 'string (YYYY-MM-DD)',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getTrendingTopics(
      parseInt(c.req.query('limit') || '25') || 25,
      c.req.query('geo') || 'US',
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Trending topics fetch failed', message: err.message }, 502);
  }
});

// ─── DAILY TRENDS ───────────────────────────

googleDiscoverRouter.get('/daily', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/discover/daily', 'Get daily trending searches from Google Trends API — structured data with traffic numbers, related queries, and news articles', PRICE, walletAddress, {
      input: {
        geo: 'string (optional, default: "US") — ISO 2-letter country code',
      },
      output: {
        trends: 'DiscoverArticle[] — title, url, source, publishedAt, snippet, traffic, relatedQueries',
        geo: 'string',
        resultCount: 'number',
        date: 'string (YYYY-MM-DD)',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getDailyTrends(c.req.query('geo') || 'US');

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Daily trends fetch failed', message: err.message }, 502);
  }
});

// ─── CATEGORY NEWS ──────────────────────────

googleDiscoverRouter.get('/category/:category', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/discover/category/:category', 'Get Google News articles by category (technology, business, entertainment, sports, science, health, world)', PRICE, walletAddress, {
      input: {
        category: 'string (required, in URL) — one of: technology, business, entertainment, sports, science, health, world',
        limit: 'number (optional, default: 25, max: 100)',
        geo: 'string (optional, default: "US") — ISO 2-letter country code',
      },
      output: {
        articles: 'DiscoverArticle[] — title, url, source, publishedAt, snippet, category, imageUrl',
        query: 'string (category name)',
        resultCount: 'number',
        geo: 'string',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const category = c.req.param('category');
  if (!category) return c.json({ error: 'Missing category' }, 400);

  const validCategories = ['technology', 'business', 'entertainment', 'sports', 'science', 'health', 'world'];
  if (!validCategories.includes(category.toLowerCase())) {
    return c.json({
      error: `Invalid category "${category}"`,
      validCategories,
      example: '/api/discover/category/technology',
    }, 400);
  }

  try {
    const result = await getCategoryNews(
      category,
      parseInt(c.req.query('limit') || '25') || 25,
      c.req.query('geo') || 'US',
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, category, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Category news fetch failed', message: err.message }, 502);
  }
});
