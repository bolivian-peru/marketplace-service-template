/**
 * ┌─────────────────────────────────────────────────┐
 * │       Job Market Intelligence API               │
 * │  Aggregate job listings from Indeed + LinkedIn  │
 * └─────────────────────────────────────────────────┘
 *
 * Features:
 *  - Search by role, location, company
 *  - Multi-source: Indeed + LinkedIn
 *  - Structured data: title, company, salary, skills, work type
 *  - Mobile proxy for authentic results
 *  - x402 USDC payment gating
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchJobs, scrapeIndeed, scrapeLinkedIn } from './scrapers/job-scraper';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.003;  // $0.003 per query
const DESCRIPTION = 'Aggregate job listings from Indeed and LinkedIn. Returns structured data: title, company, location, salary range, posting date, required skills, remote/hybrid/onsite, applicant count. Search by role, location, and source.';

// ─── OUTPUT SCHEMA FOR AI AGENTS ──────────────────────
const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Job title/role to search (e.g., "software engineer", "data scientist") (required)',
    location: 'string — Location to search (e.g., "New York", "San Francisco, CA") (required)',
    page: 'number — Page number for pagination (default: 0)',
    sources: 'string — Comma-separated sources: "indeed,linkedin" (default: both)',
  },
  output: {
    jobs: [{
      title: 'string — Job title',
      company: 'string — Company name',
      location: 'string — Job location',
      salaryRange: 'string | null — Salary range (e.g., "$120,000–$180,000 USD/YEAR")',
      postingDate: 'string | null — ISO date when posted',
      description: 'string | null — Job description (truncated to 500 chars)',
      requiredSkills: 'string[] — Detected technical skills',
      workType: '"remote" | "hybrid" | "onsite" | "unknown"',
      applicantCount: 'string | null — Number of applicants',
      url: 'string — Direct link to job posting',
      source: 'string — "indeed" or "linkedin"',
    }],
    totalFound: 'number — Total jobs found across all sources',
    query: 'string — Search query used',
    location: 'string — Location searched',
    page: 'number — Current page',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── API ENDPOINT ─────────────────────────────────────

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
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // ── Step 3: Validate input ──
  const query = c.req.query('query');
  const location = c.req.query('location');
  const pageParam = c.req.query('page');
  const sourcesParam = c.req.query('sources');

  if (!query) {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a job title/role like ?query=software+engineer&location=New+York',
      example: '/api/run?query=data+scientist&location=San+Francisco&sources=indeed,linkedin',
    }, 400);
  }

  if (!location) {
    return c.json({
      error: 'Missing required parameter: location',
      hint: 'Provide a location like ?query=software+engineer&location=New+York',
      example: '/api/run?query=data+scientist&location=San+Francisco&sources=indeed,linkedin',
    }, 400);
  }

  const page = pageParam ? parseInt(pageParam) || 0 : 0;
  const sources = sourcesParam
    ? sourcesParam.split(',').map(s => s.trim().toLowerCase())
    : ['indeed', 'linkedin'];

  // Validate sources
  const validSources = ['indeed', 'linkedin'];
  const invalidSources = sources.filter(s => !validSources.includes(s));
  if (invalidSources.length > 0) {
    return c.json({
      error: `Invalid sources: ${invalidSources.join(', ')}`,
      hint: `Valid sources are: ${validSources.join(', ')}`,
    }, 400);
  }

  // ── Step 4: Execute scraping ──
  try {
    const proxy = getProxy();
    const result = await searchJobs(query, location, page, sources);

    // Set payment confirmation headers
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
      hint: 'The target sites may be temporarily blocking requests. Try again in a few minutes.',
    }, 502);
  }
});
