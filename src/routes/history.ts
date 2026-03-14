/**
 * GET /api/history
 * Returns historical trend data for tracked topics.
 *
 * Price: $0.05 USDC
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getTrendHistory, getTrackedTopics, getStoreStats } from '../analysis/trend-store';

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';
const PRICE_USDC = 0.05;
const MAX_TOPIC_LENGTH = 200;

const RATE_LIMIT_PER_MIN = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const DESCRIPTION =
  'Historical Trend Data API: retrieve engagement history and trend direction for tracked topics. ' +
  'Returns snapshots over time with peak engagement, averages, and trend direction classification.';

const OUTPUT_SCHEMA = {
  input: {
    topic: 'string (optional) - specific topic to query history for',
    limit: 'number (optional, default: 20, max: 50) - number of topics when listing all',
  },
  output: {
    topic: 'string',
    firstSeen: 'string (ISO 8601)',
    lastSeen: 'string (ISO 8601)',
    peakEngagement: 'number',
    avgEngagement: 'number',
    trendDirection: '"rising" | "stable" | "declining"',
    snapshots: 'TrendSnapshot[] - historical engagement data points',
  },
};

function normalizeClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = c.req.header('x-real-ip')?.trim();
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  const candidate = forwarded || realIp || cfIp || 'unknown';
  if (!candidate || candidate.length > 64 || /[\r\n]/.test(candidate)) return 'unknown';
  return candidate;
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (rateLimits.size > 10_000) {
    for (const [key, value] of rateLimits) {
      if (now > value.resetAt) rateLimits.delete(key);
    }
  }
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }
  return { allowed: true, retryAfter: 0 };
}

function toSafeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '').slice(0, 256);
}

export const historyRouter = new Hono();

historyRouter.get('/', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rateStatus.retryAfter }, 429);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/history', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  } catch (error) {
    console.error('[history] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const topicParam = c.req.query('topic');
  const limitParam = c.req.query('limit');
  const limit = Math.min(Math.max(1, parseInt(limitParam ?? '20', 10) || 20), 50);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  // If a specific topic is requested, return its history
  if (topicParam && topicParam.trim().length > 0) {
    const safeTopic = topicParam.trim().slice(0, MAX_TOPIC_LENGTH);
    const history = getTrendHistory(safeTopic);

    if (!history) {
      return c.json({
        topic: safeTopic,
        found: false,
        message: 'No historical data found for this topic. Research it first via POST /api/research.',
        payment: {
          txHash: payment.txHash,
          network: payment.network,
          amount: verification.amount ?? PRICE_USDC,
          settled: true,
        },
      });
    }

    return c.json({
      topic: history.topic,
      found: true,
      firstSeen: new Date(history.firstSeen).toISOString(),
      lastSeen: new Date(history.lastSeen).toISOString(),
      peakEngagement: history.peakEngagement,
      avgEngagement: history.avgEngagement,
      trendDirection: history.trendDirection,
      snapshotCount: history.snapshots.length,
      snapshots: history.snapshots.slice(-50).map(s => ({
        timestamp: new Date(s.timestamp).toISOString(),
        platforms: s.platforms,
        totalEngagement: s.totalEngagement,
        platformEngagement: s.platformEngagement,
        sentimentScore: s.sentimentScore,
      })),
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount ?? PRICE_USDC,
        settled: true,
      },
    });
  }

  // Otherwise, return all tracked topics
  const trackedTopics = getTrackedTopics(limit);
  const stats = getStoreStats();

  return c.json({
    tracked_topics: trackedTopics.map(h => ({
      topic: h.topic,
      firstSeen: new Date(h.firstSeen).toISOString(),
      lastSeen: new Date(h.lastSeen).toISOString(),
      peakEngagement: h.peakEngagement,
      avgEngagement: h.avgEngagement,
      trendDirection: h.trendDirection,
      snapshotCount: h.snapshots.length,
    })),
    store_stats: stats,
    generated_at: new Date().toISOString(),
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_USDC,
      settled: true,
    },
  });
});
