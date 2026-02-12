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
const SERVICE_NAME = 'google-maps-lead-generator';
const PRICE_USDC = 0.005;  // $0.005 per business record
const DESCRIPTION = 'Extract structured business data from Google Maps: name, address, phone, website, email, hours, ratings, reviews, categories, and geocoordinates. Search by category + location with full pagination.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query/category (e.g., "plumbers", "restaurants") (required)',
    location: 'string — Location to search (e.g., "Austin TX", "New York City") (required)',
    limit: 'number — Max results to return (default: 20, max: 100)',
    pageToken: 'string — Pagination token for next page (optional)',
  },
  output: {
    businesses: [{
      name: 'string — Business name',
      address: 'string | null — Full street address',
      phone: 'string | null — Phone number',
      website: 'string | null — Business website URL',
      email: 'string | null — Email address (if found)',
      hours: 'object | null — Operating hours by day',
      rating: 'number | null — Google rating (1-5)',
      reviewCount: 'number | null — Total review count',
      categories: 'string[] — Business categories/types',
      coordinates: '{ latitude, longitude } | null — Geo coordinates',
      placeId: 'string | null — Google Place ID',
      priceLevel: 'string | null — Price level ($, $$, $$$, $$$$)',
      permanentlyClosed: 'boolean — Whether business is permanently closed',
    }],
    totalFound: 'number — Total businesses found',
    nextPageToken: 'string | null — Token for next page of results',
    searchQuery: 'string — The search query used',
    location: 'string — The location searched',
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
