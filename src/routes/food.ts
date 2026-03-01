/**
 * Food Delivery Price Intelligence API Route
 * Bounty #76 — $50 SX token
 *
 * Endpoints:
 *   GET /api/food/search?query=pizza&address=10001&platform=ubereats&limit=10
 *   GET /api/food/menu?id=restaurant-id&platform=ubereats
 *   GET /api/food/compare?query=pizza&address=10001&limit=5
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchUberEats,
  searchDoorDash,
  scrapeUberEatsMenu,
  type Restaurant,
} from '../scrapers/food-delivery';

export const foodRouter = new Hono();

const SEARCH_PRICE_USDC = 0.01;
const MENU_PRICE_USDC = 0.02;
const COMPARE_PRICE_USDC = 0.03;

const SERVICE_DESCRIPTION = 'Food Delivery Price Intelligence API — restaurant search, menu prices, delivery fees from Uber Eats & DoorDash.';

// ─── GET PROXY METADATA ─────────────────────────────

async function getProxyMeta() {
  try {
    const proxy = getProxy();
    return { country: proxy.country, type: 'mobile' };
  } catch {
    return { country: 'US', type: 'mobile' };
  }
}

// ─── /api/food/search ───────────────────────────────

foodRouter.get('/search', async (c) => {
  const query = c.req.query('query') || '';
  const address = c.req.query('address') || 'New York, NY';
  const platform = c.req.query('platform') || 'ubereats';
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25);

  if (!query) {
    return c.json({ error: 'query parameter is required' }, 400);
  }

  // ── Payment check ──
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response({
        price: SEARCH_PRICE_USDC,
        description: `${SERVICE_DESCRIPTION} Search ${limit} restaurants on ${platform}.`,
        endpoint: '/api/food/search',
      }),
      402,
    );
  }

  const verified = await verifyPayment(c, SEARCH_PRICE_USDC);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  // ── Scrape ──
  let restaurants: Restaurant[] = [];
  try {
    if (platform === 'doordash') {
      restaurants = await searchDoorDash(query, address, limit);
    } else {
      restaurants = await searchUberEats(query, address, limit);
    }
  } catch (err: any) {
    return c.json({ error: 'Scraping failed', details: err?.message }, 500);
  }

  const proxyMeta = await getProxyMeta();

  return c.json({
    restaurants,
    query,
    address,
    platform,
    total: restaurants.length,
    meta: {
      proxy: proxyMeta,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: SEARCH_PRICE_USDC,
        settled: true,
      },
    },
    scraped_at: new Date().toISOString(),
  });
});

// ─── /api/food/menu ─────────────────────────────────

foodRouter.get('/menu', async (c) => {
  const restaurantId = c.req.query('id') || '';
  const platform = c.req.query('platform') || 'ubereats';

  if (!restaurantId) {
    return c.json({ error: 'id parameter is required (restaurant ID or slug)' }, 400);
  }

  // ── Payment check ──
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response({
        price: MENU_PRICE_USDC,
        description: `${SERVICE_DESCRIPTION} Full menu with prices for one restaurant.`,
        endpoint: '/api/food/menu',
      }),
      402,
    );
  }

  const verified = await verifyPayment(c, MENU_PRICE_USDC);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  // ── Scrape ──
  let menuItems = [];
  try {
    if (platform === 'ubereats') {
      menuItems = await scrapeUberEatsMenu(restaurantId);
    } else {
      return c.json({ error: 'Platform not supported for menu scraping yet. Use ubereats.' }, 400);
    }
  } catch (err: any) {
    return c.json({ error: 'Menu scraping failed', details: err?.message }, 500);
  }

  const proxyMeta = await getProxyMeta();

  return c.json({
    restaurant_id: restaurantId,
    platform,
    menu_items: menuItems,
    total_items: menuItems.length,
    meta: {
      proxy: proxyMeta,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: MENU_PRICE_USDC,
        settled: true,
      },
    },
    scraped_at: new Date().toISOString(),
  });
});

// ─── /api/food/compare ──────────────────────────────

foodRouter.get('/compare', async (c) => {
  const query = c.req.query('query') || '';
  const address = c.req.query('address') || 'New York, NY';
  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 10);

  if (!query) {
    return c.json({ error: 'query parameter is required' }, 400);
  }

  // ── Payment check ──
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response({
        price: COMPARE_PRICE_USDC,
        description: `${SERVICE_DESCRIPTION} Cross-platform price comparison (Uber Eats + DoorDash).`,
        endpoint: '/api/food/compare',
      }),
      402,
    );
  }

  const verified = await verifyPayment(c, COMPARE_PRICE_USDC);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  // ── Scrape both platforms in parallel ──
  let ubereatsResults: Restaurant[] = [];
  let doordashResults: Restaurant[] = [];

  const [ueResult, ddResult] = await Promise.allSettled([
    searchUberEats(query, address, limit),
    searchDoorDash(query, address, limit),
  ]);

  if (ueResult.status === 'fulfilled') ubereatsResults = ueResult.value;
  if (ddResult.status === 'fulfilled') doordashResults = ddResult.value;

  // Find cheapest delivery fee across platforms
  const allWithFees = [
    ...ubereatsResults.filter(r => r.delivery_fee !== null).map(r => ({ platform: 'ubereats', name: r.name, fee: r.delivery_fee! })),
    ...doordashResults.filter(r => r.delivery_fee !== null).map(r => ({ platform: 'doordash', name: r.name, fee: r.delivery_fee! })),
  ].sort((a, b) => a.fee - b.fee);

  const cheapestDelivery = allWithFees[0]
    ? `${allWithFees[0].name} on ${allWithFees[0].platform} ($${allWithFees[0].fee.toFixed(2)})`
    : null;

  const proxyMeta = await getProxyMeta();

  return c.json({
    query,
    address,
    platforms: {
      ubereats: ubereatsResults,
      doordash: doordashResults,
    },
    summary: {
      ubereats_count: ubereatsResults.length,
      doordash_count: doordashResults.length,
      cheapest_delivery: cheapestDelivery,
      avg_delivery_time_ubereats: ubereatsResults.length
        ? Math.round(ubereatsResults.filter(r => r.delivery_time_min).reduce((s, r) => s + (r.delivery_time_min! + (r.delivery_time_max || r.delivery_time_min!)) / 2, 0) / ubereatsResults.filter(r => r.delivery_time_min).length)
        : null,
    },
    meta: {
      proxy: proxyMeta,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: COMPARE_PRICE_USDC,
        settled: true,
      },
    },
    scraped_at: new Date().toISOString(),
  });
});

// ─── Health / Discovery (no payment) ────────────────

foodRouter.get('/', (c) => {
  return c.json({
    service: 'Food Delivery Price Intelligence API',
    bounty: '#76',
    endpoints: {
      search: {
        path: '/api/food/search',
        params: { query: 'string (required)', address: 'string', platform: 'ubereats|doordash', limit: 'number (max 25)' },
        price: `$${SEARCH_PRICE_USDC} USDC`,
      },
      menu: {
        path: '/api/food/menu',
        params: { id: 'string (restaurant id or slug)', platform: 'ubereats' },
        price: `$${MENU_PRICE_USDC} USDC`,
      },
      compare: {
        path: '/api/food/compare',
        params: { query: 'string (required)', address: 'string', limit: 'number (max 10)' },
        price: `$${COMPARE_PRICE_USDC} USDC`,
      },
    },
    example: '/api/food/search?query=pizza&address=10001&platform=ubereats&limit=5',
  });
});
