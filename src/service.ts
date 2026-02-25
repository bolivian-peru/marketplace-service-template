/**
 * Service Router — Marketplace API
 *
 * Exposes:
 *   GET /api/run       (Google Maps Lead Generator)
 *   GET /api/details   (Google Maps Place details)
 *   GET /api/jobs      (Job Market Intelligence)
 *   GET /api/reviews/* (Google Reviews & Business Data)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';
import { searchTweets, getTrending as getXTrending, getUserProfile, getUserTweets, getThread as getXThread, COUNTRY_WOEIDS } from './scrapers/twitter';

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


// ─── BOUNTY #73: X/Twitter wallet ──────────────────
const X_WALLET_ADDRESS = process.env.WALLET_ADDRESS || 'A6M8icBwgDPwYhaWAjhJw267nbtkuivKH2q6sKPZgQEf';

// ═══════════════════════════════════════════════════════
// X/Twitter Real-Time Search API (Bounty #73) — $100
// ═══════════════════════════════════════════════════════


const X_PRICES = {
  search: 0.01,
  trending: 0.005,
  profile: 0.01,
  tweets: 0.01,
  thread: 0.02,
};

// ─── GET /api/x/search ──────────────────────────────
serviceRouter.get('/x/search', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/search', 'Search tweets by keyword or hashtag', X_PRICES.search, X_WALLET_ADDRESS, {
        input: {
          query: 'string (required) — Search keyword, hashtag, or from:user',
          sort: 'string (optional: latest|top|people|media, default: latest)',
          limit: 'number (optional, default: 20, max: 100)',
        },
        output: { results: 'Tweet[] — id, author, text, likes, retweets, replies, views, url, media, hashtags', meta: 'proxy info' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.search, X_WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const query = c.req.query('query');
    if (!query) return c.json({ error: 'query parameter is required' }, 400);

    const sort = (c.req.query('sort') as any) || 'latest';
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const proxyIp = await getProxyExitIp();
    const data = await searchTweets(query, sort, limit);

    return c.json({
      query,
      ...data,
      meta: {
        sort,
        total_results: data.total_results,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(X_PRICES.search), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X search failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/trending ────────────────────────────
serviceRouter.get('/x/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/trending', 'Trending topics on X by country', X_PRICES.trending, X_WALLET_ADDRESS, {
        input: { country: 'string (optional: US|UK|CA|AU|IN|BR|JP|DE|FR|MX|WORLDWIDE, default: US)' },
        output: { trends: 'TrendingTopic[] — name, tweet_volume, rank, category' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.trending, X_WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const country = (c.req.query('country') || 'US').toUpperCase();
    const woeid = COUNTRY_WOEIDS[country] || COUNTRY_WOEIDS.US;
    const proxyIp = await getProxyExitIp();
    const trends = await getXTrending(woeid);

    return c.json({
      country,
      trends,
      meta: {
        woeid,
        total_trends: trends.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(X_PRICES.trending), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X trending failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/user/:handle ────────────────────────
serviceRouter.get('/x/user/:handle', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/user/:handle', 'X user profile with metrics', X_PRICES.profile, X_WALLET_ADDRESS, {
        input: { handle: 'string (required) — X handle without @' },
        output: { profile: 'XUserProfile — handle, name, bio, followers, following, tweet_count, verified, location' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.profile, X_WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const handle = c.req.param('handle');
    if (!handle) return c.json({ error: 'handle is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const profile = await getUserProfile(handle);

    return c.json({
      profile,
      meta: {
        handle,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(X_PRICES.profile), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X user profile failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/user/:handle/tweets ─────────────────
serviceRouter.get('/x/user/:handle/tweets', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/user/:handle/tweets', 'Recent tweets from a user', X_PRICES.tweets, X_WALLET_ADDRESS, {
        input: {
          handle: 'string (required) — X handle without @',
          limit: 'number (optional, default: 20, max: 200)',
        },
        output: { tweets: 'Tweet[] — full tweet data with engagement metrics' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.tweets, X_WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const handle = c.req.param('handle');
    if (!handle) return c.json({ error: 'handle is required' }, 400);

    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 200);
    const proxyIp = await getProxyExitIp();
    const tweets = await getUserTweets(handle, limit);

    return c.json({
      handle,
      tweets,
      meta: {
        total_tweets: tweets.length,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(X_PRICES.tweets), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X user tweets failed', details: err.message }, 500);
  }
});

// ─── GET /api/x/thread/:tweet_id ────────────────────
serviceRouter.get('/x/thread/:tweet_id', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/x/thread/:tweet_id', 'Full conversation thread from a tweet', X_PRICES.thread, X_WALLET_ADDRESS, {
        input: { tweet_id: 'string (required) — Tweet ID' },
        output: { root: 'Tweet — the original tweet', conversation: 'Tweet[] — replies and thread', total: 'number' },
      }),
      402,
    );
  }

  const verified = await verifyPayment(payment.txHash, payment.network, X_PRICES.thread, X_WALLET_ADDRESS);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  const clientIp = getClientIp(c);
  if (!checkProxyRateLimit(clientIp)) {
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  try {
    const tweetId = c.req.param('tweet_id');
    if (!tweetId) return c.json({ error: 'tweet_id is required' }, 400);

    const proxyIp = await getProxyExitIp();
    const thread = await getXThread(tweetId);

    return c.json({
      ...thread,
      meta: {
        tweet_id: tweetId,
        conversation_size: thread.total,
        proxy: { ip: proxyIp || 'mobile', country: 'US', carrier: 'T-Mobile' },
      },
      payment: { txHash: payment.txHash, amount: String(X_PRICES.thread), verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'X thread fetch failed', details: err.message }, 500);
  }
});
