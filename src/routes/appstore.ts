/**
 * App Store Intelligence API — Routes (Bounty #54)
 * ─────────────────────────────────────────────────
 * GET /api/appstore/rankings?store=apple&category=games&country=US
 * GET /api/appstore/app?store=apple&appId=<id>&country=US
 * GET /api/appstore/search?store=apple&query=vpn&country=US
 * GET /api/appstore/trending?store=apple&country=US
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import {
  scrapeAppleRankings,
  scrapeAppleAppDetails,
  scrapeAppleSearch,
  scrapePlayStoreSearch,
  scrapePlayStoreApp,
  scrapePlayStoreRankings,
  scrapeTrendingApps,
} from '../scrapers/appstore-scraper';
import { getProxy, getProxyExitIp } from '../proxy';

export const appstoreRouter = new Hono();

const WALLET = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';
const PRICE_RANKINGS = 0.01;
const PRICE_APP = 0.015;
const PRICE_SEARCH = 0.005;
const PRICE_TRENDING = 0.01;

// ─── Rankings endpoint ──────────────────────────────

appstoreRouter.get('/rankings', async (c) => {
  const store = c.req.query('store') || 'apple';
  const category = c.req.query('category') || 'games';
  const country = c.req.query('country') || 'US';
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/appstore/rankings',
        `Top ${store === 'apple' ? 'Apple App Store' : 'Google Play'} rankings by category and country`,
        PRICE_RANKINGS,
        WALLET,
        {
          type: 'object',
          properties: {
            rankings: { type: 'array', items: { type: 'object', description: 'App ranking with name, developer, rating, etc.' } },
            metadata: { type: 'object' },
          },
        },
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_RANKINGS);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const proxyConfig = getProxy();
    const proxyIp = await getProxyExitIp();

    const rankings = store === 'apple'
      ? await scrapeAppleRankings(category, country, limit)
      : await scrapePlayStoreRankings(category, country, limit);

    if (rankings.length === 0) {
      return c.json({ error: 'No rankings found', store, category, country }, 200);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      type: 'rankings',
      store,
      category,
      country,
      timestamp: new Date().toISOString(),
      rankings,
      metadata: {
        totalRanked: rankings.length,
        scrapedAt: new Date().toISOString(),
      },
      proxy: { country: proxyConfig.country, carrier: 'Mobile', type: 'mobile', ip: proxyIp },
      payment: { txHash: payment.txHash, amount: PRICE_RANKINGS, verified: true },
    });
  } catch (err: any) {
    console.error('[APPSTORE] Rankings error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});

// ─── App details endpoint ───────────────────────────

appstoreRouter.get('/app', async (c) => {
  const store = c.req.query('store') || 'apple';
  const appId = c.req.query('appId');
  const country = c.req.query('country') || 'US';

  if (!appId) {
    return c.json({ error: 'Missing required parameter: appId', example: '/api/appstore/app?store=apple&appId=284882215&country=US' }, 400);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/appstore/app',
        `Detailed app information from ${store === 'apple' ? 'Apple App Store' : 'Google Play'}`,
        PRICE_APP,
        WALLET,
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_APP);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const proxyConfig = getProxy();
    const proxyIp = await getProxyExitIp();

    const app = store === 'apple'
      ? await scrapeAppleAppDetails(appId, country)
      : await scrapePlayStoreApp(appId, country);

    if (!app) {
      return c.json({ error: 'App not found', appId, store, country }, 200);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      type: 'app',
      store,
      country,
      timestamp: new Date().toISOString(),
      app,
      metadata: { scrapedAt: new Date().toISOString() },
      proxy: { country: proxyConfig.country, carrier: 'Mobile', type: 'mobile', ip: proxyIp },
      payment: { txHash: payment.txHash, amount: PRICE_APP, verified: true },
    });
  } catch (err: any) {
    console.error('[APPSTORE] App detail error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});

// ─── Search endpoint ────────────────────────────────

appstoreRouter.get('/search', async (c) => {
  const store = c.req.query('store') || 'apple';
  const query = c.req.query('query');
  const country = c.req.query('country') || 'US';
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 50);

  if (!query) {
    return c.json({ error: 'Missing required parameter: query', example: '/api/appstore/search?store=apple&query=vpn&country=US' }, 400);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/appstore/search',
        `Search ${store === 'apple' ? 'Apple App Store' : 'Google Play'} apps`,
        PRICE_SEARCH,
        WALLET,
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_SEARCH);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const proxyConfig = getProxy();
    const proxyIp = await getProxyExitIp();

    const results = store === 'apple'
      ? await scrapeAppleSearch(query, country, limit)
      : await scrapePlayStoreSearch(query, country, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      type: 'search',
      store,
      country,
      timestamp: new Date().toISOString(),
      searchResults: results,
      metadata: {
        totalResults: results.length,
        query,
        scrapedAt: new Date().toISOString(),
      },
      proxy: { country: proxyConfig.country, carrier: 'Mobile', type: 'mobile', ip: proxyIp },
      payment: { txHash: payment.txHash, amount: PRICE_SEARCH, verified: true },
    });
  } catch (err: any) {
    console.error('[APPSTORE] Search error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});

// ─── Trending endpoint ──────────────────────────────

appstoreRouter.get('/trending', async (c) => {
  const store = c.req.query('store') || 'apple';
  const country = c.req.query('country') || 'US';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/appstore/trending',
        `Trending and new apps on ${store === 'apple' ? 'Apple App Store' : 'Google Play'}`,
        PRICE_TRENDING,
        WALLET,
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_TRENDING);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const proxyConfig = getProxy();
    const proxyIp = await getProxyExitIp();

    const trending = await scrapeTrendingApps(store, country);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      type: 'trending',
      store,
      country,
      timestamp: new Date().toISOString(),
      trending,
      metadata: {
        totalResults: trending.length,
        scrapedAt: new Date().toISOString(),
      },
      proxy: { country: proxyConfig.country, carrier: 'Mobile', type: 'mobile', ip: proxyIp },
      payment: { txHash: payment.txHash, amount: PRICE_TRENDING, verified: true },
    });
  } catch (err: any) {
    console.error('[APPSTORE] Trending error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});
