/**
 * ┌─────────────────────────────────────────────────┐
 * │       Social Profile Intelligence API           │
 * │  Profile data from Twitter/X + Instagram       │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { lookupProfile } from './scrapers/social-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'social-profile-intelligence';
const PRICE_USDC = 0.003;
const DESCRIPTION = 'Given a social media handle, return structured profile data: followers, following, bio, engagement rate, verified status, recent posts. Supports Twitter/X and Instagram.';

const OUTPUT_SCHEMA = {
  input: {
    handle: 'string — Social media handle or URL (required)',
    sources: 'string — Comma-separated: "twitter,instagram" (default: both)',
  },
  output: {
    profiles: [{
      handle: 'string',
      displayName: 'string',
      bio: 'string | null',
      followers: 'number | null',
      following: 'number | null',
      posts: 'number | null',
      verified: 'boolean',
      profileImageUrl: 'string | null',
      profileUrl: 'string',
      engagementRate: 'number | null',
      recentPosts: '[{ text, date, likes, comments, shares, url }]',
      source: 'string — "twitter" or "instagram"',
    }],
    query: 'string',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const handle = c.req.query('handle');
  if (!handle) {
    return c.json({
      error: 'Missing required parameter: handle',
      example: '/api/run?handle=elonmusk&sources=twitter,instagram',
    }, 400);
  }

  const sources = c.req.query('sources')?.split(',').map(s => s.trim().toLowerCase()) || ['twitter', 'instagram'];

  try {
    const proxy = getProxy();
    const result = await lookupProfile(handle, sources);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Service execution failed', message: err.message }, 502);
  }
});
