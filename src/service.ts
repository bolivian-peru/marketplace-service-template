/**
 * ┌─────────────────────────────────────────────────┐
 * │     E-Commerce Price & Stock Monitor            │
 * │  Amazon + Walmart product price tracking       │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchProducts } from './scrapers/ecommerce-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'ecommerce-price-monitor';
const PRICE_USDC = 0.002;
const DESCRIPTION = 'Monitor product prices and availability across Amazon and Walmart. Returns current price, availability, seller info, ratings, review count, and BSR. Search by product name or keyword.';

const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Product name or search keyword (required)',
    page: 'number — Page number (default: 1)',
    sources: 'string — Comma-separated: "amazon,walmart" (default: both)',
  },
  output: {
    products: [{
      title: 'string',
      price: 'number | null — Current price',
      priceFormatted: 'string | null',
      originalPrice: 'number | null — Original/list price if on sale',
      currency: 'string',
      availability: 'string',
      inStock: 'boolean',
      seller: 'string | null',
      rating: 'number | null — Star rating (1-5)',
      reviewCount: 'number | null',
      bsr: 'string | null — Best Sellers Rank (Amazon)',
      category: 'string | null',
      imageUrl: 'string | null',
      productUrl: 'string',
      asin: 'string | null — Amazon ASIN',
      source: 'string — "amazon" or "walmart"',
    }],
    query: 'string',
    totalFound: 'number',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const query = c.req.query('query');
  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      example: '/api/run?query=MacBook+Pro+M3&sources=amazon,walmart',
    }, 400);
  }

  const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
  const sources = c.req.query('sources')?.split(',').map(s => s.trim().toLowerCase()) || ['amazon', 'walmart'];

  try {
    const proxy = getProxy();
    const result = await searchProducts(query, { page, sources });

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Service execution failed', message: err.message }, 502);
  }
});
