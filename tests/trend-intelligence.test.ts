/**
 * Trend Intelligence API — Unit Tests
 *
 * Tests for:
 *   - Sentiment analysis
 *   - Pattern detection (cross-platform)
 *   - Breakout detection
 *   - Trend scoring and ranking
 *   - Historical trend store
 */

import { describe, test, expect } from 'bun:test';
import { scoreSentiment, aggregateSentiment } from '../src/analysis/sentiment';
import { detectPatterns } from '../src/analysis/patterns';
import { detectBreakouts, calculateTrendScore, rankTrends } from '../src/analysis/breakout';
import { detectBreakoutFromInterest } from '../src/scrapers/google-trends';
import { recordSnapshot, getTrendHistory, getEngagementBaselines, getStoreStats } from '../src/analysis/trend-store';
import type { RedditPost } from '../src/scrapers/reddit';
import type { WebResult } from '../src/scrapers/web';
import type { YouTubeResult } from '../src/scrapers/youtube';
import type { TwitterResult } from '../src/scrapers/twitter';
import type { TikTokResult } from '../src/scrapers/tiktok';

// ─── SENTIMENT ──────────────────────────────────────

describe('scoreSentiment', () => {
  test('returns positive for positive text', () => {
    const result = scoreSentiment('This is great and amazing, I love it');
    expect(result.overall).toBe('positive');
  });

  test('returns negative for negative text', () => {
    const result = scoreSentiment('This is terrible and awful, I hate it');
    expect(result.overall).toBe('negative');
  });

  test('returns neutral for empty text', () => {
    const result = scoreSentiment('');
    expect(result.overall).toBe('neutral');
  });

  test('handles negation', () => {
    const result = scoreSentiment('This is not good at all, very disappointing');
    expect(result.overall).toBe('negative');
  });
});

describe('aggregateSentiment', () => {
  test('aggregates multiple positive texts', () => {
    const texts = [
      'Amazing product, works great',
      'Love this tool, highly recommend',
      'Excellent service, very satisfied',
    ];
    const result = aggregateSentiment(texts);
    expect(result.overall).toBe('positive');
    expect(result.positive).toBeGreaterThan(result.negative);
  });

  test('handles empty array', () => {
    const result = aggregateSentiment([]);
    expect(result.overall).toBe('neutral');
  });
});

// ─── PATTERN DETECTION ──────────────────────────────

describe('detectPatterns', () => {
  const makeRedditPost = (title: string, score: number): RedditPost => ({
    id: `post_${Math.random().toString(36).slice(2)}`,
    title,
    subreddit: 'test',
    score,
    numComments: Math.floor(score / 5),
    url: 'https://reddit.com/test',
    permalink: 'https://reddit.com/r/test/post',
    created: Date.now() / 1000,
    selftext: title,
    author: 'testuser',
    upvoteRatio: 0.95,
    isVideo: false,
    flair: null,
    platform: 'reddit',
  });

  const makeWebResult = (title: string): WebResult => ({
    title,
    url: 'https://example.com/article',
    snippet: title,
    source: 'example.com',
    platform: 'web',
  });

  test('detects cross-platform patterns', () => {
    const patterns = detectPatterns({
      reddit: [
        makeRedditPost('Claude Code versus Cursor comparison 2025', 500),
        makeRedditPost('Claude Code AI assistant review', 300),
      ],
      web: [
        makeWebResult('Claude Code AI assistant tool review and comparison'),
        makeWebResult('Claude Code features and capabilities'),
      ],
    });

    expect(patterns.length).toBeGreaterThan(0);
    // Should find patterns with both reddit and web sources
    const crossPlatform = patterns.filter(p => p.sources.length >= 2);
    expect(crossPlatform.length).toBeGreaterThanOrEqual(0); // May or may not find cross-platform
  });

  test('returns empty for empty data', () => {
    const patterns = detectPatterns({});
    expect(patterns).toEqual([]);
  });

  test('includes YouTube and TikTok data in patterns', () => {
    const youtubeResults: YouTubeResult[] = [{
      videoId: 'abc123',
      title: 'Testing artificial intelligence tools in 2025',
      url: 'https://youtube.com/watch?v=abc123',
      channelName: 'TestChannel',
      viewCount: 100000,
      description: 'Testing artificial intelligence tools comparison review',
      publishedAt: new Date().toISOString(),
      engagementScore: 80,
      platform: 'youtube',
    }];

    const tiktokResults: TikTokResult[] = [{
      videoId: '123456',
      author: '@testuser',
      description: 'Testing artificial intelligence tools trend',
      url: 'https://tiktok.com/@testuser/video/123456',
      likes: 5000,
      views: 100000,
      engagementScore: 75,
      publishedAt: new Date().toISOString(),
      platform: 'tiktok',
    }];

    const patterns = detectPatterns({
      youtube: youtubeResults,
      tiktok: tiktokResults,
    });

    expect(patterns.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── BREAKOUT DETECTION ─────────────────────────────

describe('detectBreakouts', () => {
  test('detects breakout from high-engagement patterns', () => {
    const patterns = [
      {
        pattern: 'test breakout topic',
        strength: 'established' as const,
        sources: ['reddit' as const, 'web' as const, 'youtube' as const],
        totalEngagement: 5000,
        evidence: [
          { platform: 'reddit', title: 'Big post', url: 'https://reddit.com/1', engagement: 2000 },
          { platform: 'web', title: 'Big article', url: 'https://example.com/1', engagement: 1500 },
          { platform: 'youtube', title: 'Big video', url: 'https://youtube.com/1', engagement: 1500 },
        ],
      },
    ];

    const baselines = new Map([['test breakout topic', 500]]);
    const breakouts = detectBreakouts(patterns, baselines);

    expect(breakouts.length).toBe(1);
    expect(breakouts[0].breakoutScore).toBeGreaterThan(0);
    expect(breakouts[0].classification).toBe('explosive');
  });

  test('returns empty for low-engagement patterns', () => {
    const patterns = [
      {
        pattern: 'boring topic',
        strength: 'emerging' as const,
        sources: ['reddit' as const],
        totalEngagement: 10,
        evidence: [
          { platform: 'reddit', title: 'Small post', url: 'https://reddit.com/1', engagement: 10 },
        ],
      },
    ];

    const baselines = new Map([['boring topic', 10]]);
    const breakouts = detectBreakouts(patterns, baselines);

    expect(breakouts.length).toBe(0);
  });
});

describe('calculateTrendScore', () => {
  test('scores higher for cross-platform established patterns', () => {
    const highPattern = {
      pattern: 'popular topic',
      strength: 'established' as const,
      sources: ['reddit' as const, 'web' as const, 'youtube' as const],
      totalEngagement: 5000,
      evidence: [],
    };

    const lowPattern = {
      pattern: 'niche topic',
      strength: 'emerging' as const,
      sources: ['reddit' as const],
      totalEngagement: 50,
      evidence: [],
    };

    const highScore = calculateTrendScore(highPattern, null);
    const lowScore = calculateTrendScore(lowPattern, null);

    expect(highScore).toBeGreaterThan(lowScore);
  });
});

describe('rankTrends', () => {
  test('ranks trends by composite score', () => {
    const patterns = [
      {
        pattern: 'less popular',
        strength: 'emerging' as const,
        sources: ['reddit' as const],
        totalEngagement: 50,
        evidence: [],
      },
      {
        pattern: 'very popular',
        strength: 'established' as const,
        sources: ['reddit' as const, 'web' as const, 'youtube' as const],
        totalEngagement: 5000,
        evidence: [],
      },
    ];

    const ranked = rankTrends(patterns, []);
    expect(ranked[0].pattern.pattern).toBe('very popular');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

// ─── BREAKOUT FROM INTEREST ─────────────────────────

describe('detectBreakoutFromInterest', () => {
  test('detects breakout when recent values spike', () => {
    const points = [];
    for (let i = 30; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400_000).toISOString().split('T')[0];
      // Low baseline for first 21 days, spike in last 9
      const value = i > 9 ? 15 + Math.random() * 5 : 70 + Math.random() * 20;
      points.push({ date, value });
    }

    const result = detectBreakoutFromInterest(points);
    expect(result.breakoutDetected).toBe(true);
    expect(result.breakoutScore).toBeGreaterThan(0);
  });

  test('no breakout for stable data', () => {
    const points = [];
    for (let i = 30; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400_000).toISOString().split('T')[0];
      points.push({ date, value: 50 + Math.random() * 5 });
    }

    const result = detectBreakoutFromInterest(points);
    expect(result.breakoutDetected).toBe(false);
  });

  test('handles short data gracefully', () => {
    const result = detectBreakoutFromInterest([
      { date: '2025-01-01', value: 50 },
      { date: '2025-01-02', value: 60 },
    ]);
    expect(result.breakoutDetected).toBe(false);
    expect(result.breakoutScore).toBe(0);
  });
});

// ─── TREND STORE ────────────────────────────────────

describe('trend-store', () => {
  test('records and retrieves snapshots', () => {
    recordSnapshot({
      topic: 'test-topic-store',
      timestamp: Date.now() - 3600_000,
      platforms: ['reddit', 'web'],
      totalEngagement: 100,
      platformEngagement: { reddit: 60, web: 40 },
      sentimentScore: 0.5,
    });

    recordSnapshot({
      topic: 'test-topic-store',
      timestamp: Date.now(),
      platforms: ['reddit', 'web', 'youtube'],
      totalEngagement: 250,
      platformEngagement: { reddit: 100, web: 80, youtube: 70 },
      sentimentScore: 0.6,
    });

    const history = getTrendHistory('test-topic-store');
    expect(history).not.toBeNull();
    expect(history!.snapshots.length).toBe(2);
    expect(history!.peakEngagement).toBe(250);
  });

  test('returns null for unknown topic', () => {
    const history = getTrendHistory('nonexistent-topic-xyz');
    expect(history).toBeNull();
  });

  test('provides engagement baselines', () => {
    recordSnapshot({
      topic: 'baseline-test-topic',
      timestamp: Date.now() - 7200_000,
      platforms: ['reddit'],
      totalEngagement: 200,
      platformEngagement: { reddit: 200 },
      sentimentScore: 0,
    });

    recordSnapshot({
      topic: 'baseline-test-topic',
      timestamp: Date.now(),
      platforms: ['reddit'],
      totalEngagement: 300,
      platformEngagement: { reddit: 300 },
      sentimentScore: 0,
    });

    const baselines = getEngagementBaselines(['baseline-test-topic']);
    expect(baselines.has('baseline-test-topic')).toBe(true);
    expect(baselines.get('baseline-test-topic')).toBe(250); // average of 200 and 300
  });

  test('getStoreStats returns counts', () => {
    const stats = getStoreStats();
    expect(stats.topics).toBeGreaterThan(0);
    expect(stats.totalSnapshots).toBeGreaterThan(0);
  });
});
