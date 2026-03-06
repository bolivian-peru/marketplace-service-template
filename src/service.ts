/**
 * Service Router — Marketplace API
 *
 * Exposes:
 *   GET /api/run       (Google Maps Lead Generator)
 *   GET /api/details   (Google Maps Place details)
 *   GET /api/jobs      (Job Market Intelligence)
 *   GET /api/reviews/* (Google Reviews & Business Data)
 *   GET /api/airbnb/*  (Airbnb Market Intelligence)
 *   GET /api/reddit/*  (Reddit Intelligence)
 *   GET /api/instagram/* (Instagram Intelligence + AI Vision)
 *   GET /api/linkedin/* (LinkedIn Enrichment)
 *   GET /api/prediction/* (Prediction Market Signal Aggregator)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';
import { searchAirbnb, getListingDetail, getListingReviews, getMarketStats } from './scrapers/airbnb-scraper';
import { 
  scrapeLinkedInPerson, 
  scrapeLinkedInCompany, 
  searchLinkedInPeople, 
  findCompanyEmployees 
} from './scrapers/linkedin-enrichment';
import { getProfile, getPosts, analyzeProfile, analyzeImages, auditProfile } from './scrapers/instagram-scraper';
import { searchReddit, getSubreddit, getTrending, getComments } from './scrapers/reddit-scraper';
import {
  getMarketSignal,
  getArbitrageOpportunities,
  getSentimentAnalysis,
  getTrendingMarketsWithDivergence,
  fetchPolymarketActive,
  fetchKalshiActive,
} from './scrapers/prediction-market-scraper';

export const serviceRouter = new Hono();

// ─── TREND INTELLIGENCE ROUTES (Bounty #70) ─────────
serviceRouter.route('/research', researchRouter);
serviceRouter.route('/trending', trendingRouter);

const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Job Market Intelligence API (Indeed/LinkedIn): title, company, location, salary, date, link, remote + proxy exit metadata.';
const MAPS_PRICE_USDC = 0.005;
const MAPS_DESCRIPTION = 'Extract structured business data from Google Maps: name, address, phone, website, email, hours, ratings, reviews, categories, and geocoordinates. Search by category + location with full pagination.';

const MAPS_OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query/category (required)',
    location: 'string — Location to search (required)',
    limit: 'number — Max results to return (default: 20, max: 100)',
    pageToken: 'string — Pagination token for next page (optional)',
  },
  output: {
    businesses: [{
      name: 'string',
      address: 'string | null',
      phone: 'string | null',
      website: 'string | null',
      email: 'string | null',
      hours: 'object | null',
      rating: 'number | null',
      reviewCount: 'number | null',
      categories: 'string[]',
      coordinates: '{ latitude, longitude } | null',
      placeId: 'string | null',
      priceLevel: 'string | null',
      permanentlyClosed: 'boolean',
    }],
    totalFound: 'number',
    nextPageToken: 'string | null',
    searchQuery: 'string',
    location: 'string',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

serviceRouter.get('/run', async (c) => {
  // Prediction Market Signal Aggregator (Issue #55 spec: GET /api/run?type=signal|arbitrage|sentiment|trending)
  const type = c.req.query('type');
  if (type === 'signal' || type === 'arbitrage' || type === 'sentiment' || type === 'trending') {
    const predWallet = process.env.WALLET_ADDRESS || '';
    const priceMap: Record<string, number> = { signal: 0.05, arbitrage: 0.03, sentiment: 0.02, trending: 0.04 };
    const price = priceMap[type];
    const payment = extractPayment(c);

    if (!payment) {
      return c.json(build402Response(`/api/run?type=${type}`, `Prediction market ${type} aggregator — see /api/prediction/${type} for full schema`, price, predWallet, {}), 402);
    }

    const verification = await verifyPayment(payment, predWallet, price);
    if (!verification.valid) {
      return c.json({ error: 'Payment verification failed', details: verification.error }, 402);
    }

    try {
      if (type === 'signal') {
        const market = c.req.query('market');
        if (!market) return c.json({ error: 'Missing required query param: market', example: '/api/run?type=signal&market=us-presidential-election-2028' }, 400);
        const result = await getMarketSignal(market);
        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);
        return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, verified: true } });
      } else if (type === 'arbitrage') {
        const result = await getArbitrageOpportunities();
        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);
        return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, verified: true } });
      } else if (type === 'sentiment') {
        const topic = c.req.query('topic');
        if (!topic) return c.json({ error: 'Missing required query param: topic', example: '/api/run?type=sentiment&topic=bitcoin+etf&country=US' }, 400);
        const country = c.req.query('country') || 'US';
        const result = await getSentimentAnalysis(topic, country);
        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);
        return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, verified: true } });
      } else {
        const result = await getTrendingMarketsWithDivergence();
        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);
        return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, verified: true } });
      }
    } catch (err: any) {
      return c.json({ error: `Prediction market ${type} failed`, message: err?.message || String(err) }, 502);
    }
  }

  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', MAPS_DESCRIPTION, MAPS_PRICE_USDC, walletAddress, MAPS_OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, MAPS_PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  const location = c.req.query('location');
  const limitParam = c.req.query('limit');
  const pageToken = c.req.query('pageToken');

  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a search query like ?query=plumbers&location=Austin+TX',
      example: '/api/run?query=restaurants&location=New+York+City&limit=20',
    }, 400);
  }

  if (!location) {
    return c.json({
      error: 'Missing required parameter: location',
      hint: 'Provide a location like ?query=plumbers&location=Austin+TX',
      example: '/api/run?query=restaurants&location=New+York+City&limit=20',
    }, 400);
  }

  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam);
    if (isNaN(parsed) || parsed < 1) {
      return c.json({ error: 'Invalid limit parameter: must be a positive integer' }, 400);
    }
    limit = Math.min(parsed, 100);
  }

  const startIndex = pageToken ? parseInt(pageToken) || 0 : 0;

  try {
    const proxy = getProxy();
    const result = await scrapeGoogleMaps(query, location, limit, startIndex);

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

serviceRouter.get('/details', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/details', 'Get detailed business info by Place ID', MAPS_PRICE_USDC, walletAddress, {
        input: { placeId: 'string — Google Place ID (required)' },
        output: { business: 'BusinessData — Full business details' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, MAPS_PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const placeId = c.req.query('placeId');
  if (!placeId) {
    return c.json({ error: 'Missing required parameter: placeId' }, 400);
  }

  try {
    const proxy = getProxy();
    const url = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
    const response = await proxyFetch(url, { timeoutMs: 45_000 });

    if (!response.ok) {
      throw new Error(`Failed to fetch place details: ${response.status}`);
    }

    const html = await response.text();
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
      hint: 'Invalid place ID or Google blocked the request.',
    }, 502);
  }
});

serviceRouter.get('/jobs', async (c) => {
  const walletAddress = 'GpXHXs5KfzfXbNKcMLNbAMsJsgPsBE7y5GtwVoiuxYvH';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/jobs',
        DESCRIPTION,
        PRICE_USDC,
        walletAddress,
        {
          input: {
            query: 'string (required) — job title / keywords (e.g., "Software Engineer")',
            location: 'string (optional, default: "Remote")',
            platform: '"indeed" | "linkedin" | "both" (optional, default: "indeed")',
            limit: 'number (optional, default: 20, max: 50)'
          },
          output: {
            results: 'JobListing[]',
            meta: {
              proxy: '{ ip, country, host, type:"mobile" }',
              platform: 'indeed|linkedin|both',
              limit: 'number'
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query') || 'Software Engineer';
  const location = c.req.query('location') || 'Remote';
  const platform = (c.req.query('platform') || 'indeed').toLowerCase();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();

    let results: JobListing[] = [];
    if (platform === 'both') {
      const [a, b] = await Promise.all([
        scrapeIndeed(query, location, limit),
        scrapeLinkedIn(query, location, limit),
      ]);
      results = [...a, ...b];
    } else if (platform === 'linkedin') {
      results = await scrapeLinkedIn(query, location, limit);
    } else {
      results = await scrapeIndeed(query, location, limit);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      results,
      meta: {
        platform,
        limit,
        proxy: {
          ip,
          country: proxy.country,
          host: proxy.host,
          type: 'mobile',
        },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Scrape failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// ─── GOOGLE REVIEWS & BUSINESS DATA API ─────────────
// ═══════════════════════════════════════════════════════

const REVIEWS_PRICE_USDC = 0.02;   // $0.02 per reviews fetch
const BUSINESS_PRICE_USDC = 0.01;  // $0.01 per business lookup
const SUMMARY_PRICE_USDC = 0.005;  // $0.005 per summary

// ─── PROXY RATE LIMITING (prevent proxy quota abuse) ──
const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20; // max proxy-routed requests per minute per IP

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyUsage.get(ip);
  if (!entry || now > entry.resetAt) {
    proxyUsage.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= PROXY_RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of proxyUsage) {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  }
}, 300_000);

// ─── GET /api/reviews/search ────────────────────────

serviceRouter.get('/reviews/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reviews/search', 'Search businesses by query + location', BUSINESS_PRICE_USDC, walletAddress, {
      input: { query: 'string (required)', location: 'string (required)', limit: 'number (optional, default: 10)' },
      output: { query: 'string', location: 'string', businesses: 'BusinessInfo[]', totalFound: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, BUSINESS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  const location = c.req.query('location');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 20);

  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/reviews/search?query=pizza&location=NYC' }, 400);
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/reviews/search?query=pizza&location=NYC' }, 400);

  try {
    const proxy = getProxy();
    const result = await searchBusinesses(query, location, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/reviews/summary/:place_id ─────────────

serviceRouter.get('/reviews/summary/:place_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reviews/summary/:place_id', 'Get review summary stats: rating distribution, response rate, sentiment', SUMMARY_PRICE_USDC, walletAddress, {
      input: { place_id: 'string (required) — Google Place ID (in URL path)' },
      output: { business: '{ name, placeId, rating, totalReviews }', summary: '{ avgRating, totalReviews, ratingDistribution, responseRate, avgResponseTimeDays, sentimentBreakdown }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SUMMARY_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const summaryIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(summaryIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const placeId = c.req.param('place_id');
  if (!placeId) return c.json({ error: 'Missing place_id in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await fetchReviewSummary(placeId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Summary fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/reviews/:place_id ─────────────────────

serviceRouter.get('/reviews/:place_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reviews/:place_id', 'Fetch Google reviews for a business by Place ID', REVIEWS_PRICE_USDC, walletAddress, {
      input: {
        place_id: 'string (required) — Google Place ID (in URL path)',
        sort: '"newest" | "relevant" | "highest" | "lowest" (optional, default: "newest")',
        limit: 'number (optional, default: 20, max: 50)',
      },
      output: { business: 'BusinessInfo', reviews: 'ReviewData[]', pagination: '{ total, returned, sort }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REVIEWS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const reviewsIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(reviewsIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const placeId = c.req.param('place_id');
  if (!placeId) return c.json({ error: 'Missing place_id in URL path' }, 400);

  const sort = c.req.query('sort') || 'newest';
  if (!['newest', 'relevant', 'highest', 'lowest'].includes(sort)) {
    return c.json({ error: 'Invalid sort parameter. Use: newest, relevant, highest, lowest' }, 400);
  }

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const result = await fetchReviews(placeId, sort, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reviews fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/business/:place_id ────────────────────

serviceRouter.get('/business/:place_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/business/:place_id', 'Get detailed business info + review summary by Place ID', BUSINESS_PRICE_USDC, walletAddress, {
      input: { place_id: 'string (required) — Google Place ID (in URL path)' },
      output: {
        business: 'BusinessInfo — name, address, phone, website, hours, category, rating, photos, coordinates',
        summary: 'ReviewSummary — ratingDistribution, responseRate, sentimentBreakdown',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, BUSINESS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const bizIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(bizIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const placeId = c.req.param('place_id');
  if (!placeId) return c.json({ error: 'Missing place_id in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await fetchBusinessDetails(placeId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Business details fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// ─── LINKEDIN PEOPLE & COMPANY ENRICHMENT API (Bounty #77) ─────────
// ═══════════════════════════════════════════════════════

const LINKEDIN_PERSON_PRICE_USDC = 0.03;    // $0.03 per person profile
const LINKEDIN_COMPANY_PRICE_USDC = 0.05;   // $0.05 per company profile
const LINKEDIN_SEARCH_PRICE_USDC = 0.10;    // $0.10 per search query

// ─── GET /api/linkedin/person ────────────────────────
serviceRouter.get('/linkedin/person', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/linkedin/person', 'LinkedIn Person Profile Enrichment', LINKEDIN_PERSON_PRICE_USDC, walletAddress, {
        input: { url: 'string — LinkedIn profile URL (required)' },
        output: { person: 'LinkedInPerson — name, headline, company, education, skills', meta: 'proxy info' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_PERSON_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing required parameter: url', example: '/api/linkedin/person?url=linkedin.com/in/username' }, 400);
  }

  // Extract public ID from URL
  const publicIdMatch = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
  if (!publicIdMatch) {
    return c.json({ error: 'Invalid LinkedIn profile URL', example: 'linkedin.com/in/username' }, 400);
  }

  try {
    const proxy = getProxy();
    const person = await scrapeLinkedInPerson(publicIdMatch[1]);

    if (!person) {
      return c.json({ error: 'Failed to scrape profile. Profile may be private or LinkedIn blocked the request.' }, 502);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      person: {
        ...person,
        meta: { proxy: { country: proxy.country, type: 'mobile' } },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Profile fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/linkedin/company ────────────────────────
serviceRouter.get('/linkedin/company', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/linkedin/company', 'LinkedIn Company Profile Enrichment', LINKEDIN_COMPANY_PRICE_USDC, walletAddress, {
        input: { url: 'string — LinkedIn company URL (required)' },
        output: { company: 'LinkedInCompany — name, description, industry, employees', meta: 'proxy info' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_COMPANY_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing required parameter: url', example: '/api/linkedin/company?url=linkedin.com/company/name' }, 400);
  }

  const companyIdMatch = url.match(/linkedin\.com\/company\/([^\/\?]+)/);
  if (!companyIdMatch) {
    return c.json({ error: 'Invalid LinkedIn company URL', example: 'linkedin.com/company/name' }, 400);
  }

  try {
    const proxy = getProxy();
    const company = await scrapeLinkedInCompany(companyIdMatch[1]);

    if (!company) {
      return c.json({ error: 'Failed to scrape company. Company may not exist or LinkedIn blocked the request.' }, 502);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      company: {
        ...company,
        meta: { proxy: { country: proxy.country, type: 'mobile' } },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Company fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/linkedin/search/people ────────────────────────
serviceRouter.get('/linkedin/search/people', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/linkedin/search/people', 'LinkedIn People Search by Title + Location + Industry', LINKEDIN_SEARCH_PRICE_USDC, walletAddress, {
        input: { 
          title: 'string — Job title (required)',
          location: 'string — Location (optional)',
          industry: 'string — Industry (optional)',
          limit: 'number — Max results (default: 10, max: 20)'
        },
        output: { results: 'LinkedInSearchResult[]', meta: 'proxy info' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_SEARCH_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const title = c.req.query('title');
  if (!title) {
    return c.json({ error: 'Missing required parameter: title', example: '/api/linkedin/search/people?title=CTO&location=San+Francisco' }, 400);
  }

  const location = c.req.query('location');
  const industry = c.req.query('industry');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 20);

  try {
    const proxy = getProxy();
    const results = await searchLinkedInPeople(title, location || undefined, industry || undefined, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      results,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/linkedin/company/:id/employees ────────────────────────
serviceRouter.get('/linkedin/company/:id/employees', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/linkedin/company/:id/employees', 'Find Company Employees by Job Title', LINKEDIN_SEARCH_PRICE_USDC, walletAddress, {
        input: { 
          id: 'string — LinkedIn company ID (in URL path)',
          title: 'string — Job title filter (optional)',
          limit: 'number — Max results (default: 10, max: 20)'
        },
        output: { results: 'LinkedInSearchResult[]', meta: 'proxy info' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_SEARCH_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const companyId = c.req.param('id');
  if (!companyId) {
    return c.json({ error: 'Missing company ID in URL path', example: '/api/linkedin/company/google/employees?title=engineer' }, 400);
  }

  const title = c.req.query('title') || undefined;
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 20);

  try {
    const proxy = getProxy();
    const results = await findCompanyEmployees(companyId, title, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      results,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Employee search failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// ─── REDDIT INTELLIGENCE API (Bounty #68) ──────────
// ═══════════════════════════════════════════════════════

const REDDIT_SEARCH_PRICE = 0.005;   // $0.005 per search/subreddit
const REDDIT_COMMENTS_PRICE = 0.01;  // $0.01 per comment thread

// ─── GET /api/reddit/search ─────────────────────────

serviceRouter.get('/reddit/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/search', 'Search Reddit posts by keyword via mobile proxy', REDDIT_SEARCH_PRICE, walletAddress, {
      input: {
        query: 'string (required) — search keywords',
        sort: '"relevance" | "hot" | "new" | "top" | "comments" (default: "relevance")',
        time: '"hour" | "day" | "week" | "month" | "year" | "all" (default: "all")',
        limit: 'number (default: 25, max: 100)',
        after: 'string (optional) — pagination token',
      },
      output: {
        posts: 'RedditPost[] — title, selftext, author, subreddit, score, upvoteRatio, numComments, createdUtc, permalink, url, isSelf, flair, awards, over18',
        after: 'string | null — next page token',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REDDIT_SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/reddit/search?query=AI+agents&sort=relevance&time=week' }, 400);

  const sort = c.req.query('sort') || 'relevance';
  const time = c.req.query('time') || 'all';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '25') || 25, 1), 100);
  const after = c.req.query('after') || undefined;

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await searchReddit(query, sort, time, limit, after);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        query, sort, time, limit,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reddit search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/reddit/trending ───────────────────────

serviceRouter.get('/reddit/trending', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/trending', 'Get trending/popular posts across Reddit via mobile proxy', REDDIT_SEARCH_PRICE, walletAddress, {
      input: { limit: 'number (default: 25, max: 100)' },
      output: {
        posts: 'RedditPost[] — trending posts from r/popular',
        after: 'string | null — next page token',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REDDIT_SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '25') || 25, 1), 100);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getTrending(limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        limit,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Reddit trending fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/reddit/subreddit/:name ────────────────

serviceRouter.get('/reddit/subreddit/:name', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/subreddit/:name', 'Browse a subreddit via mobile proxy', REDDIT_SEARCH_PRICE, walletAddress, {
      input: {
        name: 'string (required, in path) — subreddit name (e.g., programming)',
        sort: '"hot" | "new" | "top" | "rising" (default: "hot")',
        time: '"hour" | "day" | "week" | "month" | "year" | "all" (default: "all")',
        limit: 'number (default: 25, max: 100)',
        after: 'string (optional) — pagination token',
      },
      output: {
        posts: 'RedditPost[] — subreddit posts',
        after: 'string | null — next page token',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REDDIT_SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const name = c.req.param('name');
  if (!name) return c.json({ error: 'Missing subreddit name in URL path' }, 400);

  const sort = c.req.query('sort') || 'hot';
  const time = c.req.query('time') || 'all';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '25') || 25, 1), 100);
  const after = c.req.query('after') || undefined;

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getSubreddit(name, sort, time, limit, after);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        subreddit: name, sort, time, limit,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Subreddit fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/reddit/thread/:id ─────────────────────

serviceRouter.get('/reddit/thread/*', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reddit/thread/:permalink', 'Fetch post comments via mobile proxy', REDDIT_COMMENTS_PRICE, walletAddress, {
      input: {
        permalink: 'string (required, in path) — Reddit post permalink (e.g., r/programming/comments/abc123/title)',
        sort: '"best" | "top" | "new" | "controversial" | "old" (default: "best")',
        limit: 'number (default: 50, max: 200)',
      },
      output: {
        post: 'RedditPost — the parent post',
        comments: 'RedditComment[] — threaded comments with { author, body, score, createdUtc, depth, replies }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REDDIT_COMMENTS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  // Extract permalink from wildcard path
  const permalink = c.req.path.replace('/api/reddit/thread/', '');
  if (!permalink || !permalink.includes('comments')) {
    return c.json({ error: 'Invalid permalink — must contain "comments" segment', example: '/api/reddit/thread/r/programming/comments/abc123/title' }, 400);
  }

  const sort = c.req.query('sort') || 'best';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getComments(permalink, sort, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        permalink, sort, limit,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Comment fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// ─── INSTAGRAM INTELLIGENCE + AI VISION API ─────────
// ═══════════════════════════════════════════════════════

const IG_PROFILE_PRICE  = 0.01;   // $0.01 per profile lookup
const IG_POSTS_PRICE    = 0.02;   // $0.02 per posts fetch
const IG_ANALYZE_PRICE  = 0.15;   // $0.15 per full analysis (includes AI vision)
const IG_IMAGES_PRICE   = 0.08;   // $0.08 per image-only analysis
const IG_AUDIT_PRICE    = 0.05;   // $0.05 per authenticity audit

// ─── GET /api/instagram/profile/:username ───────────

serviceRouter.get('/instagram/profile/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/profile/:username', 'Get Instagram profile data: followers, bio, engagement rate, posting frequency', IG_PROFILE_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        profile: 'InstagramProfile — username, full_name, bio, followers, following, posts_count, is_verified, is_business, engagement_rate, avg_likes, avg_comments, posting_frequency',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_PROFILE_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const profile = await getProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram profile fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/posts/:username ─────────────

serviceRouter.get('/instagram/posts/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/posts/:username', 'Get recent Instagram posts: captions, likes, comments, hashtags, timestamps', IG_POSTS_PRICE, walletAddress, {
      input: {
        username: 'string (required) — Instagram username (in URL path)',
        limit: 'number (optional, default: 12, max: 50)',
      },
      output: {
        posts: 'InstagramPost[] — id, shortcode, type, caption, likes, comments, timestamp, image_url, video_url, is_sponsored, hashtags',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_POSTS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '12') || 12, 1), 50);

  try {
    const proxy = getProxy();
    const posts = await getPosts(username, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      posts,
      meta: { username, count: posts.length, proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram posts fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/analyze/:username ───────────

serviceRouter.get('/instagram/analyze/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/analyze/:username', 'Full Instagram analysis: profile + posts + AI vision analysis (account type, content themes, sentiment, authenticity, brand recommendations)', IG_ANALYZE_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        profile: 'InstagramProfile',
        posts: 'InstagramPost[]',
        ai_analysis: '{ account_type, content_themes, sentiment, authenticity, images_analyzed, model_used, recommendations }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_ANALYZE_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await analyzeProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram analysis failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/analyze/:username/images ────

serviceRouter.get('/instagram/analyze/:username/images', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/analyze/:username/images', 'AI vision analysis of Instagram images only: content themes, style, aesthetic consistency, brand safety', IG_IMAGES_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        images_analyzed: 'number',
        analysis: '{ account_type, content_themes, sentiment, authenticity, recommendations, model_used }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_IMAGES_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await analyzeImages(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { username, proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram image analysis failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/instagram/audit/:username ─────────────

serviceRouter.get('/instagram/audit/:username', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/instagram/audit/:username', 'Instagram authenticity audit: fake follower detection, engagement pattern analysis, bot signals', IG_AUDIT_PRICE, walletAddress, {
      input: { username: 'string (required) — Instagram username (in URL path)' },
      output: {
        profile: 'InstagramProfile',
        authenticity: '{ score, verdict, face_consistency, engagement_pattern, follower_quality, comment_analysis, fake_signals }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, IG_AUDIT_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const username = c.req.param('username');
  if (!username) return c.json({ error: 'Missing username in URL path' }, 400);

  try {
    const proxy = getProxy();
    const result = await auditProfile(username);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Instagram audit failed', message: err?.message || String(err) }, 502);
  }
});

// ═══════════════════════════════════════════════════════
// ─── AIRBNB MARKET INTELLIGENCE API (Bounty #78) ────
// ═══════════════════════════════════════════════════════

const AIRBNB_SEARCH_PRICE = 0.02;
const AIRBNB_LISTING_PRICE = 0.01;
const AIRBNB_REVIEWS_PRICE = 0.01;
const AIRBNB_MARKET_STATS_PRICE = 0.05;

// ─── GET /api/airbnb/search ─────────────────────────

serviceRouter.get('/airbnb/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/search', 'Search Airbnb listings by location, dates, guests. Returns pricing, ratings, host info.', AIRBNB_SEARCH_PRICE, walletAddress, {
      input: {
        location: 'string (required) — city or area',
        checkin: 'string (optional) — YYYY-MM-DD',
        checkout: 'string (optional) — YYYY-MM-DD',
        guests: 'number (optional, default: 1)',
        limit: 'number (optional, default: 20, max: 50)',
      },
      output: {
        listings: 'AirbnbListing[] — id, name, price, rating, reviewCount, host, roomType, amenities, coordinates',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location' }, 400);

  const checkin = c.req.query('checkin') || undefined;
  const checkout = c.req.query('checkout') || undefined;
  const guests = parseInt(c.req.query('guests') || '1') || 1;
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const results = await searchAirbnb(location, checkin, checkout, guests, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      listings: results,
      meta: { location, checkin, checkout, guests, count: results.length, proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/airbnb/listing/:id ────────────────────

serviceRouter.get('/airbnb/listing/:id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/listing/:id', 'Get detailed Airbnb listing: host, amenities, pricing calendar, location.', AIRBNB_LISTING_PRICE, walletAddress, {
      input: { id: 'string (required) — Airbnb listing ID (in URL path)' },
      output: {
        listing: 'AirbnbListingDetail — id, name, description, price, rating, host, amenities, photos, location, houseRules',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_LISTING_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const listingId = c.req.param('id');
  if (!listingId) return c.json({ error: 'Missing listing ID' }, 400);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const listing = await getListingDetail(listingId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      listing,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb listing fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/airbnb/reviews/:listing_id ────────────

serviceRouter.get('/airbnb/reviews/:listing_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/reviews/:listing_id', 'Get Airbnb listing reviews with ratings and author info.', AIRBNB_REVIEWS_PRICE, walletAddress, {
      input: {
        listing_id: 'string (required) — Airbnb listing ID (in URL path)',
        limit: 'number (optional, default: 20, max: 50)',
      },
      output: {
        reviews: 'AirbnbReview[] — id, author, rating, text, date, response',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_REVIEWS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const listingId = c.req.param('listing_id');
  if (!listingId) return c.json({ error: 'Missing listing ID' }, 400);

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const reviews = await getListingReviews(listingId, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      reviews,
      meta: { listingId, count: reviews.length, proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb reviews fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/airbnb/market-stats ───────────────────

serviceRouter.get('/airbnb/market-stats', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/market-stats', 'Airbnb market statistics: average daily rate, price distribution, superhost percentage for an area.', AIRBNB_MARKET_STATS_PRICE, walletAddress, {
      input: {
        location: 'string (required) — city or area',
        checkin: 'string (optional) — YYYY-MM-DD',
        checkout: 'string (optional) — YYYY-MM-DD',
      },
      output: {
        stats: '{ averageDailyRate, medianPrice, priceDistribution, superhostPercentage, totalListings, averageRating }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_MARKET_STATS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location' }, 400);

  const checkin = c.req.query('checkin') || undefined;
  const checkout = c.req.query('checkout') || undefined;

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const stats = await getMarketStats(location, checkin, checkout);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      stats,
      meta: { location, proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb market stats failed', message: err?.message || String(err) }, 502);
  }
});

// ─── PREDICTION MARKET SIGNAL AGGREGATOR (Bounty #55) ───

const PREDICT_WALLET = process.env.WALLET_ADDRESS || '';
const PREDICT_SIGNAL_PRICE = 0.05;
const PREDICT_ARBITRAGE_PRICE = 0.03;
const PREDICT_SENTIMENT_PRICE = 0.02;
const PREDICT_TRENDING_PRICE = 0.04;

// GET /api/prediction/signal?market=us-presidential-election-2028
serviceRouter.get('/prediction/signal', async (c) => {
  const payment = extractPayment(c);
  const walletAddress = PREDICT_WALLET;

  if (!payment) {
    return c.json(build402Response('/api/prediction/signal', 'Get prediction market signal: combined odds from Polymarket/Kalshi/Metaculus + social sentiment from Twitter/Reddit/TikTok via mobile proxy. Detects arbitrage spreads and sentiment divergence.', PREDICT_SIGNAL_PRICE, walletAddress, {
      queryParams: { market: 'string — Market slug/topic (e.g. us-presidential-election-2028, bitcoin-etf-approval)' },
      output: {
        type: 'signal',
        market: 'string',
        timestamp: 'string',
        odds: { polymarket: 'MarketOdds | null', kalshi: 'KalshiOdds | null', metaculus: 'MetaculusOdds | null' },
        sentiment: { twitter: 'TwitterSentiment | null', reddit: 'RedditSentiment | null', tiktok: 'TikTokSentiment | null' },
        signals: { arbitrage: 'ArbitrageSignal', sentimentDivergence: 'SentimentDivergence', volumeSpike: '{ detected: boolean }' },
        proxy: '{ country: string, type: "mobile" }',
        payment: '{ txHash, amount, settled }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PREDICT_SIGNAL_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 402);
  }

  const market = c.req.query('market');
  if (!market) {
    return c.json({ error: 'Missing required query param: market', example: '/api/prediction/signal?market=bitcoin-etf-approval' }, 400);
  }

  try {
    const proxy = getProxy();
    const result = await getMarketSignal(market);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, carrier: proxy.carrier, type: 'mobile' },
      payment: { txHash: payment.txHash, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Signal aggregation failed', message: err?.message || String(err) }, 502);
  }
});

// GET /api/prediction/arbitrage
serviceRouter.get('/prediction/arbitrage', async (c) => {
  const payment = extractPayment(c);
  const walletAddress = PREDICT_WALLET;

  if (!payment) {
    return c.json(build402Response('/api/prediction/arbitrage', 'Get all active arbitrage opportunities across Polymarket and Kalshi. Returns top 10 spreads ranked by profit potential.', PREDICT_ARBITRAGE_PRICE, walletAddress, {
      queryParams: {},
      output: {
        type: 'arbitrage',
        timestamp: 'string',
        opportunities: 'Array<{ market, platforms, spread, potentialProfit, confidence, description }>',
        totalOpportunities: 'number',
        proxy: '{ country, type }',
        payment: '{ txHash, amount, settled }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PREDICT_ARBITRAGE_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 402);
  }

  try {
    const proxy = getProxy();
    const result = await getArbitrageOpportunities();

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, carrier: proxy.carrier, type: 'mobile' },
      payment: { txHash: payment.txHash, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Arbitrage scan failed', message: err?.message || String(err) }, 502);
  }
});

// GET /api/prediction/sentiment?topic=bitcoin+etf&country=US
serviceRouter.get('/prediction/sentiment', async (c) => {
  const payment = extractPayment(c);
  const walletAddress = PREDICT_WALLET;

  if (!payment) {
    return c.json(build402Response('/api/prediction/sentiment', 'Sentiment analysis for any prediction market topic from Twitter/X, Reddit, and TikTok via mobile proxies.', PREDICT_SENTIMENT_PRICE, walletAddress, {
      queryParams: {
        topic: 'string — Topic to analyze (required, e.g. "bitcoin etf", "us election 2028")',
        country: 'string — Target country code (optional, default: US)',
      },
      output: {
        type: 'sentiment',
        topic: 'string',
        country: 'string',
        overall: '{ score: number, label: bullish|bearish|neutral, confidence: number }',
        byPlatform: { twitter: 'TwitterSentiment', reddit: 'RedditSentiment', tiktok: 'TikTokSentiment' },
        proxy: '{ country, type }',
        payment: '{ txHash, amount, settled }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PREDICT_SENTIMENT_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 402);
  }

  const topic = c.req.query('topic');
  if (!topic) {
    return c.json({ error: 'Missing required query param: topic', example: '/api/prediction/sentiment?topic=bitcoin+etf&country=US' }, 400);
  }

  const country = c.req.query('country') || 'US';

  try {
    const proxy = getProxy();
    const result = await getSentimentAnalysis(topic, country);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, carrier: proxy.carrier, type: 'mobile' },
      payment: { txHash: payment.txHash, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Sentiment analysis failed', message: err?.message || String(err) }, 502);
  }
});

// GET /api/prediction/trending
serviceRouter.get('/prediction/trending', async (c) => {
  const payment = extractPayment(c);
  const walletAddress = PREDICT_WALLET;

  if (!payment) {
    return c.json(build402Response('/api/prediction/trending', 'Trending prediction markets with sentiment divergence scores. Identifies markets where social sentiment disagrees with on-chain odds.', PREDICT_TRENDING_PRICE, walletAddress, {
      queryParams: {},
      output: {
        type: 'trending',
        markets: 'Array<{ id, title, category, polymarketYes, sentimentScore, divergenceScore, divergenceType, volume24h, trending }>',
        proxy: '{ country, type }',
        payment: '{ txHash, amount, settled }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PREDICT_TRENDING_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 402);
  }

  try {
    const proxy = getProxy();
    const result = await getTrendingMarketsWithDivergence();

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, carrier: proxy.carrier, type: 'mobile' },
      payment: { txHash: payment.txHash, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Trending markets fetch failed', message: err?.message || String(err) }, 502);
  }
});

// GET /api/prediction/markets?minVolume=1000&minLiquidity=5000&limit=20
serviceRouter.get('/prediction/markets', async (c) => {
  const payment = extractPayment(c);
  const walletAddress = PREDICT_WALLET;
  const PREDICT_MARKETS_PRICE = 0.02;

  if (!payment) {
    return c.json(build402Response('/api/prediction/markets', 'List active prediction markets from Polymarket and Kalshi with volume and liquidity filters.', PREDICT_MARKETS_PRICE, walletAddress, {
      queryParams: {
        minVolume: 'number (optional) — minimum 24h volume in USD',
        minLiquidity: 'number (optional) — minimum liquidity in USD (Polymarket only)',
        limit: 'number (optional, default: 20, max: 50) — max markets to return per source',
        source: 'string (optional: "polymarket"|"kalshi"|"all", default: "all")',
      },
      output: {
        type: 'markets',
        polymarket: 'Array<{ slug, question, yes, volume24h, liquidity }>',
        kalshi: 'Array<{ ticker, title, yes, volume24h }>',
        proxy: '{ country, type }',
        payment: '{ txHash, amount, settled }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PREDICT_MARKETS_PRICE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 402);
  }

  try {
    const proxy = getProxy();
    const minVolume = Math.max(0, parseFloat(c.req.query('minVolume') ?? '0') || 0);
    const minLiquidity = Math.max(0, parseFloat(c.req.query('minLiquidity') ?? '0') || 0);
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
    const source = c.req.query('source') ?? 'all';

    const [polymarkets, kalshiMarkets] = await Promise.all([
      source !== 'kalshi' ? fetchPolymarketActive() : Promise.resolve([]),
      source !== 'polymarket' ? fetchKalshiActive() : Promise.resolve([]),
    ]);

    const filteredPoly = polymarkets
      .filter(m => m.volume24h >= minVolume && m.liquidity >= minLiquidity)
      .slice(0, limit);

    const filteredKalshi = kalshiMarkets
      .filter(m => m.volume24h >= minVolume)
      .slice(0, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      type: 'markets',
      polymarket: filteredPoly,
      kalshi: filteredKalshi,
      filters: { minVolume, minLiquidity, limit, source },
      proxy: { country: proxy.country, carrier: proxy.carrier, type: 'mobile' },
      payment: { txHash: payment.txHash, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Markets fetch failed', message: err?.message || String(err) }, 502);
  }
});
