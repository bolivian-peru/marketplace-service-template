

/**
 * Amazon API Routes
 *
 * Endpoints for Amazon Product & BSR Tracker API
 */

import { Hono } from 'hono';
import { getAmazonProduct } from '../amazon/products';
import { getAmazonBSR } from '../amazon/bsr';
import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment, build402Response } from '../payment';

export const amazonRouter = new Hono();

// Amazon Product Tracker API
const PRODUCT_PRICE_USDC = 0.005; // $0.005 per product lookup
const PRODUCT_DESCRIPTION = 'Amazon Product Tracker API — Extract real-time Amazon product data by ASIN: price, Best Sellers Rank (BSR), reviews count, rating, buy box winner, and competitor analysis. Supports multiple Amazon marketplaces (US, UK, DE).';

// Amazon BSR Tracker API
const BSR_PRICE_USDC = 0.01; // $0.01 per BSR lookup
const BSR_DESCRIPTION = 'Amazon Best Sellers Rank (BSR) Tracker API — Get category best sellers rankings with product details. Supports multiple Amazon marketplaces (US, UK, DE).';

// Amazon Search API
const SEARCH_PRICE_USDC = 0.01; // $0.01 per search query
const SEARCH_DESCRIPTION = 'Amazon Search API — Search products by keyword with category filter. Returns up to 20 results per query.';

// Amazon Reviews API
const REVIEWS_PRICE_USDC = 0.02; // $0.02 per reviews fetch
const REVIEWS_DESCRIPTION = 'Amazon Reviews API — Extract reviews for a product with rating and date.';

// Proxy rate limiting
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

// GET /api/amazon/product/:asin
amazonRouter.get('/product/:asin', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/product/:asin',
        PRODUCT_DESCRIPTION,
        PRODUCT_PRICE_USDC,
        walletAddress,
        {
          input: {
            asin: 'string (required) — Amazon Standard Identification Number',
            marketplace: 'string (optional, default: "US") — Amazon marketplace (US, UK, DE)',
          },
          output: {
            asin: 'string',
            title: 'string',
            brand: 'string',
            price: {
              current: 'number',
              currency: 'string',
              was: 'number?',
              discount_pct: 'number?',
            },
            bsr: {
              rank: 'number',
              category: 'string',
              sub_category_ranks: 'Array<{ category: string, rank: number }>',
            },
            rating: 'number',
            reviews_count: 'number',
            buy_box: {
              seller: 'string',
              is_amazon: 'boolean',
              fulfilled_by: 'string',
            },
            availability: 'string',
            images: 'string[]',
            meta: {
              marketplace: 'string',
              proxy: '{ ip, country, carrier, type:"mobile" }',
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRODUCT_PRICE_USDC);
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

  const asin = c.req.param('asin');
  const marketplace = c.req.query('marketplace') || 'US';

  if (!asin) {
    return c.json({ error: 'Missing required parameter: asin' }, 400);
  }

  try {
    const product = await getAmazonProduct(asin, marketplace);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...product,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch Amazon product',
      message: err.message,
      hint: 'ASIN may be invalid or Amazon blocked the request. Try again in a few minutes.',
    }, 502);
  }
});

// GET /api/amazon/bsr
amazonRouter.get('/bsr', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/bsr',
        BSR_DESCRIPTION,
        BSR_PRICE_USDC,
        walletAddress,
        {
          input: {
            category: 'string (required) — Amazon category (electronics, books, home, etc.)',
            marketplace: 'string (optional, default: "US") — Amazon marketplace (US, UK, DE)',
            limit: 'number (optional, default: 20) — Max number of products to return',
          },
          output: {
            category: 'string',
            rank: 'number',
            subcategories: 'Array<{ name: string, rank: number, url: string }>',
            products: 'Array<{ asin: string, title: string, price: number, rating: number, reviews_count: number, url: string }>',
            meta: {
              marketplace: 'string',
              proxy: '{ ip, country, carrier, type:"mobile" }',
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, BSR_PRICE_USDC);
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

  const category = c.req.query('category');
  const marketplace = c.req.query('marketplace') || 'US';
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 20, 1), 100) : 20;

  if (!category) {
    return c.json({ error: 'Missing required parameter: category' }, 400);
  }

  try {
    const bsrData = await getAmazonBSR(category, marketplace, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...bsrData,
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch Amazon BSR data',
      message: err.message,
      hint: 'Category may be invalid or Amazon blocked the request. Try again in a few minutes.',
    }, 502);
  }
});

// GET /api/amazon/search
amazonRouter.get('/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/search',
        SEARCH_DESCRIPTION,
        SEARCH_PRICE_USDC,
        walletAddress,
        {
          input: {
            query: 'string (required) — Search keyword',
            category: 'string (optional) — Amazon category filter',
            marketplace: 'string (optional, default: "US") — Amazon marketplace (US, UK, DE)',
            limit: 'number (optional, default: 20) — Max number of results to return',
          },
          output: {
            query: 'string',
            category: 'string?',
            results: 'Array<{ asin: string, title: string, price: number, rating: number, reviews_count: number, url: string }>',
            total_found: 'number',
            meta: {
              marketplace: 'string',
              proxy: '{ ip, country, carrier, type:"mobile" }',
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, SEARCH_PRICE_USDC);
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
  const category = c.req.query('category');
  const marketplace = c.req.query('marketplace') || 'US';
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 20, 1), 100) : 20;

  if (!query) {
    return c.json({ error: 'Missing required parameter: query' }, 400);
  }

  try {
    const baseUrl = marketplace === 'US' ? 'www.amazon.com' :
                   marketplace === 'UK' ? 'www.amazon.co.uk' :
                   marketplace === 'DE' ? 'www.amazon.de' :
                   'www.amazon.com';

    // Construct search URL
    let searchUrl = `https://${baseUrl}/s?k=${encodeURIComponent(query)}`;
    if (category) {
      searchUrl += `&rh=p_n_feature_browse-bin:${getAmazonCategoryId(category)}`;
    }
    searchUrl += `&s=${limitParam || '20'}`;

    const proxy = getProxy();
    const ip = await getProxyExitIp();

    // Fetch search results with mobile proxy
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
        'Accept-Language': marketplace === 'US' ? 'en-US' :
                           marketplace === 'UK' ? 'en-GB' :
                           marketplace === 'DE' ? 'de-DE' : 'en-US',
      },
      timeoutMs: 30000,
      maxRetries: 3,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Amazon search results: ${response.status}`);
    }

    const html = await response.text();
    const root = parse(html);

    // Extract search results
    const results = extractSearchResults(root, baseUrl, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      query,
      category,
      results,
      total_found: results.length,
      meta: {
        marketplace,
        proxy: {
          ip,
          country: proxy.country,
          carrier: proxy.host,
          type: 'mobile',
        },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch Amazon search results',
      message: err.message,
      hint: 'Query may be too broad or Amazon blocked the request. Try again in a few minutes.',
    }, 502);
  }
});

// GET /api/amazon/reviews/:asin
amazonRouter.get('/reviews/:asin', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/amazon/reviews/:asin',
        REVIEWS_DESCRIPTION,
        REVIEWS_PRICE_USDC,
        walletAddress,
        {
          input: {
            asin: 'string (required) — Amazon Standard Identification Number',
            sort: 'string (optional, default: "recent") — Sort by "recent" or "helpful"',
            limit: 'number (optional, default: 10) — Max number of reviews to return',
          },
          output: {
            asin: 'string',
            reviews: 'Array<{ rating: number, title: string, content: string, author: string, date: string, verified_purchase: boolean }>',
            total_reviews: 'number',
            meta: {
              marketplace: 'string',
              proxy: '{ ip, country, carrier, type:"mobile" }',
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, REVIEWS_PRICE_USDC);
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

  const asin = c.req.param('asin');
  const sort = c.req.query('sort') || 'recent';
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 10, 1), 100) : 10;

  if (!asin) {
    return c.json({ error: 'Missing required parameter: asin' }, 400);
  }

  try {
    const baseUrl = 'www.amazon.com'; // Default to US marketplace for reviews
    const reviewsUrl = `https://${baseUrl}/product-reviews/${asin}/ref=cm_cr_getr_d_paging_btm_next_2?ie=UTF8&reviewerType=all_reviews&sortBy=${sort === 'helpful' ? 'helpful' : 'recent'}`;

    const proxy = getProxy();
    const ip = await getProxyExitIp();

    // Fetch reviews with mobile proxy
    const response = await proxyFetch(reviewsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
        'Accept-Language': 'en-US',
      },
      timeoutMs: 30000,
      maxRetries: 3,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Amazon reviews: ${response.status}`);
    }

    const html = await response.text();
    const root = parse(html);

    // Extract reviews
    const reviews = extractReviews(root, limit);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      asin,
      reviews,
      total_reviews: reviews.length,
      meta: {
        marketplace: 'US', // Default to US for reviews
        proxy: {
          ip,
          country: proxy.country,
          carrier: proxy.host,
          type: 'mobile',
        },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch Amazon reviews',
      message: err.message,
      hint: 'ASIN may be invalid or Amazon blocked the request. Try again in a few minutes.',
    }, 502);
  }
});

// Helper function to parse HTML
function parse(html: string) {
  const { parse } = require('node-html-parser');
  return parse(html);
}

// Helper function to extract search results
function extractSearchResults(root: any, baseUrl: string, limit: number) {
  const results = [];

  // Try different selectors for search results
  const selectors = [
    '.s-result-item',
    '.a-section.a-spacing-medium',
    '.puis-card-container',
    '.sg-col-4-of-12',
    '.sg-col-20-of-24',
  ];

  for (const selector of selectors) {
    const elements = root.querySelectorAll(selector);
    for (let i = 0; i < Math.min(elements.length, limit); i++) {
      try {
        const element = elements[i];
        const asin = extractASIN(element);
        const title = extractProductTitle(element);
        const price = extractProductPrice(element);
        const rating = extractProductRating(element);
        const reviewsCount = extractProductReviewsCount(element);
        const url = extractProductUrl(element, baseUrl);

        if (asin && title) {
          results.push({
            asin,
            title,
            price,
            rating,
            reviews_count: reviewsCount,
            url,
          });
        }
      } catch (error) {
        console.error(`Error extracting search result ${i}:`, error);
        continue;
      }
    }

    if (results.length >= limit) break;
  }

  return results;
}

// Helper function to extract reviews
function extractReviews(root: any, limit: number) {
  const reviews = [];

  // Try different selectors for reviews
  const selectors = [
    '.review',
    '.a-section.review',
    '.review-data',
    '.review-text-content',
    '.review-text',
  ];

  for (const selector of selectors) {
    const elements = root.querySelectorAll(selector);
    for (let i = 0; i < Math.min(elements.length, limit); i++) {
      try {
        const element = elements[i];
        const rating = extractReviewRating(element);
        const title = extractReviewTitle(element);
        const content = extractReviewContent(element);
        const author = extractReviewAuthor(element);
        const date = extractReviewDate(element);
        const verifiedPurchase = extractVerifiedPurchase(element);

        if (rating !== null) {
          reviews.push({
            rating,
            title,
            content,
            author,
            date,
            verified_purchase: verifiedPurchase,
          });
        }
      } catch (error) {
        console.error(`Error extracting review ${i}:`, error);
        continue;
      }
    }

    if (reviews.length >= limit) break;
  }

  return reviews;
}

// Helper functions for extracting review data
function extractReviewRating(element: any): number | null {
  const ratingElement = element.querySelector('.review-rating span.a-icon-alt, .review-star-rating span.a-icon-alt');
  if (ratingElement) {
    const text = ratingElement.textContent.trim();
    const ratingMatch = text.match(/([0-9.]+)\s+out\s+of\s+5/);
    if (ratingMatch) {
      return parseFloat(ratingMatch[1]);
    }
  }
  return null;
}

function extractReviewTitle(element: any): string {
  const titleElement = element.querySelector('.review-title, .review-title-content, .a-text-bold');
  if (titleElement) {
    return titleElement.textContent.trim();
  }
  return 'No title';
}

function extractReviewContent(element: any): string {
  const contentElement = element.querySelector('.review-text-content, .review-text, .a-expander-content');
  if (contentElement) {
    return contentElement.textContent.trim();
  }
  return '';
}

function extractReviewAuthor(element: any): string {
  const authorElement = element.querySelector('.review-author, .a-profile-name');
  if (authorElement) {
    return authorElement.textContent.trim();
  }
  return 'Anonymous';
}

function extractReviewDate(element: any): string {
  const dateElement = element.querySelector('.review-date, .a-color-secondary');
  if (dateElement) {
    return dateElement.textContent.trim();
  }
  return new Date().toISOString().split('T')[0];
}

function extractVerifiedPurchase(element: any): boolean {
  const verifiedElement = element.querySelector('.review-verification');
  if (verifiedElement) {
    return verifiedElement.textContent.includes('Verified Purchase');
  }
  return false;
}

// Helper functions for extracting product data
function extractASIN(element: any): string | null {
  const asinElement = element.querySelector('[data-asin]');
  if (asinElement) {
    return asinElement.getAttribute('data-asin');
  }
  return null;
}

function extractProductTitle(element: any): string {
  const titleElement = element.querySelector('.a-size-medium, .a-text-bold, .a-color-base');
  if (titleElement) {
    return titleElement.textContent.trim();
  }
  return 'Unknown Product';
}

function extractProductPrice(element: any): number {
  const priceElement = element.querySelector('.a-price-whole, .a-offscreen, .a-color-base');
  if (priceElement) {
    const priceText = priceElement.textContent.trim();
    const priceMatch = priceText.match(/\$([0-9.]+)/) || priceText.match(/([0-9.]+)/);
    if (priceMatch) {
      return parseFloat(priceMatch[1]);
    }
  }
  return 0;
}

function extractProductRating(element: any): number {
  const ratingElement = element.querySelector('.a-icon-alt');
  if (ratingElement) {
    const ratingText = ratingElement.textContent.trim();
    const ratingMatch = ratingText.match(/([0-9.]+)\s+out\s+of\s+5/);
    if (ratingMatch) {
      return parseFloat(ratingMatch[1]);
    }
  }
  return 0;
}

function extractProductReviewsCount(element: any): number {
  const reviewsElement = element.querySelector('.a-size-small');
  if (reviewsElement) {
    const text = reviewsElement.textContent.trim();
    const countMatch = text.match(/([0-9,]+)/);
    if (countMatch) {
      return parseInt(countMatch[1].replace(/,/g, ''));
    }
  }
  return 0;
}

function extractProductUrl(element: any, baseUrl: string): string {
  const linkElement = element.querySelector('a.a-link-normal');
  if (linkElement) {
    const href = linkElement.getAttribute('href');
    if (href) {
      if (href.startsWith('http')) {
        return href;
      } else {
        return `https://${baseUrl}${href}`;
      }
    }
  }
  return '#';
}

// Helper function to get Amazon category ID
function getAmazonCategoryId(category: string): string {
  const categoryMap: Record<string, string> = {
    'electronics': '172282',
    'books': '283155',
    'home': '1055398',
    'sports': '2454167011',
    'beauty': '3760901',
    'toys': '165793011',
    'clothing': '1036592',
    'automotive': '266232',
    'grocery': '16310101',
    'pet-supplies': '51552011',
  };

  return categoryMap[category.toLowerCase()] || '172282'; // Default to electronics
}
