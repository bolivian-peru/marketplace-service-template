/**
 * Google SERP + AI Search API Route
 * ────────────────────────────────────
 * Bounty #149 — $200 USD
 *
 * Endpoints:
 *   GET /api/serp/search   — Full Google SERP (organic, ads, AI Overview, PAA, map pack, knowledge panel)
 *   GET /api/serp/ai       — AI Overview only (lightweight)
 *   GET /api/serp/suggest  — Google autocomplete suggestions
 *
 * Pricing (x402 micropayments):
 *   $0.01 USDC — /search (full SERP)
 *   $0.005 USDC — /ai    (AI Overview only)
 *   $0.002 USDC — /suggest
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import { scrapeMobileSERP, extractAiOverview, buildGoogleSearchUrl } from '../scrapers/serp-tracker';
import { decodeHtmlEntities } from '../utils/helpers';

export const serpRouter = new Hono();

// ─── CONSTANTS ────────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_SEARCH = 0.01;   // Full SERP
const PRICE_AI     = 0.005;  // AI Overview only
const PRICE_SUGGEST = 0.002; // Autocomplete

const DESCRIPTION_SEARCH = 'Google SERP Intelligence API: organic results, AI Overviews, ads, People Also Ask, map pack, knowledge panel, related searches — via mobile proxies.';
const DESCRIPTION_AI     = 'Google AI Overview extractor: retrieves AI-generated answer summaries for any query.';
const DESCRIPTION_SUGGEST = 'Google autocomplete suggestions for a query prefix.';

const OUTPUT_SCHEMA_SEARCH = {
  query: 'string',
  country: 'string (ISO 3166-1 alpha-2, default: "us")',
  language: 'string (BCP-47, default: "en")',
  location: 'string | null',
  totalResults: 'string | null',
  organic: [{
    position: 'number',
    title: 'string',
    url: 'string',
    displayUrl: 'string',
    snippet: 'string | null',
    sitelinks: 'array | null',
    date: 'string | null',
  }],
  ads: [{
    position: 'number',
    title: 'string',
    url: 'string',
    displayUrl: 'string',
    snippet: 'string | null',
  }],
  peopleAlsoAsk: [{
    question: 'string',
    answer: 'string | null',
    url: 'string | null',
    title: 'string | null',
  }],
  featuredSnippet: {
    text: 'string',
    url: 'string | null',
    title: 'string | null',
    type: 'string',
  } + ' | null',
  aiOverview: {
    text: 'string',
    sources: [{ title: 'string', url: 'string' }],
  } + ' | null',
  mapPack: [{
    name: 'string',
    address: 'string | null',
    rating: 'number | null',
    reviewCount: 'number | null',
    category: 'string | null',
    phone: 'string | null',
  }],
  knowledgePanel: {
    title: 'string',
    type: 'string | null',
    description: 'string | null',
    url: 'string | null',
    attributes: 'Record<string, string>',
  } + ' | null',
  relatedSearches: 'string[]',
  meta: {
    proxy: { ip: 'string', country: 'string', carrier: 'string | null' },
    scrapedAt: 'string (ISO 8601)',
    responseTimeMs: 'number',
  },
};

// ─── RATE LIMITING ─────────────────────────────────────

const RATE_LIMIT_PER_MIN = Math.max(1, Math.min(parseInt(process.env.SERP_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 120));
const RATE_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_PER_MIN;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 300_000);

// ─── HELPERS ───────────────────────────────────────────

function getClientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function validateQuery(q: unknown): string | null {
  if (typeof q !== 'string' || q.trim().length < 1 || q.trim().length > 500) return null;
  return q.trim();
}

// ─── GET /api/serp/search ──────────────────────────────

serpRouter.get('/search', async (c: Context) => {
  const ip = getClientIp(c);

  // Rate limit
  if (!checkRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  // Validate query
  const q = validateQuery(c.req.query('q'));
  if (!q) {
    return c.json({
      error: 'Missing or invalid query parameter "q" (1–500 chars required)',
      schema: OUTPUT_SCHEMA_SEARCH,
      pricing: { amount: PRICE_SEARCH, currency: 'USDC' },
    }, 400);
  }

  const country  = (c.req.query('country')  ?? 'us').toLowerCase().slice(0, 2);
  const language = (c.req.query('language') ?? 'en').toLowerCase().slice(0, 5);
  const location = c.req.query('location') ?? undefined;
  const start    = Math.max(0, Math.min(parseInt(c.req.query('start') ?? '0', 10) || 0, 90));

  // x402 payment
  const payment = extractPayment(c.req.raw);
  if (!payment) {
    return c.json(build402Response(PRICE_SEARCH, WALLET_ADDRESS, DESCRIPTION_SEARCH, OUTPUT_SCHEMA_SEARCH), 402);
  }
  const verified = await verifyPayment(payment, PRICE_SEARCH, WALLET_ADDRESS);
  if (!verified) {
    return c.json({ error: 'Payment verification failed' }, 402);
  }

  const t0 = Date.now();

  try {
    const proxy = await getProxy();
    const serp  = await scrapeMobileSERP(q, country, language, location, start);

    return c.json({
      ...serp,
      meta: {
        proxy: {
          ip: proxy?.ip ?? 'direct',
          country: proxy?.country ?? 'unknown',
          carrier: proxy?.carrier ?? null,
        },
        scrapedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - t0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown scraping error';
    const status = message.includes('CAPTCHA') ? 503 : 500;
    return c.json({ error: message }, status);
  }
});

// ─── GET /api/serp/ai ──────────────────────────────────

serpRouter.get('/ai', async (c: Context) => {
  const ip = getClientIp(c);

  if (!checkRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const q = validateQuery(c.req.query('q'));
  if (!q) {
    return c.json({ error: 'Missing or invalid query parameter "q"' }, 400);
  }

  const payment = extractPayment(c.req.raw);
  if (!payment) {
    return c.json(build402Response(PRICE_AI, WALLET_ADDRESS, DESCRIPTION_AI, {
      aiOverview: { text: 'string', sources: [{ title: 'string', url: 'string' }] },
    }), 402);
  }
  const verified = await verifyPayment(payment, PRICE_AI, WALLET_ADDRESS);
  if (!verified) return c.json({ error: 'Payment verification failed' }, 402);

  try {
    const country  = (c.req.query('country') ?? 'us').toLowerCase().slice(0, 2);
    const language = (c.req.query('language') ?? 'en').toLowerCase().slice(0, 5);
    const url      = buildGoogleSearchUrl(q, country, language);

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `${language},en;q=0.9`,
      'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
    };

    const response = await proxyFetch(url, { timeoutMs: 30000, maxRetries: 2, headers });
    if (!response.ok) throw new Error(`Google returned HTTP ${response.status}`);

    const html = await response.text();
    const aiOverview = extractAiOverview(html);

    if (!aiOverview) {
      return c.json({ query: q, aiOverview: null, note: 'No AI Overview found for this query.' });
    }

    return c.json({ query: q, aiOverview, scrapedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Scraping error';
    return c.json({ error: message }, 500);
  }
});

// ─── GET /api/serp/suggest ─────────────────────────────

serpRouter.get('/suggest', async (c: Context) => {
  const ip = getClientIp(c);

  if (!checkRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }

  const q = validateQuery(c.req.query('q'));
  if (!q) return c.json({ error: 'Missing query parameter "q"' }, 400);

  const payment = extractPayment(c.req.raw);
  if (!payment) {
    return c.json(build402Response(PRICE_SUGGEST, WALLET_ADDRESS, DESCRIPTION_SUGGEST, {
      query: 'string',
      suggestions: 'string[]',
    }), 402);
  }
  const verified = await verifyPayment(payment, PRICE_SUGGEST, WALLET_ADDRESS);
  if (!verified) return c.json({ error: 'Payment verification failed' }, 402);

  try {
    const language = (c.req.query('language') ?? 'en').slice(0, 5);
    const suggestUrl = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${language}&q=${encodeURIComponent(q)}`;

    const resp = await proxyFetch(suggestUrl, {
      timeoutMs: 10000,
      maxRetries: 2,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });

    if (!resp.ok) throw new Error(`Suggest API returned ${resp.status}`);

    const data = await resp.json() as [string, string[]];
    const suggestions: string[] = Array.isArray(data[1]) ? data[1].slice(0, 10) : [];

    return c.json({ query: q, suggestions, fetchedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching suggestions';
    return c.json({ error: message }, 500);
  }
});
