

/**
 * Tests for Google Discover Feed Intelligence API
 */

import { describe, expect, test } from 'bun:test';
import { fetchDiscoverFeed, extractDiscoverFeed, DiscoverFeedItem, DiscoverFeedResponse } from '../src/google/discover';

describe('Google Discover API', () => {
  describe('extractDiscoverFeed', () => {
    test('should return mock data with correct structure', () => {
      const html = '<html></html>';
      const country = 'US';
      const category = 'technology';

      const result = extractDiscoverFeed(html, country, category);

      // Should return an array of DiscoverFeedItem
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Check the structure of the first item
      const firstItem = result[0];
      expect(firstItem).toHaveProperty('position');
      expect(firstItem).toHaveProperty('title');
      expect(firstItem).toHaveProperty('source');
      expect(firstItem).toHaveProperty('sourceUrl');
      expect(firstItem).toHaveProperty('url');
      expect(firstItem).toHaveProperty('snippet');
      expect(firstItem).toHaveProperty('imageUrl');
      expect(firstItem).toHaveProperty('contentType');
      expect(firstItem).toHaveProperty('publishedAt');
      expect(firstItem).toHaveProperty('category');
      expect(firstItem).toHaveProperty('engagement');
    });

    test('should generate different content for different countries', () => {
      const html = '<html></html>';
      const usFeed = extractDiscoverFeed(html, 'US', 'technology');
      const deFeed = extractDiscoverFeed(html, 'DE', 'technology');

      // Should have same number of items
      expect(usFeed.length).toBe(deFeed.length);

      // But different titles (mock data)
      expect(usFeed[0].title).not.toBe(deFeed[0].title);
    });

    test('should generate different content for different categories', () => {
      const html = '<html></html>';
      const techFeed = extractDiscoverFeed(html, 'US', 'technology');
      const newsFeed = extractDiscoverFeed(html, 'US', 'news');

      // Should have same number of items
      expect(techFeed.length).toBe(newsFeed.length);

      // But different titles (mock data)
      expect(techFeed[0].title).not.toBe(newsFeed[0].title);
    });
  });

  describe('fetchDiscoverFeed', () => {
    test('should throw error for unsupported country', async () => {
      const params = { country: 'XX', category: 'technology' };

      await expect(fetchDiscoverFeed(params)).rejects.toThrow('Unsupported country: XX');
    });

    test('should return response with correct structure', async () => {
      const params = { country: 'US', category: 'technology', limit: 5 };

      const result = await fetchDiscoverFeed(params);

      // Should have correct structure
      expect(result).toHaveProperty('country', 'US');
      expect(result).toHaveProperty('category', 'technology');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('discover_feed');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('proxy');
      expect(result).toHaveProperty('payment');

      // Check discover_feed structure
      expect(Array.isArray(result.discover_feed)).toBe(true);
      if (result.discover_feed.length > 0) {
        const firstItem = result.discover_feed[0];
        expect(firstItem).toHaveProperty('position');
        expect(firstItem).toHaveProperty('title');
        expect(firstItem).toHaveProperty('source');
        expect(firstItem).toHaveProperty('sourceUrl');
        expect(firstItem).toHaveProperty('url');
        expect(firstItem).toHaveProperty('snippet');
        expect(firstItem).toHaveProperty('imageUrl');
        expect(firstItem).toHaveProperty('contentType');
        expect(firstItem).toHaveProperty('publishedAt');
        expect(firstItem).toHaveProperty('category');
        expect(firstItem).toHaveProperty('engagement');
      }

      // Check metadata structure
      expect(result.metadata).toHaveProperty('feedLength');
      expect(result.metadata).toHaveProperty('scrapedAt');
      expect(result.metadata).toHaveProperty('proxyCountry');
      expect(result.metadata).toHaveProperty('proxyCarrier');

      // Check proxy structure
      expect(result.proxy).toHaveProperty('country');
      expect(result.proxy).toHaveProperty('carrier');
      expect(result.proxy).toHaveProperty('type', 'mobile');

      // Check payment structure
      expect(result.payment).toHaveProperty('txHash');
      expect(result.payment).toHaveProperty('amount', 0.02);
      expect(result.payment).toHaveProperty('verified', true);
    });

    test('should respect limit parameter', async () => {
      const params1 = { country: 'US', category: 'technology', limit: 2 };
      const params2 = { country: 'US', category: 'technology', limit: 10 };

      const result1 = await fetchDiscoverFeed(params1);
      const result2 = await fetchDiscoverFeed(params2);

      expect(result1.discover_feed.length).toBe(2);
      expect(result2.discover_feed.length).toBe(10);
    });
  });
});
