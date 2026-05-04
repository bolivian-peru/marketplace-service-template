

/**
 * Test suite for Amazon Product & BSR Tracker API
 */

import { describe, expect, test, beforeAll } from 'bun:test';
import { getAmazonProduct } from '../src/amazon/products';
import { getAmazonBSR } from '../src/amazon/bsr';
import { serviceRouter } from '../src/service';
import { Hono } from 'hono';

// Test configuration
const TEST_ASIN = 'B08N5KWB9H'; // Example ASIN for testing
const TEST_CATEGORY = 'electronics';
const TEST_MARKETPLACES = ['US', 'UK', 'DE'];

// Helper function to create a test app
function createTestApp() {
  const app = new Hono();
  app.route('/api', serviceRouter);
  return app;
}

describe('Amazon Product Tracker', () => {
  test('should extract product data from Amazon', async () => {
    for (const marketplace of TEST_MARKETPLACES) {
      const product = await getAmazonProduct(TEST_ASIN, marketplace);

      // Basic validation
      expect(product).toBeDefined();
      expect(product.asin).toBe(TEST_ASIN);
      expect(product.title).toBeTruthy();
      expect(product.brand).toBeTruthy();
      expect(product.price.current).toBeGreaterThanOrEqual(0);
      expect(product.rating).toBeGreaterThanOrEqual(0);
      expect(product.reviews_count).toBeGreaterThanOrEqual(0);
      expect(product.availability).toBeTruthy();
      expect(product.images.length).toBeGreaterThan(0);
      expect(product.meta.marketplace).toBe(marketplace);
      expect(product.meta.proxy.type).toBe('mobile');
    }
  }, { timeout: 30000 });

  test('should handle invalid ASIN gracefully', async () => {
    try {
      await getAmazonProduct('INVALID_ASIN', 'US');
      // If we get here, the test failed
      expect(true).toBe(false);
    } catch (error) {
      // Expected to fail
      expect(error).toBeDefined();
    }
  }, { timeout: 10000 });
});

describe('Amazon BSR Tracker', () => {
  test('should extract BSR data from Amazon', async () => {
    for (const marketplace of TEST_MARKETPLACES) {
      const bsrData = await getAmazonBSR(TEST_CATEGORY, marketplace);

      // Basic validation
      expect(bsrData).toBeDefined();
      expect(bsrData.category).toBeTruthy();
      expect(bsrData.products.length).toBeGreaterThan(0);
      expect(bsrData.meta.marketplace).toBe(marketplace);
      expect(bsrData.meta.proxy.type).toBe('mobile');
    }
  }, { timeout: 30000 });

  test('should handle invalid category gracefully', async () => {
    try {
      await getAmazonBSR('INVALID_CATEGORY', 'US');
      // If we get here, the test failed
      expect(true).toBe(false);
    } catch (error) {
      // Expected to fail
      expect(error).toBeDefined();
    }
  }, { timeout: 10000 });
});

describe('Amazon API Routes', () => {
  const app = createTestApp();

  test('should return 402 for product endpoint without payment', async () => {
    const response = await app.request(`/api/amazon/product/${TEST_ASIN}?marketplace=US`);
    expect(response.status).toBe(402);
  });

  test('should return 402 for BSR endpoint without payment', async () => {
    const response = await app.request(`/api/amazon/bsr?category=${TEST_CATEGORY}&marketplace=US`);
    expect(response.status).toBe(402);
  });

  test('should return 400 for missing ASIN parameter', async () => {
    const response = await app.request('/api/amazon/product/?marketplace=US');
    expect(response.status).toBe(400);
  });

  test('should return 400 for missing category parameter', async () => {
    const response = await app.request('/api/amazon/bsr?marketplace=US');
    expect(response.status).toBe(400);
  });
});

