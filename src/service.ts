/**
 * Service Router — LinkedIn People & Company Enrichment API (Bounty #77)
 *
 * Endpoints:
 *   GET /api/linkedin/person
 *   GET /api/linkedin/company
 *   GET /api/linkedin/search/people
 *   GET /api/linkedin/company/:id/employees
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getPersonProfile, getCompanyProfile, searchPeople, getCompanyEmployees } from './scrapers/linkedin-scraper';

export const serviceRouter = new Hono();

const WALLET_ADDRESS = '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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

// ─── GET /api/linkedin/person ───────────────────────

serviceRouter.get('/linkedin/person', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/linkedin/person',
      'Extract LinkedIn person profile: name, headline, company, experience, education, skills, connections.',
      0.03,
      WALLET_ADDRESS,
      {
        input: { url: 'string (required) — LinkedIn profile URL (e.g., linkedin.com/in/username)' },
        output: {
          profile: '{ name, headline, location, current_company, previous_companies[], education[], skills[], connections, profile_url }',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.03);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing required parameter: url', example: '/api/linkedin/person?url=linkedin.com/in/username' }, 400);

  const profileUrl = url.startsWith('http') ? url : `https://${url}`;

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const profile = await getPersonProfile(profileUrl, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      profile,
      meta: { proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Profile fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/linkedin/company ──────────────────────

serviceRouter.get('/linkedin/company', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/linkedin/company',
      'Extract LinkedIn company profile: description, employee count, industry, headquarters, website, specialties.',
      0.05,
      WALLET_ADDRESS,
      {
        input: { url: 'string (required) — LinkedIn company URL (e.g., linkedin.com/company/name)' },
        output: {
          company: '{ name, description, industry, employee_count, headquarters, website, specialties[], founded }',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.05);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing required parameter: url', example: '/api/linkedin/company?url=linkedin.com/company/google' }, 400);

  const companyUrl = url.startsWith('http') ? url : `https://${url}`;

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const company = await getCompanyProfile(companyUrl, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      company,
      meta: { proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Company fetch failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/linkedin/search/people ────────────────

serviceRouter.get('/linkedin/search/people', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/linkedin/search/people',
      'Search LinkedIn people by title, location, and industry. Returns up to 20 results.',
      0.10,
      WALLET_ADDRESS,
      {
        input: {
          title: 'string (optional) — job title (e.g., "CTO")',
          location: 'string (optional) — location (e.g., "San Francisco")',
          industry: 'string (optional) — industry (e.g., "SaaS")',
        },
        output: {
          results: '{ name, headline, location, profile_url }[]',
          total_results: 'number',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.10);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const title = c.req.query('title') || '';
  const location = c.req.query('location') || '';
  const industry = c.req.query('industry') || '';

  if (!title && !location && !industry) {
    return c.json({ error: 'At least one search parameter required: title, location, or industry' }, 400);
  }

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await searchPeople(title, location, industry, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/linkedin/company/:id/employees ────────

serviceRouter.get('/linkedin/company/:id/employees', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/linkedin/company/:id/employees',
      'List employees at a company with optional title filter.',
      0.10,
      WALLET_ADDRESS,
      {
        input: {
          id: 'string (required, in URL path) — company name or identifier',
          title: 'string (optional) — filter by job title (e.g., "engineer")',
        },
        output: {
          results: '{ name, headline, location, profile_url }[]',
          total_results: 'number',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.10);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const companyId = c.req.param('id');
  if (!companyId) return c.json({ error: 'Missing company ID in URL path' }, 400);
  const title = c.req.query('title') || '';

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getCompanyEmployees(companyId, title, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: { proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Employee search failed', message: err?.message || String(err) }, 502);
  }
});

// ─── Alias: /api/linkedin/profile/:handle ───────────────────────────────────
serviceRouter.get('/linkedin/profile/:handle', (c) => {
  return c.redirect(`/api/linkedin/person?url=linkedin.com/in/${c.req.param('handle')}`);
});
