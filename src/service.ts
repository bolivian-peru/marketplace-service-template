/**
 * ┌─────────────────────────────────────────────────┐
 * │     Ad Verification & Brand Safety              │
 * │  Verify ad placements + content safety         │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { verifyAdPlacements } from './scrapers/adverify-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'ad-verification-safety';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Verify digital ad placements on any webpage. Checks ad presence, position, network detection, creative integrity, brand safety scoring, and viewability metrics. Flags unsafe content (adult, violence, hate, drugs).';

const OUTPUT_SCHEMA = {
  input: {
    url: 'string — Target webpage URL to verify (required)',
    expectedCountry: 'string — Expected geo-target country (optional)',
    expectedLandingPage: 'string — Expected ad landing page URL (optional)',
    expectedAdNetwork: 'string — Expected ad network e.g. "Google AdSense" (optional)',
  },
  output: {
    placements: [{
      found: 'boolean',
      adPosition: 'string | null — "above-fold", "below-header", "in-content", "footer"',
      adSize: 'string | null',
      adNetwork: 'string | null',
      creativeIntegrity: '{ imageLoaded, linkWorking, correctLandingPage, mismatches }',
      surroundingContent: '{ pageTitle, safetyScore, flaggedTerms, adultContent, violenceContent, hateContent }',
      geoTarget: '{ expectedCountry, actualCountry, correct }',
      loadTime: 'number | null — Page load time in ms',
      viewability: '{ aboveFold, estimatedViewRate, adDensity }',
    }],
    url: 'string',
    overallSafety: 'number — 0-100, higher = safer',
    totalAdsFound: 'number',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const url = c.req.query('url');
  if (!url) {
    return c.json({
      error: 'Missing required parameter: url',
      example: '/api/run?url=https://example.com/page&expectedCountry=US',
    }, 400);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  const expectedCountry = c.req.query('expectedCountry');
  const expectedLandingPage = c.req.query('expectedLandingPage');
  const expectedAdNetwork = c.req.query('expectedAdNetwork');

  try {
    const proxy = getProxy();
    const result = await verifyAdPlacements(url, {
      expectedCountry: expectedCountry || undefined,
      expectedLandingPage: expectedLandingPage || undefined,
      expectedAdNetwork: expectedAdNetwork || undefined,
    });

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Service execution failed', message: err.message }, 502);
  }
});
