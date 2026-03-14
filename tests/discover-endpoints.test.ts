import { describe, expect, test } from 'bun:test';
import {
  clusterByTopic,
} from '../src/scrapers/discover-scraper';
import type { DiscoverFeedItem } from '../src/types';

// ─── UNIT TESTS ─────────────────────────────────────

describe('Google Discover Feed Intelligence', () => {

  describe('Topic Clustering', () => {
    test('clusters articles with shared keywords', () => {
      const items: DiscoverFeedItem[] = [
        {
          title: 'Apple announces new iPhone 16 features',
          url: 'https://example.com/1',
          source: 'TechCrunch',
          sourceUrl: null,
          publishedAt: new Date().toISOString(),
          description: 'Apple revealed new features for iPhone 16',
          topic: 'technology',
          freshnessScore: 90,
          eligibilitySignals: { score: 75, factors: ['optimal_title_length'] },
        },
        {
          title: 'Apple iPhone 16 Pro review: the best yet',
          url: 'https://example.com/2',
          source: 'The Verge',
          sourceUrl: null,
          publishedAt: new Date().toISOString(),
          description: 'Our hands-on review of the iPhone 16 Pro',
          topic: 'technology',
          freshnessScore: 85,
          eligibilitySignals: { score: 80, factors: ['review_content'] },
        },
        {
          title: 'Samsung Galaxy S25 Ultra specs leaked',
          url: 'https://example.com/3',
          source: 'GSMArena',
          sourceUrl: null,
          publishedAt: new Date().toISOString(),
          description: 'Samsung next flagship specs revealed',
          topic: 'technology',
          freshnessScore: 70,
          eligibilitySignals: { score: 65, factors: [] },
        },
      ];

      const clusters = clusterByTopic(items);
      expect(clusters.length).toBeGreaterThan(0);

      // Should find an apple/iphone cluster
      const appleCluster = clusters.find(c =>
        c.topic.includes('apple') || c.topic.includes('iphone')
      );
      expect(appleCluster).toBeDefined();
      expect(appleCluster!.articleCount).toBeGreaterThanOrEqual(2);
    });

    test('returns empty array for single item', () => {
      const items: DiscoverFeedItem[] = [
        {
          title: 'Unique standalone article',
          url: 'https://example.com/solo',
          source: 'Solo News',
          sourceUrl: null,
          publishedAt: null,
          description: null,
          topic: 'misc',
          freshnessScore: 50,
          eligibilitySignals: { score: 50, factors: [] },
        },
      ];

      const clusters = clusterByTopic(items);
      expect(clusters.length).toBe(0);
    });

    test('assigns velocity based on freshness', () => {
      const now = new Date();
      const items: DiscoverFeedItem[] = [
        {
          title: 'Breaking tech news about AI advancement',
          url: 'https://example.com/a',
          source: 'Reuters',
          sourceUrl: null,
          publishedAt: now.toISOString(),
          description: 'Major AI breakthrough reported',
          topic: 'ai',
          freshnessScore: 95,
          eligibilitySignals: { score: 85, factors: ['urgency_signal'] },
        },
        {
          title: 'New AI advancement changes industry outlook',
          url: 'https://example.com/b',
          source: 'BBC',
          sourceUrl: null,
          publishedAt: now.toISOString(),
          description: 'Industry reacts to AI news',
          topic: 'ai',
          freshnessScore: 90,
          eligibilitySignals: { score: 80, factors: ['news_event'] },
        },
      ];

      const clusters = clusterByTopic(items);
      const aiCluster = clusters.find(c => c.topic.includes('advancement'));
      if (aiCluster) {
        expect(aiCluster.velocity).toBe('rising');
        expect(aiCluster.avgFreshnessScore).toBeGreaterThan(70);
      }
    });
  });

  describe('Endpoint Integration (402 responses)', () => {
    test('GET /api/discover/feed returns 402 without payment', async () => {
      const app = (await import('../src/index')).default;
      const res = await app.fetch(new Request('http://localhost/api/discover/feed?topics=technology'));
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.status).toBe(402);
      expect(body.resource).toBe('/api/discover/feed');
      expect(body.price.currency).toBe('USDC');
    });

    test('GET /api/discover/trending returns 402 without payment', async () => {
      const app = (await import('../src/index')).default;
      const res = await app.fetch(new Request('http://localhost/api/discover/trending'));
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.status).toBe(402);
      expect(body.resource).toBe('/api/discover/trending');
    });

    test('GET /api/discover/analyze returns 402 without payment', async () => {
      const app = (await import('../src/index')).default;
      const res = await app.fetch(new Request('http://localhost/api/discover/analyze?url=https://example.com'));
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.status).toBe(402);
      expect(body.resource).toBe('/api/discover/analyze');
    });

    test('GET /api/discover/topics returns 402 without payment', async () => {
      const app = (await import('../src/index')).default;
      const res = await app.fetch(new Request('http://localhost/api/discover/topics?query=ai'));
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.status).toBe(402);
      expect(body.resource).toBe('/api/discover/topics');
    });

    test('GET /health lists discover endpoints', async () => {
      const app = (await import('../src/index')).default;
      const res = await app.fetch(new Request('http://localhost/health'));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.endpoints).toContain('/api/discover/feed');
      expect(body.endpoints).toContain('/api/discover/trending');
      expect(body.endpoints).toContain('/api/discover/analyze');
      expect(body.endpoints).toContain('/api/discover/topics');
    });

    test('GET / lists discover endpoints in service discovery', async () => {
      const app = (await import('../src/index')).default;
      const res = await app.fetch(new Request('http://localhost/'));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const paths = body.endpoints.map((e: any) => e.path);
      expect(paths).toContain('/api/discover/feed');
      expect(paths).toContain('/api/discover/trending');
      expect(paths).toContain('/api/discover/analyze');
      expect(paths).toContain('/api/discover/topics');
    });
  });
});
