/**
 * GET /api/trending
 * Returns currently trending topics across requested platforms.
 *
 * Price: $0.10 USDC
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import { getRedditTrending } from '../scrapers/reddit';
import { getTrendingWeb } from '../scrapers/web';
import { getYouTubeTrending } from '../scrapers/youtube';
import { getTwitterTrending } from '../scrapers/twitter';
import type { TrendingResponse, TrendingItem } from '../types/index';

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '32akW7C2Mmf1zBUYEZZpgUFVXS2gqk9Z1UqJ3KddeLAr';
const PRICE_USDC = 0.10;

const SUPPORTED_PLATFORMS = new Set(['reddit', 'web', 'youtube', 'twitter', 'x']);
const DEFAULT_PLATFORMS = ['reddit', 'web'];
const MAX_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_PLATFORM_PARAM_LENGTH = 64;

const TRENDING_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(parseInt(process.env.TRENDING_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 300),
);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const DESCRIPTION =
  'Trending Topics API: fetch what is trending right now on Reddit, web, YouTube, and Twitter/X. ' +
  'Returns engagement-ranked topics with source URLs.';

const OUTPUT_SCHEMA = {
  input: {
    country: 'string (optional, default: "US") - ISO country code for web/YouTube/Twitter trends',
    platforms: 'string (optional, default: "reddit,web") - comma-separated platform list: reddit, web, youtube, twitter, x',
    limit: 'number (optional, default: 20, max: 50) - topics per platform',
  },
  output: {
    country: 'string',
    platforms: 'string[]',
    trending: 'TrendingItem[] - { topic, platform, engagement, traffic?, url? }',
    generated_at: 'string (ISO 8601)',
    meta: '{ proxy: { ip, country, type } }',
  },
};

function normalizeClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = c.req.header('x-real-ip')?.trim();
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  const candidate = forwarded || realIp || cfIp || 'unknown';

  if (!candidate || candidate.length > 64 || /[\r\n]/.test(candidate)) {
    return 'unknown';
  }

  return candidate;
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();

  if (rateLimits.size > 10_000) {
    for (const [key, value] of rateLimits) {
      if (now > value.resetAt) {
        rateLimits.delete(key);
      }
    }
  }

  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count += 1;
  if (entry.count > TRENDING_RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}

function parseCountry(countryParam: string | undefined): string {
  if (!countryParam) return 'US';
  const normalized = countryParam.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return 'US';
  return normalized;
}

function parsePlatforms(platformParam: string | undefined): { platforms: string[]; error?: string } {
  if (!platformParam) {
    return { platforms: [...DEFAULT_PLATFORMS] };
  }

  if (platformParam.length > MAX_PLATFORM_PARAM_LENGTH) {
    return { platforms: [], error: `platforms query is too long. Max ${MAX_PLATFORM_PARAM_LENGTH} characters.` };
  }

  const normalized = platformParam
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .map((p) => (p === 'x' ? 'twitter' : p))
    .filter((p) => SUPPORTED_PLATFORMS.has(p));

  const unique = Array.from(new Set(normalized));
  if (unique.length === 0) {
    return { platforms: [], error: 'No supported platforms requested. Use reddit, web, youtube, and/or twitter (x is accepted as alias).' };
  }

  return { platforms: unique };
}

function parseLimit(limitParam: string | undefined): number {
  const parsed = Number.parseInt(limitParam ?? '20', 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
}

function toSafeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '').slice(0, 256);
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const ipRes = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 5_000,
    });

    if (!ipRes.ok) return null;

    const ipData = await ipRes.json() as { ip?: string };
    const ip = typeof ipData?.ip === 'string' ? ipData.ip.trim() : '';
    if (!ip || ip.length > 64) return null;
    return ip;
  } catch {
    return null;
  }
}

export const trendingRouter = new Hono();

trendingRouter.get('/', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      { error: 'Rate limit exceeded for /api/trending', retryAfter: rateStatus.retryAfter },
      429,
    );
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/trending', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  } catch (error) {
    console.error('[trending] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const country = parseCountry(c.req.query('country'));
  const platformsParse = parsePlatforms(c.req.query('platforms'));
  if (platformsParse.error) {
    return c.json({ error: platformsParse.error }, 400);
  }
  const requestedPlatforms = platformsParse.platforms;

  const limit = parseLimit(c.req.query('limit'));

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  const fetches = await Promise.allSettled([
    requestedPlatforms.includes('reddit') ? getRedditTrending(limit) : Promise.resolve([]),
    requestedPlatforms.includes('web') ? getTrendingWeb(country, limit) : Promise.resolve([]),
    requestedPlatforms.includes('youtube') ? getYouTubeTrending(country, limit) : Promise.resolve([]),
    requestedPlatforms.includes('twitter') ? getTwitterTrending(country, limit) : Promise.resolve([]),
  ]);

  const redditTrending = fetches[0].status === 'fulfilled' ? fetches[0].value : [];
  const webTrending = fetches[1].status === 'fulfilled' ? fetches[1].value : [];
  const youtubeTrending = fetches[2].status === 'fulfilled' ? fetches[2].value : [];
  const twitterTrending = fetches[3].status === 'fulfilled' ? fetches[3].value : [];

  for (const result of fetches) {
    if (result.status === 'rejected') {
      console.error('[trending] Fetch error:', result.reason);
    }
  }

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
    ...youtubeTrending.map((video): TrendingItem => ({
      topic: video.title,
      platform: 'youtube',
      engagement: Math.round(video.engagementScore),
      url: video.url,
    })),
    ...twitterTrending.map((tweet): TrendingItem => ({
      topic: tweet.text.slice(0, 120),
      platform: 'twitter',
      engagement: Math.round(tweet.engagementScore),
      url: tweet.url,
    })),
  ];

  trendingItems.sort((a, b) => {
    if (a.engagement !== null && b.engagement !== null) return b.engagement - a.engagement;
    if (a.engagement !== null) return -1;
    if (b.engagement !== null) return 1;
    return 0;
  });

  const platformsUsed = [
    redditTrending.length > 0 ? 'reddit' : null,
    webTrending.length > 0 ? 'web' : null,
    youtubeTrending.length > 0 ? 'youtube' : null,
    twitterTrending.length > 0 ? 'twitter' : null,
  ].filter(Boolean) as string[];

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

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
