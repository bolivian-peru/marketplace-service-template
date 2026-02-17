/**
 * Service Router — Job Market Intelligence (Bounty #16)
 *
 * Exposes ONLY:
 *   GET /api/jobs
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { getLinkedInProvider, checkLinkedInRateLimit, buildLinkedInMeta } from './scrapers/linkedin';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Job Market Intelligence API (Indeed/LinkedIn): title, company, location, salary, date, link, remote + proxy exit metadata.';

const LINKEDIN_PERSON_PRICE_USDC = 0.03;
const LINKEDIN_COMPANY_PRICE_USDC = 0.05;
const LINKEDIN_SEARCH_PRICE_USDC = 0.10;

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

// ═══════════════════════════════════════════════════════
// ─── LINKEDIN ENRICHMENT API (Bounty #77) ───────────
// ═══════════════════════════════════════════════════════

serviceRouter.get('/linkedin/person', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/linkedin/person', 'LinkedIn person enrichment by profile URL', LINKEDIN_PERSON_PRICE_USDC, walletAddress, {
      input: { url: 'string (required) — linkedin.com/in/username' },
      output: { name: 'string', headline: 'string', location: 'string', current_company: 'object', skills: 'string[]', meta: '{ proxy, provider, mock }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_PERSON_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = checkLinkedInRateLimit(clientIp);
  if (!allowed.allowed) {
    c.header('Retry-After', String(allowed.retryAfter || 60));
    return c.json({ error: 'LinkedIn rate limit exceeded for this client', retryAfter: allowed.retryAfter || 60 }, 429);
  }

  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing required parameter: url', example: '/api/linkedin/person?url=linkedin.com/in/janesmith' }, 400);

  try {
    const provider = getLinkedInProvider();
    const [profile, proxyMeta] = await Promise.all([
      provider.getPersonByUrl(url),
      buildLinkedInMeta(),
    ]);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...profile,
      meta: {
        proxy: proxyMeta,
        provider: provider.providerName,
        mock: provider.isMock,
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn person enrichment failed', message: err?.message || String(err) }, 502);
  }
});

serviceRouter.get('/linkedin/company', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/linkedin/company', 'LinkedIn company enrichment by company URL', LINKEDIN_COMPANY_PRICE_USDC, walletAddress, {
      input: { url: 'string (required) — linkedin.com/company/name' },
      output: { id: 'string', name: 'string', industry: 'string', employee_count: 'string', job_openings: 'number', meta: '{ proxy, provider, mock }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_COMPANY_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = checkLinkedInRateLimit(clientIp);
  if (!allowed.allowed) {
    c.header('Retry-After', String(allowed.retryAfter || 60));
    return c.json({ error: 'LinkedIn rate limit exceeded for this client', retryAfter: allowed.retryAfter || 60 }, 429);
  }

  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing required parameter: url', example: '/api/linkedin/company?url=linkedin.com/company/openai' }, 400);

  try {
    const provider = getLinkedInProvider();
    const [company, proxyMeta] = await Promise.all([
      provider.getCompanyByUrl(url),
      buildLinkedInMeta(),
    ]);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...company,
      meta: {
        proxy: proxyMeta,
        provider: provider.providerName,
        mock: provider.isMock,
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn company enrichment failed', message: err?.message || String(err) }, 502);
  }
});

serviceRouter.get('/linkedin/search/people', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/linkedin/search/people', 'LinkedIn people search by title + location + industry', LINKEDIN_SEARCH_PRICE_USDC, walletAddress, {
      input: {
        title: 'string (required) — e.g. CTO',
        location: 'string (optional, default: United States)',
        industry: 'string (optional, default: SaaS)',
        limit: 'number (optional, default: 10, max: 10)',
      },
      output: { query: 'object', results: 'LinkedInPersonProfile[]', meta: '{ proxy, provider, mock }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_SEARCH_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = checkLinkedInRateLimit(clientIp);
  if (!allowed.allowed) {
    c.header('Retry-After', String(allowed.retryAfter || 60));
    return c.json({ error: 'LinkedIn rate limit exceeded for this client', retryAfter: allowed.retryAfter || 60 }, 429);
  }

  const title = c.req.query('title');
  const location = c.req.query('location') || 'United States';
  const industry = c.req.query('industry') || 'SaaS';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 10);

  if (!title) return c.json({ error: 'Missing required parameter: title', example: '/api/linkedin/search/people?title=CTO&location=San+Francisco&industry=SaaS' }, 400);

  try {
    const provider = getLinkedInProvider();
    const [searchResult, proxyMeta] = await Promise.all([
      provider.searchPeople({ title, location, industry, limit }),
      buildLinkedInMeta(),
    ]);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...searchResult,
      meta: {
        proxy: proxyMeta,
        provider: provider.providerName,
        mock: provider.isMock,
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn people search failed', message: err?.message || String(err) }, 502);
  }
});

serviceRouter.get('/linkedin/company/:id/employees', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/linkedin/company/:id/employees', 'LinkedIn employee lookup by company and title', LINKEDIN_SEARCH_PRICE_USDC, walletAddress, {
      input: {
        id: 'string (required) — LinkedIn company slug in URL path',
        title: 'string (optional, default: engineer)',
        limit: 'number (optional, default: 10, max: 25)',
      },
      output: { company_id: 'string', title: 'string', total: 'number', employees: 'LinkedInPersonProfile[]', meta: '{ proxy, provider, mock }' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, LINKEDIN_SEARCH_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = checkLinkedInRateLimit(clientIp);
  if (!allowed.allowed) {
    c.header('Retry-After', String(allowed.retryAfter || 60));
    return c.json({ error: 'LinkedIn rate limit exceeded for this client', retryAfter: allowed.retryAfter || 60 }, 429);
  }

  const companyId = c.req.param('id');
  const title = c.req.query('title') || 'engineer';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 25);

  if (!companyId) return c.json({ error: 'Missing company id in path', example: '/api/linkedin/company/openai/employees?title=engineer' }, 400);

  try {
    const provider = getLinkedInProvider();
    const [employeesResult, proxyMeta] = await Promise.all([
      provider.getCompanyEmployees(companyId, title, limit),
      buildLinkedInMeta(),
    ]);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...employeesResult,
      meta: {
        proxy: proxyMeta,
        provider: provider.providerName,
        mock: provider.isMock,
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'LinkedIn employee lookup failed', message: err?.message || String(err) }, 502);
  }
});
