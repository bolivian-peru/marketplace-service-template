

/**
 * Tests for Facebook Marketplace API
 * --------------------------------
 * Tests for the Facebook Marketplace Monitor API endpoints.
 */

import { describe, expect, test, beforeAll } from 'bun:test';
import { FacebookMarketplace } from '../src/facebook/marketplace';
import { serviceRouter } from '../src/service';
import { Hono } from 'hono';

// Mock the proxyFetch function to avoid actual network requests
jest.mock('../src/proxy', () => ({
  proxyFetch: jest.fn().mockImplementation((url: string) => {
    // Return a mock response based on the URL
    if (url.includes('/search/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`
          <html>
            <body>
              <div data-ad-id="12345">iPhone 15 for sale</div>
              <div data-ad-id="67890">MacBook Pro 14"</div>
            </body>
          </html>
        `),
      } as Response);
    } else if (url.includes('/item/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`
          <html>
            <head><title>iPhone 15 for sale</title></head>
            <body>
              <span>$999</span>
              <span>Brooklyn, NY</span>
              <img src="https://example.com/image.jpg" alt="iPhone 15">
            </body>
          </html>
        `),
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    } as Response);
  }),
  getProxy: jest.fn().mockReturnValue({
    url: 'http://proxy.example.com:8080',
    host: 'proxy.example.com',
    port: 8080,
    user: 'user',
    pass: 'pass',
    country: 'US',
  }),
}));

// Mock the payment verification
jest.mock('../src/payment', () => ({
  extractPayment: jest.fn().mockReturnValue({
    txHash: 'mock-tx-hash',
    network: 'solana',
  }),
  verifyPayment: jest.fn().mockResolvedValue({
    valid: true,
    amount: 0.01,
  }),
  build402Response: jest.fn().mockReturnValue({
    status: 402,
    message: 'Payment required',
  }),
}));

describe('Facebook Marketplace API', () => {
  beforeAll(() => {
    // Set up environment variables
    process.env.WALLET_ADDRESS = 'mock-wallet-address';
  });

  describe('FacebookMarketplace class', () => {
    test('search should return listings', async () => {
      const result = await FacebookMarketplace.search({
        query: 'iPhone 15',
        location: 'New York',
      });

      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });

    test('getListingDetails should return listing details', async () => {
      const listing = await FacebookMarketplace.getListingDetails('12345');

      expect(listing).toBeDefined();
      expect(listing.title).toBeDefined();
      expect(listing.price).toBeGreaterThan(0);
    });

    test('getCategories should return categories', async () => {
      const categories = await FacebookMarketplace.getCategories('New York');

      expect(categories).toBeDefined();
      expect(categories.length).toBeGreaterThan(0);
    });

    test('monitorNewListings should return new listings', async () => {
      const result = await FacebookMarketplace.monitorNewListings({
        query: 'iPhone 15',
        since: '1h',
      });

      expect(result.new_listings).toBeDefined();
      expect(result.total_found).toBeGreaterThan(0);
      expect(result.last_checked).toBeDefined();
    });
  });

  describe('API endpoints', () => {
    const app = new Hono();
    app.route('/marketplace', serviceRouter);

    test('GET /marketplace/search should return 402 when no payment', async () => {
      const response = await app.request('/marketplace/search?query=iphone+15');
      expect(response.status).toBe(402);
    });

    test('GET /marketplace/listing/:id should return 402 when no payment', async () => {
      const response = await app.request('/marketplace/listing/12345');
      expect(response.status).toBe(402);
    });

    test('GET /marketplace/categories should return 402 when no payment', async () => {
      const response = await app.request('/marketplace/categories');
      expect(response.status).toBe(402);
    });

    test('GET /marketplace/new should return 402 when no payment', async () => {
      const response = await app.request('/marketplace/new?query=iphone+15');
      expect(response.status).toBe(402);
    });
  });
});
