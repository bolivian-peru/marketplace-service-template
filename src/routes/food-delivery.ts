/**
 * Food Delivery Price Intelligence Routes (Bounty #76)
 *
 * GET /api/food-delivery/search?query=pizza&location=NYC&limit=25
 * GET /api/food-delivery/popular?location=NYC&limit=25
 * GET /api/food-delivery/cuisine/:type?location=NYC&limit=25
 * GET /api/food-delivery/prices?location=NYC&cuisine=pizza&limit=25
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchRestaurants,
  getPopularRestaurants,
  searchByCuisine,
  getPriceIntelligence,
} from '../scrapers/food-delivery';

export const foodDeliveryRouter = new Hono();

const PRICE = 0.005;

function proxyInfo() {
  try { const p = getProxy(); return { country: p.country, type: 'mobile' as const }; }
  catch { return { country: 'US', type: 'mobile' as const }; }
}

// ─── SEARCH RESTAURANTS ─────────────────────

foodDeliveryRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/food-delivery/search', 'Search restaurants across Yelp, DoorDash, Grubhub — returns ratings, delivery fees, cuisine, coordinates', PRICE, walletAddress, {
      input: {
        query: 'string (required) — search keywords (e.g., "pizza", "sushi", "burger")',
        location: 'string (required) — city or address (e.g., "New York", "San Francisco, CA")',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        restaurants: 'Restaurant[] — id, name, address, city, rating, reviewCount, priceLevel, cuisine, deliveryFee, deliveryTime, minimumOrder, isOpen, imageUrl, url, source, lat, lng',
        query: 'string',
        location: 'string',
        resultCount: 'number',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/food-delivery/search?query=pizza&location=NYC' }, 400);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/food-delivery/search?query=pizza&location=NYC' }, 400);

  try {
    const result = await searchRestaurants(query, location, parseInt(c.req.query('limit') || '25') || 25);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Restaurant search failed', message: err.message }, 502);
  }
});

// ─── POPULAR RESTAURANTS ────────────────────

foodDeliveryRouter.get('/popular', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/food-delivery/popular', 'Get popular/trending restaurants in a location sorted by review count', PRICE, walletAddress, {
      input: {
        location: 'string (required) — city or address',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        restaurants: 'Restaurant[] — sorted by popularity (review count)',
        location: 'string',
        resultCount: 'number',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/food-delivery/popular?location=NYC' }, 400);

  try {
    const result = await getPopularRestaurants(location, parseInt(c.req.query('limit') || '25') || 25);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Popular restaurants fetch failed', message: err.message }, 502);
  }
});

// ─── SEARCH BY CUISINE ──────────────────────

foodDeliveryRouter.get('/cuisine/:type', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/food-delivery/cuisine/:type', 'Search restaurants by cuisine type (pizza, sushi, mexican, chinese, indian, thai, etc.)', PRICE, walletAddress, {
      input: {
        type: 'string (required, in URL) — cuisine type (e.g., "pizza", "sushi", "mexican")',
        location: 'string (required) — city or address',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        restaurants: 'Restaurant[] — filtered by cuisine type',
        query: 'string — cuisine type used',
        location: 'string',
        resultCount: 'number',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const type = c.req.param('type');
  if (!type) return c.json({ error: 'Missing cuisine type in URL path' }, 400);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/food-delivery/cuisine/pizza?location=NYC' }, 400);

  try {
    const result = await searchByCuisine(type, location, parseInt(c.req.query('limit') || '25') || 25);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      cuisineType: type,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Cuisine search failed', message: err.message }, 502);
  }
});

// ─── PRICE INTELLIGENCE ─────────────────────

foodDeliveryRouter.get('/prices', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/food-delivery/prices', 'Price intelligence — average delivery fees, rating distribution, price level breakdown for a location', PRICE, walletAddress, {
      input: {
        location: 'string (required) — city or address',
        cuisine: 'string (optional) — filter by cuisine type',
        limit: 'number (optional, default: 25, max: 100)',
      },
      output: {
        avgDeliveryFee: 'number — average delivery fee in USD',
        avgRating: 'number — average rating (0-5)',
        priceDistribution: 'Record<string, number> — count per price level ($, $$, $$$, $$$$)',
        restaurants: 'Restaurant[] — all restaurants included in analysis',
        query: 'string',
        location: 'string',
        resultCount: 'number',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const location = c.req.query('location');
  if (!location) return c.json({ error: 'Missing required parameter: location', example: '/api/food-delivery/prices?location=NYC&cuisine=pizza' }, 400);

  try {
    const cuisine = c.req.query('cuisine') || undefined;
    const result = await getPriceIntelligence(location, cuisine, parseInt(c.req.query('limit') || '25') || 25);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: proxyInfo(),
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Price intelligence failed', message: err.message }, 502);
  }
});
