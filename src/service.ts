/**
 * Amazon Product & BSR Tracker — Service Router
 * ───────────────────────────────────────────────
 * Bounty #72 — Proxies.sx marketplace
 *
 * Endpoints:
 *   GET /api/amazon/product/:asin       — Product data, price, BSR, reviews, buy box
 *   GET /api/amazon/search              — Keyword search with category filter
 *   GET /api/amazon/bestsellers         — BSR top-ranked products by category
 *   GET /api/amazon/reviews/:asin       — Product reviews with pagination
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import {
  scrapeProduct,
  searchProducts,
  scrapeBestSellers,
  scrapeReviews,
} from './scrapers/amazon-scraper';
import { MARKETPLACES } from './types';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIG ──────────────────────────────────

const SERVICE_NAME = 'amazon-product-bsr-tracker';

// Pricing per bounty spec
const PRODUCT_PRICE_USDC = 0.005;   // $0.005 per product lookup
const SEARCH_PRICE_USDC  = 0.010;   // $0.01 per search query
const BSR_PRICE_USDC     = 0.010;   // $0.01 per bestsellers fetch
const REVIEWS_PRICE_USDC = 0.020;   // $0.02 per reviews fetch

// ─── PROXY RATE LIMITING ────────────────────────────

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

// ─── MARKETPLACE VALIDATION ──────────────────────────

function validateMarketplace(marketplace: string): boolean {
  return Object.keys(MARKETPLACES).includes(marketplace.toUpperCase());
}

// ─── GET /api/amazon/product/:asin ──────────────────

serviceRouter.get('/amazon/product/:asin', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/product/:asin',
        'Fetch real-time Amazon product data: price, BSR, reviews, rating, buy box, availability, images, brand.',
        PRODUCT_PRICE_USDC,
        walletAddress,
        {
          input: {
            asin: 'string (required) — Amazon ASIN in URL path (e.g., B0BSHF7WHW)',
            marketplace: '"US" | "UK" | "DE" | "FR" | "IT" | "ES" | "CA" | "JP" (default: "US")',
          },
          output: {
            asin: 'string',
            title: 'string | null',
            price: '{ current, currency, was, discount_pct, deal_label }',
            bsr: '{ rank, category, sub_category_ranks: [{ category, rank }] }',
            rating: 'number | null',
            reviews_count: 'number | null',
            buy_box: '{ seller, is_amazon, fulfilled_by, seller_rating, seller_ratings_count }',
            availability: 'string | null',
            brand: 'string | null',
            images: 'string[]',
            features: 'string[]',
            categories: 'string[]',
            meta: '{ marketplace, url, scraped_at, proxy: { ip, country, carrier, type } }',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRODUCT_PRICE_USDC);
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
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min.', retryAfter: 60 }, 429);
  }

  const asin = c.req.param('asin')?.toUpperCase();
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return c.json({
      error: 'Invalid ASIN format. Must be 10 alphanumeric characters.',
      example: '/api/amazon/product/B0BSHF7WHW',
    }, 400);
  }

  const marketplace = (c.req.query('marketplace') || 'US').toUpperCase();
  if (!validateMarketplace(marketplace)) {
    return c.json({
      error: `Invalid marketplace. Supported: ${Object.keys(MARKETPLACES).join(', ')}`,
    }, 400);
  }

  try {
    const product = await scrapeProduct(asin, marketplace);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...product,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[AMAZON] Product fetch error for ${asin}: ${err.message}`);

    if (err.message?.includes('CAPTCHA')) {
      return c.json({
        error: 'Amazon CAPTCHA block',
        message: err.message,
        hint: 'Amazon is temporarily blocking requests from this proxy. Retry in 2-5 minutes.',
      }, 503);
    }

    if (err.message?.includes('not found')) {
      return c.json({
        error: 'Product not found',
        message: err.message,
        asin,
        marketplace,
      }, 404);
    }

    return c.json({
      error: 'Product fetch failed',
      message: err.message,
      hint: 'Amazon may be temporarily blocking requests. Try again in a few minutes.',
    }, 502);
  }
});

// ─── GET /api/amazon/search ──────────────────────────

serviceRouter.get('/amazon/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/search',
        'Search Amazon products by keyword with optional category filter. Returns up to 20 results per page with pricing, ratings, and BSR.',
        SEARCH_PRICE_USDC,
        walletAddress,
        {
          input: {
            query: 'string (required) — Search keywords',
            category: 'string (optional) — Category filter: electronics, books, home-kitchen, toys-games, sports-outdoors, health-personal-care, clothing, etc.',
            marketplace: '"US" | "UK" | "DE" | "FR" | "IT" | "ES" | "CA" | "JP" (default: "US")',
            page: 'number (optional, default: 1)',
          },
          output: {
            query: 'string',
            category: 'string | null',
            marketplace: 'string',
            total_results: 'number | null',
            page: 'number',
            results: 'SearchResult[] (up to 20 per page)',
            'results[].asin': 'string',
            'results[].title': 'string | null',
            'results[].price': '{ current, currency, was, discount_pct }',
            'results[].rating': 'number | null',
            'results[].reviews_count': 'number | null',
            'results[].is_prime': 'boolean',
            'results[].is_sponsored': 'boolean',
            'results[].image': 'string | null',
            'results[].url': 'string',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min.', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  if (!query || query.trim().length === 0) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a search query like ?query=wireless+headphones',
      example: '/api/amazon/search?query=wireless+headphones&category=electronics&marketplace=US',
    }, 400);
  }

  const category = c.req.query('category') || null;
  const marketplace = (c.req.query('marketplace') || 'US').toUpperCase();

  if (!validateMarketplace(marketplace)) {
    return c.json({
      error: `Invalid marketplace. Supported: ${Object.keys(MARKETPLACES).join(', ')}`,
    }, 400);
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1);

  try {
    const results = await searchProducts(query, category, marketplace, page);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...results,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[AMAZON] Search error for "${query}": ${err.message}`);

    if (err.message?.includes('CAPTCHA')) {
      return c.json({
        error: 'Amazon CAPTCHA block',
        message: err.message,
        hint: 'Retry in 2-5 minutes.',
      }, 503);
    }

    return c.json({
      error: 'Search failed',
      message: err.message,
    }, 502);
  }
});

// ─── GET /api/amazon/bestsellers ────────────────────

serviceRouter.get('/amazon/bestsellers', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/bestsellers',
        'Fetch Amazon Best Sellers list by category. Returns ranked products with ASINs, prices, ratings, and review counts.',
        BSR_PRICE_USDC,
        walletAddress,
        {
          input: {
            category: 'string (optional, default: "electronics") — Category: electronics, books, home-kitchen, toys-games, sports-outdoors, health-personal-care, beauty, clothing, automotive, video-games, music, movies, tools, grocery, pet-supplies, baby, etc.',
            marketplace: '"US" | "UK" | "DE" | "FR" | "IT" | "ES" | "CA" | "JP" (default: "US")',
          },
          output: {
            category: 'string',
            marketplace: 'string',
            category_url: 'string',
            items: 'BestSellerItem[]',
            'items[].rank': 'number',
            'items[].asin': 'string',
            'items[].title': 'string | null',
            'items[].price': '{ current, currency }',
            'items[].rating': 'number | null',
            'items[].reviews_count': 'number | null',
            'items[].image': 'string | null',
            'items[].url': 'string',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, BSR_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min.', retryAfter: 60 }, 429);
  }

  const category = c.req.query('category') || 'electronics';
  const marketplace = (c.req.query('marketplace') || 'US').toUpperCase();

  if (!validateMarketplace(marketplace)) {
    return c.json({
      error: `Invalid marketplace. Supported: ${Object.keys(MARKETPLACES).join(', ')}`,
    }, 400);
  }

  try {
    const results = await scrapeBestSellers(category, marketplace);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...results,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[AMAZON] Bestsellers error for category "${category}": ${err.message}`);

    if (err.message?.includes('CAPTCHA')) {
      return c.json({
        error: 'Amazon CAPTCHA block',
        message: err.message,
        hint: 'Retry in 2-5 minutes.',
      }, 503);
    }

    return c.json({
      error: 'Bestsellers fetch failed',
      message: err.message,
    }, 502);
  }
});

// ─── GET /api/amazon/reviews/:asin ──────────────────

serviceRouter.get('/amazon/reviews/:asin', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/reviews/:asin',
        'Fetch Amazon product reviews with rating, date, verified purchase status, and helpful votes.',
        REVIEWS_PRICE_USDC,
        walletAddress,
        {
          input: {
            asin: 'string (required) — Amazon ASIN in URL path',
            marketplace: '"US" | "UK" | "DE" | "FR" | "IT" | "ES" | "CA" | "JP" (default: "US")',
            sort: '"recent" | "helpful" (default: "recent")',
            page: 'number (optional, default: 1)',
            limit: 'number (optional, default: 10, max: 10)',
          },
          output: {
            asin: 'string',
            marketplace: 'string',
            total_reviews: 'number | null',
            average_rating: 'number | null',
            rating_distribution: '{ "5_star": %, "4_star": %, ... }',
            sort: 'string',
            page: 'number',
            reviews: 'Review[]',
            'reviews[].id': 'string | null',
            'reviews[].author': 'string | null',
            'reviews[].rating': 'number | null',
            'reviews[].title': 'string | null',
            'reviews[].body': 'string | null',
            'reviews[].date': 'string | null',
            'reviews[].verified_purchase': 'boolean',
            'reviews[].helpful_votes': 'number | null',
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, REVIEWS_PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min.', retryAfter: 60 }, 429);
  }

  const asin = c.req.param('asin')?.toUpperCase();
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return c.json({
      error: 'Invalid ASIN format. Must be 10 alphanumeric characters.',
      example: '/api/amazon/reviews/B0BSHF7WHW',
    }, 400);
  }

  const marketplace = (c.req.query('marketplace') || 'US').toUpperCase();
  if (!validateMarketplace(marketplace)) {
    return c.json({
      error: `Invalid marketplace. Supported: ${Object.keys(MARKETPLACES).join(', ')}`,
    }, 400);
  }

  const sort = c.req.query('sort') || 'recent';
  if (!['recent', 'helpful'].includes(sort)) {
    return c.json({ error: 'Invalid sort. Use: recent, helpful' }, 400);
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1);
  const limit = Math.min(10, Math.max(1, parseInt(c.req.query('limit') || '10') || 10));

  try {
    const results = await scrapeReviews(asin, marketplace, sort, page, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...results,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[AMAZON] Reviews error for ${asin}: ${err.message}`);

    if (err.message?.includes('CAPTCHA')) {
      return c.json({
        error: 'Amazon CAPTCHA block',
        message: err.message,
        hint: 'Retry in 2-5 minutes.',
      }, 503);
    }

    return c.json({
      error: 'Reviews fetch failed',
      message: err.message,
    }, 502);
  }
});
