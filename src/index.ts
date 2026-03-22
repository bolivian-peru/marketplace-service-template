/**
 * X/Twitter Real-Time Search API — Server Entry Point
 * ────────────────────────────────────────────────────
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

// Rate limiting (in-memory, per IP)
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
  service: 'x-intelligence-search',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  endpoints: [
    'GET /api/x/search?query=&sort=latest&limit=20',
    'GET /api/x/trending?country=US',
    'GET /api/x/user/:handle',
    'GET /api/x/user/:handle/tweets?limit=20',
    'GET /api/x/thread/:tweet_id',
  ],
}));

app.get('/', (c) => c.json({
  name: 'x-intelligence-search',
  description: 'X/Twitter Real-Time Search API powered by Proxies.sx mobile proxies. Search tweets, get trending topics, extract user profiles and conversation threads — at micropayment prices.',
  version: '1.0.0',
  endpoints: [
    { method: 'GET', path: '/api/x/search', description: 'Search tweets by keyword, hashtag, or from:user', price: '0.01 USDC' },
    { method: 'GET', path: '/api/x/trending', description: 'Get trending topics by country (US, GB, CA, AU, IN, DE, FR, JP, ...)', price: '0.005 USDC' },
    { method: 'GET', path: '/api/x/user/:handle', description: 'Extract user profile with follower counts and verification status', price: '0.01 USDC' },
    { method: 'GET', path: '/api/x/user/:handle/tweets', description: 'Get recent tweets from a user', price: '0.01 USDC' },
    { method: 'GET', path: '/api/x/thread/:tweet_id', description: 'Extract full conversation thread from a tweet ID', price: '0.02 USDC' },
  ],
  pricing: {
    currency: 'USDC',
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: process.env.WALLET_ADDRESS,
        asset: 'USDC',
        assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        settlementTime: '~400ms',
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: process.env.WALLET_ADDRESS_BASE || process.env.WALLET_ADDRESS,
        asset: 'USDC',
        assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        settlementTime: '~2s',
      },
    ],
  },
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G carrier IPs)',
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
    bounty: 'https://github.com/bolivian-peru/marketplace-service-template/issues/73',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({
  error: 'Not found',
  endpoints: ['/health', '/api/x/search', '/api/x/trending', '/api/x/user/:handle', '/api/x/thread/:tweet_id'],
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
