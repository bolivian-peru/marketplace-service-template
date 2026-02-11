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
import { scrapeSerp } from './scrapers/serp-scraper';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'google-serp-ai-scraper';
const PRICE_USDC = 0.01;  // $0.01 per search
const DESCRIPTION = 'Extract search results and AI-generated overviews (SGE) from Google Search. Returns organic results, AI summaries, related searches, and common questions.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query (required)',
    country: 'string — Country code (default: "US")',
  },
  output: {
    results: [{
      rank: 'number — Result position',
      title: 'string — Title',
      link: 'string — URL',
      snippet: 'string — Meta description/snippet',
    }],
    aiOverview: {
      text: 'string — AI-generated summary',
      links: [{ title: 'string', url: 'string' }]
    },
    peopleAlsoAsk: [{ question: 'string' }],
    relatedSearches: ['string'],
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── API ENDPOINT ─────────────────────────────────────

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
    }, 402);
  }

  // ── Step 3: Validate input ──
  const query = c.req.query('query');
  const country = c.req.query('country') || 'US';

  if (!query) {
    return c.json({ error: 'Missing required parameter: query' }, 400);
  }

  // ── Step 4: Execute scraping ──
  try {
    const proxy = getProxy();
    const result = await scrapeSerp(query, country);

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
      error: 'Scraping failed',
      message: err.message,
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
