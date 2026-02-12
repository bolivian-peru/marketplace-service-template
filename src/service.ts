/**
 * ┌─────────────────────────────────────────────────┐
 * │         Google Maps Lead Generator              │
 * │  Extract business data from Google Maps         │
 * └─────────────────────────────────────────────────┘
 *
 * Features:
 *  - Extract: name, address, phone, website, email, hours, ratings, review count, categories, geocoordinates
 *  - Search by category + location (e.g., "plumbers in Austin TX")
 *  - Full pagination support (beyond Google's 120-result limit)
 *  - Mobile proxy support for reliable scraping
 *  - x402 USDC payment gating
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;  // $0.005 per request
const DESCRIPTION = 'Extract job listings from Indeed and LinkedIn with salary and date info.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  endpoints: {
    '/jobs': 'Get job listings from Indeed/LinkedIn',
  },
  payment: 'All endpoints cost $0.005 USDC per call'
};

// ─── API ENDPOINTS ─────────────────────────────────────

// Job Scraper (#16)
serviceRouter.get('/jobs', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/jobs', 'Job Market Scraper: Fetch jobs from Indeed/LinkedIn', PRICE_USDC, walletAddress, { query: 'string', location: 'string' }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query') || 'Software Engineer';
  const location = c.req.query('location') || 'Remote';

  const { scrapeIndeed } = await import('./scrapers/job-scraper');
  try {
    const results = await scrapeIndeed(query, location);
    return c.json({ results, payment: { txHash: payment.txHash, settled: true } });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

