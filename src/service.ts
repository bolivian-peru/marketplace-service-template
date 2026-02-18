/**
 * Service Router — Job Market Intelligence (Bounty #16)
 *
 * Exposes ONLY:
 *   GET /api/jobs
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { searchAirbnb, getListingDetail, getListingReviews, getMarketStats } from './scrapers/airbnb-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Job Market Intelligence API (Indeed/LinkedIn): title, company, location, salary, date, link, remote + proxy exit metadata.';

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
// ─── AIRBNB MARKET INTELLIGENCE API (Bounty #78) ────
// ═══════════════════════════════════════════════════════

const AIRBNB_SEARCH_PRICE = 0.02;     // $0.02 per search
const AIRBNB_LISTING_PRICE = 0.01;    // $0.01 per listing detail
const AIRBNB_REVIEWS_PRICE = 0.01;    // $0.01 per reviews fetch
const AIRBNB_MARKET_PRICE = 0.05;     // $0.05 per market stats report

// ─── GET /api/airbnb/search ─────────────────────────

serviceRouter.get('/airbnb/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/search', 'Search Airbnb listings by location, dates, guests, and price range', AIRBNB_SEARCH_PRICE, walletAddress, {
      input: {
        location: 'string (required) — city or area (e.g., "Miami Beach")',
        checkin: 'string (optional) — YYYY-MM-DD',
        checkout: 'string (optional) — YYYY-MM-DD',
        guests: 'number (default: 2)',
        price_min: 'number (optional) — minimum price per night',
        price_max: 'number (optional) — maximum price per night',
        limit: 'number (default: 20, max: 50)',
      },
      output: {
        results: 'AirbnbListing[] — id, title, type, price_per_night, rating, reviews_count, superhost, bedrooms, bathrooms, max_guests, amenities, images, url',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/airbnb/search?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07' }, 400);

  const checkin = c.req.query('checkin');
  const checkout = c.req.query('checkout');
  const guests = Math.max(1, parseInt(c.req.query('guests') || '2') || 2);
  const priceMin = c.req.query('price_min') ? parseInt(c.req.query('price_min')!) : undefined;
  const priceMax = c.req.query('price_max') ? parseInt(c.req.query('price_max')!) : undefined;
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const results = await searchAirbnb(location, checkin, checkout, guests, priceMin, priceMax, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      location,
      checkin: checkin || null,
      checkout: checkout || null,
      guests,
      results,
      totalResults: results.length,
      meta: {
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/airbnb/listing/:id ────────────────────

serviceRouter.get('/airbnb/listing/:id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/listing/:id', 'Get detailed Airbnb listing: price, rating, host, amenities, rules', AIRBNB_LISTING_PRICE, walletAddress, {
      input: {
        id: 'string (required, in path) — Airbnb listing ID',
      },
      output: {
        listing: 'AirbnbListingDetail — full listing with description, host info, house rules, amenities',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_LISTING_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const id = c.req.param('id');
  if (!id || !/^\d+$/.test(id)) {
    return c.json({ error: 'Invalid listing ID. Must be numeric.', example: '/api/airbnb/listing/12345678' }, 400);
  }

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const listing = await getListingDetail(id);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...listing,
      meta: {
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb listing fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/airbnb/reviews/:listing_id ────────────

serviceRouter.get('/airbnb/reviews/:listing_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/reviews/:listing_id', 'Fetch Airbnb listing reviews', AIRBNB_REVIEWS_PRICE, walletAddress, {
      input: {
        listing_id: 'string (required, in path) — Airbnb listing ID',
        limit: 'number (default: 10, max: 20)',
      },
      output: {
        reviews: 'AirbnbReview[] — author, rating, date, text, response',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_REVIEWS_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const listingId = c.req.param('listing_id');
  if (!listingId || !/^\d+$/.test(listingId)) {
    return c.json({ error: 'Invalid listing ID. Must be numeric.' }, 400);
  }

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 20);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const reviews = await getListingReviews(listingId, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      listing_id: listingId,
      reviews,
      totalReturned: reviews.length,
      meta: {
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Airbnb reviews fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/airbnb/market-stats ───────────────────

serviceRouter.get('/airbnb/market-stats', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/airbnb/market-stats', 'Market statistics: avg daily rate, occupancy estimate, price distribution, property types', AIRBNB_MARKET_PRICE, walletAddress, {
      input: {
        location: 'string (required) — market area (e.g., "Miami Beach")',
        checkin: 'string (optional) — YYYY-MM-DD for seasonal pricing',
        checkout: 'string (optional) — YYYY-MM-DD',
      },
      output: {
        stats: '{ avg_daily_rate, median_daily_rate, total_listings, avg_rating, superhost_pct, price_distribution, property_types }',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_MARKET_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/airbnb/market-stats?location=Miami+Beach' }, 400);

  const checkin = c.req.query('checkin');
  const checkout = c.req.query('checkout');

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const stats = await getMarketStats(location, checkin, checkout);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...stats,
      timestamp: new Date().toISOString(),
      meta: {
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Market stats generation failed', message: err?.message || String(err) }, 502);
  }
});


// ═══════════════════════════════════════════════════════
// ─── FACEBOOK MARKETPLACE MONITOR API (Bounty #75) ───
// ═══════════════════════════════════════════════════════

const FB_SEARCH_PRICE = 0.01;
const FB_LISTING_PRICE = 0.005;
const FB_MONITOR_PRICE = 0.02;

serviceRouter.get('/marketplace/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/marketplace/search', 'Search Facebook Marketplace', FB_SEARCH_PRICE, walletAddress, {
      input: { query: 'string (required)', location: 'string', min_price: 'number', max_price: 'number', limit: 'number (default: 20)' },
      output: { results: 'MarketplaceListing[]', totalFound: 'number' },
    }), 402);
  }
  const verification = await verifyPayment(payment, walletAddress, FB_SEARCH_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment failed', reason: verification.error }, 402);
  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing query' }, 400);
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) { c.header('Retry-After', '60'); return c.json({ error: 'Rate limited' }, 429); }
  try {
    const proxy = getProxy(); const ip = await getProxyExitIp();
    const result = await searchMarketplace(query, { location: c.req.query('location'), minPrice: c.req.query('min_price') ? parseInt(c.req.query('min_price')!) : undefined, maxPrice: c.req.query('max_price') ? parseInt(c.req.query('max_price')!) : undefined }, Math.min(parseInt(c.req.query('limit') || '20') || 20, 40));
    c.header('X-Payment-Settled', 'true'); c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, meta: { proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' } }, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) { return c.json({ error: 'Search failed', message: err?.message || String(err) }, 502); }
});

serviceRouter.get('/marketplace/listing/:id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/marketplace/listing/:id', 'Get listing details', FB_LISTING_PRICE, walletAddress, {
      input: { id: 'string (required)' }, output: { listing: 'MarketplaceListing' },
    }), 402);
  }
  const verification = await verifyPayment(payment, walletAddress, FB_LISTING_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment failed', reason: verification.error }, 402);
  const id = c.req.param('id');
  if (!id || !/^\d+$/.test(id)) return c.json({ error: 'Invalid listing ID' }, 400);
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) { c.header('Retry-After', '60'); return c.json({ error: 'Rate limited' }, 429); }
  try {
    const proxy = getProxy(); const ip = await getProxyExitIp();
    const listing = await getListingDetail(id);
    c.header('X-Payment-Settled', 'true'); c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...listing, meta: { proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' } }, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) { return c.json({ error: 'Fetch failed', message: err?.message || String(err) }, 502); }
});

serviceRouter.get('/marketplace/categories', async (c) => {
  return c.json({ location: c.req.query('location') || 'all', categories: await getCategories() });
});

serviceRouter.get('/marketplace/new', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/marketplace/new', 'Monitor new listings', FB_MONITOR_PRICE, walletAddress, {
      input: { query: 'string (required)', since: 'string (default: "1h")', location: 'string', limit: 'number' },
      output: { results: 'MarketplaceListing[]', totalFound: 'number' },
    }), 402);
  }
  const verification = await verifyPayment(payment, walletAddress, FB_MONITOR_PRICE);
  if (!verification.valid) return c.json({ error: 'Payment failed', reason: verification.error }, 402);
  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing query' }, 400);
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) { c.header('Retry-After', '60'); return c.json({ error: 'Rate limited' }, 429); }
  try {
    const proxy = getProxy(); const ip = await getProxyExitIp();
    const result = await getNewListings(query, parseInt(c.req.query('since') || '1') || 1, c.req.query('location'), Math.min(parseInt(c.req.query('limit') || '20') || 20, 40));
    c.header('X-Payment-Settled', 'true'); c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, meta: { proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' } }, payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) { return c.json({ error: 'Monitor failed', message: err?.message || String(err) }, 502); }
});
