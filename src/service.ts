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
const SERVICE_NAME = 'social-profile-intelligence';
const PRICE_USDC = 0.005;  // $0.005 per request
const DESCRIPTION = 'A specialized scraper for Reddit and Twitter profiles. Uses headless browsers for Twitter to bypass SPA protections.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  endpoints: {
    '/social': 'Get social profile data from Reddit/Twitter',
  },
  payment: 'All endpoints cost $0.005 USDC per call'
};

// ─── API ENDPOINTS ─────────────────────────────────────

// Social Scraper (#10)
serviceRouter.get('/social', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/social', 'Social Scraper: Fetch profile data from Reddit/Twitter', PRICE_USDC, walletAddress, { username: 'string', platform: 'reddit|twitter' }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const username = c.req.query('username');
  const platform = c.req.query('platform') || 'reddit';
  if (!username) return c.json({ error: 'Missing required parameter: username' }, 400);

  const { scrapeReddit, scrapeTwitter } = await import('./scrapers/social-scraper');
  try {
    const result = platform === 'reddit' ? await scrapeReddit(username) : await scrapeTwitter(username);
    return c.json({ result, payment: { txHash: payment.txHash, settled: true } });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});
