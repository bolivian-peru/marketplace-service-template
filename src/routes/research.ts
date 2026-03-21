/**
 * POST /api/research — Cross-Platform Research Endpoint
 * 
 * Accepts:
 *   {
 *     "topic": "AI coding assistants",
 *     "platforms": ["reddit", "x", "youtube"],
 *     "days": 30,
 *     "country": "US"
 *   }
 * 
 * Returns a structured intelligence report with:
 * - Pattern detection (cross-platform signal identification)
 * - Sentiment analysis per platform
 * - Engagement-weighted top discussions
 * - Emerging topics
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, getProxyExitIp } from '../proxy';
import { searchRedditBroad } from '../scrapers/reddit-scraper';
import { searchX } from '../scrapers/x-scraper';
import { searchYouTube } from '../scrapers/youtube-scraper';
import { detectPatterns, analyzeSentiment, extractEmergingTopics, getTopDiscussions } from '../utils/synthesis';
import type { Platform, Evidence, ResearchReport } from '../types';

export const researchRouter = new Hono();

// Pricing tiers
const PRICE_SINGLE_PLATFORM = 0.10;     // $0.10 per single-platform query
const PRICE_CROSS_PLATFORM = 0.50;      // $0.50 per 2-3 platform synthesis
const PRICE_FULL_REPORT = 1.00;         // $1.00 per full report (all platforms)

const OUTPUT_SCHEMA = {
  input: {
    topic: 'string — Topic to research (required)',
    platforms: 'string[] — Platforms: ["reddit", "x", "youtube"] (optional, default: all)',
    days: 'number — Lookback days (optional, default: 30)',
    country: 'string — Country code (optional, default: "US")',
  },
  output: {
    topic: 'string',
    timeframe: 'string',
    patterns: 'TrendPattern[] — Cross-platform patterns with signal strength (established/reinforced/emerging)',
    sentiment: '{ overall, by_platform: { reddit: { positive, neutral, negative }, x: ..., youtube: ... } }',
    top_discussions: 'Evidence[] — Highest engagement posts across platforms',
    emerging_topics: 'string[] — Related topics gaining traction',
    meta: '{ sources_checked, platforms_used, query_time_ms, proxy: { ip, country } }',
  },
};

function getPriceForPlatforms(platforms: Platform[]): number {
  if (platforms.length === 1) return PRICE_SINGLE_PLATFORM;
  if (platforms.length <= 2) return PRICE_CROSS_PLATFORM;
  return PRICE_FULL_REPORT;
}

function getPriceDescription(platforms: Platform[]): string {
  if (platforms.length === 1) return `Single-platform research (${platforms[0]}) — $0.10 USDC`;
  if (platforms.length <= 2) return `Cross-platform research (${platforms.join('+')}) — $0.50 USDC`;
  return `Full intelligence report (all platforms) — $1.00 USDC`;
}

// ─── POST /api/research ──────────────────────────────

researchRouter.post('/', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // Parse request body
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const topic: string = body.topic;
  if (!topic?.trim()) {
    return c.json({
      error: 'Missing required field: topic',
      example: { topic: 'AI coding assistants', platforms: ['reddit', 'x', 'youtube'], days: 30 },
    }, 400);
  }

  const validPlatforms: Platform[] = ['reddit', 'x', 'youtube'];
  const requestedPlatforms: Platform[] = Array.isArray(body.platforms)
    ? body.platforms.filter((p: any) => validPlatforms.includes(p))
    : validPlatforms;

  if (requestedPlatforms.length === 0) {
    return c.json({ error: 'No valid platforms specified. Use: reddit, x, youtube' }, 400);
  }

  const days = Math.min(Math.max(parseInt(body.days) || 30, 1), 90);
  const country = (body.country || 'US').toUpperCase();

  // Check payment
  const payment = extractPayment(c);
  const price = getPriceForPlatforms(requestedPlatforms);

  if (!payment) {
    return c.json(
      build402Response('/api/research', getPriceDescription(requestedPlatforms), price, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, price);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount.',
    }, 402);
  }

  const startTime = Date.now();
  const proxy = getProxy();

  // ─── PARALLEL SCRAPING ──────────────────────────────

  const scrapers: Promise<Evidence[]>[] = [];

  if (requestedPlatforms.includes('reddit')) {
    scrapers.push(
      searchRedditBroad(topic, days, 40).catch(() => [])
    );
  }

  if (requestedPlatforms.includes('x')) {
    scrapers.push(
      searchX(topic, days, 25).catch(() => [])
    );
  }

  if (requestedPlatforms.includes('youtube')) {
    scrapers.push(
      searchYouTube(topic, days, 20).catch(() => [])
    );
  }

  const results = await Promise.allSettled(scrapers);

  // Collect evidence by platform
  const evidenceByPlatform: Partial<Record<Platform, Evidence[]>> = {};
  let platformIdx = 0;

  for (const platform of requestedPlatforms) {
    const result = results[platformIdx++];
    if (result.status === 'fulfilled') {
      evidenceByPlatform[platform] = result.value as Evidence[];
    } else {
      evidenceByPlatform[platform] = [];
    }
  }

  const allEvidence: Evidence[] = Object.values(evidenceByPlatform).flat();

  // ─── SYNTHESIS ──────────────────────────────────────

  const patterns = detectPatterns(allEvidence, topic);
  const sentiment = analyzeSentiment(evidenceByPlatform);
  const topDiscussions = getTopDiscussions(allEvidence, 10);
  const emergingTopics = extractEmergingTopics(allEvidence, topic, 5);

  const ip = await getProxyExitIp().catch(() => 'unknown');

  const report: ResearchReport = {
    topic,
    timeframe: `last ${days} days`,
    patterns,
    sentiment,
    top_discussions: topDiscussions,
    emerging_topics: emergingTopics,
    meta: {
      sources_checked: allEvidence.length,
      platforms_used: requestedPlatforms,
      query_time_ms: Date.now() - startTime,
      proxy: {
        ip,
        country: proxy.country,
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount!,
        settled: true,
      },
    },
  };

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);

  return c.json(report);
});

// ─── GET /api/research (discovery) ──────────────────

researchRouter.get('/', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  return c.json(
    build402Response(
      '/api/research',
      'Cross-platform trend intelligence: scrapes Reddit + X + YouTube simultaneously, synthesizes structured intelligence reports with pattern detection and sentiment analysis.',
      PRICE_FULL_REPORT,
      walletAddress,
      OUTPUT_SCHEMA,
    ),
    402,
  );
});
