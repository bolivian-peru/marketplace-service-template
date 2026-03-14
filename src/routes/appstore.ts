/**
 * App Store Intelligence Routes
 * ─────────────────────────────
 * GET /api/appstore/rankings   — Top app rankings by category + country
 * GET /api/appstore/app        — App details + reviews
 * GET /api/appstore/search     — Search apps by keyword
 * GET /api/appstore/trending   — Trending/new apps
 * GET /api/appstore/compare    — Compare apps side by side
 *
 * Supports Apple App Store + Google Play Store.
 * All requests routed through real 4G/5G mobile carrier IPs.
 *
 * Pricing: $0.01 USDC per request (rankings, search, trending)
 *          $0.02 USDC per request (app detail with reviews)
 *          $0.03 USDC per request (compare — multi-app)
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import { aggregateSentiment } from '../analysis/sentiment';
import {
  getRankings,
  getAppDetail,
  searchApps,
  getTrendingApps,
} from '../scrapers/appstore-scraper';
import type { AppRanking, AppDetail, AppSearchResult, TrendingApp } from '../scrapers/appstore-scraper';

export const appstoreRouter = new Hono();

// ─── CONSTANTS ──────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_RANKINGS = 0.01;
const PRICE_APP_DETAIL = 0.02;
const PRICE_SEARCH = 0.01;
const PRICE_TRENDING = 0.01;
const PRICE_COMPARE = 0.03;

const SUPPORTED_STORES = ['apple', 'google'] as const;
type Store = typeof SUPPORTED_STORES[number];

const SUPPORTED_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'];

const VALID_CATEGORIES = [
  'all', 'games', 'business', 'education', 'entertainment', 'finance',
  'food-drink', 'health-fitness', 'lifestyle', 'medical', 'music',
  'navigation', 'news', 'photo-video', 'productivity', 'reference',
  'shopping', 'social', 'sports', 'travel', 'utilities', 'weather',
];

const DESCRIPTION_RANKINGS = 'App Store Rankings Intelligence — top app charts by category and country from Apple App Store and Google Play Store via real 4G/5G mobile carrier IPs.';
const DESCRIPTION_APP = 'App Store App Intelligence — detailed app metadata, reviews, ratings, and changelog from Apple App Store and Google Play Store.';
const DESCRIPTION_SEARCH = 'App Store Search Intelligence — search apps by keyword across Apple App Store and Google Play Store.';
const DESCRIPTION_TRENDING = 'App Store Trending Intelligence — discover trending and new apps on Apple App Store and Google Play Store.';
const DESCRIPTION_COMPARE = 'App Store Compare Intelligence — side-by-side comparison of multiple apps with review sentiment analysis.';

const OUTPUT_SCHEMA_RANKINGS = {
  input: {
    store: '"apple" | "google" (required)',
    category: 'string — app category (default: "all")',
    country: '"US" | "DE" | "FR" | "ES" | "GB" | "PL" (default: "US")',
    limit: 'number — max results 1-200 (default: 50)',
  },
  output: {
    type: '"rankings"',
    store: '"apple" | "google"',
    category: 'string',
    country: 'string',
    rankings: [{
      rank: 'number',
      appName: 'string',
      developer: 'string',
      appId: 'string',
      rating: 'number | null',
      ratingCount: 'number | null',
      price: 'string',
      inAppPurchases: 'boolean',
      category: 'string',
      lastUpdated: 'string | null',
      size: 'string | null',
      icon: 'string | null',
    }],
    metadata: '{ totalRanked, scrapedAt }',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const OUTPUT_SCHEMA_APP = {
  input: {
    store: '"apple" | "google" (required)',
    appId: 'string — app identifier (required)',
    country: '"US" | "DE" | "FR" | "ES" | "GB" | "PL" (default: "US")',
  },
  output: {
    type: '"app"',
    store: 'string',
    app: '{appName, developer, appId, description, rating, ratingCount, price, inAppPurchases, category, lastUpdated, size, icon, screenshots, version, whatsNew, contentRating, installs, reviews}',
    reviewSentiment: '{ overall, positive%, neutral%, negative% }',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const OUTPUT_SCHEMA_SEARCH = {
  input: {
    store: '"apple" | "google" (required)',
    query: 'string — search keyword (required)',
    country: '"US" | "DE" | "FR" | "ES" | "GB" | "PL" (default: "US")',
    limit: 'number — max results 1-50 (default: 25)',
  },
  output: {
    type: '"search"',
    store: 'string',
    query: 'string',
    results: '[{appName, developer, appId, rating, ratingCount, price, icon, description, category}]',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const OUTPUT_SCHEMA_TRENDING = {
  input: {
    store: '"apple" | "google" (required)',
    country: '"US" | "DE" | "FR" | "ES" | "GB" | "PL" (default: "US")',
    limit: 'number — max results 1-100 (default: 25)',
  },
  output: {
    type: '"trending"',
    store: 'string',
    trending: '[{rank, appName, developer, appId, rating, ratingCount, price, icon, category, growthSignal}]',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── HELPERS ────────────────────────────────────────

function validateStore(store: string | undefined): Store | null {
  if (!store) return null;
  const lower = store.toLowerCase() as Store;
  return SUPPORTED_STORES.includes(lower) ? lower : null;
}

function validateCategory(category: string | undefined): string {
  if (!category) return 'all';
  const lower = category.toLowerCase();
  return VALID_CATEGORIES.includes(lower) ? lower : 'all';
}

function validateCountry(country: string | undefined): string {
  if (!country) return 'US';
  const upper = country.toUpperCase();
  return SUPPORTED_COUNTRIES.includes(upper) ? upper : 'US';
}

function safeInt(val: string | undefined, fallback: number, min: number, max: number): number {
  if (!val) return fallback;
  const n = parseInt(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 5_000,
    });
    if (!r.ok) return null;
    const data = await r.json() as { ip?: string };
    return typeof data?.ip === 'string' ? data.ip.trim() : null;
  } catch {
    return null;
  }
}

// ─── RANKINGS ENDPOINT ──────────────────────────────

appstoreRouter.get('/rankings', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/appstore/rankings', DESCRIPTION_RANKINGS, PRICE_RANKINGS, WALLET_ADDRESS, OUTPUT_SCHEMA_RANKINGS),
      402,
    );
  }

  const store = validateStore(c.req.query('store'));
  if (!store) {
    return c.json({ error: 'Missing or invalid "store" parameter. Use "apple" or "google".' }, 400);
  }

  const category = validateCategory(c.req.query('category'));
  const country = validateCountry(c.req.query('country'));
  const limit = safeInt(c.req.query('limit'), 50, 1, 200);

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_RANKINGS);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();

  try {
    const rankings = await getRankings(store, category, country, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.slice(0, 256));

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
      proxy: {
        country: proxyConfig.country,
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_RANKINGS,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error('[appstore] Rankings error:', err.message);
    return c.json({ error: 'Failed to fetch rankings', detail: err.message }, 502);
  }
});

// ─── APP DETAIL ENDPOINT ────────────────────────────

appstoreRouter.get('/app', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/appstore/app', DESCRIPTION_APP, PRICE_APP_DETAIL, WALLET_ADDRESS, OUTPUT_SCHEMA_APP),
      402,
    );
  }

  const store = validateStore(c.req.query('store'));
  if (!store) {
    return c.json({ error: 'Missing or invalid "store" parameter. Use "apple" or "google".' }, 400);
  }

  const appId = c.req.query('appId');
  if (!appId || appId.length < 1 || appId.length > 200) {
    return c.json({ error: 'Missing or invalid "appId" parameter.' }, 400);
  }

  const country = validateCountry(c.req.query('country'));

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_APP_DETAIL);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();

  try {
    const app = await getAppDetail(store, appId, country);

    // Compute review sentiment
    const reviewTexts = app.reviews
      .filter(r => r.text.length > 5)
      .map(r => `${r.title || ''} ${r.text}`);
    const sentiment = aggregateSentiment(reviewTexts);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.slice(0, 256));

    return c.json({
      type: 'app',
      store,
      country,
      timestamp: new Date().toISOString(),
      app,
      reviewSentiment: sentiment,
      proxy: {
        country: proxyConfig.country,
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_APP_DETAIL,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error('[appstore] App detail error:', err.message);
    return c.json({ error: 'Failed to fetch app details', detail: err.message }, 502);
  }
});

// ─── SEARCH ENDPOINT ────────────────────────────────

appstoreRouter.get('/search', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/appstore/search', DESCRIPTION_SEARCH, PRICE_SEARCH, WALLET_ADDRESS, OUTPUT_SCHEMA_SEARCH),
      402,
    );
  }

  const store = validateStore(c.req.query('store'));
  if (!store) {
    return c.json({ error: 'Missing or invalid "store" parameter. Use "apple" or "google".' }, 400);
  }

  const query = c.req.query('query')?.trim();
  if (!query || query.length < 1 || query.length > 200) {
    return c.json({ error: 'Missing or invalid "query" parameter.' }, 400);
  }

  const country = validateCountry(c.req.query('country'));
  const limit = safeInt(c.req.query('limit'), 25, 1, 50);

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_SEARCH);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();

  try {
    const results = await searchApps(store, query, country, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.slice(0, 256));

    return c.json({
      type: 'search',
      store,
      query,
      country,
      timestamp: new Date().toISOString(),
      results,
      metadata: {
        totalResults: results.length,
        scrapedAt: new Date().toISOString(),
      },
      proxy: {
        country: proxyConfig.country,
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_SEARCH,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error('[appstore] Search error:', err.message);
    return c.json({ error: 'Failed to search apps', detail: err.message }, 502);
  }
});

// ─── TRENDING ENDPOINT ──────────────────────────────

appstoreRouter.get('/trending', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/appstore/trending', DESCRIPTION_TRENDING, PRICE_TRENDING, WALLET_ADDRESS, OUTPUT_SCHEMA_TRENDING),
      402,
    );
  }

  const store = validateStore(c.req.query('store'));
  if (!store) {
    return c.json({ error: 'Missing or invalid "store" parameter. Use "apple" or "google".' }, 400);
  }

  const country = validateCountry(c.req.query('country'));
  const limit = safeInt(c.req.query('limit'), 25, 1, 100);

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_TRENDING);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();

  try {
    const trending = await getTrendingApps(store, country, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.slice(0, 256));

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
      proxy: {
        country: proxyConfig.country,
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_TRENDING,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error('[appstore] Trending error:', err.message);
    return c.json({ error: 'Failed to fetch trending apps', detail: err.message }, 502);
  }
});

// ─── COMPARE ENDPOINT ───────────────────────────────

appstoreRouter.get('/compare', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/appstore/compare', DESCRIPTION_COMPARE, PRICE_COMPARE, WALLET_ADDRESS, {
        input: {
          store: '"apple" | "google" (required)',
          appIds: 'string — comma-separated app IDs (2-5 apps, required)',
          country: '"US" | "DE" | "FR" | "ES" | "GB" | "PL" (default: "US")',
        },
        output: {
          type: '"compare"',
          apps: '[AppDetail with reviewSentiment]',
          comparison: '{ highestRated, mostReviewed, bestSentiment, summary }',
        },
      }),
      402,
    );
  }

  const store = validateStore(c.req.query('store'));
  if (!store) {
    return c.json({ error: 'Missing or invalid "store" parameter. Use "apple" or "google".' }, 400);
  }

  const appIdsRaw = c.req.query('appIds')?.trim();
  if (!appIdsRaw) {
    return c.json({ error: 'Missing "appIds" parameter. Provide 2-5 comma-separated app IDs.' }, 400);
  }

  const appIds = appIdsRaw.split(',').map(id => id.trim()).filter(id => id.length > 0);
  if (appIds.length < 2 || appIds.length > 5) {
    return c.json({ error: 'Provide 2-5 app IDs separated by commas.' }, 400);
  }

  const country = validateCountry(c.req.query('country'));

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_COMPARE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();

  try {
    const appResults = await Promise.allSettled(
      appIds.map(id => getAppDetail(store, id, country))
    );

    const apps: Array<AppDetail & { reviewSentiment: any }> = [];
    const errors: string[] = [];

    for (let i = 0; i < appResults.length; i++) {
      const result = appResults[i];
      if (result.status === 'fulfilled') {
        const app = result.value;
        const reviewTexts = app.reviews
          .filter(r => r.text.length > 5)
          .map(r => `${r.title || ''} ${r.text}`);
        const sentiment = aggregateSentiment(reviewTexts);
        apps.push({ ...app, reviewSentiment: sentiment });
      } else {
        errors.push(`${appIds[i]}: ${result.reason?.message || 'fetch failed'}`);
      }
    }

    if (apps.length < 2) {
      return c.json({
        error: 'Could not fetch enough apps for comparison',
        details: errors,
      }, 502);
    }

    // Build comparison summary
    const withRating = apps.filter(a => a.rating !== null);
    const highestRated = withRating.length > 0
      ? withRating.reduce((best, app) => (app.rating! > (best.rating || 0)) ? app : best)
      : null;

    const withReviews = apps.filter(a => a.ratingCount !== null);
    const mostReviewed = withReviews.length > 0
      ? withReviews.reduce((best, app) => (app.ratingCount! > (best.ratingCount || 0)) ? app : best)
      : null;

    const bestSentiment = apps.reduce((best, app) => {
      return (app.reviewSentiment.positive > best.reviewSentiment.positive) ? app : best;
    });

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.slice(0, 256));

    return c.json({
      type: 'compare',
      store,
      country,
      timestamp: new Date().toISOString(),
      apps,
      comparison: {
        highestRated: highestRated ? { appName: highestRated.appName, appId: highestRated.appId, rating: highestRated.rating } : null,
        mostReviewed: mostReviewed ? { appName: mostReviewed.appName, appId: mostReviewed.appId, ratingCount: mostReviewed.ratingCount } : null,
        bestSentiment: { appName: bestSentiment.appName, appId: bestSentiment.appId, sentiment: bestSentiment.reviewSentiment },
        appsCompared: apps.length,
      },
      ...(errors.length > 0 ? { warnings: errors } : {}),
      proxy: {
        country: proxyConfig.country,
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_COMPARE,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error('[appstore] Compare error:', err.message);
    return c.json({ error: 'Failed to compare apps', detail: err.message }, 502);
  }
});
