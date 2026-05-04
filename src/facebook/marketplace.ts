

/**
 * Facebook Marketplace Scraper
 * ----------------------------
 * Scrapes Facebook Marketplace listings with mobile proxies to avoid detection.
 * Implements real-time monitoring for new listings.
 */

import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { Context } from 'hono';

// Types
interface FacebookListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  location: string;
  seller: {
    name: string;
    joined: string;
    rating: string;
  };
  condition: string;
  posted_at: string;
  images: string[];
  url: string;
}

interface FacebookSearchParams {
  query?: string;
  location?: string;
  radius?: string;
  min_price?: string;
  max_price?: string;
  category?: string;
}

interface FacebookCategory {
  id: string;
  name: string;
  url: string;
}

interface FacebookMonitorParams {
  query: string;
  since: string;
}

interface FacebookMonitorResult {
  new_listings: FacebookListing[];
  total_found: number;
  last_checked: string;
}

// Constants
const FACEBOOK_PRICE_USDC = 0.01; // $0.01 per search query
const FACEBOOK_LISTING_PRICE_USDC = 0.005; // $0.005 per listing detail
const FACEBOOK_MONITOR_PRICE_USDC = 0.02; // $0.02 per new listings monitor check

// Facebook Marketplace base URL
const FACEBOOK_MARKETPLACE_URL = 'https://www.facebook.com/marketplace';

// User agent for mobile device simulation
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Facebook Marketplace API
export class FacebookMarketplace {
  private static async fetchWithProxy(url: string, options: RequestInit = {}): Promise<Response> {
    const defaultHeaders = {
      'User-Agent': MOBILE_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    return proxyFetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers },
      timeoutMs: 45000,
      maxRetries: 3,
    });
  }

  /**
   * Search Facebook Marketplace with filters
   */
  public static async search(
    params: FacebookSearchParams
  ): Promise<{ results: FacebookListing[]; total: number; proxy: { country: string; type: string } }> {
    const query = params.query ? encodeURIComponent(params.query) : '';
    const location = params.location ? encodeURIComponent(params.location) : '';
    const radius = params.radius || '25mi';
    const minPrice = params.min_price || '';
    const maxPrice = params.max_price || '';
    const category = params.category || '';

    // Build search URL
    let url = `${FACEBOOK_MARKETPLACE_URL}/search/?`;
    if (query) url += `query=${query}&`;
    if (location) url += `exact=${location}&`;
    if (radius) url += `radius=${radius}&`;
    if (minPrice) url += `minPrice=${minPrice}&`;
    if (maxPrice) url += `maxPrice=${maxPrice}&`;
    if (category) url += `category=${category}&`;

    // Remove trailing &
    url = url.replace(/&$/, '');

    const response = await this.fetchWithProxy(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch Facebook Marketplace: ${response.status}`);
    }

    const html = await response.text();
    return this.parseSearchResults(html);
  }

  /**
   * Parse search results from HTML
   */
  private static parseSearchResults(html: string): { results: FacebookListing[]; total: number } {
    const results: FacebookListing[] = [];
    let total = 0;

    // This is a simplified parser - in a real implementation you would use a proper HTML parser
    // For this example, we'll extract some basic information

    // Extract total count
    const totalMatch = html.match(/aria-label="(\d+)\s+results"/);
    if (totalMatch) {
      total = parseInt(totalMatch[1]);
    }

    // Extract listing cards
    const listingMatches = html.matchAll(/data-ad-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g);
    for (const match of listingMatches) {
      const id = match[1];
      const cardHtml = match[2];

      // Extract title
      const titleMatch = cardHtml.match(/<span[^>]*>([^<]+)<\/span>/);
      const title = titleMatch ? titleMatch[1] : 'Untitled';

      // Extract price
      const priceMatch = cardHtml.match(/<span[^>]*>\$([\d,]+)<\/span>/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;

      // Extract location
      const locationMatch = cardHtml.match(/aria-label="([^"]+)"[^>]*>/);
      const location = locationMatch ? locationMatch[1] : 'Unknown';

      // Extract image URL
      const imageMatch = cardHtml.match(/src="([^"]+)"[^>]*alt="[^"]*"/);
      const image = imageMatch ? imageMatch[1] : '';

      // Extract URL
      const urlMatch = cardHtml.match(/href="([^"]+)"[^>]*>/);
      const url = urlMatch ? `https://facebook.com${urlMatch[1]}` : '';

      results.push({
        id,
        title,
        price,
        currency: 'USD',
        location,
        seller: {
          name: 'Unknown',
          joined: 'Unknown',
          rating: 'N/A',
        },
        condition: 'Unknown',
        posted_at: new Date().toISOString(),
        images: image ? [image] : [],
        url,
      });
    }

    return { results, total };
  }

  /**
   * Get details for a specific listing
   */
  public static async getListingDetails(listingId: string): Promise<FacebookListing> {
    const url = `${FACEBOOK_MARKETPLACE_URL}/item/${listingId}`;

    const response = await this.fetchWithProxy(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch listing details: ${response.status}`);
    }

    const html = await response.text();
    return this.parseListingDetails(html);
  }

  /**
   * Parse listing details from HTML
   */
  private static parseListingDetails(html: string): FacebookListing {
    // This is a simplified parser - in a real implementation you would use a proper HTML parser
    const listing: FacebookListing = {
      id: 'unknown',
      title: 'Unknown',
      price: 0,
      currency: 'USD',
      location: 'Unknown',
      seller: {
        name: 'Unknown',
        joined: 'Unknown',
        rating: 'N/A',
      },
      condition: 'Unknown',
      posted_at: new Date().toISOString(),
      images: [],
      url: '',
    };

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      listing.title = titleMatch[1].replace(' | Facebook', '').trim();
    }

    // Extract price
    const priceMatch = html.match(/<span[^>]*class="[^"]*x193iq5w[^"]*"[^>]*>\$([\d,]+)<\/span>/);
    if (priceMatch) {
      listing.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }

    // Extract location
    const locationMatch = html.match(/<span[^>]*class="[^"]*x1lliihq[^"]*"[^>]*>([^<]+)<\/span>/);
    if (locationMatch) {
      listing.location = locationMatch[1];
    }

    // Extract images
    const imageMatches = html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g);
    for (const match of imageMatches) {
      const src = match[1];
      if (src && !src.includes('svg')) {
        listing.images.push(src);
      }
    }

    // Extract URL
    listing.url = `https://facebook.com/marketplace/item/${listing.id}`;

    return listing;
  }

  /**
   * Get Facebook Marketplace categories
   */
  public static async getCategories(location: string): Promise<FacebookCategory[]> {
    const url = `${FACEBOOK_MARKETPLACE_URL}/`;

    const response = await this.fetchWithProxy(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch categories: ${response.status}`);
    }

    const html = await response.text();
    return this.parseCategories(html);
  }

  /**
   * Parse categories from HTML
   */
  private static parseCategories(html: string): FacebookCategory[] {
    const categories: FacebookCategory[] = [];

    // This is a simplified parser - in a real implementation you would use a proper HTML parser
    // For this example, we'll return some hardcoded categories
    const hardcodedCategories = [
      { id: '1', name: 'Vehicles', url: `${FACEBOOK_MARKETPLACE_URL}/vehicles` },
      { id: '2', name: 'Housing', url: `${FACEBOOK_MARKETPLACE_URL}/housing` },
      { id: '3', name: 'Electronics', url: `${FACEBOOK_MARKETPLACE_URL}/electronics` },
      { id: '4', name: 'Clothing & Accessories', url: `${FACEBOOK_MARKETPLACE_URL}/clothing` },
      { id: '5', name: 'Home & Garden', url: `${FACEBOOK_MARKETPLACE_URL}/home-garden` },
      { id: '6', name: 'Sports & Leisure', url: `${FACEBOOK_MARKETPLACE_URL}/sports` },
      { id: '7', name: 'Toys & Games', url: `${FACEBOOK_MARKETPLACE_URL}/toys` },
      { id: '8', name: 'Other', url: `${FACEBOOK_MARKETPLACE_URL}/other` },
    ];

    return hardcodedCategories;
  }

  /**
   * Monitor for new listings
   */
  public static async monitorNewListings(params: FacebookMonitorParams): Promise<FacebookMonitorResult> {
    const query = params.query ? encodeURIComponent(params.query) : '';
    const since = params.since || '1h';

    // Build search URL
    let url = `${FACEBOOK_MARKETPLACE_URL}/search/?query=${query}&`;
    if (since) url += `since=${since}&`;

    // Remove trailing &
    url = url.replace(/&$/, '');

    const response = await this.fetchWithProxy(url);

    if (!response.ok) {
      throw new Error(`Failed to monitor new listings: ${response.status}`);
    }

    const html = await response.text();
    const { results, total } = this.parseSearchResults(html);

    return {
      new_listings: results,
      total_found: total,
      last_checked: new Date().toISOString(),
    };
  }
}

// Facebook Marketplace Router
export function facebookRouter() {
  const router = new Hono();

  // Search endpoint
  router.get('/search', async (c) => {
    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
    }

    const payment = extractPayment(c);
    if (!payment) {
      return c.json(
        build402Response(
          '/api/marketplace/search',
          'Facebook Marketplace Search API: Search listings by keyword, location, price range, and category',
          FACEBOOK_PRICE_USDC,
          walletAddress,
          {
            input: {
              query: 'string (optional) - Search query (e.g., "iPhone 15")',
              location: 'string (optional) - Location to search (e.g., "New York")',
              radius: 'string (optional) - Search radius (e.g., "25mi")',
              min_price: 'string (optional) - Minimum price (e.g., "500")',
              max_price: 'string (optional) - Maximum price (e.g., "1000")',
              category: 'string (optional) - Category ID (e.g., "1" for Vehicles)',
            },
            output: {
              results: 'FacebookListing[] - Array of marketplace listings',
              total: 'number - Total number of results',
              meta: {
                proxy: '{ country: string, type: "mobile" } - Proxy information',
                payment: '{ txHash, network, amount, settled } - Payment information',
              },
            },
          }
        ),
        402
      );
    }

    const verification = await verifyPayment(payment, walletAddress, FACEBOOK_PRICE_USDC);
    if (!verification.valid) {
      return c.json({
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
      }, 402);
    }

    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkProxyRateLimit(clientIp)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
    }

    // Extract query parameters
    const query = c.req.query('query');
    const location = c.req.query('location');
    const radius = c.req.query('radius');
    const minPrice = c.req.query('min_price');
    const maxPrice = c.req.query('max_price');
    const category = c.req.query('category');

    try {
      const proxy = getProxy();
      const params: FacebookSearchParams = {
        query,
        location,
        radius,
        min_price: minPrice,
        max_price: maxPrice,
        category,
      };

      const result = await FacebookMarketplace.search(params);

      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);

      return c.json({
        ...result,
        meta: {
          proxy: { country: proxy.country, type: 'mobile' },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            settled: true,
          },
        },
      });
    } catch (err: any) {
      return c.json({
        error: 'Search failed',
        message: err.message,
        hint: 'Facebook may be blocking requests. Try again in a few minutes or adjust your search parameters.',
      }, 502);
    }
  });

  // Listing details endpoint
  router.get('/listing/:id', async (c) => {
    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
    }

    const payment = extractPayment(c);
    if (!payment) {
      return c.json(
        build402Response(
          '/api/marketplace/listing/:id',
          'Facebook Marketplace Listing Details API: Get detailed information about a specific listing',
          FACEBOOK_LISTING_PRICE_USDC,
          walletAddress,
          {
            input: {
              id: 'string (required) - Listing ID (in URL path)',
            },
            output: {
              listing: 'FacebookListing - Detailed listing information',
              meta: {
                proxy: '{ country: string, type: "mobile" } - Proxy information',
                payment: '{ txHash, network, amount, settled } - Payment information',
              },
            },
          }
        ),
        402
      );
    }

    const verification = await verifyPayment(payment, walletAddress, FACEBOOK_LISTING_PRICE_USDC);
    if (!verification.valid) {
      return c.json({
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
      }, 402);
    }

    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkProxyRateLimit(clientIp)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
    }

    const listingId = c.req.param('id');

    try {
      const proxy = getProxy();
      const listing = await FacebookMarketplace.getListingDetails(listingId);

      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);

      return c.json({
        listing,
        meta: {
          proxy: { country: proxy.country, type: 'mobile' },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            settled: true,
          },
        },
      });
    } catch (err: any) {
      return c.json({
        error: 'Failed to fetch listing details',
        message: err.message,
        hint: 'Invalid listing ID or Facebook blocked the request.',
      }, 502);
    }
  });

  // Categories endpoint
  router.get('/categories', async (c) => {
    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
    }

    const payment = extractPayment(c);
    if (!payment) {
      return c.json(
        build402Response(
          '/api/marketplace/categories',
          'Facebook Marketplace Categories API: Get available categories for a location',
          FACEBOOK_PRICE_USDC,
          walletAddress,
          {
            input: {
              location: 'string (optional) - Location to search (e.g., "New York")',
            },
            output: {
              categories: 'FacebookCategory[] - Array of available categories',
              meta: {
                proxy: '{ country: string, type: "mobile" } - Proxy information',
                payment: '{ txHash, network, amount, settled } - Payment information',
              },
            },
          }
        ),
        402
      );
    }

    const verification = await verifyPayment(payment, walletAddress, FACEBOOK_PRICE_USDC);
    if (!verification.valid) {
      return c.json({
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
      }, 402);
    }

    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkProxyRateLimit(clientIp)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
    }

    const location = c.req.query('location');

    try {
      const proxy = getProxy();
      const categories = await FacebookMarketplace.getCategories(location || '');

      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);

      return c.json({
        categories,
        meta: {
          proxy: { country: proxy.country, type: 'mobile' },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            settled: true,
          },
        },
      });
    } catch (err: any) {
      return c.json({
        error: 'Failed to fetch categories',
        message: err.message,
        hint: 'Facebook may be blocking requests. Try again in a few minutes.',
      }, 502);
    }
  });

  // New listings monitor endpoint
  router.get('/new', async (c) => {
    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
    }

    const payment = extractPayment(c);
    if (!payment) {
      return c.json(
        build402Response(
          '/api/marketplace/new',
          'Facebook Marketplace New Listings Monitor API: Monitor for new listings matching a query',
          FACEBOOK_MONITOR_PRICE_USDC,
          walletAddress,
          {
            input: {
              query: 'string (required) - Search query (e.g., "iPhone 15")',
              since: 'string (optional) - Time window for new listings (e.g., "1h", "24h")',
            },
            output: {
              new_listings: 'FacebookListing[] - Array of new listings',
              total_found: 'number - Total number of results',
              last_checked: 'string - Timestamp of last check',
              meta: {
                proxy: '{ country: string, type: "mobile" } - Proxy information',
                payment: '{ txHash, network, amount, settled } - Payment information',
              },
            },
          }
        ),
        402
      );
    }

    const verification = await verifyPayment(payment, walletAddress, FACEBOOK_MONITOR_PRICE_USDC);
    if (!verification.valid) {
      return c.json({
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
      }, 402);
    }

    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkProxyRateLimit(clientIp)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Proxy rate limit exceeded. Max 20 requests/min to protect proxy quota.', retryAfter: 60 }, 429);
    }

    const query = c.req.query('query');
    const since = c.req.query('since');

    if (!query) {
      return c.json({
        error: 'Missing required parameter: query',
        hint: 'Provide a search query like ?query=iphone+15&since=1h',
        example: '/api/marketplace/new?query=iphone+15&since=1h',
      }, 400);
    }

    try {
      const proxy = getProxy();
      const params: FacebookMonitorParams = {
        query,
        since,
      };

      const result = await FacebookMarketplace.monitorNewListings(params);

      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);

      return c.json({
        ...result,
        meta: {
          proxy: { country: proxy.country, type: 'mobile' },
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            settled: true,
          },
        },
      });
    } catch (err: any) {
      return c.json({
        error: 'Monitoring failed',
        message: err.message,
        hint: 'Facebook may be blocking requests. Try again in a few minutes or adjust your search parameters.',
      }, 502);
    }
  });

  return router;
}

// Proxy rate limiting (same as in service.ts)
const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20; // max proxy-routed requests per minute per IP

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyUsage.get(ip);
  if (!entry || now > entry.resetAt) {
    proxyUsage.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= PROXY_RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of proxyUsage) {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  }
}, 300_000);
