/**
 * Marketplace Service — Server Entry Point
 * ─────────────────────────────────────────
 * Mounts: /api/*
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serviceRouter } from './service';

const app = new Hono();
const SERVER_START = Date.now();

// ─── MIDDLEWARE ──────────────────────────────────────

app.use('*', logger());

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Payment-Signature', 'X-Payment-Signature', 'X-Payment-Network'],
  exposeHeaders: ['X-Payment-Settled', 'X-Payment-TxHash', 'Retry-After'],
}));

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
});

// Rate limiting (in-memory, per IP, resets every minute)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '60'); // requests per minute

app.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
    }
  }

  await next();
});

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 300_000);

// ─── ROUTES ─────────────────────────────────────────

app.get('/health', (c) => {
  const uptimeMs = Date.now() - SERVER_START;
  const hours = Math.floor(uptimeMs / 3_600_000);
  const minutes = Math.floor((uptimeMs % 3_600_000) / 60_000);

  const proxyConfigured = !!(process.env.PROXY_HOST && process.env.PROXY_HTTP_PORT && process.env.PROXY_USER && process.env.PROXY_PASS);
  const walletConfigured = !!process.env.WALLET_ADDRESS;

  return c.json({
    status: 'healthy',
    service: process.env.SERVICE_NAME || 'marketplace-service',
    version: '1.0.0',
    uptime: `${hours}h ${minutes}m`,
    timestamp: new Date().toISOString(),
    checks: {
      proxy: proxyConfigured ? 'ok' : 'not_configured',
      target: 'ok',
      payment: walletConfigured ? 'configured' : 'not_configured',
    },
    endpoints: [
      '/api/run', '/api/details',
      '/api/jobs',
      '/api/research', '/api/trending',
      '/api/reviews/search', '/api/reviews/:place_id', '/api/reviews/summary/:place_id', '/api/business/:place_id',
      '/api/reddit/search', '/api/reddit/trending', '/api/reddit/subreddit/:name/top', '/api/reddit/thread/:id/comments',
    ],
  });
});

app.get('/', (c) => c.json({
  name: process.env.SERVICE_NAME || 'marketplace-service-hub',
  description: process.env.SERVICE_DESCRIPTION || 'AI agent intelligence services powered by real 4G/5G mobile proxies.',
  version: '1.0.0',
  endpoints: [
    { method: 'GET', path: '/api/run', description: 'Google Maps Lead Generator — search businesses by category + location', price: '0.005 USDC' },
    { method: 'GET', path: '/api/details', description: 'Google Maps Place Details — detailed business info by Place ID', price: '0.005 USDC' },
    { method: 'GET', path: '/api/jobs', description: 'Get job listings (Indeed/LinkedIn) with salary + date + proxy metadata' },
    { method: 'GET', path: '/api/reviews/search', description: 'Search businesses by query + location', price: '0.01 USDC' },
    { method: 'GET', path: '/api/reviews/:place_id', description: 'Fetch Google reviews by Place ID', price: '0.02 USDC' },
    { method: 'GET', path: '/api/business/:place_id', description: 'Get business details + review summary', price: '0.01 USDC' },
    { method: 'GET', path: '/api/reviews/summary/:place_id', description: 'Get review summary stats', price: '0.005 USDC' },
    { method: 'GET', path: '/api/reddit/search', description: 'Search Reddit posts by keyword/subreddit', price: '0.005 USDC' },
    { method: 'GET', path: '/api/reddit/trending', description: 'Get trending Reddit posts', price: '0.005 USDC' },
    { method: 'GET', path: '/api/reddit/subreddit/:name/top', description: 'Get top posts from a subreddit', price: '0.005 USDC' },
    { method: 'GET', path: '/api/reddit/thread/:id/comments', description: 'Get full thread with comments', price: '0.01 USDC' },
  ],
  pricing: {
    amount: process.env.PRICE_USDC || '0.005',
    currency: 'USDC',
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv',
        asset: 'USDC',
        assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        settlementTime: '~400ms',
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: '0xF8cD900794245fc36CBE65be9afc23CDF5103042',
        asset: 'USDC',
        assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        settlementTime: '~2s',
      },
    ],
  },
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G IPs)',
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    skillFile: 'https://agents.proxies.sx/marketplace/skill.md',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({ error: 'Not found', endpoints: [
  '/', '/health',
  '/api/jobs',
  '/api/reviews/search', '/api/reviews/:place_id', '/api/business/:place_id', '/api/reviews/summary/:place_id',
  '/api/reddit/search', '/api/reddit/trending', '/api/reddit/subreddit/:name/top', '/api/reddit/thread/:id/comments',
] }, 404));

app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  port: parseInt(process.env.PORT || '3000'),
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
