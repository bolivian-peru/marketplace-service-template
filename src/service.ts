/**
 * ┌─────────────────────────────────────────────────┐
 * │  Service Router                                 │
 * │  Google Maps Lead Generator + Mobile SERP       │
 * └─────────────────────────────────────────────────┘
 *
 * Services:
 *  1. Google Maps Lead Generator — /api/run, /api/details
 *  2. Mobile SERP Tracker — /api/serp
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';
import { scrapeMobileSERP } from './scrapers/serp-tracker';

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
const query = c.req.query('market') || c.req.query('topic');
const location = c.req.query('location');
const limitParam = c.req.query('limit');
const pageToken = c.req.query('pageToken');

if (!query) {
  return c.json({ 
    error: 'Missing required parameter: market or topic',
    hint: 'Provide a search query like ?market=us-presidential-election-2028&location=Austin+TX or ?topic=bitcoin+etf&location=US',
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

// ═══════════════════════════════════════════════════════
// ─── MOBILE SERP TRACKER ─────────────────────────────
// ═══════════════════════════════════════════════════════

const SERP_SERVICE_NAME = 'mobile-serp-tracker';
const SERP_PRICE_USDC = 0.003;  // $0.003 per query
const SERP_DESCRIPTION = 'Real Google mobile SERP results from 4G/5G carrier IPs. Returns structured JSON with organic results, People Also Ask, featured snippets, AI Overviews, map packs, ads, knowledge panel, and position tracking. Supports country/language targeting.';

const SERP_OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query (required)',
    country: 'string — Country code for targeting, e.g. "us", "gb", "de" (default: "us")',
    language: 'string — Language code, e.g. "en", "es", "fr" (default: "en")',
    location: 'string — Local search location, e.g. "Austin TX" (optional)',
    start: 'number — Pagination offset (default: 0, increments of 10)',
  },
  output: {
    query: 'string — The search query used',
    country: 'string — Country code used',
    language: 'string — Language code used',
    location: 'string | null — Location used',
    totalResults: 'string | null — Approximate total results count',
    organic: [{
      position: 'number — Ranking position (1-based)',
      title: 'string — Page title',
      url: 'string — Page URL',
      displayUrl: 'string — Display URL (domain + path)',
      snippet: 'string — Description snippet',
      sitelinks: '{ title, url }[] — Sitelinks if present',
      date: 'string | null — Published date if shown',
      cached: 'boolean — Whether cached version available',
    }],
    ads: [{
      position: 'number — Ad position',
      title: 'string — Ad headline',
      url: 'string — Landing page URL',
      displayUrl: 'string — Display URL',
      description: 'string — Ad description',
      isTop: 'boolean — Whether ad is above organic results',
    }],
    peopleAlsoAsk: [{
      question: 'string — The question',
      snippet: 'string | null — Answer snippet',
      url: 'string | null — Source URL',
    }],
    featuredSnippet: '{ text, url, title, type } | null — Featured snippet if present',
    aiOverview: '{ text, sources } | null — AI Overview if present',
    mapPack: [{
      name: 'string — Business name',
      address: 'string | null — Address',
      rating: 'number | null — Rating',
      reviewCount: 'number | null — Review count',
      category: 'string | null — Business category',
      phone: 'string | null — Phone number',
    }],
    knowledgePanel: '{ title, type, description, url, attributes } | null',
    relatedSearches: 'string[] — Related search suggestions',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── SERP API ENDPOINT ───────────────────────────────

serviceRouter.get('/serp', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);

  if (!payment) {
    return c.json(
      build402Response('/api/serp', SERP_DESCRIPTION, SERP_PRICE_USDC, walletAddress, SERP_OUTPUT_SCHEMA),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, SERP_PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // ── Step 3: Validate input ──
  const query = c.req.query('query');
  const country = c.req.query('country') || 'us';
  const language = c.req.query('language') || 'en';
  const location = c.req.query('location');
  const startParam = c.req.query('start');

  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a search query like ?query=best+coffee+shops',
      example: '/api/serp?query=best+coffee+shops&country=us&language=en',
    }, 400);
  }

  // Validate country code (2 letters)
  if (!/^[a-zA-Z]{2}$/.test(country)) {
    return c.json({ error: 'Invalid country code: must be 2-letter ISO code (e.g. "us", "gb", "de")' }, 400);
  }

  // Validate language code (2 letters)
  if (!/^[a-zA-Z]{2}$/.test(language)) {
    return c.json({ error: 'Invalid language code: must be 2-letter ISO code (e.g. "en", "es", "fr")' }, 400);
  }

  // Parse start offset
  let start = 0;
  if (startParam) {
    const parsed = parseInt(startParam);
    if (isNaN(parsed) || parsed < 0) {
      return c.json({ error: 'Invalid start parameter: must be a non-negative integer' }, 400);
    }
    start = parsed;
  }

  // ── Step 4: Execute SERP scraping ──
  try {
    const proxy = getProxy();
    const result = await scrapeMobileSERP(query, country.toLowerCase(), language.toLowerCase(), location, start);

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
      error: 'SERP scraping failed',
      message: err.message,
      hint: 'Google may be temporarily blocking requests or serving CAPTCHAs. Try again in a few minutes.',
    }, 502);
  }
});
