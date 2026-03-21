/**
 * TikTok Trend Intelligence — Server Entry Point
 * ───────────────────────────────────────────────
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

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 300_000);

// ─── ROUTES ─────────────────────────────────────────

app.get('/health', (c) => c.json({
  status: 'healthy',
  service: 'tiktok-trend-intelligence',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/run'],
  supportedTypes: ['trending', 'hashtag', 'creator', 'sound'],
  supportedCountries: ['US', 'DE', 'FR', 'ES', 'GB', 'PL'],
}));

app.get('/', (c) => c.json({
  name: 'tiktok-trend-intelligence',
  description: 'Real-time TikTok trend intelligence: trending videos, hashtags, sounds, and creator profiles — routed through real 4G/5G mobile carrier IPs for maximum reliability.',
  version: '1.0.0',
  endpoints: [
    {
      method: 'GET',
      path: '/api/run?type=trending&country=US',
      description: 'Trending videos, hashtags, and sounds for a country',
      price: '0.02 USDC',
    },
    {
      method: 'GET',
      path: '/api/run?type=hashtag&tag=ai&country=US',
      description: 'Hashtag analytics: view count, growth velocity, top videos',
      price: '0.02 USDC',
    },
    {
      method: 'GET',
      path: '/api/run?type=creator&username=@charlidamelio',
      description: 'Creator profile: followers, engagement rate, recent posts',
      price: '0.02 USDC',
    },
    {
      method: 'GET',
      path: '/api/run?type=sound&id=12345',
      description: 'Sound/audio trend: usage count, trending velocity, top videos',
      price: '0.02 USDC',
    },
  ],
  pricing: {
    amount: '0.02',
    currency: 'USDC',
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: process.env.WALLET_ADDRESS || 'YOUR_SOLANA_WALLET',
        asset: 'USDC',
        assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        settlementTime: '~400ms',
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: process.env.WALLET_ADDRESS_BASE || 'YOUR_BASE_WALLET',
        asset: 'USDC',
        assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        settlementTime: '~2s',
      },
    ],
  },
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G IPs — T-Mobile US, Vodafone DE, Orange FR, Movistar ES, EE GB, Play PL)',
  countries: {
    US: 'T-Mobile (United States)',
    DE: 'Vodafone (Germany)',
    FR: 'Orange (France)',
    ES: 'Movistar (Spain)',
    GB: 'EE (United Kingdom)',
    PL: 'Play (Poland)',
  },
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({
  error: 'Not found',
  endpoints: ['/', '/health', '/api/run'],
  examples: [
    '/api/run?type=trending&country=US',
    '/api/run?type=hashtag&tag=ai&country=US',
    '/api/run?type=creator&username=@charlidamelio',
    '/api/run?type=sound&id=12345',
  ],
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
