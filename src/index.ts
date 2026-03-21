/**
 * Amazon Product & BSR Tracker — Server Entry Point
 * ───────────────────────────────────────────────────
 * Bounty #72 — Proxies.sx marketplace
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
  service: 'amazon-product-bsr-tracker',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  endpoints: [
    '/api/amazon/product/:asin',
    '/api/amazon/search',
    '/api/amazon/bestsellers',
    '/api/amazon/reviews/:asin',
  ],
  marketplaces: ['US', 'UK', 'DE', 'FR', 'IT', 'ES', 'CA', 'JP'],
}));

app.get('/', (c) => c.json({
  name: 'amazon-product-bsr-tracker',
  description: 'Amazon Product & BSR Tracker API — real-time product data, BSR rankings, reviews, and search via Proxies.sx 4G/5G mobile proxies. Gated by x402 USDC micropayments.',
  version: '1.0.0',
  bounty: 'https://github.com/bolivian-peru/marketplace-service-template/issues/72',
  endpoints: [
    {
      method: 'GET',
      path: '/api/amazon/product/:asin',
      description: 'Real-time Amazon product data: price, BSR, rating, reviews count, buy box winner, availability, images, brand, features',
      price: `${0.005} USDC`,
      example: '/api/amazon/product/B0BSHF7WHW?marketplace=US',
    },
    {
      method: 'GET',
      path: '/api/amazon/search',
      description: 'Search Amazon products by keyword with optional category filter. Returns up to 20 results per page.',
      price: `${0.01} USDC`,
      example: '/api/amazon/search?query=wireless+headphones&category=electronics&marketplace=US',
    },
    {
      method: 'GET',
      path: '/api/amazon/bestsellers',
      description: 'Amazon Best Sellers list by category — ranked products with ASINs, prices, ratings.',
      price: `${0.01} USDC`,
      example: '/api/amazon/bestsellers?category=electronics&marketplace=US',
    },
    {
      method: 'GET',
      path: '/api/amazon/reviews/:asin',
      description: 'Product reviews with rating, date, verified purchase status, and helpful votes.',
      price: `${0.02} USDC`,
      example: '/api/amazon/reviews/B0BSHF7WHW?sort=recent&limit=10&marketplace=US',
    },
  ],
  supported_marketplaces: {
    US: 'amazon.com (USD)',
    UK: 'amazon.co.uk (GBP)',
    DE: 'amazon.de (EUR)',
    FR: 'amazon.fr (EUR)',
    IT: 'amazon.it (EUR)',
    ES: 'amazon.es (EUR)',
    CA: 'amazon.ca (CAD)',
    JP: 'amazon.co.jp (JPY)',
  },
  pricing: {
    product_lookup: '0.005 USDC',
    search_query: '0.01 USDC',
    bestsellers: '0.01 USDC',
    reviews: '0.02 USDC',
    currency: 'USDC',
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: process.env.WALLET_ADDRESS || 'SET_WALLET_ADDRESS_IN_ENV',
        asset: 'USDC',
        assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        settlementTime: '~400ms',
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: process.env.WALLET_ADDRESS_BASE || process.env.WALLET_ADDRESS || 'SET_WALLET_ADDRESS_IN_ENV',
        asset: 'USDC',
        assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        settlementTime: '~2s',
      },
    ],
  },
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G IPs) — highest Amazon trust score',
  why_mobile_proxies: 'Amazon uses ML-based anomaly detection that blocks datacenter/residential IPs. Mobile carrier IPs blend seamlessly with Amazon app traffic.',
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
    bounty: 'https://github.com/bolivian-peru/marketplace-service-template/issues/72',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({
  error: 'Not found',
  endpoints: [
    '/',
    '/health',
    '/api/amazon/product/:asin',
    '/api/amazon/search',
    '/api/amazon/bestsellers',
    '/api/amazon/reviews/:asin',
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
