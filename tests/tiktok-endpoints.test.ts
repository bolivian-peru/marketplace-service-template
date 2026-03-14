import { describe, expect, test } from 'bun:test';
import app from '../src/index';
import {
  calculateTrendScore,
  predictViralPotential,
  type TikTokVideo,
} from '../src/scrapers/tiktok-scraper';

// ─── Unit tests for trend scoring and viral prediction ─────

describe('TikTok Trend Intelligence', () => {
  const mockVideo: TikTokVideo = {
    id: '7341234567890',
    description: 'Test video #ai #viral',
    author: { username: 'testcreator', followers: 1200000 },
    stats: { views: 5400000, likes: 340000, comments: 12000, shares: 45000, saves: 8000 },
    sound: { name: 'Original Sound', author: 'testcreator' },
    hashtags: ['ai', 'viral'],
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
    url: 'https://www.tiktok.com/@testcreator/video/7341234567890',
    duration: 30,
    isAd: false,
  };

  test('calculateTrendScore returns 0-100', () => {
    const score = calculateTrendScore(mockVideo);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('calculateTrendScore gives higher score to viral videos', () => {
    const viralVideo = { ...mockVideo, stats: { views: 50000000, likes: 5000000, comments: 200000, shares: 500000, saves: 100000 } };
    const lowVideo = { ...mockVideo, stats: { views: 100, likes: 5, comments: 0, shares: 0, saves: 0 } };

    const viralScore = calculateTrendScore(viralVideo);
    const lowScore = calculateTrendScore(lowVideo);

    expect(viralScore).toBeGreaterThan(lowScore);
  });

  test('predictViralPotential returns score, verdict, and factors', () => {
    const prediction = predictViralPotential(mockVideo);

    expect(prediction).toHaveProperty('score');
    expect(prediction).toHaveProperty('verdict');
    expect(prediction).toHaveProperty('factors');
    expect(prediction.score).toBeGreaterThanOrEqual(0);
    expect(prediction.score).toBeLessThanOrEqual(100);
    expect(typeof prediction.verdict).toBe('string');
    expect(Array.isArray(prediction.factors)).toBe(true);
  });

  test('predictViralPotential identifies high engagement', () => {
    const highEngagement: TikTokVideo = {
      ...mockVideo,
      stats: { views: 1000000, likes: 150000, comments: 50000, shares: 30000, saves: 20000 },
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    };

    const prediction = predictViralPotential(highEngagement);
    expect(prediction.score).toBeGreaterThan(30);
    expect(prediction.factors.length).toBeGreaterThan(0);
  });

  // ─── API endpoint tests (402 payment flow) ─────

  test('GET /api/tiktok/trending returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/trending?country=US'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.message).toBe('Payment required');
    expect(body.resource).toBe('/api/tiktok/trending');
  });

  test('GET /api/tiktok/hashtag returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/hashtag?tag=ai'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/tiktok/hashtag');
  });

  test('GET /api/tiktok/creator returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/creator?username=charlidamelio'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/tiktok/creator');
  });

  test('GET /api/tiktok/sound returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/sound?id=12345'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/tiktok/sound');
  });

  test('GET /api/tiktok/search returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/search?query=test'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/tiktok/search');
  });

  test('GET /api/tiktok/video returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/video?id=7341234567890'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/tiktok/video');
  });

  test('Health check includes TikTok endpoints', async () => {
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.endpoints).toContain('/api/tiktok/trending');
    expect(body.endpoints).toContain('/api/tiktok/hashtag');
    expect(body.endpoints).toContain('/api/tiktok/creator');
    expect(body.endpoints).toContain('/api/tiktok/sound');
    expect(body.endpoints).toContain('/api/tiktok/search');
    expect(body.endpoints).toContain('/api/tiktok/video');
  });

  test('Service discovery includes TikTok endpoints', async () => {
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const paths = body.endpoints.map((e: any) => e.path);
    expect(paths).toContain('/api/tiktok/trending');
    expect(paths).toContain('/api/tiktok/creator');
  });

  test('402 response includes payment networks', async () => {
    const res = await app.fetch(new Request('http://localhost/api/tiktok/trending'));
    const body = await res.json() as any;
    expect(body.networks).toBeDefined();
    expect(body.networks.length).toBeGreaterThan(0);
    expect(body.networks[0]).toHaveProperty('network');
    expect(body.networks[0]).toHaveProperty('recipient');
    expect(body.networks[0]).toHaveProperty('asset');
  });
});
