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
 *   GET /api/serp      (Google SERP Tracker)
 *   GET /api/price     (E-Commerce Price & Stock Monitor)
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
import { scrapeProductPrice, monitorPrices } from './scrapers/price-monitor';
import { trackTravelPrices } from './scrapers/travel-price-tracker';
import { aggregateRealEstate } from './scrapers/realestate-scraper';
import { getSocialProfiles } from './scrapers/social-scraper';
import { spyOnAds } from './scrapers/adspy-scraper';
import { verifyAdPlacements } from './scrapers/adverify-scraper';
import { monitorReputation } from './scrapers/review-monitor';
import { aiSearch } from './scrapers/ai-search';

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
  const walletAddress = '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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
  const walletAddress = process.env.SOLANA_WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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

// ─── MOBILE SERP TRACKER ────────────────────────────────

import { scrapeMobileSERP } from './scrapers/serp-tracker';

const SERP_PRICE_USDC = parseFloat(process.env.SERP_PRICE_USDC || '0.003');
const SERP_DESCRIPTION = 'Mobile SERP Tracker — Google search results with organic, ads, PAA, AI overview, map pack, knowledge panel. Real mobile IP fingerprint.';
const SERP_OUTPUT_SCHEMA = {
  input: { query: 'string (required) — search query', location: 'string (optional) — geo location', num: 'number (optional) — results count, default 10' },
  output: { organic: '[{ position, title, url, snippet, sitelinks? }]', ads: '[{ position, title, url, description }]', peopleAlsoAsk: '[{ question, snippet }]', aiOverview: '{ text, sources }', mapPack: '[{ name, rating, reviews, address }]', knowledgePanel: '{ title, description, attributes }' },
};

serviceRouter.get('/serp', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Wallet not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/serp', SERP_DESCRIPTION, SERP_PRICE_USDC, walletAddress, SERP_OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SERP_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query') || c.req.query('q');
  if (!query) return c.json({ error: 'Missing required parameter: query' }, 400);

  const location = c.req.query('location') || c.req.query('loc') || undefined;
  const num = parseInt(c.req.query('num') || '10');

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const results = await scrapeMobileSERP(query, { location, num });

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      query,
      results,
      meta: { location, num, proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'SERP scrape failed', message: err?.message || String(err) }, 502);
  }
});

// ─── E-COMMERCE PRICE & STOCK MONITOR ─────────────────

const PRICE_PRICE_USDC = parseFloat(process.env.PRICE_PRICE_USDC || '0.005');
const PRICE_DESCRIPTION = 'E-Commerce Price & Stock Monitor — scrape any product page for price, availability, brand, rating. Supports Amazon, eBay, Walmart, Etsy, Target, AliExpress + schema.org/Product JSON-LD.';
const PRICE_OUTPUT_SCHEMA = {
  input: {
    url: 'string (required) — Product page URL to scrape',
    urls: 'string (optional) — Comma-separated list of URLs for batch monitoring',
  },
  output: {
    results: '[{ name, price, currency, originalPrice, stockStatus, image, url, store, brand, rating, reviewCount, checkedAt, onSale }]',
    totalFound: 'number',
  },
};

serviceRouter.get('/price', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Wallet not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/price', PRICE_DESCRIPTION, PRICE_PRICE_USDC, walletAddress, PRICE_OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const urlParam = c.req.query('url');
  const urlsParam = c.req.query('urls');

  if (!urlParam && !urlsParam) {
    return c.json({
      error: 'Missing required parameter',
      hint: 'Provide ?url=https://example.com/product or ?urls=https://a.com/p1,https://b.com/p2',
      example: '/api/price?url=https://www.amazon.com/dp/B0EXAMPLE',
    }, 400);
  }

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();

    let result: any;

    if (urlsParam) {
      const urls = urlsParam.split(',').map(u => u.trim()).filter(Boolean);
      if (urls.length === 0) {
        return c.json({ error: 'urls parameter is empty', hint: 'Provide comma-separated URLs' }, 400);
      }
      if (urls.length > 10) {
        return c.json({ error: 'Maximum 10 URLs per batch request', limit: 10 }, 400);
      }
      result = await monitorPrices(urls);
    } else {
      const product = await scrapeProductPrice(urlParam!);
      result = { results: [product], totalFound: 1 };
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Price scrape failed', message: err?.message || String(err), hint: 'The product page may be blocking requests or require JavaScript rendering.' }, 502);
  }
});

// ─── TRAVEL PRICE TRACKER ────────────────────────────

const TRAVEL_PRICE_USDC = parseFloat(process.env.TRAVEL_PRICE_USDC || '0.005');
const TRAVEL_DESCRIPTION = 'Travel Price Tracker API — compare flight, hotel, and package prices across Google Flights, Kayak, Skyscanner, Booking.com. Multi-provider aggregation with price range and cheapest-first sorting.';
const TRAVEL_OUTPUT_SCHEMA = {
  input: {
    type: '"flight" | "hotel" | "package" (required)',
    origin: 'string (flights) — departure city or airport code',
    destination: 'string (required) — destination city, airport, or hotel name',
    departDate: 'string (optional) — YYYY-MM-DD',
    returnDate: 'string (optional) — YYYY-MM-DD',
    travelers: 'number (optional) — default 1',
    limit: 'number (optional) — max results, default 20',
  },
  output: {
    results: '[{ provider, price, currency, origin, destination, departDate, returnDate, details, url, type, checkedAt }]',
    cheapest: 'TravelPrice | null',
    priceRange: '{ min, max }',
    totalFound: 'number',
  },
};

serviceRouter.get('/travel', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Wallet not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/travel', TRAVEL_DESCRIPTION, TRAVEL_PRICE_USDC, walletAddress, TRAVEL_OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, TRAVEL_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const type = (c.req.query('type') || 'flight') as 'flight' | 'hotel' | 'package';
  const origin = c.req.query('origin') || undefined;
  const destination = c.req.query('destination');
  const departDate = c.req.query('departDate') || c.req.query('depart') || undefined;
  const returnDate = c.req.query('returnDate') || c.req.query('return') || undefined;
  const travelers = parseInt(c.req.query('travelers') || '1');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  if (!destination) {
    return c.json({
      error: 'Missing required parameter: destination',
      hint: 'Provide ?type=flight&origin=NYC&destination=LAX&departDate=2026-06-15',
      example: '/api/travel?type=flight&origin=JFK&destination=LAX&departDate=2026-06-15&returnDate=2026-06-22',
    }, 400);
  }

  if (type === 'flight' && !origin) {
    return c.json({ error: 'Flight searches require origin parameter' }, 400);
  }

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();

    const result = await trackTravelPrices({
      type,
      origin,
      destination,
      departDate,
      returnDate,
      travelers,
      limit,
    });

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Travel price search failed', message: err?.message || String(err), hint: 'Travel sites may have blocked the request. Try again with a different query.' }, 502);
  }
});

// ─── REAL ESTATE LISTING AGGREGATOR ───────────────────

const REALESTATE_PRICE_USDC = parseFloat(process.env.REALESTATE_PRICE_USDC || '0.005');
const REALESTATE_DESCRIPTION = 'Real Estate Listing Aggregator — search Zillow, Realtor.com, Redfin for property listings with price, beds/baths, sqft, and status. Price range analysis included.';

serviceRouter.get('/realestate', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Wallet not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/realestate', REALESTATE_DESCRIPTION, REALESTATE_PRICE_USDC, walletAddress, {
      input: { location: 'string (required)', type: '"sale" | "rent" (default: sale)', limit: 'number (default: 20)' },
      output: { results: 'RealEstateListing[]', priceRange: '{ min, max, avg }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REALESTATE_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location' }, 400);

  const type = (c.req.query('type') || 'sale') as 'sale' | 'rent';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await aggregateRealEstate(location, type, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, meta: { proxy: { ip, country: proxy.country, type: 'mobile' } }, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Real estate search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── SOCIAL PROFILE INTELLIGENCE ──────────────────────

const SOCIAL_PRICE_USDC = parseFloat(process.env.SOCIAL_PRICE_USDC || '0.005');
const SOCIAL_DESCRIPTION = 'Social Profile Intelligence — aggregate public profiles from Twitter, Instagram, GitHub. Extract bio, followers, posts, verification status. Multi-platform lookup from a single username.';

serviceRouter.get('/social', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Wallet not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/social', SOCIAL_DESCRIPTION, SOCIAL_PRICE_USDC, walletAddress, {
      input: { username: 'string (required)', platforms: 'string (optional) — twitter,instagram,github (default: all)' },
      output: { profiles: 'SocialProfile[]', totalPlatforms: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SOCIAL_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const username = c.req.query('username');
  if (!username) return c.json({ error: 'Missing required parameter: username' }, 400);

  const platformsStr = c.req.query('platforms');
  const platforms = platformsStr ? platformsStr.split(',').map(s => s.trim()) : undefined;

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getSocialProfiles(username, platforms);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, meta: { proxy: { ip, country: proxy.country, type: 'mobile' } }, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Social lookup failed', message: err?.message || String(err) }, 502);
  }
});

// ─── AD SPY & CREATIVE INTELLIGENCE ───────────────────

const ADSPY_PRICE_USDC = parseFloat(process.env.ADSPY_PRICE_USDC || '0.005');
const ADSPY_DESCRIPTION = 'Ad Spy & Creative Intelligence — monitor competitor ads across Facebook Ad Library, Google Ads Transparency, TikTok Creative Center. Extract headlines, creatives, landing pages, ad formats.';

serviceRouter.get('/adspy', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Wallet not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/adspy', ADSPY_DESCRIPTION, ADSPY_PRICE_USDC, walletAddress, {
      input: { keyword: 'string (optional)', advertiser: 'string (optional)', platform: '"facebook" | "google" | "tiktok" (optional)' },
      output: { results: 'AdCreative[]', platforms: 'string[]' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, ADSPY_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const keyword = c.req.query('keyword') || c.req.query('query') || undefined;
  const advertiser = c.req.query('advertiser') || undefined;
  const platform = c.req.query('platform') || undefined;

  if (!keyword && !advertiser) {
    return c.json({ error: 'Missing required parameter: keyword or advertiser', example: '/api/adspy?keyword=shoes&platform=facebook' }, 400);
  }

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await spyOnAds({ keyword, advertiser, platform });

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, meta: { proxy: { ip, country: proxy.country, type: 'mobile' } }, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Ad spy failed', message: err?.message || String(err) }, 502);
  }
});

// ─── AD VERIFICATION & BRAND SAFETY ──────────────────

const ADVERIFY_PRICE_USDC = 0.005;
serviceRouter.get('/adverify', async (c) => {
  const wallet = process.env.WALLET_ADDRESS; if(!wallet) return c.json({error:'Wallet not configured'},500);
  const p = extractPayment(c); if(!p) return c.json(build402Response('/api/adverify','Ad Verification & Brand Safety — check URLs for adult content, gambling, hate speech, malware, and competitor ads.',ADVERIFY_PRICE_USDC,wallet,{input:{urls:'string — comma-separated URLs',brand:'string (optional)',competitors:'string (optional)'}}),402);
  const v = await verifyPayment(p,wallet,ADVERIFY_PRICE_USDC); if(!v.valid) return c.json({error:'Payment verification failed',reason:v.error},402);
  const urls = (c.req.query('urls')||c.req.query('url')||'').split(',').map(u=>u.trim()).filter(Boolean);
  if(!urls.length) return c.json({error:'Missing urls parameter'},400);
  const competitors = (c.req.query('competitors')||'').split(',').map(u=>u.trim()).filter(Boolean);
  try{
    const proxy = getProxy(); const ip = await getProxyExitIp();
    const result = await verifyAdPlacements(urls,undefined,competitors.length?competitors:undefined);
    c.header('X-Payment-Settled','true'); c.header('X-Payment-TxHash',p.txHash);
    return c.json({...result,meta:{proxy:{ip,country:proxy.country,type:'mobile'}},payment:{txHash:p.txHash,network:p.network,amount:v.amount,settled:true}});
  }catch(err:any){return c.json({error:'Verification failed',message:err?.message||String(err)},502);}
});

// ─── REVIEW & REPUTATION MONITOR ─────────────────────

const REVIEWMON_PRICE_USDC = 0.005;
serviceRouter.get('/reputation', async (c) => {
  const wallet = process.env.WALLET_ADDRESS; if(!wallet) return c.json({error:'Wallet not configured'},500);
  const p = extractPayment(c); if(!p) return c.json(build402Response('/api/reputation','Review & Reputation Monitor — aggregate reviews from Trustpilot and Google. Sentiment analysis and rating distribution included.',REVIEWMON_PRICE_USDC,wallet,{input:{business:'string (required)',platforms:'trustpilot,google (optional)'}}),402);
  const v = await verifyPayment(p,wallet,REVIEWMON_PRICE_USDC); if(!v.valid) return c.json({error:'Payment verification failed',reason:v.error},402);
  const business = c.req.query('business'); if(!business) return c.json({error:'Missing business parameter'},400);
  const plats = (c.req.query('platforms')||'').split(',').map(s=>s.trim()).filter(Boolean);
  try{
    const proxy = getProxy(); const ip = await getProxyExitIp();
    const result = await monitorReputation(business,plats.length?plats:undefined);
    c.header('X-Payment-Settled','true'); c.header('X-Payment-TxHash',p.txHash);
    return c.json({...result,meta:{proxy:{ip,country:proxy.country,type:'mobile'}},payment:{txHash:p.txHash,network:p.network,amount:v.amount,settled:true}});
  }catch(err:any){return c.json({error:'Monitor failed',message:err?.message||String(err)},502);}
});

// ─── AI-POWERED SEARCH ($200 Wave 1) ──────────────────

const AISEARCH_PRICE_USDC = 0.02;
serviceRouter.get('/aisearch', async (c) => {
  const wallet = process.env.WALLET_ADDRESS; if(!wallet) return c.json({error:'Wallet not configured'},500);
  const p = extractPayment(c); if(!p) return c.json(build402Response('/api/aisearch','AI-Powered Search Summarizer — Google SERP + qwen3.7-max LLM analysis. Returns structured answers with cited sources.',AISEARCH_PRICE_USDC,wallet,{input:{q:'string (required)',deep:'boolean (optional)'},output:{answer:'string',sources:'[{title,url,snippet}]',followUpQuestions:'string[]',confidence:'high|medium|low',tokensUsed:'number'}}),402);
  const v = await verifyPayment(p,wallet,AISEARCH_PRICE_USDC); if(!v.valid) return c.json({error:'Payment verification failed',reason:v.error},402);
  const q = c.req.query('q') || c.req.query('query');
  if(!q) return c.json({error:'Missing query parameter',example:'/api/aisearch?q=iPhone+16+vs+Samsung+S25+camera'},400);
  const deep = c.req.query('deep') === 'true';
  try{
    const proxy = getProxy(); const ip = await getProxyExitIp();
    const result = await aiSearch(q, deep, process.env.AI_SEARCH_API_KEY || c.req.query('apikey') || undefined);
    c.header('X-Payment-Settled','true'); c.header('X-Payment-TxHash',p.txHash);
    return c.json({...result,meta:{proxy:{ip,country:proxy.country,type:'mobile'}},payment:{txHash:p.txHash,network:p.network,amount:v.amount,settled:true}});
  }catch(err:any){return c.json({error:'AI search failed',message:err?.message||String(err)},502);}
});
