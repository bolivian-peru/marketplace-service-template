/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │   Google SERP + AI Search Scraper                               │
 * │   Production-quality scraper with browser rendering             │
 * │   Supports: Organic, Ads, AI Overview, Featured Snippets, PAA   │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { createStealthPage } from './browser';
import { parseGoogleSerp, SerpResults } from './parser';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ──────────────────────────
const SERVICE_NAME = 'google-serp-ai-scraper';
const PRICE_USDC = 0.008;  // $0.008 per query
const DESCRIPTION = 'Google SERP scraper with AI Overview extraction. Uses real browser rendering through mobile proxies. Returns structured JSON with organic results, ads, AI overviews, featured snippets, and People Also Ask.';

const OUTPUT_SCHEMA = {
  input: {
    q: 'string — Search query (required)',
    country: 'string — Country code: US, UK, DE, FR (optional, default: US)',
    page: 'number — Page number 1-10 (optional, default: 1)',
  },
  output: {
    query: 'string — The search query',
    country: 'string — Country used for search',
    timestamp: 'string — ISO timestamp',
    results: {
      organic: '[{ position, title, url, snippet, siteLinks }] — Deep organic extraction for current SERP page',
      ads: '[{ position, title, url, displayUrl, description }] — Sponsored ads',
      aiOverview: '{ text, citations/sources: [{ title, url, sourceDomain }], sections } | null — AI Overview/SGE if present',
      featuredSnippet: '{ text, source, sourceUrl } | null — Featured snippet if present',
      peopleAlsoAsk: '[string] — People Also Ask questions',
      relatedSearches: '[string] — Related search suggestions',
      knowledgePanel: '{ title, description } | null — Knowledge panel if present',
    },
    metadata: {
      totalResults: 'string — Approximate total results',
      searchTime: 'string — Google search time',
      scrapedAt: 'string — When scraping occurred',
      proxyCountry: 'string — Proxy country used',
      cacheHit: 'boolean — Whether response came from 5-minute memory cache',
      cacheAgeMs: 'number — Age of cached result in milliseconds',
    },
    payment: {
      txHash: 'string — Transaction hash',
      network: 'string — Payment network (solana/base)',
      amount: 'number — USDC amount paid',
      settled: 'boolean — Payment confirmed',
    },
  },
};

// Supported countries
const SUPPORTED_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'ES', 'IT', 'CA', 'AU'];

// Google domains by country
const GOOGLE_DOMAINS: Record<string, string> = {
  US: 'google.com',
  UK: 'google.co.uk',
  DE: 'google.de',
  FR: 'google.fr',
  ES: 'google.es',
  IT: 'google.it',
  CA: 'google.ca',
  AU: 'google.com.au',
};

const SERP_CACHE_TTL_MS = 5 * 60_000;
const REPLAY_WINDOW_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

interface SerpCacheEntry {
  data: SerpResults;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

interface ReplayNonceEntry {
  seenAt: number;
  txHash: string;
  scope: string;
}

const serpCache = new Map<string, SerpCacheEntry>();
const replayNonces = new Map<string, ReplayNonceEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of serpCache) {
    if (entry.expiresAt <= now) serpCache.delete(key);
  }
}, 60_000);

setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of replayNonces) {
    if (entry.seenAt + REPLAY_WINDOW_MS <= now) replayNonces.delete(nonce);
  }
}, 60_000);

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildCacheKey(query: string, country: string, pageNum: number): string {
  return `${country}|p${pageNum}|${normalizeQuery(query)}`;
}

function getCachedSerp(key: string): { result: SerpResults; ageMs: number } | null {
  const entry = serpCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt <= now) {
    serpCache.delete(key);
    return null;
  }

  entry.hits += 1;
  return {
    result: deepClone(entry.data),
    ageMs: now - entry.createdAt,
  };
}

function putCachedSerp(key: string, result: SerpResults): void {
  const now = Date.now();
  serpCache.set(key, {
    data: deepClone(result),
    createdAt: now,
    expiresAt: now + SERP_CACHE_TTL_MS,
    hits: 0,
  });
}

function parsePaymentTimestamp(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^\d{10,13}$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return value.length === 10 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function reserveReplayNonce(c: Context, txHash: string, scope: string): { ok: true } | { ok: false; error: string } {
  const nonceHeader = c.req.header('x-payment-nonce') || c.req.header('payment-nonce');
  const timestampHeader = c.req.header('x-payment-timestamp') || c.req.header('payment-timestamp');

  if (!nonceHeader) {
    return { ok: false, error: 'Missing required header: X-Payment-Nonce' };
  }
  if (!timestampHeader) {
    return { ok: false, error: 'Missing required header: X-Payment-Timestamp' };
  }

  const nonce = nonceHeader.trim();
  if (!NONCE_PATTERN.test(nonce)) {
    return {
      ok: false,
      error: 'Invalid X-Payment-Nonce format. Use 16-128 chars: letters, numbers, dot, underscore, colon, or dash.',
    };
  }

  const timestamp = parsePaymentTimestamp(timestampHeader);
  if (timestamp === null) {
    return { ok: false, error: 'Invalid X-Payment-Timestamp. Use unix seconds/ms or ISO-8601.' };
  }

  const now = Date.now();
  if (timestamp > now + MAX_FUTURE_SKEW_MS) {
    return { ok: false, error: 'Payment timestamp is too far in the future.' };
  }
  if (now - timestamp > REPLAY_WINDOW_MS) {
    return { ok: false, error: 'Payment timestamp expired. Max age is 5 minutes.' };
  }

  const nonceKey = nonce.toLowerCase();
  const existing = replayNonces.get(nonceKey);
  if (existing) {
    return {
      ok: false,
      error: `Replay detected for nonce "${nonce}". Nonces can only be used once within 5 minutes.`,
    };
  }

  replayNonces.set(nonceKey, { seenAt: now, txHash, scope });
  return { ok: true };
}

async function scrapeSerp(query: string, country: string, pageNum: number, useProxy: boolean): Promise<SerpResults> {
  let context: any = null;

  try {
    if (useProxy) {
      // Validate proxy credentials early for clearer error responses.
      getProxy();
    }

    const browser = await createStealthPage({
      country,
      useProxy,
      headless: true,
    });

    context = browser.context;
    const page = browser.page;

    const domain = GOOGLE_DOMAINS[country] || 'google.com';
    const start = (pageNum - 1) * 10;
    const searchUrl = `https://www.${domain}/search?q=${encodeURIComponent(query)}&hl=en&gl=${country.toLowerCase()}${start > 0 ? `&start=${start}` : ''}`;

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    try {
      const consentButton = await page.$(
        '#L2AGLb, button[id*="agree"], button[aria-label*="Accept"], button:has-text("Accept all"), button:has-text("Alle akzeptieren")'
      );
      if (consentButton) {
        await consentButton.click();
        await page.waitForTimeout(1_000);
      }
    } catch {
      // Consent not required or already accepted.
    }

    const captchaPresent = await page.$('form[action*="sorry"], #captcha-form, div#g-recaptcha');
    if (captchaPresent) {
      throw new Error('CAPTCHA detected. Please retry with a different proxy.');
    }

    const result = await parseGoogleSerp(page, query, country);
    result.metadata.proxyCountry = country;
    return result;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ─── SERP ENDPOINT ──────────────────────────────────

serviceRouter.get('/run', async (c: Context) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment headers ──
  const payment = extractPayment(c);

  if (!payment) {
    const challenge = build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA) as any;
    const existingRequired = Array.isArray(challenge.headers?.required) ? challenge.headers.required : [];
    challenge.headers = {
      ...challenge.headers,
      required: Array.from(new Set([...existingRequired, 'X-Payment-Nonce', 'X-Payment-Timestamp'])),
      optional: Array.from(new Set([...(challenge.headers?.optional || []), 'X-Payment-Network'])),
      format: 'Payment-Signature: <tx_hash>; X-Payment-Nonce: <random_nonce>; X-Payment-Timestamp: <unix_ms>',
    };
    return c.json(
      challenge,
      402,
    );
  }

  // ── Step 2: Validate input ──
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing required parameter: ?q=<search_query>' }, 400);
  }

  if (query.length > 200) {
    return c.json({ error: 'Query too long. Maximum 200 characters.' }, 400);
  }

  let country = (c.req.query('country') || 'US').toUpperCase();
  if (!SUPPORTED_COUNTRIES.includes(country)) {
    country = 'US';
  }

  let pageNum = parseInt(c.req.query('page') || '1', 10);
  if (isNaN(pageNum) || pageNum < 1 || pageNum > 10) {
    pageNum = 1;
  }

  // ── Step 3: Request-level replay protection ──
  const replayScope = `${payment.network}:${payment.txHash}:${country}:${pageNum}:${normalizeQuery(query)}`;
  const replayGuard = reserveReplayNonce(c, payment.txHash, replayScope);
  if (!replayGuard.ok) {
    return c.json(
      {
        error: 'Replay protection failed',
        reason: replayGuard.error,
        hint: 'Generate a new nonce and use a current timestamp for each paid request.',
      },
      409
    );
  }

  // ── Step 4: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json(
      {
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount.',
      },
      402
    );
  }

  // ── Step 5: Return cached SERP when available (no proxy/browser spend) ──
  const cacheKey = buildCacheKey(query, country, pageNum);
  const cached = getCachedSerp(cacheKey);
  if (cached) {
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    c.header('X-Cache', 'HIT');

    cached.result.metadata.proxyCountry = country;
    cached.result.metadata.cacheHit = true;
    cached.result.metadata.cacheAgeMs = cached.ageMs;

    return c.json({
      ...cached.result,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  }

  // ── Step 6: Scrape Google SERP ──
  let result: SerpResults;
  try {
    result = await scrapeSerp(query, country, pageNum, true);
  } catch (err: any) {
    return c.json(
      {
        error: 'Scraping failed',
        message: err.message,
        hint: 'The proxy may be blocked or Google returned an unusual response. Try again.',
      },
      502
    );
  }

  result.metadata.proxyCountry = country;
  result.metadata.cacheHit = false;
  result.metadata.cacheAgeMs = 0;
  putCachedSerp(cacheKey, result);

  // Set payment confirmation headers
  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);
  c.header('X-Cache', 'MISS');

  return c.json({
    ...result,
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount,
      settled: true,
    },
  });
});

// ─── DEMO ENDPOINT (No payment required for testing) ──

serviceRouter.get('/demo', async (c: Context) => {
  const query = c.req.query('q') || 'best laptops 2025';
  let country = (c.req.query('country') || 'US').toUpperCase();
  if (!SUPPORTED_COUNTRIES.includes(country)) {
    country = 'US';
  }

  try {
    const result = await scrapeSerp(query, country, 1, false);
    result.metadata.cacheHit = false;
    result.metadata.cacheAgeMs = 0;

    return c.json({
      ...result,
      _demo: true,
      _note: 'This is a demo endpoint without mobile proxy. Production endpoint requires x402 payment.',
    });

  } catch (err: any) {
    return c.json({
      error: 'Demo scraping failed',
      message: err.message,
    }, 502);
  }
});

// ─── HEALTH CHECK ───────────────────────────────────

serviceRouter.get('/health', async (c: Context) => {
  return c.json({
    status: 'healthy',
    service: SERVICE_NAME,
    version: '1.0.0',
    features: [
      'organic_results',
      'ads',
      'ai_overview',
      'featured_snippets',
      'people_also_ask',
      'related_searches',
      'knowledge_panel',
    ],
    supported_countries: SUPPORTED_COUNTRIES,
    pricing: {
      amount: PRICE_USDC,
      currency: 'USDC',
      networks: ['solana', 'base'],
    },
  });
});
