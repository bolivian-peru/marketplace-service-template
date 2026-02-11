/**
 * ┌─────────────────────────────────────────────────┐
 * │       Review & Reputation Monitor               │
 * │  Aggregate reviews from Google Maps + Yelp     │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchReviews } from './scrapers/review-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'review-reputation-monitor';
const PRICE_USDC = 0.002;
const DESCRIPTION = 'Aggregate business reviews from Google Maps and Yelp. Returns reviews, rating trends, sentiment analysis, keyword extraction. Search by business name or URL.';

const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Business name to search (required)',
    location: 'string — Location for context (optional)',
    sources: 'string — Comma-separated: "google_maps,yelp" (default: both)',
  },
  output: {
    businesses: [{
      businessName: 'string',
      overallRating: 'number | null — Average rating (1-5)',
      totalReviews: 'number | null',
      ratingDistribution: 'Record<string, number>',
      reviews: [{ author: 'string', rating: 'number | null', date: 'string | null', text: 'string', source: 'string' }],
      topKeywords: 'string[] — Most frequent words in reviews',
      sentimentSummary: '{ positive, neutral, negative } — Count of reviews by sentiment',
      source: 'string',
      url: 'string',
    }],
    query: 'string',
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
      example: '/api/run?query=Starbucks&location=Austin+TX&sources=google_maps,yelp',
    }, 400);
  }

  const location = c.req.query('location');
  const sources = c.req.query('sources')?.split(',').map(s => s.trim().toLowerCase()) || ['google_maps', 'yelp'];

  try {
    const proxy = getProxy();
    const result = await searchReviews(query, location || undefined, sources);

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
