/**
 * POST /api/research
 * ──────────────────
 * Cross-platform trend intelligence synthesis.
 *
 * Pricing tiers (x402):
 *   $0.10 USDC - single platform
 *   $0.50 USDC - 2-3 platforms (cross-platform synthesis)
 *   $1.00 USDC - all platforms + full report
 *
 * MVP platforms: reddit, web
 * Stretch: x, youtube (require additional proxy/auth setup)
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import { searchReddit } from '../scrapers/reddit';
import { searchWeb, getTrendingWeb } from '../scrapers/web';
import { aggregateSentiment } from '../analysis/sentiment';
import { detectPatterns } from '../analysis/patterns';
import type {
  ResearchRequest,
  ResearchResponse,
  PlatformSentimentBreakdown,
  TopDiscussion,
  Platform,
} from '../types/index';

// ─── CONSTANTS ──────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

// Pricing by platform count
const PRICE_SINGLE = 0.10;
const PRICE_MULTI = 0.50;
const PRICE_FULL = 1.00;

const SUPPORTED_PLATFORMS: Platform[] = ['reddit', 'web'];

const DESCRIPTION =
  'Trend Intelligence API: cross-platform research synthesis with pattern detection and sentiment analysis. ' +
  'Scrapes Reddit + web simultaneously, finds cross-platform signals, returns structured intelligence report.';

const OUTPUT_SCHEMA = {
  input: {
    topic: 'string (required) — topic or keyword to research',
    platforms: '("reddit" | "web")[] (optional, default: ["reddit", "web"])',
    days: 'number (optional, default: 30, max: 90)',
    country: 'string (optional, default: "US") — ISO country code',
  },
  output: {
    topic: 'string',
    timeframe: 'string',
    patterns: 'TrendPattern[] — cross-platform signals with strength classification',
    sentiment: '{ overall, by_platform: Record<platform, { positive%, neutral%, negative% }> }',
    top_discussions: 'TopDiscussion[] — highest-engagement posts across platforms',
    emerging_topics: 'string[] — single-platform high-engagement signals',
    meta: '{ sources_checked, platforms_used, proxy, generated_at }',
  },
  pricing: {
    single_platform: '$0.10 USDC',
    cross_platform: '$0.50 USDC (2-3 platforms)',
    full_report: '$1.00 USDC (all platforms)',
  },
};

// ─── ROUTER ─────────────────────────────────────────

export const researchRouter = new Hono();

researchRouter.post('/', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ─── Payment gate ────────────────────────────────

  const payment = extractPayment(c);
  if (!payment) {
    // We need to know the tier to quote the right price. Default to cross-platform.
    return c.json(
      build402Response('/api/research', DESCRIPTION, PRICE_MULTI, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  // ─── Parse request body ──────────────────────────

  let body: Partial<ResearchRequest> = {};
  try {
    body = await c.req.json() as Partial<ResearchRequest>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const topic = body.topic?.trim();
  if (!topic) {
    return c.json({ error: 'Missing required field: topic' }, 400);
  }

  // Validate and filter platforms
  const requestedPlatforms = (body.platforms ?? ['reddit', 'web']).filter(
    (p): p is Platform => SUPPORTED_PLATFORMS.includes(p as Platform),
  );
  const platforms = requestedPlatforms.length > 0 ? requestedPlatforms : ['reddit', 'web'] as Platform[];

  const days = Math.min(Math.max(Number(body.days ?? 30) || 30, 1), 90);
  const country = (body.country ?? 'US').toUpperCase().slice(0, 2);

  // Determine price tier
  const price = platforms.length >= 3 ? PRICE_FULL : platforms.length >= 2 ? PRICE_MULTI : PRICE_SINGLE;

  // Verify payment
  const verification = await verifyPayment(payment, WALLET_ADDRESS, price);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  // ─── Scrape platforms in parallel ───────────────

  const proxyConfig = getProxy();
  let proxyIp: string | null = null;

  // Attempt to get exit IP for metadata
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

  const scrapeResults = await Promise.allSettled([
    platforms.includes('reddit')
      ? searchReddit(topic, days, 50)
      : Promise.resolve([]),
    platforms.includes('web')
      ? searchWeb(topic, 20)
      : Promise.resolve([]),
    platforms.includes('web')
      ? getTrendingWeb(country, 20)
      : Promise.resolve([]),
  ]);

  const redditPosts = scrapeResults[0].status === 'fulfilled' ? scrapeResults[0].value : [];
  const webResults = scrapeResults[1].status === 'fulfilled' ? scrapeResults[1].value : [];
  const webTrending = scrapeResults[2].status === 'fulfilled' ? scrapeResults[2].value : [];

  // Log scrape errors without failing the request
  for (const result of scrapeResults) {
    if (result.status === 'rejected') {
      console.error('[research] Scrape error:', result.reason);
    }
  }

  // ─── Sentiment analysis ──────────────────────────

  const sentimentByPlatform: Record<string, PlatformSentimentBreakdown> = {};

  if (redditPosts.length > 0) {
    const texts = redditPosts.map((p) => `${p.title} ${p.selftext}`);
    sentimentByPlatform['reddit'] = aggregateSentiment(texts);
  }

  if (webResults.length > 0) {
    const texts = webResults.map((r) => `${r.title} ${r.snippet}`);
    sentimentByPlatform['web'] = aggregateSentiment(texts);
  }

  // Aggregate overall sentiment
  const allTexts = [
    ...redditPosts.map((p) => `${p.title} ${p.selftext}`),
    ...webResults.map((r) => `${r.title} ${r.snippet}`),
  ];
  const overallSentiment = aggregateSentiment(allTexts);

  // ─── Pattern detection ───────────────────────────

  const patterns = detectPatterns({
    reddit: redditPosts,
    web: webResults,
    webTrending,
  });

  // ─── Top discussions ─────────────────────────────

  const topDiscussions: TopDiscussion[] = [
    ...redditPosts
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((p) => ({
        platform: 'reddit',
        title: p.title,
        url: p.permalink,
        engagement: p.score,
        subreddit: p.subreddit,
        score: p.score,
        numComments: p.numComments,
      })),
    ...webResults.slice(0, 3).map((r) => ({
      platform: 'web',
      title: r.title,
      url: r.url,
      engagement: 0,
      source: r.source,
    })),
  ].sort((a, b) => b.engagement - a.engagement).slice(0, 8);

  // ─── Emerging topics (single-source high-engagement) ──

  const emergingPatterns = patterns.filter((p) => p.strength === 'emerging');
  const emergingTopics = emergingPatterns.slice(0, 5).map((p) => p.pattern);

  // ─── Build response ──────────────────────────────

  const sourcesChecked = redditPosts.length + webResults.length + webTrending.length;
  const platformsUsed = [
    redditPosts.length > 0 ? 'reddit' : null,
    webResults.length > 0 || webTrending.length > 0 ? 'web' : null,
  ].filter(Boolean) as string[];

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', payment.txHash);

  const response: ResearchResponse = {
    topic,
    timeframe: `last ${days} days`,
    patterns,
    sentiment: {
      overall: overallSentiment.overall,
      by_platform: sentimentByPlatform,
    },
    top_discussions: topDiscussions,
    emerging_topics: emergingTopics,
    meta: {
      sources_checked: sourcesChecked,
      platforms_used: platformsUsed,
      proxy: {
        ip: proxyIp,
        country: proxyConfig.country,
        type: 'mobile',
      },
      generated_at: new Date().toISOString(),
    },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? price,
      settled: true,
    },
  };

  return c.json(response);
});
