/**
 * ┌─────────────────────────────────────────────────┐
 * │       Mobile SERP Tracker                       │
 * │  Real mobile Google search results             │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeGoogleMobile } from './scrapers/serp-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'mobile-serp-tracker';
const PRICE_USDC = 0.003;
const DESCRIPTION = 'Real Google search results from mobile devices on real 4G/5G carriers. Returns organic results, AI Overviews, featured snippets, People Also Ask, map packs, and related searches. Country/language targeting supported.';

const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query (required)',
    country: 'string — Country code, e.g. "US", "UK", "DE" (default: "US")',
    language: 'string — Language code, e.g. "en", "de", "fr" (default: "en")',
    page: 'number — Page number, 0-indexed (default: 0)',
    location: 'string — Local search location (optional)',
  },
  output: {
    query: 'string',
    country: 'string',
    language: 'string',
    organic: [{ position: 'number', title: 'string', url: 'string', displayUrl: 'string', snippet: 'string' }],
    featuredSnippet: '{ text, source, sourceUrl } | null',
    aiOverview: '{ text, sources: [{ title, url }] } | null',
    peopleAlsoAsk: [{ question: 'string', snippet: 'string | null', source: 'string | null' }],
    relatedSearches: 'string[]',
    mapPack: [{ name: 'string', rating: 'number | null', reviewCount: 'number | null', address: 'string | null' }],
    totalResults: 'string | null',
    page: 'number',
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
      example: '/api/run?query=best+laptops+2026&country=US&language=en',
    }, 400);
  }

  const country = c.req.query('country') || 'US';
  const language = c.req.query('language') || 'en';
  const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 0;
  const location = c.req.query('location');

  try {
    const proxy = getProxy();
    const result = await scrapeGoogleMobile(query, { country, language, page, location: location || undefined });

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
