/**
 * Prediction Market Signal Aggregator Routes (Bounty #55)
 *
 * GET /api/prediction/search?query=keyword&limit=25
 * GET /api/prediction/trending?limit=25
 * GET /api/prediction/polymarket?query=keyword&limit=25
 * GET /api/prediction/metaculus?query=keyword&limit=25
 * GET /api/prediction/category/:category?limit=25
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
} from '../scrapers/prediction-market';

export const predictionRouter = new Hono();

const PRICE = 0.005;

function proxyInfo() {
  try { const p = getProxy(); return { country: p.country, type: 'mobile' as const }; }
  catch { return { country: 'US', type: 'mobile' as const }; }
}

// ─── SEARCH ALL MARKETS ──────────────────────

predictionRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction/search', 'Search prediction markets across Polymarket + Metaculus — returns probabilities, volume, liquidity', PRICE, walletAddress, {
      input: { query: 'string (required)', limit: 'number (optional, default: 25)' },
      output: { markets: 'PredictionMarket[] — id, title, probability, volume, liquidity, endDate, category, url, source', query: 'string', resultCount: 'number' },
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
  } catch (err: any) {
    return c.json({ error: 'Market search failed', message: err.message }, 502);
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
      output: { markets: 'PredictionMarket[]', resultCount: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getTrendingMarkets(parseInt(c.req.query('limit') || '25') || 25);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Trending fetch failed', message: err.message }, 502);
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
      output: { markets: 'PredictionMarket[]', resultCount: 'number' },
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
  } catch (err: any) {
    return c.json({ error: 'Polymarket search failed', message: err.message }, 502);
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
      output: { markets: 'PredictionMarket[]', resultCount: 'number' },
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
  } catch (err: any) {
    return c.json({ error: 'Metaculus search failed', message: err.message }, 502);
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
      output: { markets: 'PredictionMarket[]', category: 'string', resultCount: 'number' },
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
  } catch (err: any) {
    return c.json({ error: 'Category fetch failed', message: err.message }, 502);
  }
});
