/**
 * POST /api/research
 * Cross-platform trend intelligence synthesis.
 *
 * Pricing tiers (x402):
 *   $0.10 USDC - single platform
 *   $0.50 USDC - 2-3 platforms (cross-platform synthesis)
 *   $1.00 USDC - all platforms + full report
 *
 * MVP platforms: reddit, web
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import { searchReddit } from '../scrapers/reddit';
import { searchWeb, getTrendingWeb } from '../scrapers/web';
import { searchYouTube, getYouTubeTrending } from '../scrapers/youtube';
import { searchTwitter, getTwitterTrending } from '../scrapers/twitter';
import { aggregateSentiment } from '../analysis/sentiment';
import { detectPatterns } from '../analysis/patterns';
import type {
  ResearchRequest,
  ResearchResponse,
  PlatformSentimentBreakdown,
  TopDiscussion,
  Platform,
} from '../types/index';

// Constants

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_SINGLE = 0.10;
const PRICE_MULTI = 0.50;
const PRICE_FULL = 1.00;

const SUPPORTED_PLATFORMS: Platform[] = ['reddit', 'web', 'youtube', 'twitter'];
const DEFAULT_PLATFORMS: Platform[] = ['reddit', 'web'];

const MAX_TOPIC_LENGTH = 200;
const MIN_TOPIC_LENGTH = 2;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_DAYS = 90;
const MAX_REDDIT_RESULTS = 50;
const MAX_WEB_RESULTS = 20;
const MAX_TRENDING_RESULTS = 20;
const MAX_YOUTUBE_RESULTS = 20;
const MAX_TWITTER_RESULTS = 20;

const RESEARCH_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Math.min(parseInt(process.env.RESEARCH_RATE_LIMIT_PER_MIN ?? '12', 10) || 12, 120),
);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const DESCRIPTION =
  'Trend Intelligence API: cross-platform research synthesis with pattern detection and sentiment analysis. ' +
  'Scrapes Reddit, web, YouTube, and Twitter/X simultaneously, finds cross-platform signals, returns structured intelligence report.';

const OUTPUT_SCHEMA = {
  input: {
    topic: 'string (required) - topic or keyword to research',
    platforms: '("reddit" | "web" | "youtube" | "twitter")[] (optional, default: ["reddit", "web"])',
    days: 'number (optional, default: 30, max: 90)',
    country: 'string (optional, default: "US") - ISO country code',
  },
  output: {
    topic: 'string',
    timeframe: 'string',
    patterns: 'TrendPattern[] - cross-platform signals with strength classification',
    sentiment: '{ overall, by_platform: Record<platform, { positive%, neutral%, negative% }> }',
    top_discussions: 'TopDiscussion[] - highest-engagement posts across platforms',
    emerging_topics: 'string[] - single-platform high-engagement signals',
    meta: '{ sources_checked, platforms_used, proxy, generated_at }',
  },
  pricing: {
    single_platform: '$0.10 USDC',
    cross_platform: '$0.50 USDC (2-3 platforms)',
    full_report: '$1.00 USDC (4 platforms)',
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

  const current = rateLimits.get(ip);
  if (!current || now > current.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count > RESEARCH_RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}

function parseCountry(input: unknown): string {
  if (typeof input !== 'string') return 'US';
  const normalized = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return 'US';
  return normalized;
}

function sanitizeTopic(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().replace(/\s+/g, ' ');
  if (normalized.length < MIN_TOPIC_LENGTH || normalized.length > MAX_TOPIC_LENGTH) {
    return null;
  }
  if (/[\r\n\0]/.test(normalized)) {
    return null;
  }
  return normalized;
}

function parsePlatforms(input: unknown): { platforms: Platform[]; error?: string } {
  if (input === undefined) {
    return { platforms: [...DEFAULT_PLATFORMS] };
  }

  if (!Array.isArray(input)) {
    return { platforms: [], error: 'platforms must be an array' };
  }

  if (input.length > SUPPORTED_PLATFORMS.length) {
    return { platforms: [], error: `Too many platforms requested. Max ${SUPPORTED_PLATFORMS.length}` };
  }

  const normalized = input
    .map((p) => (typeof p === 'string' ? p.trim().toLowerCase() : ''))
    .filter((p): p is Platform => SUPPORTED_PLATFORMS.includes(p as Platform));

  const unique = Array.from(new Set(normalized));

  if (unique.length === 0) {
    return { platforms: [], error: 'No supported platforms selected. Use reddit, web, youtube, and/or twitter.' };
  }

  return { platforms: unique };
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

// Router

export const researchRouter = new Hono();

researchRouter.post('/', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    c.header('Retry-After', String(rateStatus.retryAfter));
    return c.json(
      {
        error: 'Rate limit exceeded for /api/research',
        retryAfter: rateStatus.retryAfter,
      },
      429,
    );
  }

  const contentType = c.req.header('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 415);
  }

  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return c.json({ error: `Request body too large. Max ${MAX_BODY_BYTES} bytes.` }, 413);
    }
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/research', DESCRIPTION, PRICE_MULTI, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return c.json({ error: 'JSON body must be an object' }, 400);
  }

  const body = parsedBody as Partial<ResearchRequest>;

  const topic = sanitizeTopic(body.topic);
  if (!topic) {
    return c.json(
      { error: `Invalid topic. Length must be ${MIN_TOPIC_LENGTH}-${MAX_TOPIC_LENGTH} characters.` },
      400,
    );
  }

  const platformsParse = parsePlatforms(body.platforms);
  if (platformsParse.error) {
    return c.json({ error: platformsParse.error }, 400);
  }
  const platforms = platformsParse.platforms;

  const rawDays = Number(body.days ?? 30);
  if (!Number.isFinite(rawDays)) {
    return c.json({ error: 'days must be a valid number' }, 400);
  }
  const days = Math.min(Math.max(Math.floor(rawDays), 1), MAX_DAYS);

  const country = parseCountry(body.country);

  // 4 platforms = full report, 2-3 = multi, 1 = single
  const price = platforms.length >= 4 ? PRICE_FULL : platforms.length >= 2 ? PRICE_MULTI : PRICE_SINGLE;

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, price);
  } catch (error) {
    console.error('[research] Payment verification error:', error);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  const scrapeResults = await Promise.allSettled([
    platforms.includes('reddit') ? searchReddit(topic, days, MAX_REDDIT_RESULTS) : Promise.resolve([]),
    platforms.includes('web') ? searchWeb(topic, MAX_WEB_RESULTS) : Promise.resolve([]),
    platforms.includes('web') ? getTrendingWeb(country, MAX_TRENDING_RESULTS) : Promise.resolve([]),
    platforms.includes('youtube') ? searchYouTube(topic, days, MAX_YOUTUBE_RESULTS) : Promise.resolve([]),
    platforms.includes('youtube') ? getYouTubeTrending(country, MAX_TRENDING_RESULTS) : Promise.resolve([]),
    platforms.includes('twitter') ? searchTwitter(topic, days, MAX_TWITTER_RESULTS) : Promise.resolve([]),
    platforms.includes('twitter') ? getTwitterTrending(country, MAX_TRENDING_RESULTS) : Promise.resolve([]),
  ]);

  const redditPosts = scrapeResults[0].status === 'fulfilled' ? scrapeResults[0].value : [];
  const webResults = scrapeResults[1].status === 'fulfilled' ? scrapeResults[1].value : [];
  const webTrending = scrapeResults[2].status === 'fulfilled' ? scrapeResults[2].value : [];
  const youtubeResults = scrapeResults[3].status === 'fulfilled' ? scrapeResults[3].value : [];
  const youtubeTrending = scrapeResults[4].status === 'fulfilled' ? scrapeResults[4].value : [];
  const twitterResults = scrapeResults[5].status === 'fulfilled' ? scrapeResults[5].value : [];
  // twitterTrending is fetched but merged into twitterResults for pattern detection
  const twitterTrending = scrapeResults[6].status === 'fulfilled' ? scrapeResults[6].value : [];

  for (const result of scrapeResults) {
    if (result.status === 'rejected') {
      console.error('[research] Scrape error:', result.reason);
    }
  }

  const sentimentByPlatform: Record<string, PlatformSentimentBreakdown> = {};

  if (redditPosts.length > 0) {
    const texts = redditPosts.map((p) => `${p.title.slice(0, 300)} ${p.selftext.slice(0, 1000)}`);
    sentimentByPlatform.reddit = aggregateSentiment(texts);
  }

  if (webResults.length > 0) {
    const texts = webResults.map((r) => `${r.title.slice(0, 300)} ${r.snippet.slice(0, 1000)}`);
    sentimentByPlatform.web = aggregateSentiment(texts);
  }

  if (youtubeResults.length > 0) {
    const texts = youtubeResults.map((v) => `${v.title.slice(0, 300)} ${v.description.slice(0, 1000)}`);
    sentimentByPlatform.youtube = aggregateSentiment(texts);
  }

  const allTwitter = [...twitterResults, ...twitterTrending];
  if (allTwitter.length > 0) {
    const texts = allTwitter.map((t) => t.text.slice(0, 500));
    sentimentByPlatform.twitter = aggregateSentiment(texts);
  }

  const allTexts = [
    ...redditPosts.map((p) => `${p.title.slice(0, 300)} ${p.selftext.slice(0, 1000)}`),
    ...webResults.map((r) => `${r.title.slice(0, 300)} ${r.snippet.slice(0, 1000)}`),
    ...youtubeResults.map((v) => `${v.title.slice(0, 300)} ${v.description.slice(0, 1000)}`),
    ...allTwitter.map((t) => t.text.slice(0, 500)),
  ];
  const overallSentiment = aggregateSentiment(allTexts);

  const patterns = detectPatterns({
    reddit: redditPosts,
    web: webResults,
    webTrending,
  });

  const topDiscussions: TopDiscussion[] = [
    ...redditPosts
      .slice()
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
    ...youtubeResults
      .slice()
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 3)
      .map((v) => ({
        platform: 'youtube',
        title: v.title,
        url: v.url,
        engagement: Math.round(v.engagementScore),
      })),
    ...allTwitter
      .slice()
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 3)
      .map((t) => ({
        platform: 'twitter',
        title: t.text.slice(0, 120),
        url: t.url,
        engagement: Math.round(t.engagementScore),
      })),
  ]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10);

  const emergingPatterns = patterns.filter((p) => p.strength === 'emerging');
  const emergingTopics = emergingPatterns.slice(0, 5).map((p) => p.pattern);

  const sourcesChecked =
    redditPosts.length + webResults.length + webTrending.length +
    youtubeResults.length + youtubeTrending.length +
    twitterResults.length + twitterTrending.length;

  const platformsUsed = [
    redditPosts.length > 0 ? 'reddit' : null,
    webResults.length > 0 || webTrending.length > 0 ? 'web' : null,
    youtubeResults.length > 0 || youtubeTrending.length > 0 ? 'youtube' : null,
    allTwitter.length > 0 ? 'twitter' : null,
  ].filter(Boolean) as string[];

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

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
