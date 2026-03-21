/**
 * Trend Intelligence API — Server Entry Point
 * ─────────────────────────────────────────────
 * Cross-platform research: Reddit + X/Twitter + YouTube → structured intelligence
 * x402 USDC payment gated | Mobile proxy powered
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
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '60');

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

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 300_000);

// ─── ROUTES ─────────────────────────────────────────

app.get('/health', (c) => c.json({
  status: 'healthy',
  service: 'trend-intelligence-api',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  endpoints: [
    'POST /api/research',
    'GET /api/trending',
  ],
}));

app.get('/', (c) => c.json({
  name: 'trend-intelligence-api',
  description: 'Cross-platform trend intelligence API. Scrapes Reddit, X/Twitter, and YouTube simultaneously for any topic. Synthesizes structured intelligence reports with pattern detection, engagement-weighted scoring, and sentiment analysis. x402-gated, mobile-proxy-powered.',
  version: '1.0.0',
  endpoints: [
    {
      method: 'POST',
      path: '/api/research',
      description: 'Full cross-platform intelligence report — pattern detection, sentiment analysis, top discussions, emerging topics',
      pricing: {
        single_platform: '0.10 USDC',
        two_platforms: '0.50 USDC',
        all_platforms: '1.00 USDC',
      },
      example_request: {
        topic: 'AI coding assistants',
        platforms: ['reddit', 'x', 'youtube'],
        days: 30,
        country: 'US',
      },
    },
    {
      method: 'GET',
      path: '/api/trending',
      description: 'Trending topics aggregated across Reddit, X/Twitter, YouTube',
      pricing: '0.10 USDC',
      params: {
        country: 'string (optional, default: US)',
        platforms: 'string (optional, default: reddit,x,youtube)',
      },
    },
  ],
  pricing: {
    currency: 'USDC',
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv',
        asset: 'USDC',
        assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        settlementTime: '~400ms',
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: process.env.WALLET_ADDRESS_BASE || '0xF8cD900794245fc36CBE65be9afc23CDF5103042',
        asset: 'USDC',
        assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        settlementTime: '~2s',
      },
    ],
  },
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G IPs) — bypasses Reddit/X/YouTube rate limits',
  signal_strength: {
    established: '3+ platforms, high engagement (>1000)',
    reinforced: '2+ platforms, moderate engagement (>200)',
    emerging: 'Notable spike on 1 platform',
  },
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
    bounty: 'https://github.com/bolivian-peru/marketplace-service-template/issues/70',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({
  error: 'Not found',
  endpoints: ['/', '/health', 'POST /api/research', 'GET /api/trending'],
}, 404));

app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  port: parseInt(process.env.PORT || '3000'),
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
