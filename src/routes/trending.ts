/**
 * GET /api/trending — Cross-Platform Trending Topics
 *
 * Query params:
 *   ?country=US&platforms=reddit,x,youtube
 *
 * Returns trending topics aggregated across platforms.
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, getProxyExitIp } from '../proxy';
import { getSubredditPosts } from '../scrapers/reddit-scraper';
import { getXTrends } from '../scrapers/x-scraper';
import { getYouTubeTrending } from '../scrapers/youtube-scraper';
import { analyzeSentiment } from '../utils/synthesis';
import type { Platform, Evidence, XTrend, TrendingResponse } from '../types';

export const trendingRouter = new Hono();

const PRICE_TRENDING = 0.10;

const OUTPUT_SCHEMA = {
  input: {
    country: 'string — Country code (optional, default: "US")',
    platforms: 'string — Comma-separated platforms (optional, default: "reddit,x,youtube")',
  },
  output: {
    country: 'string',
    platforms: 'string[]',
    trends: 'Array<{ topic, platforms, volume, sentiment, samplePost? }>',
    meta: '{ fetched_at, proxy: { ip, country } }',
  },
};

// ─── GET /api/trending ────────────────────────────────

trendingRouter.get('/', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/trending', 'Trending topics aggregated across Reddit, X/Twitter, and YouTube. Real-time intelligence via mobile proxies.', PRICE_TRENDING, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_TRENDING);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const country = (c.req.query('country') || 'US').toUpperCase();
  const validPlatforms: Platform[] = ['reddit', 'x', 'youtube'];
  const platformsParam = c.req.query('platforms') || 'reddit,x,youtube';
  const requestedPlatforms: Platform[] = platformsParam
    .split(',')
    .map(p => p.trim().toLowerCase() as Platform)
    .filter(p => validPlatforms.includes(p));

  if (requestedPlatforms.length === 0) {
    return c.json({ error: 'No valid platforms. Use: reddit, x, youtube' }, 400);
  }

  const proxy = getProxy();

  // ─── PARALLEL TRENDING FETCH ─────────────────────────

  const fetchJobs: Promise<any>[] = [];

  if (requestedPlatforms.includes('reddit')) {
    fetchJobs.push(
      getSubredditPosts('popular', 'hot', 1, 30)
        .then(posts => ({ type: 'reddit' as const, data: posts }))
        .catch(() => ({ type: 'reddit' as const, data: [] }))
    );
  }

  if (requestedPlatforms.includes('x')) {
    fetchJobs.push(
      getXTrends(country)
        .then(trends => ({ type: 'x' as const, data: trends }))
        .catch(() => ({ type: 'x' as const, data: [] }))
    );
  }

  if (requestedPlatforms.includes('youtube')) {
    fetchJobs.push(
      getYouTubeTrending(country)
        .then(videos => ({ type: 'youtube' as const, data: videos }))
        .catch(() => ({ type: 'youtube' as const, data: [] }))
    );
  }

  const fetchResults = await Promise.allSettled(fetchJobs);

  // ─── AGGREGATE TRENDING DATA ─────────────────────────

  // Collect topic mentions across platforms
  const topicMap = new Map<string, {
    platforms: Set<Platform>;
    volume: number;
    evidence: Evidence[];
    xTrend?: XTrend;
  }>();

  for (const result of fetchResults) {
    if (result.status !== 'fulfilled') continue;
    const { type, data } = result.value;

    if (type === 'reddit') {
      for (const post of data) {
        // Use subreddit + flair as topic signal
        const topicKey = post.subreddit.replace('r/', '').toLowerCase();
        if (!topicMap.has(topicKey)) {
          topicMap.set(topicKey, { platforms: new Set(), volume: 0, evidence: [] });
        }
        const entry = topicMap.get(topicKey)!;
        entry.platforms.add('reddit');
        entry.volume += post.score;
        if (entry.evidence.length < 2) entry.evidence.push(post);
      }
    }

    if (type === 'x') {
      for (const trend of data as XTrend[]) {
        const key = trend.name.toLowerCase().replace(/^#/, '');
        if (!topicMap.has(key)) {
          topicMap.set(key, { platforms: new Set(), volume: 0, evidence: [] });
        }
        const entry = topicMap.get(key)!;
        entry.platforms.add('x');
        entry.volume += trend.tweetVolume || 1000;
        entry.xTrend = trend;
      }
    }

    if (type === 'youtube') {
      for (const video of data) {
        // Extract main topic words from title
        const words = video.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
        const topicKey = words.slice(0, 2).join(' ') || 'trending';
        if (!topicMap.has(topicKey)) {
          topicMap.set(topicKey, { platforms: new Set(), volume: 0, evidence: [] });
        }
        const entry = topicMap.get(topicKey)!;
        entry.platforms.add('youtube');
        entry.volume += video.viewCount;
        if (entry.evidence.length < 2) entry.evidence.push(video);
      }
    }
  }

  // Sort by volume and cross-platform presence
  const sortedTopics = [...topicMap.entries()]
    .filter(([, v]) => v.volume > 0)
    .sort((a, b) => {
      const platformScore = b[1].platforms.size - a[1].platforms.size;
      if (platformScore !== 0) return platformScore * 1000;
      return b[1].volume - a[1].volume;
    })
    .slice(0, 20);

  // Build response
  const trends: TrendingResponse['trends'] = sortedTopics.map(([topic, data]) => {
    const evidenceByPlatform: Partial<Record<Platform, Evidence[]>> = {};
    for (const e of data.evidence) {
      if (!evidenceByPlatform[e.platform]) evidenceByPlatform[e.platform] = [];
      evidenceByPlatform[e.platform]!.push(e);
    }

    const sentiment = analyzeSentiment(evidenceByPlatform);

    return {
      topic: topic.charAt(0).toUpperCase() + topic.slice(1),
      platforms: [...data.platforms] as Platform[],
      volume: data.volume,
      sentiment: sentiment.overall,
      samplePost: data.evidence[0],
    };
  });

  const ip = await getProxyExitIp().catch(() => 'unknown');

  const response: TrendingResponse = {
    country,
    platforms: requestedPlatforms,
    trends,
    meta: {
      fetched_at: new Date().toISOString(),
      proxy: { ip, country: proxy.country },
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

  return c.json(response);
});
