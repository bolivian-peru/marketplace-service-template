import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serviceRouter } from './service';

const app = new Hono();

app.use('*', logger());

app.use('*', cors({
  allowHeaders: ['Content-Type', 'Payment-Signature', 'X-Payment-Signature', 'X-Payment-Network'],
  exposeHeaders: ['X-Payment-Settled', 'X-Payment-TxHash', 'Retry-After'],
}));

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
});

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

app.get('/health', (c) => c.json({
  status: 'healthy',
  service: process.env.SERVICE_NAME || 'my-service',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

app.get('/', (c) => c.json({
  name: process.env.SERVICE_NAME || 'prediction-market-aggregator',
  description: process.env.SERVICE_DESCRIPTION || 'Prediction market signal aggregator combining odds with sentiment analysis',
  version: '1.0.0',
  endpoints: [
    { method: 'GET', path: '/api/run', description: 'Get trading signals, arbitrage opportunities, sentiment analysis, or trending markets' },
    { method: 'GET', path: '/health', description: 'Health check endpoint' },
  ],
  pricing: {
    amount: process.env.PRICE_USDC || '0.005',
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
  infrastructure: 'Proxies.sx mobile proxies (real 4G/5G IPs)',
  links: {
    marketplace: 'https://agents.proxies.sx/marketplace/',
    skillFile: 'https://agents.proxies.sx/marketplace/skill.md',
    github: 'https://github.com/bolivian-peru/marketplace-service-template',
  },
}));

app.route('/api', serviceRouter);

app.notFound((c) => c.json({ error: 'Not found', endpoints: ['/', '/health', '/api/run'] }, 404));

app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  port: parseInt(process.env.PORT || '3000'),
  fetch: app.fetch,
};