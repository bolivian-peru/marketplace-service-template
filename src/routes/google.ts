
/**
 * Google Discover Feed Intelligence API Routes
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment } from '../payment';
import { fetchDiscoverFeed, buildDiscover402Response, DiscoverFeedParams } from '../google/discover';

export const googleRouter = new Hono();

// Google Discover Feed API endpoint
googleRouter.get('/discover', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      buildDiscover402Response(walletAddress),
      402
    );
  }

  const verification = await verifyPayment(payment, walletAddress, 0.02);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // Get query parameters
  const country = c.req.query('country');
  const category = c.req.query('category') || 'news';
  const limitParam = c.req.query('limit');

  // Validate parameters
  if (!country) {
    return c.json({
      error: 'Missing required parameter: country',
      hint: 'Provide a country code like ?country=US or ?country=DE',
      example: '/api/google/discover?country=US&category=technology&limit=20',
    }, 400);
  }

  // Parse limit
  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam);
    if (isNaN(parsed) || parsed < 1) {
      return c.json({ error: 'Invalid limit parameter: must be a positive integer' }, 400);
    }
    limit = Math.min(parsed, 50);
  }

  try {
    // Fetch the Discover feed
    const params: DiscoverFeedParams = {
      country: country.toUpperCase(),
      category: category.toLowerCase(),
      limit: limit
    };

    const feed = await fetchDiscoverFeed(params);

    // Add payment headers
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json(feed);
  } catch (error: any) {
    return c.json({
      error: 'Failed to fetch Google Discover feed',
      message: error.message,
      hint: 'This could be due to proxy issues or Google blocking the request. Try again in a few minutes.',
    }, 502);
  }
});

// Health check endpoint for the Google API
googleRouter.get('/health', (c) => {
  return c.json({
    service: 'google-discover-api',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/api/google/discover?country=US&category=technology',
      '/api/google/discover?country=DE&category=news',
      '/api/google/discover?country=GB&category=sports',
    ],
  });
});
