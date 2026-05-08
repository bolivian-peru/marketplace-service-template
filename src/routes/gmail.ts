/**
 * Gmail API Integration Service
 * ─────────────────────────────────────────
 * Provides email search functionality via Gmail API:
 * - Search emails by query (from, to, subject, date range)
 * - Returns email metadata (sender, subject, date, snippet)
 * - Pagination support
 * - OAuth2 authentication with refresh token handling
 */

import { Hono, type Context } from 'hono';
import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getGmailClient, searchEmails, getEmailMetadata, type GmailSearchResult } from '../scrapers/gmail-scraper';

export const gmailRouter = new Hono();

// ─── PRICING & CONFIG ─────────────────────────────────

const PRICE_USDC = 0.01;
const DESCRIPTION = 'Gmail API email search: search by from/to/subject/date, returns metadata (sender, subject, date, snippet) with pagination.';
const OUTPUT_SCHEMA = {
  input: {
    query: 'string — Gmail search query (e.g., "from:example@gmail.com subject:invoice")',
    maxResults: 'number — Max emails to return (default: 10, max: 50)',
    pageToken: 'string — Pagination token for next page (optional)',
    includeBody: 'boolean — Include email snippet/body preview (default: false)',
  },
  output: {
    emails: [{
      id: 'string — Gmail message ID',
      threadId: 'string — Gmail thread ID',
      subject: 'string | null',
      from: 'string | null',
      to: 'string | null',
      date: 'string — ISO date',
      snippet: 'string — Email preview snippet',
      labelIds: 'string[] — Gmail labels (INBOX, SENT, etc.)',
    }],
    total: 'number — Total matching emails',
    nextPageToken: 'string | null — For pagination',
    resultSizeEstimate: 'number — Gmail\'s estimate of total matches',
    query: 'string — Original search query',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── INTERNAL HELPER: Get emails with payment check ─────────────────────────

async function handleGmailSearch(
  c: Context,
  params: {
    query?: string;
    maxResults?: string;
    pageToken?: string;
    includeBody?: string;
  }
) {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/gmail/search', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
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
  if (!checkGmailRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded. Max 20 Gmail requests/min.', retryAfter: 60 }, 429);
  }

  // ─── Input validation ───
  const query = params.query;
  if (!query || query.trim() === '') {
    return c.json({
      error: 'Missing required parameter: query',
      hint: 'Provide a Gmail search query like ?query=from:example@gmail.com',
      examples: [
        '/api/gmail/search?query=from:boss@company.com',
        '/api/gmail/search?query=subject:invoice after:2024/01/01',
        '/api/gmail/search?query=to:newsletter@spam.com before:2024/12/31',
      ],
      gmailQueryOperators: {
        from: 'Search by sender',
        to: 'Search by recipient',
        subject: 'Search in subject line',
        after: 'Emails after date (YYYY/MM/DD)',
        before: 'Emails before date (YYYY/MM/DD)',
        has: 'Has attachment, or specific words',
        filename: 'Attachment filename',
        'list:': 'Mailing list',
      },
    }, 400);
  }

  let maxResults = 10;
  if (params.maxResults) {
    const parsed = parseInt(params.maxResults);
    if (isNaN(parsed) || parsed < 1) {
      return c.json({ error: 'Invalid maxResults parameter: must be a positive integer' }, 400);
    }
    maxResults = Math.min(parsed, 50); // Cap at 50
  }

  const includeBody = params.includeBody === 'true' || params.includeBody === '1';

  try {
    const proxy = getProxy();
    const result = await searchEmails(query.trim(), maxResults, params.pageToken, includeBody);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      query: query.trim(),
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[GMAIL] Search failed: ${err.message}`);
    
    // Handle specific Gmail API errors
    if (err.message.includes('Invalid query') || err.message.includes('malformed')) {
      return c.json({
        error: 'Invalid Gmail query syntax',
        message: err.message,
        hint: 'Check your search operators. Example: "from:user@example.com subject:meeting"',
      }, 400);
    }
    
    if (err.message.includes('insufficient')) {
      return c.json({
        error: 'Gmail API authentication failed',
        message: 'Access token expired or invalid. Please re-authorize.',
        hint: 'Ensure GOOGLE_REFRESH_TOKEN is valid in environment.',
      }, 401);
    }

    return c.json({
      error: 'Gmail API request failed',
      message: err.message,
      hint: 'Gmail API may be temporarily unavailable. Try again.',
    }, 502);
  }
}

// ─── INTERNAL HELPER: Get single email with payment check ───────────────────

async function handleGmailGetEmail(
  c: Context,
  messageId: string,
  params: { format?: string }
) {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(`/api/gmail/message/${messageId}`, 'Get full email metadata by message ID', PRICE_USDC, walletAddress, {
        input: { messageId: 'string — Gmail message ID (required)' },
        output: { email: 'EmailMetadata — Full email details' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkGmailRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded. Max 20 Gmail requests/min.', retryAfter: 60 }, 429);
  }

  if (!messageId || messageId.trim() === '') {
    return c.json({ error: 'Missing required parameter: messageId' }, 400);
  }

  try {
    const proxy = getProxy();
    const format = params.format || 'metadata';
    const email = await getEmailMetadata(messageId.trim(), format as any);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      email,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[GMAIL] Get email failed: ${err.message}`);
    return c.json({
      error: 'Gmail API request failed',
      message: err.message,
    }, 502);
  }
}

// ─── RATE LIMITING ──────────────────────────────────────

const gmailRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkGmailRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = gmailRateLimits.get(ip);

  if (!entry || now > entry.resetAt) {
    gmailRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= 20) {
    return false;
  }

  entry.count++;
  return true;
}

// ─── ROUTES ─────────────────────────────────────────────

// GET /api/gmail/search — Search emails
gmailRouter.get('/search', async (c) => {
  return handleGmailSearch(c, {
    query: c.req.query('query'),
    maxResults: c.req.query('maxResults'),
    pageToken: c.req.query('pageToken'),
    includeBody: c.req.query('includeBody'),
  });
});

// GET /api/gmail/message/:id — Get single email
gmailRouter.get('/message/:id', async (c) => {
  const messageId = c.req.param('id');
  return handleGmailGetEmail(c, messageId, {
    format: c.req.query('format'),
  });
});

// GET /api/gmail/labels — Get available labels
gmailRouter.get('/labels', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/gmail/labels', 'Get list of Gmail labels', PRICE_USDC, walletAddress, {
        input: {},
        output: { labels: 'string[] — Available Gmail labels' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkGmailRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded.', retryAfter: 60 }, 429);
  }

  try {
    const { getLabels } = await import('../scrapers/gmail-scraper');
    const labels = await getLabels();

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      labels,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Gmail API request failed', message: err.message }, 502);
  }
});

// GET /api/gmail/health — Check Gmail API connection status
gmailRouter.get('/health', async (c) => {
  try {
    const gmailClient = getGmailClient();
    const isConfigured = gmailClient !== null;
    
    return c.json({
      status: isConfigured ? 'configured' : 'not_configured',
      service: 'gmail-api',
      oauthConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN),
      proxyConfigured: !!(process.env.PROXY_HOST && process.env.PROXY_USER),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ status: 'error', message: err.message }, 500);
  }
});

export default gmailRouter;
