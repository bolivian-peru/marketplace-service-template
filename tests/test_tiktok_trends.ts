

/**
 * Tests for TikTok Trend Intelligence API
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tiktokRouter } from '../src/routes/tiktok';
import { Hono } from 'hono';
import { type Context } from 'hono';

// Mock the payment verification
jest.mock('../src/payment', () => ({
  extractPayment: jest.fn().mockReturnValue({
    txHash: 'mock-tx-hash',
    network: 'solana',
  }),
  verifyPayment: jest.fn().mockResolvedValue({
    valid: true,
    amount: 0.05,
  }),
  build402Response: jest.fn().mockReturnValue({
    status: 402,
    body: {
      error: 'Payment required',
      payment: {
        wallet: 'mock-wallet-address',
        amount: 0.05,
        networks: ['solana', 'base'],
      },
    },
  }),
}));

// Mock the proxy
jest.mock('../src/proxy', () => ({
  getProxy: jest.fn().mockReturnValue({
    country: 'US',
    host: 'proxy.proxies.sx',
  }),
}));

// Mock the TikTok scraper functions
jest.mock('../src/scrapers/tiktok-scraper', () => ({
  getTikTokTrending: jest.fn().mockResolvedValue([
    {
      id: 'trend_1',
      title: 'Test Trending Topic',
      description: 'Test description',
      url: 'https://www.tiktok.com/trending/topic/1',
      views: 1000000,
      likes: 500000,
      comments: 10000,
      shares: 50000,
      hashtags: ['#test', '#trending'],
      platform: 'tiktok',
      country: 'US',
      timestamp: new Date().toISOString(),
    },
  ]),
  getTikTokHashtag: jest.fn().mockResolvedValue({
    tag: 'test',
    name: '#test',
    videos: 100000,
    views: 50000000,
    followers: 10000,
    topVideos: [
      {
        id: 'video_test_1',
        title: 'Test video with #test',
        url: 'https://www.tiktok.com/@testuser/video/1',
        views: 100000,
        likes: 50000,
        comments: 1000,
        shares: 5000,
        creator: '@testuser',
        timestamp: new Date().toISOString(),
      },
    ],
    trending: true,
    country: 'US',
    timestamp: new Date().toISOString(),
  }),
  getTikTokCreator: jest.fn().mockResolvedValue({
    username: '@testcreator',
    name: 'Test Creator',
    bio: 'Test bio',
    followers: 1000000,
    following: 1000,
    likes: 5000000,
    videos: 100,
    verified: false,
    topVideos: [
      {
        id: 'video_testcreator_1',
        title: 'Test video by @testcreator',
        url: 'https://www.tiktok.com/@testcreator/video/1',
        views: 100000,
        likes: 50000,
        comments: 1000,
        shares: 5000,
        timestamp: new Date().toISOString(),
      },
    ],
    country: 'US',
    timestamp: new Date().toISOString(),
  }),
  getTikTokSound: jest.fn().mockResolvedValue({
    id: '12345',
    title: 'Test Sound',
    author: 'Test Artist',
    duration: 30,
    plays: 1000000,
    videos: 5000,
    trending: true,
    country: 'US',
    timestamp: new Date().toISOString(),
  }),
}));

describe('TikTok Trend Intelligence API', () => {
  const app = new Hono();
  app.route('/api/tiktok', tiktokRouter);

  beforeAll(() => {
    // Setup any test environment
  });

  afterAll(() => {
    // Cleanup after tests
  });

  describe('GET /api/tiktok/trending', () => {
    it('should return trending TikTok content', async () => {
      const req = new Request('http://localhost/api/tiktok/trending?country=US&limit=10');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('trending');
      expect(data.country).toBe('US');
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should handle missing country parameter', async () => {
      const req = new Request('http://localhost/api/tiktok/trending?limit=10');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('trending');
      expect(data.country).toBe('US'); // Default country
    });

    it('should handle missing limit parameter', async () => {
      const req = new Request('http://localhost/api/tiktok/trending?country=US');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('trending');
      expect(data.data).toBeDefined();
    });
  });

  describe('GET /api/tiktok/hashtag', () => {
    it('should return TikTok hashtag data', async () => {
      const req = new Request('http://localhost/api/tiktok/hashtag?tag=test&country=US&limit=5');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('hashtag');
      expect(data.country).toBe('US');
      expect(data.data).toBeDefined();
      expect(data.data.tag).toBe('test');
      expect(data.data.name).toBe('#test');
    });

    it('should return error for missing tag parameter', async () => {
      const req = new Request('http://localhost/api/tiktok/hashtag?country=US&limit=5');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Missing required parameter');
    });
  });

  describe('GET /api/tiktok/creator', () => {
    it('should return TikTok creator data', async () => {
      const req = new Request('http://localhost/api/tiktok/creator?username=@testcreator&country=US&limit=5');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('creator');
      expect(data.country).toBe('US');
      expect(data.data).toBeDefined();
      expect(data.data.username).toBe('@testcreator');
    });

    it('should handle username without @ prefix', async () => {
      const req = new Request('http://localhost/api/tiktok/creator?username=testcreator&country=US&limit=5');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('creator');
      expect(data.data.username).toBe('@testcreator');
    });

    it('should return error for missing username parameter', async () => {
      const req = new Request('http://localhost/api/tiktok/creator?country=US&limit=5');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Missing required parameter');
    });
  });

  describe('GET /api/tiktok/sound', () => {
    it('should return TikTok sound data', async () => {
      const req = new Request('http://localhost/api/tiktok/sound?id=12345&country=US');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.type).toBe('sound');
      expect(data.country).toBe('US');
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe('12345');
    });

    it('should return error for missing id parameter', async () => {
      const req = new Request('http://localhost/api/tiktok/sound?country=US');
      const res = await app.request(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Missing required parameter');
    });
  });
});
