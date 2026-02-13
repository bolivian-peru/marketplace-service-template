/**
 * ┌─────────────────────────────────────────────────┐
 * │  Service Router                                 │
 * │  E-Commerce Price & Stock Monitor               │
 * └─────────────────────────────────────────────────┘
 *
 * Bounty target: https://github.com/bolivian-peru/marketplace-service-template/issues/8
 *
 * Notes:
 * - Payments (x402) and proxy plumbing are provided by the template.
 * - This implementation focuses on a minimal, testable monitor with best-effort parsing.
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeProduct, type ProductSnapshot } from './scrapers/ecom-monitor';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'ecom-price-stock-monitor';
const PRICE_USDC = 0.005; // suggested: $0.005 per product check
const DESCRIPTION = 'Monitor product price + availability across e-commerce sites (mobile proxy). Returns structured JSON with price, stock status, seller, reviews, and best-effort rank.';

const OUTPUT_SCHEMA = {
  input: {
    urls: 'string — Comma-separated product URLs (required). Max 10. Example: urls=https://www.amazon.com/dp/ASIN,...',
    alertOnChange: 'boolean — If true, include alerts when price/stock changes vs history (default: true)',
  },
  output: {
    products: 'ProductSnapshot[] — Parsed product snapshots',
    alerts: 'Alert[] — Change events (optional)',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json(
      {
        error: 'Payment verification failed',
        reason: verification.error,
        hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
      },
      402,
    );
  }

  // ── Step 3: Validate input ──
  const urlsParam = c.req.query('urls');
  const alertOnChangeParam = c.req.query('alertOnChange');

  if (!urlsParam) {
    return c.json(
      {
        error: 'Missing required parameter: urls',
        hint: 'Provide comma-separated product URLs',
        example: '/api/run?urls=https://www.amazon.com/dp/B0...,...&alertOnChange=true',
      },
      400,
    );
  }

  const urls = urlsParam
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) return c.json({ error: 'No valid URLs provided' }, 400);
  if (urls.length > 10) return c.json({ error: 'Too many URLs. Max 10 per request.' }, 400);

  const alertOnChange = alertOnChangeParam === null || alertOnChangeParam === undefined
    ? true
    : String(alertOnChangeParam).toLowerCase() !== 'false';

  // ── Step 4: Execute scraping ──
  try {
    const proxy = getProxy();
    const products: ProductSnapshot[] = [];
    const alerts: any[] = [];

    for (const url of urls) {
      const snap = await scrapeProduct(url, { alertOnChange });
      products.push(snap);

      if (alertOnChange && snap.change && (snap.change.priceChanged || snap.change.availabilityChanged)) {
        alerts.push({
          url: snap.url,
          retailer: snap.retailer,
          title: snap.title,
          price: snap.price,
          availability: snap.availability,
          change: snap.change,
        });
      }
    }

    // Set payment confirmation headers
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      service: SERVICE_NAME,
      products,
      alerts,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json(
      {
        error: 'Service execution failed',
        message: err.message,
        hint: 'Retailer sites may temporarily block requests. Try again later or reduce request rate.',
      },
      502,
    );
  }
});
