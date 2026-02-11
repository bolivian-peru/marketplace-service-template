/**
 * ┌─────────────────────────────────────────────────┐
 * │      Ad Spy & Creative Intelligence             │
 * │  Meta Ad Library + Google Ads Transparency     │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchAds } from './scrapers/adspy-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'ad-spy-intelligence';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Monitor competitor ads across Meta Ad Library and Google Ads Transparency. Returns ad creatives, text, images, landing pages, targeting info, and spend estimates.';

const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Advertiser name or keyword (required)',
    country: 'string — Country code e.g. "US", "UK" (default: "US")',
    sources: 'string — Comma-separated: "meta,google" (default: both)',
  },
  output: {
    ads: [{
      advertiser: 'string',
      adText: 'string | null',
      headline: 'string | null',
      callToAction: 'string | null',
      imageUrl: 'string | null',
      landingPage: 'string | null',
      startDate: 'string | null',
      isActive: 'boolean',
      platform: 'string — "meta" or "google"',
      adFormat: 'string | null',
      impressionRange: 'string | null',
      spendRange: 'string | null',
      source: 'string',
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
      example: '/api/run?query=Nike&country=US&sources=meta,google',
    }, 400);
  }

  const country = c.req.query('country') || 'US';
  const sources = c.req.query('sources')?.split(',').map(s => s.trim().toLowerCase()) || ['meta', 'google'];

  try {
    const proxy = getProxy();
    const result = await searchAds(query, { country, sources });

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
