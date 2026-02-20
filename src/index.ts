/**
 * Marketplace Service — Server Entry Point (Multi-Service)
 * ────────────────────────────────────────────────────────
 * Mounts: /api/*
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serviceRouter } from './service';

const app = new Hono();

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

app.get('/health', async (c) => {
  const diagnostics: Record<string, any> = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    proxy: { status: 'unknown' },
    targets: { polymarket: 'unknown', kalshi: 'unknown' }
  };

  try {
    const proxyRes = await fetch('https://api.ipify.org?format=json', {
      // @ts-ignore
      proxy: `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_HOST}:${process.env.PROXY_HTTP_PORT}`
    });
    diagnostics.proxy.status = proxyRes.ok ? 'connected' : 'failed';
  } catch {
    diagnostics.proxy.status = 'error';
    diagnostics.status = 'degraded';
  }

  try {
    const polyRes = await fetch('https://gamma-api.polymarket.com/health');
    diagnostics.targets.polymarket = polyRes.ok ? 'up' : 'down';
  } catch { diagnostics.targets.polymarket = 'error'; }

  return c.json({
    ...diagnostics,
    version: '1.2.1',
    services: ['job-market-intelligence', 'google-reviews', 'prediction-market-aggregator', 'google-maps-leads', 'trend-intelligence'],
    endpoints: [
      '/api/jobs',
      '/api/reviews/search',
      '/api/reviews/:place_id',
      '/api/reviews/summary/:place_id',
      '/api/business/:place_id',
      '/api/predictions',
      '/api/research',
      '/api/trending',
      '/api/run',
      '/api/details'
    ],
  });
});

app.get('/', (c) => c.json({
  name: 'Multi-Service Hub (Proxies.sx Marketplace)',
  description: 'Aggregated intelligence services powered by mobile proxies.',
  version: '1.2.1',
  endpoints: [
    {
      path: '/api/run',
      description: 'Google Maps Lead Generator — search businesses by category + location',
      schema: { input: 'query (req), location (req), limit (opt)', output: 'BusinessInfo[]' }
    },
    {
      path: '/api/details',
      description: 'Google Maps Place Details — detailed business info by Place ID'
    },
    {
      path: '/api/jobs',
      description: 'Job results from Indeed/LinkedIn',
      schema: {
        input: 'query (req), location (opt), limit (opt)',
        output: 'JobListing[]: { title, company, location, salary, date, link, remote, platform }'
      }
    },
    {
      path: '/api/predictions',
      description: 'Prediction market odds + social sentiment',
      schema: {
        input: 'type: signal|arbitrage|sentiment, market: slug, topic: string',
        output: 'PredictionData: { odds: { polymarket, kalshi, metaculus }, sentiment: { reddit, twitter }, signals: { arbitrage, divergence } }'
      }
    },
    { path: '/api/research', description: 'Trend Intelligence Research' },
    { path: '/api/trending', description: 'Cross-platform trending topics' },
    { path: '/api/reviews/search', description: 'Search businesses by query + location' },
    { path: '/api/reviews/:place_id', description: 'Fetch Google reviews by Place ID' },
    { path: '/api/business/:place_id', description: 'Get business details + review summary' },
  ],
  pricing: {
    jobs: '0.005 USDC',
    reviews: '0.01-0.02 USDC',
    prediction: '0.05 USDC',
    maps: '0.005 USDC',
    trends: '0.01 USDC',
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
  infrastructure: 'Proxies.sx mobile proxies',
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({ error: 'Not found', endpoints: ['/', '/health', '/api/jobs', '/api/predictions', '/api/run', '/api/details', '/api/research', '/api/trending', '/api/reviews/search'] }, 404));

app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  port: parseInt(process.env.PORT || '3000'),
  hostname: '0.0.0.0',
  idleTimeout: 30, // Increase timeout to 30s for slow mobile proxies
  fetch: app.fetch,
};
