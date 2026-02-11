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
const SERVICE_NAME = 'lutra-multi-scraper';
const PRICE_USDC = 0.005;  // $0.005 per request
const DESCRIPTION = 'A unified scraping suite for Job Market Intelligence, Review Monitoring, and Social Profile data. Powered by mobile proxies to bypass anti-bot systems.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  endpoints: {
    '/jobs': 'Get job listings from Indeed/LinkedIn',
    '/reviews': 'Get reviews from Yelp/Trustpilot',
    '/social': 'Get social profile data from Reddit/Twitter',
    '/maps': 'Get business data from Google Maps',
  },
  payment: 'All endpoints cost $0.005 USDC per call'
};

// ─── API ENDPOINTS ─────────────────────────────────────

// 1. Job Scraper (#16)
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

// 2. Review Scraper (#14)
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

// 3. Social Scraper (#10)
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

// Legacy Maps Endpoint
serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);

  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // ── Step 3: Validate input ──
  const query = c.req.query('query');
  const location = c.req.query('location');
  const limitParam = c.req.query('limit');
  const pageToken = c.req.query('pageToken');

  if (!query) {
    return c.json({ 
      error: 'Missing required parameter: query',
      hint: 'Provide a search query like ?query=plumbers&location=Austin+TX',
      example: '/api/run?query=restaurants&location=New+York+City&limit=20'
    }, 400);
  }

  if (!location) {
    return c.json({ 
      error: 'Missing required parameter: location',
      hint: 'Provide a location like ?query=plumbers&location=Austin+TX',
      example: '/api/run?query=restaurants&location=New+York+City&limit=20'
    }, 400);
  }

  // Parse and validate limit
  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam);
    if (isNaN(parsed) || parsed < 1) {
      return c.json({ error: 'Invalid limit parameter: must be a positive integer' }, 400);
    }
    limit = Math.min(parsed, 100); // Cap at 100
  }

  // Parse page token for pagination
  const startIndex = pageToken ? parseInt(pageToken) || 0 : 0;

  // ── Step 4: Execute scraping ──
  try {
    const proxy = getProxy();
    const result = await scrapeGoogleMaps(query, location, limit, startIndex);

    // Set payment confirmation headers
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Service execution failed',
      message: err.message,
      hint: 'Google Maps may be temporarily blocking requests. Try again in a few minutes.',
    }, 502);
  }
});

// ─── ADDITIONAL ENDPOINT FOR DETAILED BUSINESS INFO ───

serviceRouter.get('/details', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);

  if (!payment) {
    return c.json(
      build402Response('/api/details', 'Get detailed business info by Place ID', PRICE_USDC, walletAddress, {
        input: { placeId: 'string — Google Place ID (required)' },
        output: { business: 'BusinessData — Full business details' },
      }),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const placeId = c.req.query('placeId');
  if (!placeId) {
    return c.json({ error: 'Missing required parameter: placeId' }, 400);
  }

  try {
    const proxy = getProxy();
    
    // Fetch detailed place page
    const url = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
    const response = await proxyFetch(url, { timeoutMs: 45000 });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch place details: ${response.status}`);
    }

    const html = await response.text();
    
    // Extract detailed business info
    const business = extractDetailedBusiness(html, placeId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      business,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch business details',
      message: err.message,
    }, 502);
  }
});
