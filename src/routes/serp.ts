/**
 * GET /api/serp/*
 * Google SERP (Search Engine Results Page) + AI Search Scraper
 *
 * Endpoints:
 *   GET /api/serp/search - Full SERP (organic, AI Overview, ads, PAA, etc.) - $0.01 USDC
 *   GET /api/serp/ai    - AI Overview only (lightweight) - $0.005 USDC
 *   GET /api/serp/suggest - Google autocomplete - $0.002 USDC
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import {
  scrapeMobileSERP,
  extractAiOverview,
  buildGoogleSearchUrl,
} from '../scrapers/serp-tracker';
import type { SerpResponse, AiOverview } from '../types/index';

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

// Pricing
const PRICE_SEARCH = 0.01;
const PRICE_AI = 0.005;
const PRICE_SUGGEST = 0.002;

// Input limits
const MAX_QUERY_LENGTH = 500;
const MIN_QUERY_LENGTH = 1;

// Rate limiting
const SERP_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(parseInt(process.env.SERP_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 300),
);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const DESCRIPTION =
  'Google SERP API: scrape search results with AI Overviews, ads, People Also Ask, featured snippets, ' +
  'map packs, knowledge panels, and related searches using mobile carrier IPs.';

const OUTPUT_SCHEMA = {
  input: {
    query: 'string (required) - search query',
    country: 'string (optional, default: "us") - ISO country code',
    language: 'string (optional, default: "en") - language code',
    location: 'string (optional) - specific location (e.g., "Austin TX")',
    start: 'number (optional, default: 0) - result offset for pagination',
  },
  output: {
    query: 'string',
    country: 'string',
    language: 'string',
    location: 'string | null',
    totalResults: 'string | null',
    organic: 'OrganicResult[]',
    ads: 'AdResult[]',
    peopleAlsoAsk: 'PeopleAlsoAsk[]',
    featuredSnippet: 'FeaturedSnippet | null',
    aiOverview: 'AiOverview | null',
    mapPack: 'MapPackResult[]',
    knowledgePanel: 'KnowledgePanel | null',
    relatedSearches: 'string[]',
  },
  pricing: {
    full_serp: '$0.01 USDC',
    ai_overview_only: '$0.005 USDC',
    autocomplete: '$0.002 USDC',
  },
};

function normalizeClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = c.req.header('x-real-ip')?.trim();
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  const candidate = forwarded || realIp || cfIp || 'unknown';

  if (!candidate || candidate.length > 64 || /[\r\n]/.test(candidate)) {
    return 'unknown';
  }

  return candidate;
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();

  // Cleanup old entries
  if (rateLimits.size > 10_000) {
    for (const [key, value] of rateLimits) {
      if (now > value.resetAt) {
        rateLimits.delete(key);
      }
    }
  }

  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= SERP_RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

function validateQuery(query: string): { valid: boolean; error?: string } {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query parameter is required' };
  }

  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { valid: false, error: `Query must be at least ${MIN_QUERY_LENGTH} character` };
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query must be less than ${MAX_QUERY_LENGTH} characters` };
  }

  return { valid: true };
}

function getProxyInfo() {
  const proxy = getProxy();
  return {
    ip: proxy?.host ?? 'direct',
    country: 'US',
    type: 'mobile',
  };
}

// Create router
const serpRouter = new Hono();

// GET /api/serp/search - Full SERP with all features
serpRouter.get('/search', async (c) => {
  // 1. Payment check
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/serp/search',
        'Google SERP (full) - organic, AI Overview, ads, PAA, featured snippet, map pack, knowledge panel, related searches',
        PRICE_SEARCH,
        WALLET_ADDRESS,
        OUTPUT_SCHEMA,
      ),
      402,
    );
  }

  // 2. Rate limit check
  const clientIp = normalizeClientIp(c);
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return c.json(
      {
        error: 'Rate limit exceeded',
        limit: SERP_RATE_LIMIT_PER_MIN,
        window_seconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
        retry_after: rateLimit.retryAfter,
      },
      429,
    );
  }

  // 3. Verify payment
  const paymentValid = await verifyPayment(payment, WALLET_ADDRESS, PRICE_SEARCH);
  if (!paymentValid) {
    return c.json(
      {
        error: 'Payment verification failed',
        expected: PRICE_SEARCH,
        network: payment.network,
      },
      402,
    );
  }

  // 4. Parse and validate query
  const query = c.req.query('q') || c.req.query('query') || '';
  const validation = validateQuery(query);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  // 5. Parse optional parameters
  const country = c.req.query('country') || 'us';
  const language = c.req.query('language') || 'en';
  const location = c.req.query('location') || undefined;
  const start = Math.max(0, parseInt(c.req.query('start') || '0', 10));

  try {
    // 6. Scrape SERP
    const result = await scrapeMobileSERP(query, country, language, location, start);

    // 7. Return result with payment confirmation
    return c.json({
      ...result,
      payment: {
        status: 'verified',
        amount: PRICE_SEARCH,
        currency: 'USDC',
        network: payment.network,
        tx_hash: payment.txHash,
      },
      meta: {
        proxy: getProxyInfo(),
        generated_at: new Date().toISOString(),
        rate_limit_remaining: SERP_RATE_LIMIT_PER_MIN - (rateLimits.get(clientIp)?.count ?? 1),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SERP] Scraping failed:', message);

    // Check for specific error types
    if (message.includes('CAPTCHA') || message.includes('flagged')) {
      return c.json(
        {
          error: 'Google blocked this request (CAPTCHA or IP flagged)',
          details: message,
          suggestion: 'Try again later or use a different IP',
        },
        403,
      );
    }

    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return c.json(
        {
          error: 'Request timeout',
          details: message,
          suggestion: 'Try with a simpler query or fewer results',
        },
        504,
      );
    }

    return c.json(
      {
        error: 'SERP scraping failed',
        details: message,
      },
      500,
    );
  }
});

// GET /api/serp/ai - AI Overview only (lightweight)
serpRouter.get('/ai', async (c) => {
  // 1. Payment check
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/serp/ai',
        'Google AI Overview only - lightweight extraction of AI-generated search summaries',
        PRICE_AI,
        WALLET_ADDRESS,
        OUTPUT_SCHEMA,
      ),
      402,
    );
  }

  // 2. Rate limit check
  const clientIp = normalizeClientIp(c);
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return c.json(
      {
        error: 'Rate limit exceeded',
        limit: SERP_RATE_LIMIT_PER_MIN,
        window_seconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
        retry_after: rateLimit.retryAfter,
      },
      429,
    );
  }

  // 3. Verify payment
  const paymentValid = await verifyPayment(payment, WALLET_ADDRESS, PRICE_AI);
  if (!paymentValid) {
    return c.json(
      {
        error: 'Payment verification failed',
        expected: PRICE_AI,
        network: payment.network,
      },
      402,
    );
  }

  // 4. Parse and validate query
  const query = c.req.query('q') || c.req.query('query') || '';
  const validation = validateQuery(query);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  // 5. Parse optional parameters
  const country = c.req.query('country') || 'us';
  const language = c.req.query('language') || 'en';
  const location = c.req.query('location') || undefined;

  try {
    // 6. Scrape SERP (full, but we'll extract only AI Overview)
    const result = await scrapeMobileSERP(query, country, language, location, 0);

    // 7. Extract only AI Overview
    const aiOverview = result.aiOverview;

    if (!aiOverview) {
      return c.json({
        query: result.query,
        country: result.country,
        language: result.language,
        location: result.location,
        aiOverview: null,
        found: false,
        message: 'No AI Overview found for this query (may not be triggered by Google)',
        payment: {
          status: 'verified',
          amount: PRICE_AI,
          currency: 'USDC',
          network: payment.network,
          tx_hash: payment.txHash,
        },
        meta: {
          proxy: getProxyInfo(),
          generated_at: new Date().toISOString(),
        },
      });
    }

    // 8. Return result with payment confirmation
    return c.json({
      query: result.query,
      country: result.country,
      language: result.language,
      location: result.location,
      aiOverview,
      found: true,
      payment: {
        status: 'verified',
        amount: PRICE_AI,
        currency: 'USDC',
        network: payment.network,
        tx_hash: payment.txHash,
      },
      meta: {
        proxy: getProxyInfo(),
        generated_at: new Date().toISOString(),
        rate_limit_remaining: SERP_RATE_LIMIT_PER_MIN - (rateLimits.get(clientIp)?.count ?? 1),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SERP/ai] Scraping failed:', message);

    if (message.includes('CAPTCHA') || message.includes('flagged')) {
      return c.json(
        {
          error: 'Google blocked this request (CAPTCHA or IP flagged)',
          details: message,
        },
        403,
      );
    }

    return c.json(
      {
        error: 'AI Overview extraction failed',
        details: message,
      },
      500,
    );
  }
});

// GET /api/serp/suggest - Google autocomplete
serpRouter.get('/suggest', async (c) => {
  // 1. Payment check
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/serp/suggest',
        'Google autocomplete suggestions - real-time search suggestions',
        PRICE_SUGGEST,
        WALLET_ADDRESS,
        OUTPUT_SCHEMA,
      ),
      402,
    );
  }

  // 2. Rate limit check
  const clientIp = normalizeClientIp(c);
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return c.json(
      {
        error: 'Rate limit exceeded',
        limit: SERP_RATE_LIMIT_PER_MIN,
        window_seconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
        retry_after: rateLimit.retryAfter,
      },
      429,
    );
  }

  // 3. Verify payment
  const paymentValid = await verifyPayment(payment, WALLET_ADDRESS, PRICE_SUGGEST);
  if (!paymentValid) {
    return c.json(
      {
        error: 'Payment verification failed',
        expected: PRICE_SUGGEST,
        network: payment.network,
      },
      402,
    );
  }

  // 4. Parse and validate query
  const query = c.req.query('q') || c.req.query('query') || '';
  const validation = validateQuery(query);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  // 5. Parse optional parameters
  const country = c.req.query('country') || 'us';
  const language = c.req.query('language') || 'en';

  try {
    // 6. Build autocomplete URL
    const url = `https://www.google.com/complete/search?client=psy-ab&cp=1&gs_ri=psy-ab&q=${encodeURIComponent(query)}&hl=${language}&gl=${country}`;

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Accept': 'application/json',
      'Accept-Language': `${language},en;q=0.9`,
      'Referer': 'https://www.google.com/',
    };

    // 7. Fetch autocomplete
    const response = await proxyFetch(url, {
      timeoutMs: 15000,
      maxRetries: 2,
      headers,
    });

    if (!response.ok) {
      throw new Error(`Google returned HTTP ${response.status}`);
    }

    const text = await response.text();

    // Parse JSONP response: google.ac.hcomplete(...)
    let suggestions: string[] = [];
    try {
      const jsonMatch = text.match(/google\.ac\.complete\([^,]+,\s*(\[[\s\S]*?\])\)/);
      if (jsonMatch && jsonMatch[1]) {
        const data = JSON.parse(jsonMatch[1]);
        // Format: [[suggestion1, ..., suggestionN], ...]
        if (Array.isArray(data) && data.length > 0) {
          const firstEntry = data[0];
          if (Array.isArray(firstEntry)) {
            suggestions = firstEntry.map((item: unknown) => {
              if (typeof item === 'string') return item;
              if (Array.isArray(item) && item.length > 0) return String(item[0]);
              return '';
            }).filter(Boolean).slice(0, 10);
          }
        }
      }
    } catch {
      // Fallback: try to extract suggestions from raw text
      const matches = text.match(/"([^"]+)"/g);
      if (matches) {
        suggestions = matches
          .map((m) => m.replace(/"/g, ''))
          .filter((s) => s.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 10);
      }
    }

    // 8. Return result with payment confirmation
    return c.json({
      query,
      country,
      language,
      suggestions,
      count: suggestions.length,
      payment: {
        status: 'verified',
        amount: PRICE_SUGGEST,
        currency: 'USDC',
        network: payment.network,
        tx_hash: payment.txHash,
      },
      meta: {
        proxy: getProxyInfo(),
        generated_at: new Date().toISOString(),
        rate_limit_remaining: SERP_RATE_LIMIT_PER_MIN - (rateLimits.get(clientIp)?.count ?? 1),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SERP/suggest] Scraping failed:', message);

    return c.json(
      {
        error: 'Autocomplete extraction failed',
        details: message,
      },
      500,
    );
  }
});

// Health check endpoint (no payment required)
serpRouter.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'serp',
    endpoints: {
      '/api/serp/search': 'Full SERP - $0.01 USDC',
      '/api/serp/ai': 'AI Overview only - $0.005 USDC',
      '/api/serp/suggest': 'Autocomplete - $0.002 USDC',
    },
  });
});

export { serpRouter };
