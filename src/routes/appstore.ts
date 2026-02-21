/**
 * App Store Intelligence API Routes (Bounty #54)
 *
 * GET /api/appstore/search?query=keyword&country=us&limit=25
 * GET /api/appstore/lookup/:trackId?country=us
 * GET /api/appstore/bundle/:bundleId?country=us
 * GET /api/appstore/top?genre=all&country=us&limit=25
 * GET /api/appstore/similar/:trackId?country=us&limit=10
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  searchApps,
  lookupApp,
  lookupByBundleId,
  getTopApps,
  getSimilarApps,
  GENRE_IDS,
} from '../scrapers/appstore-intel';

export const appstoreRouter = new Hono();

const PRICE = 0.005;

function proxyInfo() {
  try { const p = getProxy(); return { country: p.country, type: 'mobile' as const }; }
  catch { return { country: 'US', type: 'mobile' as const }; }
}

// ─── SEARCH ──────────────────────────────────

appstoreRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/appstore/search', 'Search iOS App Store by keyword — returns app details, ratings, pricing, screenshots', PRICE, walletAddress, {
      input: {
        query: 'string (required) — search keywords',
        country: 'string (optional, default: "us") — ISO 2-letter country code',
        limit: 'number (optional, default: 25, max: 200)',
      },
      output: {
        results: 'AppInfo[] — trackId, trackName, bundleId, sellerName, description, price, genres, averageUserRating, userRatingCount, version, artworkUrl, screenshotUrls',
        query: 'string',
        country: 'string',
        resultCount: 'number',
      },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const query = c.req.query('query');
  if (!query) return c.json({ error: 'Missing required parameter: query', example: '/api/appstore/search?query=weather+app' }, 400);

  try {
    const result = await searchApps(
      query,
      c.req.query('country') || 'us',
      parseInt(c.req.query('limit') || '25') || 25,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'App Store search failed', message: err.message }, 502);
  }
});

// ─── LOOKUP BY TRACK ID ──────────────────────

appstoreRouter.get('/lookup/:trackId', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/appstore/lookup/:trackId', 'Get detailed app info by App Store track ID', PRICE, walletAddress, {
      input: { trackId: 'number (required, in URL)', country: 'string (optional, default: "us")' },
      output: { app: 'AppInfo | null', trackId: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const trackId = parseInt(c.req.param('trackId'));
  if (!trackId || isNaN(trackId)) return c.json({ error: 'Invalid trackId — must be a number' }, 400);

  try {
    const result = await lookupApp(trackId, c.req.query('country') || 'us');
    if (!result.app) return c.json({ error: 'App not found', trackId }, 404);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'App lookup failed', message: err.message }, 502);
  }
});

// ─── LOOKUP BY BUNDLE ID ─────────────────────

appstoreRouter.get('/bundle/:bundleId', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/appstore/bundle/:bundleId', 'Get app info by bundle ID (e.g., com.spotify.client)', PRICE, walletAddress, {
      input: { bundleId: 'string (required, in URL)', country: 'string (optional, default: "us")' },
      output: { app: 'AppInfo | null', trackId: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const bundleId = c.req.param('bundleId');
  if (!bundleId) return c.json({ error: 'Missing bundleId' }, 400);

  try {
    const result = await lookupByBundleId(bundleId, c.req.query('country') || 'us');
    if (!result.app) return c.json({ error: 'App not found', bundleId }, 404);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Bundle lookup failed', message: err.message }, 502);
  }
});

// ─── TOP APPS ────────────────────────────────

appstoreRouter.get('/top', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/appstore/top', 'Get top free apps by genre and country', PRICE, walletAddress, {
      input: {
        genre: `string (optional, default: "all") — one of: ${Object.keys(GENRE_IDS).join(', ')}`,
        country: 'string (optional, default: "us")',
        limit: 'number (optional, default: 25, max: 200)',
      },
      output: { results: 'AppInfo[]', genre: 'string', country: 'string', resultCount: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const result = await getTopApps(
      c.req.query('genre') || 'all',
      c.req.query('country') || 'us',
      parseInt(c.req.query('limit') || '25') || 25,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Top apps fetch failed', message: err.message }, 502);
  }
});

// ─── SIMILAR APPS ────────────────────────────

appstoreRouter.get('/similar/:trackId', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/appstore/similar/:trackId', 'Find similar apps by track ID', PRICE, walletAddress, {
      input: { trackId: 'number (required, in URL)', country: 'string (optional)', limit: 'number (optional, default: 10)' },
      output: { results: 'AppInfo[]', query: 'string', country: 'string', resultCount: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const trackId = parseInt(c.req.param('trackId'));
  if (!trackId || isNaN(trackId)) return c.json({ error: 'Invalid trackId' }, 400);

  try {
    const result = await getSimilarApps(
      trackId,
      c.req.query('country') || 'us',
      parseInt(c.req.query('limit') || '10') || 10,
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({ ...result, proxy: proxyInfo(), payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Similar apps search failed', message: err.message }, 502);
  }
});
