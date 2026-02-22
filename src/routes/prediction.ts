/**
 * Prediction Market Signal Aggregator Routes (Bounty #55)
 *
 * GET /api/prediction/search?query=keyword&limit=25
 * GET /api/prediction/trending?limit=25
 * GET /api/prediction/polymarket?query=keyword&limit=25
 * GET /api/prediction/metaculus?query=keyword&limit=25
 * GET /api/prediction/category/:category?limit=25
 * GET /api/prediction/health
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchAllMarkets,
  getTrendingMarkets,
  searchPolymarket,
  searchMetaculus,
  getPolymarketByCategory,
  ScraperError,
} from '../scrapers/prediction-market';

export const predictionRouter = new Hono();

const PRICE = 0.005;

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

const MARKET_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    probability: { type: 'number', description: 'Percentage 0-100' },
    volume: { type: 'number' },
    liquidity: { type: 'number' },
    endDate: { type: 'string', format: 'date-time' },
    category: { type: 'string' },
    url: { type: 'string' },
    source: { type: 'string', enum: ['polymarket', 'metaculus'] },
    createdAt: { type: 'string' },
    commentCount: { type: 'number' },
    active: { type: 'boolean' },
  },
};

// ─── SEARCH ALL MARKETS ──────────────────────

predictionRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction/search', 'Search prediction markets across Polymarket + Metaculus — returns probabilities, volume, liquidity', PRICE, walletAddress, {
      input: { query: 'string (required)', limit: 'number (optional, default: 25)' },
      output: { markets: { type: 'array', items: MARKET_SCHEMA }, query: { type: 'string' }, resultCount: { type: 'number' } },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/prediction/search?query=AI+regulation' }, 400);

  try {
    const result = await searchAllMarkets(query, parseInt(c.req.query('limit') || '25') || 25);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err) {
    return handleScraperError(c, err, 'Market search failed');
  }
});

// ─── TRENDING ────────────────────────────────

predictionRouter.get('/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction/trending', 'Get trending prediction markets by volume', PRICE, walletAddress, {
      input: { limit: 'number (optional, default: 25)' },
      output: { markets: { type: 'array', items: MARKET_SCHEMA }, resultCount: { type: 'number' } },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getTrendingMarkets(parseInt(c.req.query('limit') || '25') || 25);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err) {
    return handleScraperError(c, err, 'Trending fetch failed');
  }
});

// ─── POLYMARKET ONLY ─────────────────────────

predictionRouter.get('/polymarket', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction/polymarket', 'Search Polymarket prediction markets', PRICE, walletAddress, {
      input: { query: 'string (required)', limit: 'number (optional, default: 25)' },
      output: { markets: { type: 'array', items: MARKET_SCHEMA }, source: { type: 'string' }, resultCount: { type: 'number' } },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing query parameter' }, 400);

  try {
    const markets = await searchPolymarket(query, parseInt(c.req.query('limit') || '25') || 25);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ markets, source: 'polymarket', resultCount: markets.length, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err) {
    return handleScraperError(c, err, 'Polymarket search failed');
  }
});

// ─── METACULUS ONLY ──────────────────────────

predictionRouter.get('/metaculus', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction/metaculus', 'Search Metaculus prediction questions', PRICE, walletAddress, {
      input: { query: 'string (required)', limit: 'number (optional, default: 25)' },
      output: { markets: { type: 'array', items: MARKET_SCHEMA }, source: { type: 'string' }, resultCount: { type: 'number' } },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing query parameter' }, 400);

  try {
    const markets = await searchMetaculus(query, parseInt(c.req.query('limit') || '25') || 25);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ markets, source: 'metaculus', resultCount: markets.length, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err) {
    return handleScraperError(c, err, 'Metaculus search failed');
  }
});

// ─── BY CATEGORY ─────────────────────────────

predictionRouter.get('/category/:category', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction/category/:category', 'Get Polymarket markets by category (politics, crypto, sports, science, pop-culture)', PRICE, walletAddress, {
      input: { category: 'string (required, in URL)', limit: 'number (optional, default: 25)' },
      output: { markets: { type: 'array', items: MARKET_SCHEMA }, category: { type: 'string' }, resultCount: { type: 'number' } },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const category = c.req.param('category');
  if (!category) return c.json({ error: 'Missing category' }, 400);

  try {
    const markets = await getPolymarketByCategory(category, parseInt(c.req.query('limit') || '25') || 25);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ markets, category, source: 'polymarket', resultCount: markets.length, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err) {
    return handleScraperError(c, err, 'Category fetch failed');
  }
});

// ─── HEALTH ENDPOINT ────────────────────────

predictionRouter.get('/health', async (c) => {
  const checks: Record<string, any> = {
    service: 'prediction-market-aggregator',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
  };

  try {
    const proxy = getProxy();
    checks.checks.proxy = { status: 'configured', country: proxy.country };
  } catch {
    checks.checks.proxy = { status: 'not_configured', fallback: 'direct' };
  }

  try {
    const r = await fetch('https://gamma-api.polymarket.com/markets?limit=1', { signal: AbortSignal.timeout(5000) });
    checks.checks.polymarket = { status: r.ok ? 'reachable' : 'blocked', statusCode: r.status };
  } catch {
    checks.checks.polymarket = { status: 'unreachable' };
  }

  try {
    const r = await fetch('https://www.metaculus.com/api2/questions/?limit=1', { signal: AbortSignal.timeout(5000) });
    checks.checks.metaculus = { status: r.ok ? 'reachable' : 'blocked', statusCode: r.status };
  } catch {
    checks.checks.metaculus = { status: 'unreachable' };
  }

  const wallet = process.env.WALLET_ADDRESS;
  checks.checks.payment = { configured: !!wallet, network: ['solana', 'base'] };
  checks.checks.endpoints = {
    search: '/api/prediction/search',
    trending: '/api/prediction/trending',
    polymarket: '/api/prediction/polymarket',
    metaculus: '/api/prediction/metaculus',
    category: '/api/prediction/category/:category',
  };

  checks.status = 'healthy';
  return c.json(checks);
});
