/**
 * GET /api/trending
 * ─────────────────
 * Returns currently trending topics across requested platforms.
 *
 * Price: $0.10 USDC (single-tier, lightweight endpoint)
 *
 * Query params:
 *   country  - ISO country code (default: US)
 *   platforms - comma-separated: reddit,web (default: reddit,web)
 *   limit    - max topics per platform (default: 20, max: 50)
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import { getRedditTrending } from '../scrapers/reddit';
import { getTrendingWeb } from '../scrapers/web';
import type { TrendingResponse, TrendingItem } from '../types/index';

// ─── CONSTANTS ──────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';
const PRICE_USDC = 0.10;

const DESCRIPTION =
  'Trending Topics API: fetch what\'s trending right now on Reddit and/or the web. ' +
  'Returns engagement-ranked topics with source URLs.';

const OUTPUT_SCHEMA = {
  input: {
    country: 'string (optional, default: "US") — ISO country code for web trends',
    platforms: 'string (optional, default: "reddit,web") — comma-separated platform list',
    limit: 'number (optional, default: 20, max: 50) — topics per platform',
  },
  output: {
    country: 'string',
    platforms: 'string[]',
    trending: 'TrendingItem[] — { topic, platform, engagement, traffic?, url? }',
    generated_at: 'string (ISO 8601)',
    meta: '{ proxy: { ip, country, type } }',
  },
};

// ─── ROUTER ─────────────────────────────────────────

export const trendingRouter = new Hono();

trendingRouter.get('/', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ─── Payment gate ────────────────────────────────

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/trending', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  // ─── Parse query params ──────────────────────────

  const country = (c.req.query('country') ?? 'US').toUpperCase().slice(0, 2);
  const platformParam = c.req.query('platforms') ?? 'reddit,web';
  const requestedPlatforms = platformParam.split(',').map((p) => p.trim().toLowerCase());
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20') || 20, 1), 50);

  // ─── Fetch trending from each platform ───────────

  const proxyConfig = getProxy();
  let proxyIp: string | null = null;

  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(5_000),
      // @ts-ignore - Bun proxy support
      proxy: proxyConfig.url,
    });
    if (ipRes.ok) {
      const ipData = await ipRes.json() as { ip?: string };
      proxyIp = typeof ipData?.ip === 'string' ? ipData.ip : null;
    }
  } catch {
    // non-fatal
  }

  const fetches = await Promise.allSettled([
    requestedPlatforms.includes('reddit')
      ? getRedditTrending(limit)
      : Promise.resolve([]),
    requestedPlatforms.includes('web')
      ? getTrendingWeb(country, limit)
      : Promise.resolve([]),
  ]);

  const redditTrending = fetches[0].status === 'fulfilled' ? fetches[0].value : [];
  const webTrending = fetches[1].status === 'fulfilled' ? fetches[1].value : [];

  for (const result of fetches) {
    if (result.status === 'rejected') {
      console.error('[trending] Fetch error:', result.reason);
    }
  }

  // ─── Normalize into unified trending list ────────

  const trendingItems: TrendingItem[] = [
    ...redditTrending.map((post): TrendingItem => ({
      topic: post.title,
      platform: 'reddit',
      engagement: post.score,
      url: post.permalink,
    })),
    ...webTrending.map((topic): TrendingItem => ({
      topic: topic.title,
      platform: 'web',
      engagement: null,
      traffic: topic.traffic,
      url: topic.articles[0]?.url,
    })),
  ];

  // Sort by engagement where available, then by appearance order
  trendingItems.sort((a, b) => {
    if (a.engagement !== null && b.engagement !== null) return b.engagement - a.engagement;
    if (a.engagement !== null) return -1;
    if (b.engagement !== null) return 1;
    return 0;
  });

  const platformsUsed = [
    redditTrending.length > 0 ? 'reddit' : null,
    webTrending.length > 0 ? 'web' : null,
  ].filter(Boolean) as string[];

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);

  const response: TrendingResponse = {
    country,
    platforms: platformsUsed,
    trending: trendingItems.slice(0, limit * requestedPlatforms.length),
    generated_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip: proxyIp,
        country: proxyConfig.country,
        type: 'mobile',
      },
    },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_USDC,
      settled: true,
    },
  };

  return c.json(response);
});
