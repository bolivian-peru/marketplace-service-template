
/**
 * TikTok Trend Intelligence API
 * GET /api/tiktok/trending - Get trending TikTok content
 * GET /api/tiktok/hashtag - Get TikTok hashtag data
 * GET /api/tiktok/creator - Get TikTok creator data
 * GET /api/tiktok/sound - Get TikTok sound data
 *
 * Price: $0.05 USDC per request
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  getTikTokTrending,
  getTikTokHashtag,
  getTikTokCreator,
  getTikTokSound,
} from '../scrapers/tiktok-scraper';
import type {
  TikTokTrendingResponse,
  TikTokHashtagResponse,
  TikTokCreatorResponse,
  TikTokSoundResponse,
} from '../types/index';

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';
const PRICE_USDC = 0.05;

const TIKTOK_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(parseInt(process.env.TIKTOK_RATE_LIMIT_PER_MIN ?? '30', 10) || 30, 300),
);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const DESCRIPTION =
  'TikTok Trend Intelligence API: fetch trending content, hashtags, sounds, and creators from TikTok. ' +
  'Returns engagement-ranked data with source URLs.';

const OUTPUT_SCHEMA = {
  input: {
    country: 'string (optional, default: "US") - ISO country code for TikTok trends',
    type: 'string (required) - Type of data to fetch: trending, hashtag, creator, or sound',
    tag: 'string (required for hashtag type) - Hashtag to search for',
    username: 'string (required for creator type) - Creator username with or without @',
    id: 'string (required for sound type) - Sound ID',
    limit: 'number (optional, default: 20, max: 50) - items per request',
  },
  output: {
    type: 'string - Type of data returned',
    country: 'string',
    timestamp: 'string (ISO 8601)',
    data: 'TikTokTrendingResponse[] | TikTokHashtagResponse | TikTokCreatorResponse | TikTokSoundResponse',
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
  if (entry.count > TIKTOK_RATE_LIMIT_PER_MIN) {
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

function parseLimit(limitParam: string | undefined): number {
  const parsed = Number.parseInt(limitParam ?? '20', 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 50);
}

function toSafeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '').slice(0, 256);
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', {
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

export const tiktokRouter = new Hono();

// TikTok trending endpoint
tiktokRouter.get('/trending', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      { error: 'Rate limit exceeded for /api/tiktok/trending', retryAfter: rateStatus.retryAfter },
      429,
    );
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/tiktok/trending', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  } catch (error) {
    console.error('[tiktok/trending] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const country = parseCountry(c.req.query('country'));
  const limit = parseLimit(c.req.query('limit'));

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch trending TikTok content
  const trendingData = await getTikTokTrending(country, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response = {
    type: 'trending',
    country,
    timestamp: new Date().toISOString(),
    data: trendingData,
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

// TikTok hashtag endpoint
tiktokRouter.get('/hashtag', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      { error: 'Rate limit exceeded for /api/tiktok/hashtag', retryAfter: rateStatus.retryAfter },
      429,
    );
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/tiktok/hashtag', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  } catch (error) {
    console.error('[tiktok/hashtag] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const tag = c.req.query('tag');
  if (!tag) {
    return c.json({ error: 'Missing required parameter: tag' }, 400);
  }

  const country = parseCountry(c.req.query('country'));
  const limit = parseLimit(c.req.query('limit'));

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch TikTok hashtag data
  const hashtagData = await getTikTokHashtag(tag, country, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response = {
    type: 'hashtag',
    country,
    timestamp: new Date().toISOString(),
    data: hashtagData,
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

// TikTok creator endpoint
tiktokRouter.get('/creator', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      { error: 'Rate limit exceeded for /api/tiktok/creator', retryAfter: rateStatus.retryAfter },
      429,
    );
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/tiktok/creator', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  } catch (error) {
    console.error('[tiktok/creator] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Missing required parameter: username' }, 400);
  }

  const country = parseCountry(c.req.query('country'));
  const limit = parseLimit(c.req.query('limit'));

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch TikTok creator data
  const creatorData = await getTikTokCreator(username, country, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response = {
    type: 'creator',
    country,
    timestamp: new Date().toISOString(),
    data: creatorData,
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

// TikTok sound endpoint
tiktokRouter.get('/sound', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      { error: 'Rate limit exceeded for /api/tiktok/sound', retryAfter: rateStatus.retryAfter },
      429,
    );
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/tiktok/sound', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  } catch (error) {
    console.error('[tiktok/sound] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const id = c.req.query('id');
  if (!id) {
    return c.json({ error: 'Missing required parameter: id' }, 400);
  }

  const country = parseCountry(c.req.query('country'));
  const limit = parseLimit(c.req.query('limit'));

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch TikTok sound data
  const soundData = await getTikTokSound(id, country, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response = {
    type: 'sound',
    country,
    timestamp: new Date().toISOString(),
    data: soundData,
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
