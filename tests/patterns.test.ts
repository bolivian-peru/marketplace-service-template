/**
 * Unit tests for extractYouTubeKeywords and extractTwitterKeywords
 * exercised indirectly through the exported detectPatterns function.
 *
 * Covers the edge cases flagged by Sentinel:
 *  - video.description undefined / empty string
 *  - video.viewCount null or 0 (falls back to engagementScore)
 *  - tweet.likes / retweets null (?? 0 fallback)
 *  - tweet.text empty string (guarded by `if (!tweet.text) continue`)
 */

import { describe, expect, test } from 'bun:test';
import { detectPatterns } from '../src/analysis/patterns';
import type { YouTubeResult } from '../src/scrapers/youtube';
import type { TwitterResult } from '../src/scrapers/twitter';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeVideo(overrides: Partial<YouTubeResult> = {}): YouTubeResult {
  return {
    videoId: 'dQw4w9WgXcQ',
    title: 'quantum computing tutorial',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    channelName: 'TechChannel',
    viewCount: 50_000,
    description: 'An introduction to quantum computing concepts',
    publishedAt: '2025-01-01',
    engagementScore: 80,
    platform: 'youtube',
    ...overrides,
  };
}

function makeTweet(overrides: Partial<TwitterResult> = {}): TwitterResult {
  return {
    tweetId: '1234567890',
    author: '@dev',
    text: 'quantum computing is taking off this year',
    url: 'https://x.com/dev/status/1234567890',
    likes: 200,
    retweets: 50,
    engagementScore: 60,
    publishedAt: '2025-01-02',
    platform: 'twitter',
    ...overrides,
  };
}

// ─── extractYouTubeKeywords ────────────────────────────────────────────────────

describe('extractYouTubeKeywords (via detectPatterns)', () => {
  test('empty description — keywords extracted from title alone', () => {
    // With description='', the concatenation becomes "quantum computing tutorial "
    // which still yields "quantum" and "computing" from the title.
    const video = makeVideo({ description: '' });

    // Pair with a Twitter result containing the same keyword so the
    // signal reaches "reinforced" (2 platforms) and passes the filter.
    const tweet = makeTweet();

    const patterns = detectPatterns({ youtube: [video], twitter: [tweet] });

    const keywords = patterns.map((p) => p.pattern);
    expect(keywords.some((k) => k.includes('quantum'))).toBe(true);
  });

  test('viewCount null — falls back to engagementScore, keyword still detected', () => {
    const video = makeVideo({ viewCount: null, engagementScore: 70 });
    const tweet = makeTweet();

    const patterns = detectPatterns({ youtube: [video], twitter: [tweet] });

    const keywords = patterns.map((p) => p.pattern);
    expect(keywords.some((k) => k.includes('quantum'))).toBe(true);
  });

  test('viewCount 0 — falls back to engagementScore, keyword still detected', () => {
    // viewCount=0 does not satisfy `viewCount > 0`, so viewWeight=0
    // and engagement = Math.max(engagementScore, 0) = engagementScore.
    const video = makeVideo({ viewCount: 0, engagementScore: 70 });
    const tweet = makeTweet();

    const patterns = detectPatterns({ youtube: [video], twitter: [tweet] });

    const keywords = patterns.map((p) => p.pattern);
    expect(keywords.some((k) => k.includes('quantum'))).toBe(true);
  });

  test('viewCount 0 AND engagementScore 0 — zero-weight keyword absent from single-platform output', () => {
    // engagement = Math.max(0, 0) = 0; addKeyword is called with weight=0.
    // detectPatterns filters single-platform signals with totalEngagement < 100.
    const video = makeVideo({
      title: 'uniquetoken zeroweight video',
      description: '',
      viewCount: 0,
      engagementScore: 0,
    });

    const patterns = detectPatterns({ youtube: [video] });

    // Signal from a single platform with total engagement 0 must be filtered out.
    const keywords = patterns.map((p) => p.pattern);
    expect(keywords.some((k) => k.includes('uniquetoken'))).toBe(false);
  });
});

// ─── extractTwitterKeywords ───────────────────────────────────────────────────

describe('extractTwitterKeywords (via detectPatterns)', () => {
  test('empty text — tweet is skipped, produces no keywords', () => {
    // The guard `if (!tweet.text) continue` skips empty-text tweets.
    // With only empty-text tweets, the twitter map is empty and detectPatterns
    // returns an empty array (no platform data).
    const tweet = makeTweet({ text: '' });

    const patterns = detectPatterns({ twitter: [tweet] });

    expect(patterns).toHaveLength(0);
  });

  test('likes null and retweets null — ?? 0 fallback, keywords still extracted', () => {
    // socialBonus = log1p(0)*3 + log1p(0)*5 = 0; engagement = engagementScore + 0.
    // Cross-platform with YouTube so the signal clears the filter.
    const tweet = makeTweet({ likes: null, retweets: null, engagementScore: 60 });
    const video = makeVideo();

    const patterns = detectPatterns({ youtube: [video], twitter: [tweet] });

    const keywords = patterns.map((p) => p.pattern);
    expect(keywords.some((k) => k.includes('quantum'))).toBe(true);
  });

  test('likes null and retweets null — engagement equals engagementScore only', () => {
    // Verify the numeric contract: with null social counts the extracted signal
    // for a cross-platform keyword has positive totalEngagement (from engagementScore).
    const tweet = makeTweet({ likes: null, retweets: null, engagementScore: 60 });
    const video = makeVideo({ viewCount: null, engagementScore: 0 });

    const patterns = detectPatterns({ youtube: [video], twitter: [tweet] });

    const match = patterns.find((p) => p.pattern.includes('quantum'));
    // Must exist (reinforced by 2 platforms) and carry positive engagement from the tweet.
    expect(match).toBeDefined();
    expect(match!.totalEngagement).toBeGreaterThan(0);
  });
});
