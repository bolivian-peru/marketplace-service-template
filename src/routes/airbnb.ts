

/**
 * Airbnb & Short-Term Rental Intelligence API Routes
 *
 * Endpoints:
 *   GET /api/airbnb/search - Search for Airbnb listings
 *   GET /api/airbnb/listing/:id - Get listing details
 *   GET /api/airbnb/market-stats - Get market statistics
 *   GET /api/airbnb/reviews/:listing_id - Get listing reviews
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import { airbnb_scraper } from '../airbnb/rentals';

export const airbnbRouter = new Hono();

// Constants
const AIRBNB_SEARCH_PRICE_USDC = 0.02;  // $0.02 per search query
const AIRBNB_LISTING_PRICE_USDC = 0.01; // $0.01 per listing detail
const AIRBNB_STATS_PRICE_USDC = 0.05;   // $0.05 per market stats report
const AIRBNB_REVIEWS_PRICE_USDC = 0.01; // $0.01 per reviews fetch

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

// ─── GET /api/airbnb/search ───────────────────────────
airbnbRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/airbnb/search',
        'Search Airbnb listings by location, dates, and guests',
        AIRBNB_SEARCH_PRICE_USDC,
        walletAddress,
        {
          input: {
            location: 'string (required) — Location to search (e.g., "Miami Beach")',
            checkin: 'string (required) — Check-in date (YYYY-MM-DD)',
            checkout: 'string (required) — Check-out date (YYYY-MM-DD)',
            guests: 'number (optional, default: 2) — Number of guests',
            price_min: 'number (optional) — Minimum price per night',
            price_max: 'number (optional) — Maximum price per night',
            limit: 'number (optional, default: 20, max: 100) — Maximum results to return'
          },
          output: {
            location: 'string — Search location',
            results: 'AirbnbListing[] — List of listings',
            meta: {
              proxy: '{ ip, country, type:"mobile" }',
              payment: '{ txHash, network, amount, settled }'
            }
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_SEARCH_PRICE_USDC);
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

  // Extract query parameters
  const location = c.req.query('location');
  const checkin = c.req.query('checkin');
  const checkout = c.req.query('checkout');
  const guests = parseInt(c.req.query('guests') || '2');
  const priceMin = c.req.query('price_min') ? parseFloat(c.req.query('price_min')!) : undefined;
  const priceMax = c.req.query('price_max') ? parseFloat(c.req.query('price_max')!) : undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '20') || 20, 100);

  // Validate required parameters
  if (!location) {
    return c.json({
      error: 'Missing required parameter: location',
      example: '/api/airbnb/search?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2',
    }, 400);
  }

  if (!checkin || !checkout) {
    return c.json({
      error: 'Missing required parameters: checkin and checkout',
      example: '/api/airbnb/search?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2',
    }, 400);
  }

  try {
    const proxy = getProxy();
    const listings = await airbnb_scraper.search_listings(
      location,
      checkin,
      checkout,
      guests,
      priceMin,
      priceMax,
      limit
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      location,
      results: listings,
      meta: {
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          network: payment.network,
          amount: verification.amount,
          settled: true,
        },
      },
    });

  } catch (err: any) {
    return c.json({
      error: 'Search failed',
      message: err?.message || String(err),
      hint: 'Airbnb may be blocking requests. Try again in a few minutes or use different dates/location.',
    }, 502);
  }
});

// ─── GET /api/airbnb/listing/:id ────────────────────
airbnbRouter.get('/listing/:id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/airbnb/listing/:id',
        'Get detailed information for a specific Airbnb listing',
        AIRBNB_LISTING_PRICE_USDC,
        walletAddress,
        {
          input: { id: 'string (required) — Airbnb listing ID (in URL path)' },
          output: {
            listing: 'AirbnbListing — Full listing details',
            meta: {
              proxy: '{ ip, country, type:"mobile" }',
              payment: '{ txHash, network, amount, settled }'
            }
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_LISTING_PRICE_USDC);
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

  const listingId = c.req.param('id');
  if (!listingId) {
    return c.json({ error: 'Missing listing ID in URL path' }, 400);
  }

  try {
    const proxy = getProxy();
    const listing = await airbnb_scraper.get_listing_details(listingId);

    if (!listing) {
      return c.json({
        error: 'Listing not found',
        hint: 'The listing ID may be invalid or the listing may have been removed.',
      }, 404);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      listing,
      meta: {
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          network: payment.network,
          amount: verification.amount,
          settled: true,
        },
      },
    });

  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch listing details',
      message: err?.message || String(err),
      hint: 'The listing may have been removed or Airbnb may be blocking requests.',
    }, 502);
  }
});

// ─── GET /api/airbnb/market-stats ───────────────────
airbnbRouter.get('/market-stats', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/airbnb/market-stats',
        'Get market statistics for a specific location',
        AIRBNB_STATS_PRICE_USDC,
        walletAddress,
        {
          input: {
            location: 'string (required) — Location to analyze',
            checkin: 'string (required) — Check-in date (YYYY-MM-DD)',
            checkout: 'string (required) — Check-out date (YYYY-MM-DD)',
            guests: 'number (optional, default: 2) — Number of guests'
          },
          output: {
            location: 'string — Market location',
            avg_daily_rate: 'number | null — Average daily rate',
            median_daily_rate: 'number | null — Median daily rate',
            total_listings: 'number — Total listings in market',
            avg_rating: 'number | null — Average rating',
            superhost_pct: 'number | null — Percentage of superhosts',
            price_distribution: 'object — Price distribution by range',
            property_types: 'object — Count of each property type',
            occupancy_estimate: 'number | null — Estimated occupancy rate',
            revenue_potential: 'number | null — Estimated revenue potential',
            meta: {
              proxy: '{ ip, country, type:"mobile" }',
              payment: '{ txHash, network, amount, settled }'
            }
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_STATS_PRICE_USDC);
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

  // Extract query parameters
  const location = c.req.query('location');
  const checkin = c.req.query('checkin');
  const checkout = c.req.query('checkout');
  const guests = parseInt(c.req.query('guests') || '2');

  // Validate required parameters
  if (!location) {
    return c.json({
      error: 'Missing required parameter: location',
      example: '/api/airbnb/market-stats?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2',
    }, 400);
  }

  if (!checkin || !checkout) {
    return c.json({
      error: 'Missing required parameters: checkin and checkout',
      example: '/api/airbnb/market-stats?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2',
    }, 400);
  }

  try {
    const proxy = getProxy();
    const stats = await airbnb_scraper.get_market_stats(
      location,
      checkin,
      checkout,
      guests
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...stats,
      meta: {
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          network: payment.network,
          amount: verification.amount,
          settled: true,
        },
      },
    });

  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch market statistics',
      message: err?.message || String(err),
      hint: 'Airbnb may be blocking requests. Try again in a few minutes or use different dates/location.',
    }, 502);
  }
});

// ─── GET /api/airbnb/reviews/:listing_id ────────────
airbnbRouter.get('/reviews/:listing_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/airbnb/reviews/:listing_id',
        'Get reviews for a specific Airbnb listing',
        AIRBNB_REVIEWS_PRICE_USDC,
        walletAddress,
        {
          input: {
            listing_id: 'string (required) — Airbnb listing ID (in URL path)',
            limit: 'number (optional, default: 10, max: 50) — Maximum reviews to return'
          },
          output: {
            reviews: 'AirbnbReview[] — List of reviews',
            meta: {
              proxy: '{ ip, country, type:"mobile" }',
              payment: '{ txHash, network, amount, settled }'
            }
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, AIRBNB_REVIEWS_PRICE_USDC);
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

  const listingId = c.req.param('listing_id');
  const limit = Math.min(parseInt(c.req.query('limit') || '10') || 10, 50);

  if (!listingId) {
    return c.json({ error: 'Missing listing ID in URL path' }, 400);
  }

  try {
    const proxy = getProxy();
    const reviews = await airbnb_scraper.get_listing_reviews(listingId, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      reviews,
      meta: {
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          network: payment.network,
          amount: verification.amount,
          settled: true,
        },
      },
    });

  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch reviews',
      message: err?.message || String(err),
      hint: 'The listing may have been removed or Airbnb may be blocking requests.',
    }, 502);
  }
});
