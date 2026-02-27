/**
 * Service Router — Marketplace API
 *
 * Exposes:
 *   GET /api/run       (Google Maps Lead Generator)
 *   GET /api/details   (Google Maps Place details)
 *   GET /api/jobs      (Job Market Intelligence)
 *   GET /api/reviews/* (Google Reviews & Business Data)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';

export const serviceRouter = new Hono();

// ─── TREND INTELLIGENCE ROUTES (Bounty #70) ─────────
serviceRouter.route('/research', researchRouter);
serviceRouter.route('/trending', trendingRouter);

const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Job Market Intelligence API (Indeed/LinkedIn): title, company, location, salary, date, link, remote + proxy exit metadata.';
const MAPS_PRICE_USDC = 0.005;
const MAPS_DESCRIPTION = 'Extract structured business data from Google Maps: name, address, phone, website, email, hours, ratings, reviews, categories, and geocoordinates. Search by category + location with full pagination.';

const MAPS_OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query/category (required)',
    location: 'string — Location to search (required)',
    limit: 'number — Max results to return (default: 20, max: 100)',
    pageToken: 'string — Pagination token for next page (optional)',
  },
  output: {
    businesses: [{
      name: 'string',
      address: 'string | null',
      phone: 'string | null',
      website: 'string | null',
      email: 'string | null',
      hours: 'object | null',
      rating: 'number | null',
      reviewCount: 'number | null',
      categories: 'string[]',
      coordinates: '{ latitude, longitude } | null',
      placeId: 'string | null',
      priceLevel: 'string | null',
      permanentlyClosed: 'boolean',
    }],
    totalFound: 'number',
    nextPageToken: 'string | null',
    searchQuery: 'string',
    location: 'string',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

type AppStoreType = 'apple' | 'google';
type RunType = 'rankings' | 'app' | 'search' | 'trending';

const SUPPORTED_COUNTRIES = new Set(['US', 'DE', 'FR', 'ES', 'GB', 'PL']);

function ensureCountry(countryRaw: string | undefined): string {
  const country = (countryRaw || 'US').toUpperCase();
  if (!SUPPORTED_COUNTRIES.has(country)) {
    throw new Error(`Unsupported country: ${country}. Use one of US, DE, FR, ES, GB, PL.`);
  }
  return country;
}

function parsePrice(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : 'Unknown';
}

function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function scrapeAppleRankings(category: string, country: string, limit: number) {
  const rssUrl = `https://rss.applemarketingtools.com/api/v2/${country.toLowerCase()}/apps/top-free/${Math.min(limit, 200)}/apps.json`;
  const res = await proxyFetch(rssUrl, { headers: { Accept: 'application/json' }, timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`Apple rankings fetch failed: ${res.status}`);
  const json: any = await res.json();
  const feeds: any[] = Array.isArray(json?.feed?.results) ? json.feed.results : [];

  const rankings = feeds.slice(0, limit).map((item, idx) => ({
    rank: idx + 1,
    appName: item?.name || null,
    developer: item?.artistName || null,
    appId: item?.id || null,
    rating: null,
    ratingCount: null,
    price: item?.kind === 'iosSoftware' ? 'Free' : 'Unknown',
    inAppPurchases: null,
    category: item?.genres?.[0]?.name || category,
    lastUpdated: item?.releaseDate || null,
    size: null,
    icon: item?.artworkUrl100 || null,
  }));

  return { rankings };
}

async function scrapeAppleSearch(query: string, country: string, limit: number) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&entity=software&limit=${Math.min(limit, 50)}`;
  const res = await proxyFetch(url, { headers: { Accept: 'application/json' }, timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`Apple search fetch failed: ${res.status}`);
  const json: any = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.slice(0, limit).map((app: any) => ({
    appName: app?.trackName || null,
    developer: app?.sellerName || app?.artistName || null,
    appId: app?.trackId ? String(app.trackId) : null,
    rating: typeof app?.averageUserRating === 'number' ? app.averageUserRating : null,
    ratingCount: typeof app?.userRatingCount === 'number' ? app.userRatingCount : null,
    price: app?.formattedPrice || 'Unknown',
    category: app?.primaryGenreName || null,
    icon: app?.artworkUrl100 || null,
  }));
}

async function scrapeAppleApp(appId: string, country: string) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${country}`;
  const res = await proxyFetch(url, { headers: { Accept: 'application/json' }, timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`Apple app lookup failed: ${res.status}`);
  const json: any = await res.json();
  const app = Array.isArray(json?.results) ? json.results[0] : null;
  if (!app) throw new Error('App not found in Apple App Store');
  return {
    appName: app?.trackName || null,
    developer: app?.sellerName || app?.artistName || null,
    appId: app?.bundleId || String(app?.trackId || appId),
    rating: typeof app?.averageUserRating === 'number' ? app.averageUserRating : null,
    ratingCount: typeof app?.userRatingCount === 'number' ? app.userRatingCount : null,
    price: app?.formattedPrice || 'Unknown',
    inAppPurchases: Array.isArray(app?.features) ? app.features.includes('iosIap') : null,
    category: app?.primaryGenreName || null,
    lastUpdated: app?.currentVersionReleaseDate?.slice(0, 10) || null,
    size: app?.fileSizeBytes ? `${Math.round(Number(app.fileSizeBytes) / (1024 * 1024))} MB` : null,
    icon: app?.artworkUrl512 || app?.artworkUrl100 || null,
    reviews: [],
  };
}

function parseGoogleAppIdsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const regex = /\/store\/apps\/details\?id=([a-zA-Z0-9._-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    found.add(m[1]);
    if (found.size >= 200) break;
  }
  return [...found];
}

async function fetchGoogleAppDetails(appId: string, country: string) {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=${country}`;
  const res = await proxyFetch(url, { timeoutMs: 35_000 });
  if (!res.ok) throw new Error(`Google app fetch failed: ${res.status}`);
  const html = await res.text();

  const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"\s*\/?>/i);
  const iconMatch = html.match(/<meta property="og:image" content="([^"]+)"\s*\/?>/i);
  const devMatch = html.match(/"author":\s*\[\s*\{\s*"@type":"Organization","name":"([^"]+)"/i);
  const ratingMatch = html.match(/"ratingValue":\s*"([0-9.]+)"/i);
  const ratingCountMatch = html.match(/"ratingCount":\s*"([0-9.,]+)"/i);
  const categoryMatch = html.match(/"applicationCategory":\s*"([^"]+)"/i);

  return {
    appName: nameMatch?.[1]?.replace(' - Apps on Google Play', '') || appId,
    developer: devMatch?.[1] || null,
    appId,
    rating: ratingMatch?.[1] ? Number(ratingMatch[1]) : null,
    ratingCount: ratingCountMatch?.[1] ? Number(ratingCountMatch[1].replace(/,/g, '')) : null,
    price: 'Free',
    inAppPurchases: /In-app purchases/i.test(html),
    category: categoryMatch?.[1] || null,
    lastUpdated: null,
    size: null,
    icon: iconMatch?.[1] || null,
    reviews: [],
  };
}

async function scrapeGoogleRankings(category: string, country: string, limit: number) {
  const url = `https://play.google.com/store/apps/category/${encodeURIComponent(category.toUpperCase())}/collection/topselling_free?hl=en&gl=${country}`;
  const res = await proxyFetch(url, { timeoutMs: 35_000 });
  if (!res.ok) throw new Error(`Google rankings fetch failed: ${res.status}`);
  const html = await res.text();
  const appIds = parseGoogleAppIdsFromHtml(html).slice(0, limit);
  const rankings = [] as any[];
  for (let i = 0; i < appIds.length; i++) {
    try {
      const app = await fetchGoogleAppDetails(appIds[i], country);
      rankings.push({ rank: i + 1, ...app });
    } catch {
      rankings.push({ rank: i + 1, appName: appIds[i], developer: null, appId: appIds[i], rating: null, ratingCount: null, price: 'Unknown', inAppPurchases: null, category, lastUpdated: null, size: null, icon: null });
    }
  }
  return { rankings };
}

async function scrapeGoogleSearch(query: string, country: string, limit: number) {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=${country}`;
  const res = await proxyFetch(url, { timeoutMs: 35_000 });
  if (!res.ok) throw new Error(`Google search fetch failed: ${res.status}`);
  const html = await res.text();
  const appIds = parseGoogleAppIdsFromHtml(html).slice(0, limit);
  const out = [] as any[];
  for (const appId of appIds) {
    try {
      out.push(await fetchGoogleAppDetails(appId, country));
    } catch {
      out.push({ appName: appId, developer: null, appId, rating: null, ratingCount: null, price: 'Unknown', category: null, icon: null });
    }
  }
  return out;
}

async function runAppStoreIntelligence(params: { type: RunType; store: AppStoreType; country: string; category?: string; appId?: string; query?: string; limit: number; txHash: string; amount: number; network: string; }) {
  const { type, store, country, category, appId, query, limit, txHash, amount, network } = params;
  const now = new Date().toISOString();
  const proxy = getProxy();

  if (type === 'rankings') {
    if (!category) throw new Error('Missing category for rankings');
    const data = store === 'apple' ? await scrapeAppleRankings(category, country, limit) : await scrapeGoogleRankings(category, country, limit);
    return {
      type,
      store,
      category,
      country,
      timestamp: now,
      rankings: data.rankings,
      metadata: { totalRanked: data.rankings.length, scrapedAt: new Date().toISOString() },
      proxy: { country: proxy.country, carrier: process.env.PROXY_CARRIER || 'unknown', type: 'mobile' },
      payment: { txHash, amount, verified: true, network },
    };
  }

  if (type === 'search') {
    if (!query) throw new Error('Missing query for search');
    const results = store === 'apple' ? await scrapeAppleSearch(query, country, limit) : await scrapeGoogleSearch(query, country, limit);
    return {
      type,
      store,
      query,
      country,
      timestamp: now,
      results,
      metadata: { totalFound: results.length, scrapedAt: new Date().toISOString() },
      proxy: { country: proxy.country, carrier: process.env.PROXY_CARRIER || 'unknown', type: 'mobile' },
      payment: { txHash, amount, verified: true, network },
    };
  }

  if (type === 'app') {
    if (!appId) throw new Error('Missing appId for app type');
    const app = store === 'apple' ? await scrapeAppleApp(appId, country) : await fetchGoogleAppDetails(appId, country);
    return {
      type,
      store,
      appId,
      country,
      timestamp: now,
      app,
      metadata: { scrapedAt: new Date().toISOString() },
      proxy: { country: proxy.country, carrier: process.env.PROXY_CARRIER || 'unknown', type: 'mobile' },
      payment: { txHash, amount, verified: true, network },
    };
  }

  const trending = store === 'apple'
    ? await scrapeAppleRankings('apps', country, Math.min(limit, 50))
    : await scrapeGoogleRankings('GAME', country, Math.min(limit, 50));

  return {
    type,
    store,
    country,
    timestamp: now,
    trending: trending.rankings,
    metadata: { totalFound: trending.rankings.length, scrapedAt: new Date().toISOString() },
    proxy: { country: proxy.country, carrier: process.env.PROXY_CARRIER || 'unknown', type: 'mobile' },
    payment: { txHash, amount, verified: true, network },
  };
}

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

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', MAPS_DESCRIPTION, MAPS_PRICE_USDC, walletAddress, MAPS_OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, MAPS_PRICE_USDC);
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

  const typeRaw = c.req.query('type');
  const storeRaw = c.req.query('store');
  const query = c.req.query('query');
  const location = c.req.query('location');
  const category = c.req.query('category');
  const appId = c.req.query('appId');
  const countryRaw = c.req.query('country');
  const limitParam = c.req.query('limit');
  const pageToken = c.req.query('pageToken');

  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam);
    if (isNaN(parsed) || parsed < 1) {
      return c.json({ error: 'Invalid limit parameter: must be a positive integer' }, 400);
    }
    limit = Math.min(parsed, 100);
  }

  if (typeRaw || storeRaw) {
    if (!typeRaw || !['rankings', 'app', 'search', 'trending'].includes(typeRaw)) {
      return c.json({ error: 'Invalid type. Use one of: rankings, app, search, trending' }, 400);
    }
    if (!storeRaw || !['apple', 'google'].includes(storeRaw)) {
      return c.json({ error: 'Invalid store. Use one of: apple, google' }, 400);
    }

    try {
      const country = ensureCountry(countryRaw);
      const payload = await runAppStoreIntelligence({
        type: typeRaw as RunType,
        store: storeRaw as AppStoreType,
        country,
        category: category || undefined,
        appId: appId || undefined,
        query: query || undefined,
        limit,
        txHash: payment.txHash,
        amount: verification.amount ?? MAPS_PRICE_USDC,
        network: payment.network,
      });

      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);
      return c.json(payload);
    } catch (err: any) {
      return c.json({ error: 'App store intelligence fetch failed', message: err?.message || String(err) }, 502);
    }
  }

  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a search query like ?query=plumbers&location=Austin+TX',
      example: '/api/run?query=restaurants&location=New+York+City&limit=20',
    }, 400);
  }

  if (!location) {
    return c.json({
      error: 'Missing required parameter: location',
      hint: 'Provide a location like ?query=plumbers&location=Austin+TX',
      example: '/api/run?query=restaurants&location=New+York+City&limit=20',
    }, 400);
  }

  const startIndex = pageToken ? parseInt(pageToken) || 0 : 0;

  try {
    const proxy = getProxy();
    const result = await scrapeGoogleMaps(query, location, limit, startIndex);

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
      hint: 'Google Maps may be temporarily blocking requests. Try again in a few minutes.',
    }, 502);
  }
});

serviceRouter.get('/details', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/details', 'Get detailed business info by Place ID', MAPS_PRICE_USDC, walletAddress, {
        input: { placeId: 'string — Google Place ID (required)' },
        output: { business: 'BusinessData — Full business details' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, MAPS_PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
  }

  const placeId = c.req.query('placeId');
  if (!placeId) {
    return c.json({ error: 'Missing required parameter: placeId' }, 400);
  }

  try {
    const proxy = getProxy();
    const url = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
    const response = await proxyFetch(url, { timeoutMs: 45_000 });

    if (!response.ok) {
      throw new Error(`Failed to fetch place details: ${response.status}`);
    }

    const html = await response.text();
    const business = extractDetailedBusiness(html, placeId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      business,
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
      error: 'Failed to fetch business details',
      message: err.message,
      hint: 'Invalid place ID or Google blocked the request.',
    }, 502);
  }
});

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
