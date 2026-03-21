/**
 * Instagram Intelligence + AI Vision Analysis API
 * ─────────────────────────────────────────────────
 * Proxies.sx Marketplace — Bounty #71
 * $200 in $SX token
 *
 * Premium Instagram analytics combining mobile proxy scraping
 * with GPT-4o vision analysis for influencer intelligence.
 *
 * Comparable to HypeAuditor ($499/mo) at $0.15/analysis.
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
  service: 'instagram-intelligence-api',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  endpoints: [
    '/api/instagram/profile/:username',
    '/api/instagram/posts/:username',
    '/api/instagram/analyze/:username',
    '/api/instagram/analyze/:username/images',
    '/api/instagram/audit/:username',
    '/api/instagram/discover',
  ],
  ai_model: 'gpt-4o',
  proxy_infrastructure: 'Proxies.sx mobile proxies (4G/5G)',
}));

app.get('/', (c) => c.json({
  name: process.env.SERVICE_NAME || 'instagram-intelligence-api',
  description: process.env.SERVICE_DESCRIPTION || 'Premium Instagram analytics API: profile data, engagement metrics, and GPT-4o visual intelligence. Mobile proxy powered for 99.9% uptime. Competes with HypeAuditor at $0.15/analysis vs $499/month.',
  version: '1.0.0',
  endpoints: [
    {
      method: 'GET',
      path: '/api/instagram/profile/:username',
      description: 'Profile data: followers, bio, engagement rate, posting frequency',
      price: '0.01 USDC',
    },
    {
      method: 'GET',
      path: '/api/instagram/posts/:username',
      description: 'Recent posts with captions, likes, comments, hashtags',
      price: '0.02 USDC',
    },
    {
      method: 'GET',
      path: '/api/instagram/analyze/:username',
      description: 'PREMIUM: Full AI analysis — profile + GPT-4o vision (account type, content themes, sentiment, authenticity, brand recommendations)',
      price: '0.15 USDC',
    },
    {
      method: 'GET',
      path: '/api/instagram/analyze/:username/images',
      description: 'AI vision analysis of post images only (GPT-4o)',
      price: '0.08 USDC',
    },
    {
      method: 'GET',
      path: '/api/instagram/audit/:username',
      description: 'Fake follower + bot detection audit with authenticity score',
      price: '0.05 USDC',
    },
    {
      method: 'GET',
      path: '/api/instagram/discover',
      description: 'Batch analyze + filter accounts by niche, engagement, brand safety',
      price: '0.03 USDC',
    },
  ],
  pricing: {
    currency: 'USDC',
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: process.env.WALLET_ADDRESS || '',
        asset: 'USDC',
        assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        settlementTime: '~400ms',
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: process.env.WALLET_ADDRESS_BASE || process.env.WALLET_ADDRESS || '',
        asset: 'USDC',
        assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        settlementTime: '~2s',
      },
    ],
  },
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G carrier IPs)',
  ai_models: {
    vision: 'gpt-4o (OpenAI)',
    purpose: 'Content classification, sentiment, authenticity, account type detection',
  },
  market_comparison: {
    this_service: '$0.15 per full analysis',
    hypeauditor: '$199-499/month',
    modash: '$199-999/month',
    heepsy: '$49-269/month',
  },
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    github: 'https://github.com/bolivian-peru/marketplace-service-template/issues/71',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({
  error: 'Not found',
  endpoints: [
    '/',
    '/health',
    '/api/instagram/profile/:username',
    '/api/instagram/posts/:username',
    '/api/instagram/analyze/:username',
    '/api/instagram/analyze/:username/images',
    '/api/instagram/audit/:username',
    '/api/instagram/discover',
  ],
}, 404));

app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

const port = parseInt(process.env.PORT || '3000');
console.log(`🚀 Instagram Intelligence API running on port ${port}`);
console.log(`📊 Endpoints: /api/instagram/profile, /analyze, /audit, /discover`);
console.log(`🤖 AI Vision: GPT-4o (set OPENAI_API_KEY in .env)`);
console.log(`📱 Proxy: Proxies.sx mobile 4G/5G (set PROXY_* in .env)`);

export default {
  port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
