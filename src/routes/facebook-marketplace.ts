/**
 * Facebook Marketplace Monitor Routes (Bounty #75)
 * ─────────────────────────────────────────────────
 * Endpoints:
 *   GET /facebook/search         — Search listings by keyword/location
 *   GET /facebook/listing/:id    — Get listing details
 *   GET /facebook/seller/:id     — Seller profile analysis
 *   GET /facebook/price-alerts   — Check prices against target
 *   GET /facebook/deal-score/:id — Score a single listing deal
 *   GET /facebook/deals          — Search + score deals
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchListings,
  getListingDetail,
  analyzeSeller,
  checkPriceAlerts,
  scoreDeal,
  scoreDeals,
} from '../scrapers/facebook-marketplace';

export const facebookRouter = new Hono();

// ─── PRICING ────────────────────────────────────────

const PRICES = {
  search: 0.01,
  listing: 0.01,
  seller: 0.02,
  priceAlerts: 0.02,
  dealScore: 0.01,
  deals: 0.03,
};

// ─── OUTPUT SCHEMAS ─────────────────────────────────

const SEARCH_SCHEMA = {
  input: {
    query: 'string — Search keywords (required)',
    location: 'string — City or region (optional)',
    minPrice: 'number — Minimum price filter (optional)',
    maxPrice: 'number — Maximum price filter (optional)',
    condition: 'string — new|used_like_new|used_good|used_fair (optional)',
    sortBy: 'string — best_match|price_low|price_high|date_newest (optional)',
    radius: 'number — Search radius in km (optional)',
    limit: 'number — Max results, default 20, max 50 (optional)',
    cursor: 'string — Pagination cursor (optional)',
  },
  output: {
    query: 'string',
    location: 'string | null',
    listings: [{
      id: 'string',
      title: 'string',
      price: 'number | null',
      currency: 'string',
      location: 'string | null',
      image_url: 'string | null',
      url: 'string',
      condition: 'string | null',
      category: 'string | null',
      date_listed: 'string | null',
      is_shipping_available: 'boolean',
    }],
    total_found: 'number',
    has_more: 'boolean',
    cursor: 'string | null',
  },
};

const LISTING_SCHEMA = {
  input: { id: 'string — Facebook Marketplace listing ID (required)' },
  output: {
    id: 'string',
    title: 'string',
    price: 'number | null',
    currency: 'string',
    location: 'string | null',
    images: 'string[]',
    condition: 'string | null',
    full_description: 'string | null',
    specifications: 'Record<string, string>',
    seller: {
      name: 'string',
      is_verified: 'boolean',
      joined_date: 'string | null',
      response_rate: 'string | null',
      badges: 'string[]',
    },
  },
};

const SELLER_SCHEMA = {
  input: { id: 'string — Seller profile ID (required)' },
  output: {
    seller: '{ name, id, is_verified, joined_date, badges, listings_count }',
    trust_score: 'number (0-100)',
    trust_level: 'string (high|medium|low|unknown)',
    recent_listings: 'MarketplaceListing[]',
    risk_factors: 'string[]',
    positive_signals: 'string[]',
  },
};

const PRICE_ALERT_SCHEMA = {
  input: {
    listing_ids: 'string — Comma-separated listing IDs (required)',
    target_price: 'number — Target price threshold (required)',
  },
  output: {
    alerts: [{
      listing_id: 'string',
      title: 'string',
      current_price: 'number | null',
      target_price: 'number',
      below_target: 'boolean',
      price_diff: 'number | null',
      price_diff_pct: 'number | null',
    }],
  },
};

const DEAL_SCORE_SCHEMA = {
  input: { id: 'string — Listing ID (required)' },
  output: {
    listing_id: 'string',
    title: 'string',
    price: 'number | null',
    score: 'number (0-100)',
    rating: 'string (excellent|good|fair|poor)',
    factors: [{ name: 'string', score: 'number', weight: 'number', detail: 'string' }],
  },
};

// ─── HELPER: payment gate ───────────────────────────

async function requirePayment(c: any, resource: string, description: string, price: number, schema: any) {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return { error: true, response: c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500) };
  }

  const payment = extractPayment(c);
  if (!payment) {
    return {
      error: true,
      response: c.json(build402Response(resource, description, price, walletAddress, schema), 402),
    };
  }

  const verification = await verifyPayment(payment, walletAddress, price);
  if (!verification.valid) {
    return {
      error: true,
      response: c.json({
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount.',
      }, 402),
    };
  }

  return { error: false, payment };
}

// ─── SEARCH LISTINGS ────────────────────────────────

facebookRouter.get('/search', async (c) => {
  const gate = await requirePayment(
    c,
    '/api/facebook/search',
    'Search Facebook Marketplace listings by keyword and location with filters',
    PRICES.search,
    SEARCH_SCHEMA,
  );
  if (gate.error) return gate.response;

  const query = c.req.query('query');
  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide search keywords, e.g. ?query=iphone+14&location=Austin+TX',
      example: '/api/facebook/search?query=mountain+bike&location=Denver+CO&maxPrice=500',
    }, 400);
  }

  const location = c.req.query('location');
  const minPrice = c.req.query('minPrice') ? parseFloat(c.req.query('minPrice')!) : undefined;
  const maxPrice = c.req.query('maxPrice') ? parseFloat(c.req.query('maxPrice')!) : undefined;
  const condition = c.req.query('condition');
  const sortBy = c.req.query('sortBy') as any;
  const radius = c.req.query('radius') ? parseInt(c.req.query('radius')!) : undefined;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
  const cursor = c.req.query('cursor');

  try {
    const proxy = getProxy();
    const result = await searchListings(query, location || undefined, {
      minPrice,
      maxPrice,
      condition: condition || undefined,
      sortBy,
      radius,
      limit,
      cursor: cursor || undefined,
    });

    return c.json({
      ...result,
      proxy: { ip: null, country: proxy.country, type: 'mobile' },
      payment: {
        txHash: gate.payment!.txHash,
        network: gate.payment!.network,
        amount: PRICES.search,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[FB-MARKETPLACE] Search error: ${err.message}`);
    return c.json({ error: 'Failed to search Facebook Marketplace', detail: err.message }, 502);
  }
});

// ─── LISTING DETAIL ─────────────────────────────────

facebookRouter.get('/listing/:id', async (c) => {
  const gate = await requirePayment(
    c,
    '/api/facebook/listing/:id',
    'Get detailed Facebook Marketplace listing with seller info, images, and specs',
    PRICES.listing,
    LISTING_SCHEMA,
  );
  if (gate.error) return gate.response;

  const listingId = c.req.param('id');
  if (!listingId || !/^\d+$/.test(listingId)) {
    return c.json({ error: 'Invalid listing ID — must be a numeric ID' }, 400);
  }

  try {
    const proxy = getProxy();
    const detail = await getListingDetail(listingId);

    if (!detail) {
      return c.json({ error: 'Listing not found or could not be parsed' }, 404);
    }

    return c.json({
      ...detail,
      proxy: { ip: null, country: proxy.country, type: 'mobile' },
      payment: {
        txHash: gate.payment!.txHash,
        network: gate.payment!.network,
        amount: PRICES.listing,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[FB-MARKETPLACE] Listing detail error: ${err.message}`);
    return c.json({ error: 'Failed to fetch listing details', detail: err.message }, 502);
  }
});

// ─── SELLER ANALYSIS ────────────────────────────────

facebookRouter.get('/seller/:id', async (c) => {
  const gate = await requirePayment(
    c,
    '/api/facebook/seller/:id',
    'Analyze Facebook Marketplace seller: trust score, risk factors, recent listings',
    PRICES.seller,
    SELLER_SCHEMA,
  );
  if (gate.error) return gate.response;

  const sellerId = c.req.param('id');
  if (!sellerId || !/^\d+$/.test(sellerId)) {
    return c.json({ error: 'Invalid seller ID — must be a numeric ID' }, 400);
  }

  try {
    const proxy = getProxy();
    const analysis = await analyzeSeller(sellerId);

    return c.json({
      ...analysis,
      proxy: { ip: null, country: proxy.country, type: 'mobile' },
      payment: {
        txHash: gate.payment!.txHash,
        network: gate.payment!.network,
        amount: PRICES.seller,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[FB-MARKETPLACE] Seller analysis error: ${err.message}`);
    return c.json({ error: 'Failed to analyze seller', detail: err.message }, 502);
  }
});

// ─── PRICE ALERTS ───────────────────────────────────

facebookRouter.get('/price-alerts', async (c) => {
  const gate = await requirePayment(
    c,
    '/api/facebook/price-alerts',
    'Check Facebook Marketplace listing prices against a target price threshold',
    PRICES.priceAlerts,
    PRICE_ALERT_SCHEMA,
  );
  if (gate.error) return gate.response;

  const listingIdsParam = c.req.query('listing_ids');
  const targetPriceParam = c.req.query('target_price');

  if (!listingIdsParam) {
    return c.json({
      error: 'Missing required parameter: listing_ids',
      hint: 'Comma-separated listing IDs, e.g. ?listing_ids=123456,789012&target_price=100',
    }, 400);
  }

  if (!targetPriceParam) {
    return c.json({
      error: 'Missing required parameter: target_price',
      hint: 'Target price threshold, e.g. ?listing_ids=123456&target_price=100',
    }, 400);
  }

  const listingIds = listingIdsParam.split(',').map(id => id.trim()).filter(Boolean);
  const targetPrice = parseFloat(targetPriceParam);

  if (isNaN(targetPrice) || targetPrice < 0) {
    return c.json({ error: 'Invalid target_price — must be a non-negative number' }, 400);
  }

  if (listingIds.length === 0) {
    return c.json({ error: 'No valid listing IDs provided' }, 400);
  }

  if (listingIds.length > 10) {
    return c.json({ error: 'Maximum 10 listing IDs per request' }, 400);
  }

  try {
    const proxy = getProxy();
    const alerts = await checkPriceAlerts(listingIds, targetPrice);
    const belowTarget = alerts.filter(a => a.below_target);

    return c.json({
      target_price: targetPrice,
      total_checked: alerts.length,
      below_target_count: belowTarget.length,
      alerts,
      proxy: { ip: null, country: proxy.country, type: 'mobile' },
      payment: {
        txHash: gate.payment!.txHash,
        network: gate.payment!.network,
        amount: PRICES.priceAlerts,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[FB-MARKETPLACE] Price alert error: ${err.message}`);
    return c.json({ error: 'Failed to check price alerts', detail: err.message }, 502);
  }
});

// ─── DEAL SCORE (single listing) ────────────────────

facebookRouter.get('/deal-score/:id', async (c) => {
  const gate = await requirePayment(
    c,
    '/api/facebook/deal-score/:id',
    'Score a Facebook Marketplace listing deal (0-100) with factor breakdown',
    PRICES.dealScore,
    DEAL_SCORE_SCHEMA,
  );
  if (gate.error) return gate.response;

  const listingId = c.req.param('id');
  if (!listingId || !/^\d+$/.test(listingId)) {
    return c.json({ error: 'Invalid listing ID — must be a numeric ID' }, 400);
  }

  try {
    const proxy = getProxy();
    const score = await scoreDeal(listingId);

    if (!score) {
      return c.json({ error: 'Listing not found or could not be scored' }, 404);
    }

    return c.json({
      ...score,
      proxy: { ip: null, country: proxy.country, type: 'mobile' },
      payment: {
        txHash: gate.payment!.txHash,
        network: gate.payment!.network,
        amount: PRICES.dealScore,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[FB-MARKETPLACE] Deal score error: ${err.message}`);
    return c.json({ error: 'Failed to score deal', detail: err.message }, 502);
  }
});

// ─── DEALS (search + score) ─────────────────────────

facebookRouter.get('/deals', async (c) => {
  const gate = await requirePayment(
    c,
    '/api/facebook/deals',
    'Search Facebook Marketplace and score all results — find the best deals',
    PRICES.deals,
    DEAL_SCORE_SCHEMA,
  );
  if (gate.error) return gate.response;

  const query = c.req.query('query');
  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Search keywords, e.g. ?query=ps5&location=Chicago+IL&limit=10',
    }, 400);
  }

  const location = c.req.query('location');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;

  try {
    const proxy = getProxy();
    const deals = await scoreDeals(query, location || undefined, Math.min(limit, 20));

    return c.json({
      query,
      location: location || null,
      total_scored: deals.length,
      deals,
      proxy: { ip: null, country: proxy.country, type: 'mobile' },
      payment: {
        txHash: gate.payment!.txHash,
        network: gate.payment!.network,
        amount: PRICES.deals,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[FB-MARKETPLACE] Deals scoring error: ${err.message}`);
    return c.json({ error: 'Failed to search and score deals', detail: err.message }, 502);
  }
});
