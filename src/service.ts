/**
 * TikTok Trend Intelligence — Service Router
 * ───────────────────────────────────────────
 * Endpoints:
 *   GET /api/run?type=trending&country=US
 *   GET /api/run?type=hashtag&tag=ai&country=US
 *   GET /api/run?type=creator&username=@charlidamelio
 *   GET /api/run?type=sound&id=12345
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import {
  fetchTrending,
  fetchHashtag,
  fetchCreator,
  fetchSound,
} from './scrapers/tiktok-scraper';

export const serviceRouter = new Hono();

// ─── CONFIG ──────────────────────────────────────────

const SERVICE_NAME = 'tiktok-trend-intelligence';
const PRICE_USDC = 0.02;  // $0.02 per query
const DESCRIPTION = 'Real-time TikTok trend intelligence: trending videos, hashtags, sounds, and creator profiles via real 4G/5G mobile carrier IPs.';

const SUPPORTED_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'];

// ─── RATE LIMITING (proxy protection) ────────────────

const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20;

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyUsage.get(ip);
  if (!entry || now > entry.resetAt) {
    proxyUsage.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= PROXY_RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of proxyUsage) {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  }
}, 300_000);

// ─── OUTPUT SCHEMA (for AI agent discovery) ──────────

const OUTPUT_SCHEMA = {
  input: {
    type: '"trending" | "hashtag" | "creator" | "sound"',
    country: '"US" | "DE" | "FR" | "ES" | "GB" | "PL" — defaults to US',
    tag: 'string — hashtag name (for type=hashtag, with or without #)',
    username: 'string — TikTok username (for type=creator, with or without @)',
    id: 'string — sound/audio ID (for type=sound)',
    limit: 'number — max results (default: 20, max: 30)',
  },
  output: {
    type: 'string — request type',
    country: 'string — country code',
    timestamp: 'ISO 8601 string',
    data: {
      videos: [{
        id: 'string',
        description: 'string',
        author: { username: 'string', followers: 'number' },
        stats: { views: 'number', likes: 'number', comments: 'number', shares: 'number' },
        sound: { name: 'string', author: 'string' },
        hashtags: 'string[]',
        createdAt: 'ISO 8601',
        url: 'string',
      }],
      trending_hashtags: [{ name: 'string', views: 'number', velocity: 'string' }],
      trending_sounds: [{ name: 'string', uses: 'number', velocity: 'string' }],
    },
    proxy: { country: 'string', carrier: 'string', type: '"mobile"' },
    payment: { txHash: 'string', amount: 'number', verified: 'boolean' },
  },
};

// ─── MAIN ENDPOINT ───────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── x402 Payment Check ──
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // ── Proxy Rate Limiting ──
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({
      error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.',
      retryAfter: 60,
    }, 429);
  }

  // ── Parse Query Params ──
  const type = c.req.query('type') || 'trending';
  const country = (c.req.query('country') || 'US').toUpperCase();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 30);

  if (!SUPPORTED_COUNTRIES.includes(country)) {
    return c.json({
      error: `Unsupported country: ${country}`,
      supported: SUPPORTED_COUNTRIES,
      hint: 'Use one of: US, DE, FR, ES, GB, PL',
    }, 400);
  }

  const proxy = getProxy();
  const timestamp = new Date().toISOString();

  try {
    switch (type) {
      // ── TRENDING ──────────────────────────────────
      case 'trending': {
        const result = await fetchTrending(country, limit);

        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);

        return c.json({
          type: 'trending',
          country,
          timestamp,
          data: result,
          proxy: {
            country: proxy.country,
            carrier: getCarrierName(proxy.country),
            type: 'mobile',
          },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            verified: true,
          },
        });
      }

      // ── HASHTAG ───────────────────────────────────
      case 'hashtag': {
        const tag = c.req.query('tag');
        if (!tag) {
          return c.json({
            error: 'Missing required parameter: tag',
            example: '/api/run?type=hashtag&tag=ai&country=US',
          }, 400);
        }

        const result = await fetchHashtag(tag, country, limit);

        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);

        return c.json({
          type: 'hashtag',
          tag: tag.startsWith('#') ? tag : `#${tag}`,
          country,
          timestamp,
          data: result,
          proxy: {
            country: proxy.country,
            carrier: getCarrierName(proxy.country),
            type: 'mobile',
          },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            verified: true,
          },
        });
      }

      // ── CREATOR ───────────────────────────────────
      case 'creator': {
        const username = c.req.query('username');
        if (!username) {
          return c.json({
            error: 'Missing required parameter: username',
            example: '/api/run?type=creator&username=@charlidamelio',
          }, 400);
        }

        const result = await fetchCreator(username, country);

        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);

        return c.json({
          type: 'creator',
          timestamp,
          data: result,
          proxy: {
            country: proxy.country,
            carrier: getCarrierName(proxy.country),
            type: 'mobile',
          },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            verified: true,
          },
        });
      }

      // ── SOUND ─────────────────────────────────────
      case 'sound': {
        const id = c.req.query('id');
        if (!id) {
          return c.json({
            error: 'Missing required parameter: id',
            example: '/api/run?type=sound&id=7341234567890',
          }, 400);
        }

        const result = await fetchSound(id, country);

        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);

        return c.json({
          type: 'sound',
          soundId: id,
          timestamp,
          data: result,
          proxy: {
            country: proxy.country,
            carrier: getCarrierName(proxy.country),
            type: 'mobile',
          },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            verified: true,
          },
        });
      }

      default:
        return c.json({
          error: `Unknown type: ${type}`,
          supported: ['trending', 'hashtag', 'creator', 'sound'],
          examples: [
            '/api/run?type=trending&country=US',
            '/api/run?type=hashtag&tag=ai&country=US',
            '/api/run?type=creator&username=@charlidamelio',
            '/api/run?type=sound&id=12345',
          ],
        }, 400);
    }
  } catch (err: any) {
    console.error(`[TIKTOK] Service error: ${err.message}`);
    return c.json({
      error: 'Service execution failed',
      message: err.message,
      hint: 'TikTok may be temporarily rate limiting. The service uses IP rotation — try again in a few seconds.',
    }, 502);
  }
});

// ─── HELPER ──────────────────────────────────────────

function getCarrierName(country: string): string {
  const carriers: Record<string, string> = {
    US: 'T-Mobile',
    DE: 'Vodafone DE',
    FR: 'Orange FR',
    ES: 'Movistar',
    GB: 'EE',
    PL: 'Play PL',
  };
  return carriers[country] || 'Mobile Carrier';
}
