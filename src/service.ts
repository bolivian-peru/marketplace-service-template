/**
 * SERP Tracker API — Marketplace Service
 * ─────────────────────────────────────────
 * Tracks Google search engine results pages (SERPs) for any keyword.
 * Returns: position, title, URL, snippet, rich result type.
 *
 * Built with x402 micropayment support (Solana + Base USDC).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeSERP, type SerpResult } from './scrapers/serp-scraper';

// ─── PRICING & CONFIG ─────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_USDC = 0.001; // $0.001 per search
const DESCRIPTION =
  'SERP Tracker: track Google search rankings for any keyword. ' +
  'Returns top results with position, title, URL, snippet, rich result type, ' +
  'and mobile proxy exit country.';

const OUTPUT_SCHEMA = {
  input: {
    keyword: 'string (required) — search keyword/query',
    locale: 'string (optional, default: en) — language code (en, es, fr, de, zh, ja...)',
    country: 'string (optional, default: us) — country code (us, uk, ca, au...)',
    limit: 'number (optional, default: 20, max: 50) — max results to return',
    pageToken: 'string (optional) — page token (reserved for future pagination)',
  },
  output: {
    keyword: 'string',
    results: '[SerpResult]',
    totalResults: 'number — Google\'s estimated total matches',
    searchTime: 'number — seconds to fetch',
    domain: '"google.com"',
    locale: 'string',
    country: 'string',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
  pricing: '$0.001 USDC per request',
  notes: 'Ad results and related-box results are filtered out by default.',
};

// ─── RATE LIMIT ────────────────────────────────────────

const SERP_RATE_LIMIT = 30; // per minute per IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const serpRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkSerpRateLimit(ip: string): boolean {
  const now = Date.now();
  const current = serpRateLimits.get(ip);
  if (!current || now > current.resetAt) {
    serpRateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= SERP_RATE_LIMIT) return false;
  current.count++;
  return true;
}

// ─── INPUT VALIDATION ──────────────────────────────────

interface SerpQueryParams {
  keyword?: string;
  locale?: string;
  country?: string;
  limit?: string;
  pageToken?: string;
}

function validateParams(params: SerpQueryParams): { ok: true; keyword: string; locale: string; country: string; limit: number } | { ok: false; error: string; hint?: string } {
  if (!params.keyword || params.keyword.trim() === '') {
    return { ok: false, error: 'Missing required parameter: keyword', hint: 'Provide a search query like ?keyword=ai+agents' };
  }
  const keyword = params.keyword.trim().slice(0, 300);
  if (keyword.length < 2) {
    return { ok: false, error: 'Keyword too short (minimum 2 characters)', hint: 'Keywords must be at least 2 characters.' };
  }

  const locale = (params.locale || 'en').slice(0, 10).toLowerCase();
  const country = (params.country || 'us').slice(0, 10).toLowerCase();

  let limit = 20;
  if (params.limit) {
    const parsed = parseInt(params.limit, 10);
    if (isNaN(parsed) || parsed < 1) {
      return { ok: false, error: 'Invalid limit parameter: must be a positive integer' };
    }
    limit = Math.min(parsed, 50);
  }

  return { ok: true, keyword, locale, country, limit };
}

// ─── ROUTE ─────────────────────────────────────────────

export const serviceRouter = new Hono();

// GET /api/run?keyword=...&locale=en&country=us&limit=20
serviceRouter.get('/run', async (c: Context) => {
  // 1. Payment check
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  // 2. Verify payment on-chain
  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // 3. Rate limit
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkSerpRateLimit(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'SERP rate limit exceeded', maxPerMinute: SERP_RATE_LIMIT, retryAfter: 60 }, 429);
  }

  // 4. Validate input
  const params: SerpQueryParams = {
    keyword: c.req.query('keyword'),
    locale: c.req.query('locale'),
    country: c.req.query('country'),
    limit: c.req.query('limit'),
    pageToken: c.req.query('pageToken'),
  };

  const validation = validateParams(params);
  if (!validation.ok) {
    return c.json({ error: validation.error, hint: validation.hint }, 400);
  }

  const { keyword, locale, country, limit } = validation;

  // 5. Scrape SERP
  const proxy = getProxy();
  const result = await scrapeSERP(keyword, locale, country);

  // 6. Respond with payment confirmation
  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);

  return c.json({
    keyword,
    results: result.results.slice(0, limit),
    totalResults: result.totalResults,
    searchTime: result.searchTime,
    domain: result.domain,
    locale,
    country,
    proxy: { country: proxy.country, type: 'mobile' },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_USDC,
      settled: true,
    },
  });
});

// GET /api/run  (no keyword)
serviceRouter.get('/', async (c: Context) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }
  return c.json({ error: 'Missing required parameter: keyword' }, 400);
});
