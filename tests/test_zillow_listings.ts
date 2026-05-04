
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { zillowRouter } from '../src/zillow/listings';
import { Hono } from 'hono';

// Mock the proxyFetch function
const mockProxyFetch = jest.fn();

jest.mock('../src/proxy', () => ({
  proxyFetch: (...args: any[]) => mockProxyFetch(...args),
}));

describe('Zillow API Tests', () => {
  beforeAll(() => {
    // Set up any test environment
  });

  afterAll(() => {
    // Clean up after tests
  });

  describe('Search Endpoint', () => {
    it('should return search results for a valid address', async () => {
      // Mock the proxyFetch response
      mockProxyFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <div class="list-card-info">
            <a class="list-card-link" href="/homedetails/123456789_zpid/">
              <span class="list-card-addr">123 Main St, New York, NY 10001</span>
              <span class="list-card-price">$1,250,000</span>
            </a>
          </div>
        `,
      });

      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/search?address=123+Main+St+New+York');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toBeDefined();
      expect(data.results.length).toBeGreaterThan(0);
      expect(data.results[0].zpid).toBe('123456789');
      expect(data.results[0].address).toContain('123 Main St');
      expect(data.results[0].price).toBe('1250000');
    });

    it('should return an error for invalid search parameters', async () => {
      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/search?invalid_param=test');
      expect(response.status).toBe(400);
    });
  });

  describe('Property Endpoint', () => {
    it('should return property details for a valid ZPID', async () => {
      // Mock the proxyFetch response
      mockProxyFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <title>123 Main St, New York, NY 10001 | Zillow</title>
          <span class="ds-value">$1,250,000</span>
          <span class="ds-home-value">$1,180,000</span>
          <div class="zsg-history-graph-item">
            <span class="date">2026-01-15</span>
            <span class="event">Listed</span>
            <span class="price">$1,250,000</span>
          </div>
          <div class="zsg-neighborhood-walkscore">92</div>
          <div class="zsg-neighborhood-transitscore">88</div>
          <img src="https://photos.zillow.com/123_main_st.jpg" />
        `,
      });

      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/property/123456789');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.zpid).toBe('123456789');
      expect(data.address).toContain('123 Main St');
      expect(data.price).toBe(1250000);
      expect(data.zestimate).toBe(1180000);
      expect(data.price_history).toBeDefined();
      expect(data.price_history.length).toBeGreaterThan(0);
      expect(data.neighborhood.walk_score).toBe(92);
      expect(data.neighborhood.transit_score).toBe(88);
      expect(data.photos).toBeDefined();
      expect(data.photos.length).toBeGreaterThan(0);
    });

    it('should return an error for invalid ZPID', async () => {
      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/property/invalid_zpid');
      expect(response.status).toBe(400);
    });
  });

  describe('Market Endpoint', () => {
    it('should return market data for a valid ZIP code', async () => {
      // Mock the proxyFetch response
      mockProxyFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <span class="zsg-value">$1,100,000</span> Median Home Value
          <span class="zsg-value">$3,200</span> Median Rent
          <span class="zsg-value">50</span> Inventory
        `,
      });

      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/market?zip=10001');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.zip).toBe('10001');
      expect(data.median_home_value).toBe(1100000);
      expect(data.median_rent).toBe(3200);
      expect(data.inventory).toBe(50);
    });

    it('should return an error for missing ZIP code', async () => {
      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/market');
      expect(response.status).toBe(400);
    });
  });

  describe('Comps Endpoint', () => {
    it('should return comparable sales for a valid ZPID', async () => {
      // Mock the proxyFetch response
      mockProxyFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <div class="comp-card">
            <a href="/homedetails/987654321_zpid/">
              <span class="address">456 Oak Ave, New York, NY 10002</span>
              <span class="price">$950,000</span>
              <span class="sqft">1600</span>
              <span class="beds">3</span>
              <span class="baths">2</span>
            </a>
          </div>
        `,
      });

      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/comps/123456789');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.zpid).toBe('123456789');
      expect(data.comparable_sales).toBeDefined();
      expect(data.comparable_sales.length).toBeGreaterThan(0);
      expect(data.comparable_sales[0].address).toContain('456 Oak Ave');
      expect(data.comparable_sales[0].price).toBe('950000');
    });

    it('should return an error for invalid ZPID', async () => {
      const app = new Hono();
      app.route('/api/realestate', zillowRouter);

      const response = await app.request('/api/realestate/comps/invalid_zpid');
      expect(response.status).toBe(400);
    });
  });
});
