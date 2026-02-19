/**
 * Service Router — Google Discover Feed Intelligence API (Bounty #52)
 *
 * Endpoints:
 *   GET /api/run?country=US&category=technology
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getDiscoverFeed } from './scrapers/google-discover-scraper';

export const serviceRouter = new Hono();

const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

// ─── GET /api/run — per bounty spec ─────────────────

serviceRouter.get('/run', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/run',
      'Google Discover Feed Intelligence — mobile-only content from Google News and Discover. Returns trending articles, sources, snippets, images, and publish times by country and category.',
      0.02,
      WALLET_ADDRESS,
      {
        input: {
          country: 'string (optional, default: "US") — ISO 2-letter country code',
          category: 'string (optional, default: "technology") — one of: technology, science, business, entertainment, sports, health, world, news, top',
        },
        output: {
          country: 'string',
          category: 'string',
          discover_feed: '{ position, title, source, sourceUrl, url, snippet, imageUrl, contentType, publishedAt, category, engagement }[]',
          metadata: '{ feedLength, scrapedAt, proxyCountry }',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.02);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const country = c.req.query('country') || 'US';
  const category = c.req.query('category') || 'technology';

  const validCategories = ['technology', 'science', 'business', 'entertainment', 'sports', 'health', 'world', 'news', 'top'];
  if (!validCategories.includes(category.toLowerCase())) {
    return c.json({ error: `Invalid category: ${category}`, valid_categories: validCategories }, 400);
  }

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getDiscoverFeed(country, category, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Discover feed fetch failed', message: err?.message || String(err) }, 502);
  }
});
