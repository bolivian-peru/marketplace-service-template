/**
 * Price Monitor API Routes
 * ────────────────────────
 * Exposes price tracking endpoints with x402 micropayment support.
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import {
  scrapeProduct,
  getPriceHistory,
  updatePriceHistory,
  addPriceAlert,
  getAlerts,
  checkPriceAlerts,
  removeAlert,
  extractIdentifier,
} from '../scrapers/price-scraper';

export const priceMonitorRouter = new Hono();

// ─── CONSTANTS ─────────────────────────────────────────

const SERVICE_NAME = 'price-monitor';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Track e-commerce prices (Amazon, eBay, etc.) with history and alert thresholds. Returns current price, original price, discount %, availability.';

const OUTPUT_SCHEMA = {
  input: {
    url_or_asin: 'string — Product URL or ASIN (required)',
    check_price: 'number — Set alert when price drops below this value (optional)',
  },
  output: {
    product: {
      title: 'string',
      currentPrice: 'number | null',
      originalPrice: 'number | null',
      discountPercent: 'number | null',
      currency: 'string',
      url: 'string',
      asin: 'string | null',
      availability: 'string',
      rating: 'number | null',
      reviewCount: 'number | null',
      site: 'string',
    },
    lastChecked: 'ISO timestamp',
    priceHistory: 'array of price snapshots',
    alerts: 'array of price alerts',
    triggeredAlerts: 'array of newly triggered alerts',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

// ─── HELPER: Check Proxy Rate Limit ────────────────────

const proxyRateLimits = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20; // requests per minute

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyRateLimits.get(ip);
  
  if (!entry || now > entry.resetAt) {
    proxyRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  
  if (entry.count >= PROXY_RATE_LIMIT) {
    return false;
  }
  
  entry.count++;
  return true;
}

// ─── GET PRICE ─────────────────────────────────────────

/**
 * GET /api/price
 * Get current price and price history for a product.
 * 
 * Query params:
 *   - url: Product URL (e.g., https://www.amazon.com/dp/B09V3KXJPB)
 *   - asin: Amazon ASIN (e.g., B09V3KXJPB)
 *   - check_price: Alert threshold (optional)
 */
priceMonitorRouter.get('/', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // Payment check
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/price', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // Payment verification
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount.',
    }, 402);
  }

  // Rate limit check
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded. Try again in 60 seconds.' }, 429);
  }

  // Input validation
  const url = c.req.query('url');
  const asin = c.req.query('asin');
  const checkPriceParam = c.req.query('check_price');

  if (!url && !asin) {
    return c.json({
      error: 'Missing required parameter: url or asin',
      hint: 'Provide a product URL (?url=...) or ASIN (?asin=...)',
      example: '/api/price?url=https://www.amazon.com/dp/B09V3KXJPB',
    }, 400);
  }

  // Build full URL from ASIN if needed
  let productUrl: string;
  if (url) {
    productUrl = url;
  } else {
    productUrl = `https://www.amazon.com/dp/${asin}`;
  }

  // Parse alert threshold
  let targetPrice: number | null = null;
  if (checkPriceParam) {
    targetPrice = parseFloat(checkPriceParam);
    if (isNaN(targetPrice) || targetPrice < 0) {
      return c.json({ error: 'Invalid check_price: must be a positive number' }, 400);
    }
  }

  try {
    const proxy = getProxy();
    const product = await scrapeProduct(productUrl);

    // Get identifier for history/alerts
    const identifier = asin ? `amazon:${asin}` : extractIdentifier(productUrl);

    // Update price history
    updatePriceHistory(identifier, product);

    // Get price history
    const history = getPriceHistory(identifier);

    // Check alerts
    let triggeredAlerts: any[] = [];
    if (product.currentPrice) {
      triggeredAlerts = checkPriceAlerts(identifier, product.currentPrice);
    }

    // Add new alert if threshold provided
    if (targetPrice !== null && product.currentPrice) {
      addPriceAlert(identifier, targetPrice);
    }

    // Get all alerts
    const alerts = getAlerts(identifier);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      product,
      lastChecked: new Date().toISOString(),
      priceHistory: history.slice(-30), // Last 30 entries
      alerts,
      triggeredAlerts,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Failed to fetch product price',
      message: err.message,
      hint: 'The product page may be temporarily unavailable. Try again later.',
    }, 502);
  }
});

// ─── GET PRICE HISTORY ─────────────────────────────────

/**
 * GET /api/price/history
 * Get price history for a tracked product.
 */
priceMonitorRouter.get('/history', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/price/history', 'Get price history for a product', PRICE_USDC, walletAddress),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const url = c.req.query('url');
  const asin = c.req.query('asin');

  if (!url && !asin) {
    return c.json({ error: 'Missing required parameter: url or asin' }, 400);
  }

  const identifier = asin ? `amazon:${asin}` : extractIdentifier(url || '');
  const history = getPriceHistory(identifier);

  c.header('X-Payment-Settled', 'true');

  return c.json({
    identifier,
    history,
    count: history.length,
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      settled: true,
    },
  });
});

// ─── SET PRICE ALERT ──────────────────────────────────

/**
 * POST /api/price/alert
 * Set a price alert for a product.
 * 
 * Body (JSON):
 *   - url: Product URL
 *   - asin: Product ASIN (alternative to url)
 *   - targetPrice: Price threshold to trigger alert
 */
priceMonitorRouter.post('/alert', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/price/alert', 'Set a price drop alert', PRICE_USDC, walletAddress),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { url, asin, targetPrice } = body;

  if (!url && !asin) {
    return c.json({ error: 'Missing required field: url or asin' }, 400);
  }

  if (!targetPrice || typeof targetPrice !== 'number' || targetPrice < 0) {
    return c.json({ error: 'Invalid targetPrice: must be a positive number' }, 400);
  }

  const identifier = asin ? `amazon:${asin}` : extractIdentifier(url);
  const alert = addPriceAlert(identifier, targetPrice);

  c.header('X-Payment-Settled', 'true');

  return c.json({
    alert,
    message: `Alert set: notify when price drops to $${targetPrice}`,
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      settled: true,
    },
  });
});

// ─── DELETE PRICE ALERT ────────────────────────────────

/**
 * DELETE /api/price/alert
 * Remove a price alert.
 */
priceMonitorRouter.delete('/alert', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/price/alert', 'Delete a price alert', PRICE_USDC, walletAddress),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const alertId = c.req.query('alert_id');
  const url = c.req.query('url');
  const asin = c.req.query('asin');

  if (!alertId) {
    return c.json({ error: 'Missing required parameter: alert_id' }, 400);
  }

  const identifier = asin ? `amazon:${asin}` : extractIdentifier(url || '');
  const deleted = removeAlert(identifier, alertId);

  c.header('X-Payment-Settled', 'true');

  return c.json({
    success: deleted,
    alertId,
    message: deleted ? 'Alert removed' : 'Alert not found',
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      settled: true,
    },
  });
});

// ─── GET ALERTS ───────────────────────────────────────

/**
 * GET /api/price/alerts
 * Get all alerts for a product.
 */
priceMonitorRouter.get('/alerts', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/price/alerts', 'Get price alerts', PRICE_USDC, walletAddress),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const url = c.req.query('url');
  const asin = c.req.query('asin');

  if (!url && !asin) {
    return c.json({ error: 'Missing required parameter: url or asin' }, 400);
  }

  const identifier = asin ? `amazon:${asin}` : extractIdentifier(url || '');
  const alerts = getAlerts(identifier);

  c.header('X-Payment-Settled', 'true');

  return c.json({
    identifier,
    alerts,
    count: alerts.length,
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      settled: true,
    },
  });
});
