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
const SERVICE_NAME = 'review-reputation-monitor';
const PRICE_USDC = 0.005;  // $0.005 per request
const DESCRIPTION = 'A specialized scraper for Yelp and Trustpilot reviews. Powered by mobile proxies to bypass anti-bot systems.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  endpoints: {
    '/reviews': 'Get reviews from Yelp/Trustpilot',
  },
  payment: 'All endpoints cost $0.005 USDC per call'
};

// ─── API ENDPOINTS ─────────────────────────────────────

// Review Scraper (#14)
serviceRouter.get('/reviews', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/reviews', 'Review Scraper: Fetch reviews from Yelp/Trustpilot', PRICE_USDC, walletAddress, { slug: 'string (yelp business slug or trustpilot domain)' }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const slug = c.req.query('slug');
  if (!slug) return c.json({ error: 'Missing required parameter: slug' }, 400);

  const { scrapeYelp, scrapeTrustpilot } = await import('./scrapers/review-scraper');
  try {
    const results = slug.includes('.') ? await scrapeTrustpilot(slug) : await scrapeYelp(slug);
    return c.json({ results, payment: { txHash: payment.txHash, settled: true } });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});
