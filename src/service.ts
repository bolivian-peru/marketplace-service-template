/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │   Google SERP + AI Search Scraper                               │
 * │   Production-quality scraper with browser rendering             │
 * │   Supports: Organic, Ads, AI Overview, Featured Snippets, PAA   │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { createStealthPage, closeBrowser } from './browser';
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
      organic: '[{ position, title, url, snippet }] — Top 10 organic results',
      ads: '[{ position, title, url, displayUrl, description }] — Sponsored ads',
      aiOverview: '{ text, sources: [{ title, url }] } | null — AI Overview/SGE if present',
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

// ─── SERP ENDPOINT ──────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);

  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount.',
    }, 402);
  }

  // ── Step 3: Validate input ──
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

  let pageNum = parseInt(c.req.query('page') || '1');
  if (isNaN(pageNum) || pageNum < 1 || pageNum > 10) {
    pageNum = 1;
  }

  // ── Step 4: Scrape Google SERP ──
  let result: SerpResults;
  let context: any = null;
  let page: any = null;

  try {
    const proxy = getProxy();
    
    // Create stealth browser page
    const browser = await createStealthPage({ 
      country, 
      useProxy: true,
      headless: true,
    });
    context = browser.context;
    page = browser.page;

    // Build Google search URL
    const domain = GOOGLE_DOMAINS[country] || 'google.com';
    const start = (pageNum - 1) * 10;
    const searchUrl = `https://www.${domain}/search?q=${encodeURIComponent(query)}&hl=en&gl=${country.toLowerCase()}${start > 0 ? `&start=${start}` : ''}`;

    // Navigate and wait for content
    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Handle cookie consent if present
    try {
      const consentButton = await page.$('button[id*="agree"], button[aria-label*="Accept"], #L2AGLb');
      if (consentButton) {
        await consentButton.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // Consent not required or already accepted
    }

    // Check for CAPTCHA
    const captchaPresent = await page.$('form[action*="sorry"], #captcha-form');
    if (captchaPresent) {
      throw new Error('CAPTCHA detected. Please retry with a different proxy.');
    }

    // Parse the SERP
    result = await parseGoogleSerp(page, query, country);

  } catch (err: any) {
    // Clean up on error
    if (context) await context.close().catch(() => {});
    
    return c.json({
      error: 'Scraping failed',
      message: err.message,
      hint: 'The proxy may be blocked or Google returned an unusual response. Try again.',
    }, 502);
  } finally {
    // Always clean up
    if (context) await context.close().catch(() => {});
  }

  // Set payment confirmation headers
  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);

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

serviceRouter.get('/demo', async (c) => {
  const query = c.req.query('q') || 'best laptops 2025';
  const country = (c.req.query('country') || 'US').toUpperCase();

  let context: any = null;

  try {
    const browser = await createStealthPage({ 
      country, 
      useProxy: false, // Demo without proxy
      headless: true,
    });
    context = browser.context;
    const page = browser.page;

    const domain = GOOGLE_DOMAINS[country] || 'google.com';
    const searchUrl = `https://www.${domain}/search?q=${encodeURIComponent(query)}&hl=en&gl=${country.toLowerCase()}`;

    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Handle consent
    try {
      const consentButton = await page.$('#L2AGLb, button[id*="agree"]');
      if (consentButton) {
        await consentButton.click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    const result = await parseGoogleSerp(page, query, country);
    
    await context.close();

    return c.json({
      ...result,
      _demo: true,
      _note: 'This is a demo endpoint without mobile proxy. Production endpoint requires x402 payment.',
    });

  } catch (err: any) {
    if (context) await context.close().catch(() => {});
    
    return c.json({
      error: 'Demo scraping failed',
      message: err.message,
    }, 502);
  }
});

// ─── HEALTH CHECK ───────────────────────────────────

serviceRouter.get('/health', async (c) => {
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
