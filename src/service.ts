/**
 * Service Router — App Store Intelligence API
 *
 * Exposes:
 *   GET /api/run?type=rankings&store=apple&category=games&country=US  — App rankings by category
 *   GET /api/run?type=app&store=google&appId=com.spotify.music        — App details
 *   GET /api/run?type=search&store=apple&query=vpn&country=GB        — Search apps
 *   GET /api/run?type=trending&store=google&country=US               — Trending apps
 */

import { Hono } from 'hono';
import { getProxy, proxyFetch } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import {
  scrapeAppleRankings,
  searchAppleStore,
  getAppleAppDetails,
  getAppleAppReviews,
  scrapeGooglePlayRankings,
  searchGooglePlay,
  getGooglePlayAppDetails,
} from './scrapers/app-store-scraper';
import type { AppListing } from './scrapers/app-store-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'app-store-intelligence';
const PRICE_USDC = 0.01; // $0.01 per query
const DESCRIPTION = 'App Store Intelligence API: scrape rankings, app details, search, and trending from Apple App Store and Google Play Store. Pay per query via USDC mobile proxy.';

const OUTPUT_SCHEMA = {
  input: {
    type: 'string — "rankings" | "app" | "search" | "trending" (required)',
    store: 'string — "apple" | "google" (required)',
    country: 'string — "US" | "DE" | "FR" | "ES" | "GB" | "PL" (default: US)',
    category: 'string — for rankings: App Store category (games, apps, music, productivity, etc.)',
    appId: 'string — for app details: platform-specific app ID',
    query: 'string — for search: keyword to search',
    limit: 'number — max results (default: 25, max: 200)',
  },
  output: {
    type: 'string — same as input type',
    store: 'string — same as input store',
    rankings: 'AppListing[] — ranked app list (rankings type)',
    results: 'AppListing[] — search results (search type)',
    app: 'AppListing — single app detail (app type)',
    recentReviews: 'AppReview[] — app store reviews',
    trending: 'AppListing[] — trending apps (trending type)',
    metadata: '{ totalFound, totalRanked, scrapedAt }',
    proxy: '{ country, carrier, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── RATE LIMITING ─────────────────────────────────────

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

// ─── PROXY EXIT IP ─────────────────────────────────────

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

// ─── VALIDATE COUNTRY ──────────────────────────────────

const VALID_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'];

function validateCountry(country: string | undefined): string {
  if (!country) return 'US';
  const upper = country.toUpperCase();
  return VALID_COUNTRIES.includes(upper) ? upper : 'US';
}

// ─── MAIN HANDLER ──────────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
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

  // ── Parse params ────────────────────────────────────
  const type = c.req.query('type') || '';
  const store = c.req.query('store') || '';
  const country = validateCountry(c.req.query('country'));
  const category = c.req.query('category') || 'apps';
  const appId = c.req.query('appId') || '';
  const query = c.req.query('query') || '';
  const limitParam = c.req.query('limit');
  let limit = 25;

  if (limitParam) {
    const parsed = parseInt(limitParam);
    if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 200);
  }

  if (!type || !store) {
    return c.json({
      error: 'Missing required parameters',
      hint: 'Provide ?type=rankings&store=apple&category=games&country=US',
      example: '/api/run?type=rankings&store=apple&category=games&country=US&limit=50',
    }, 400);
  }

  if (store !== 'apple' && store !== 'google') {
    return c.json({ error: 'Invalid store. Must be "apple" or "google".' }, 400);
  }

  try {
    const proxy = getProxy();
    let result: any;
    let recentReviews: any[] | undefined;

    switch (type) {
      case 'rankings': {
        if (store === 'apple') {
          const apps = await scrapeAppleRankings(category, country, limit);
          result = {
            type: 'rankings',
            store: 'apple',
            category,
            country,
            timestamp: new Date().toISOString(),
            rankings: apps,
            metadata: { totalRanked: apps.length, scrapedAt: new Date().toISOString() },
          };
        } else {
          const apps = await scrapeGooglePlayRankings(category, country, limit);
          result = {
            type: 'rankings',
            store: 'google',
            category,
            country,
            timestamp: new Date().toISOString(),
            rankings: apps,
            metadata: { totalRanked: apps.length, scrapedAt: new Date().toISOString() },
          };
        }
        break;
      }

      case 'app': {
        if (!appId) {
          return c.json({ error: 'Missing required parameter: appId', hint: 'Provide ?type=app&store=apple&appId=123456789' }, 400);
        }
        
        if (store === 'apple') {
          const app = await getAppleAppDetails(appId, country);
          const reviews = await getAppleAppReviews(appId, country, 10);
          result = {
            type: 'app',
            store: 'apple',
            appId,
            country,
            timestamp: new Date().toISOString(),
            app,
            recentReviews: reviews,
            metadata: { scrapedAt: new Date().toISOString() },
          };
        } else {
          const app = await getGooglePlayAppDetails(appId, country);
          result = {
            type: 'app',
            store: 'google',
            appId,
            country,
            timestamp: new Date().toISOString(),
            app,
            metadata: { scrapedAt: new Date().toISOString() },
          };
        }
        break;
      }

      case 'search': {
        if (!query) {
          return c.json({ error: 'Missing required parameter: query', hint: 'Provide ?type=search&store=apple&query=vpn&country=US' }, 400);
        }

        if (store === 'apple') {
          const apps = await searchAppleStore(query, country, limit);
          result = {
            type: 'search',
            store: 'apple',
            query,
            country,
            timestamp: new Date().toISOString(),
            results: apps,
            metadata: { totalFound: apps.length, scrapedAt: new Date().toISOString() },
          };
        } else {
          const apps = await searchGooglePlay(query, country);
          result = {
            type: 'search',
            store: 'google',
            query,
            country,
            timestamp: new Date().toISOString(),
            results: apps,
            metadata: { totalFound: apps.length, scrapedAt: new Date().toISOString() },
          };
        }
        break;
      }

      case 'trending': {
        if (store === 'apple') {
          const apps = await scrapeAppleRankings('grossing', country, limit);
          result = {
            type: 'trending',
            store: 'apple',
            country,
            timestamp: new Date().toISOString(),
            apps,
            metadata: { totalFound: apps.length, scrapedAt: new Date().toISOString() },
          };
        } else {
          const apps = await scrapeGooglePlayRankings('grossing', country, limit);
          result = {
            type: 'trending',
            store: 'google',
            country,
            timestamp: new Date().toISOString(),
            apps,
            metadata: { totalFound: apps.length, scrapedAt: new Date().toISOString() },
          };
        }
        break;
      }

      default:
        return c.json({
          error: 'Invalid type parameter',
          hint: 'Use: rankings, app, search, or trending',
          example: '/api/run?type=rankings&store=apple&category=games&country=US',
        }, 400);
    }

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
      hint: 'The app store may be blocking requests. Try a different country or store.',
    }, 502);
  }
});

// ─── HEALTH CHECK ──────────────────────────────────────

serviceRouter.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: SERVICE_NAME,
    description: DESCRIPTION,
    price: PRICE_USDC,
    timestamp: new Date().toISOString(),
  });
});

// ─── SERVICE DISCOVERY ─────────────────────────────────

serviceRouter.get('/', (c) => {
  return c.json({
    service: SERVICE_NAME,
    description: DESCRIPTION,
    price_usdc: PRICE_USDC,
    endpoints: {
      '/api/run': {
        method: 'GET',
        description: 'App Store Intelligence API',
        params: {
          type: 'rankings | app | search | trending (required)',
          store: 'apple | google (required)',
          country: 'US | DE | FR | ES | GB | PL (default: US)',
          category: 'Category name for rankings (default: apps)',
          appId: 'App ID for app details',
          query: 'Search keyword',
          limit: 'Max results (default: 25, max: 200)',
        },
        price: `$${PRICE_USDC} per request`,
        examples: [
          '/api/run?type=rankings&store=apple&category=games&country=US&limit=50',
          '/api/run?type=app&store=google&appId=com.spotify.music&country=DE',
          '/api/run?type=search&store=apple&query=vpn&country=GB',
          '/api/run?type=trending&store=google&country=US',
        ],
      },
      '/health': { method: 'GET', description: 'Health check' },
    },
    payment: {
      protocol: 'x402 (HTTP 402 + USDC)',
      networks: ['Solana', 'Base'],
      wallets: {
        solana: process.env.WALLET_ADDRESS || 'not configured',
        base: process.env.WALLET_ADDRESS_BASE || process.env.WALLET_ADDRESS || 'not configured',
      },
    },
  });
});
