/**
 * Service Router — Trend Intelligence API (Bounty #70)
 *
 * Endpoints:
 *   POST /api/research — Cross-platform topic research
 *   GET  /api/trending — Cross-platform trending topics
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { researchTopic, getCrossPlatformTrending } from './scrapers/trend-intelligence-scraper';

export const serviceRouter = new Hono();

const WALLET_ADDRESS = '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

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

// ─── POST /api/research ─────────────────────────────

serviceRouter.post('/research', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/research',
      'Cross-platform trend research: scrapes Reddit, X/Twitter, YouTube, and the web simultaneously, then synthesizes results into structured intelligence with engagement-weighted pattern detection and sentiment analysis.',
      0.05,
      WALLET_ADDRESS,
      {
        input: {
          topic: 'string (required) — research topic or keywords',
          platforms: 'string[] (optional, default: ["reddit","twitter","youtube","web"]) — platforms to scrape',
          days: 'number (optional, default: 30) — timeframe in days',
          country: 'string (optional, default: "US") — ISO 2-letter country code',
        },
        output: {
          topic: 'string',
          timeframe: 'string',
          patterns: '{ pattern, strength: emerging|growing|established, sources, evidence[] }[]',
          sentiment: '{ overall, by_platform }',
          top_discussions: '{ platform, title, url, engagement }[]',
          emerging_topics: 'string[]',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.05);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const topic = body.topic || c.req.query('topic');
  if (!topic) return c.json({ error: 'Missing required field: topic' }, 400);

  const platforms = body.platforms || ['reddit', 'twitter', 'youtube', 'web'];
  const days = body.days || 30;
  const country = body.country || c.req.query('country') || 'US';

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await researchTopic(topic, platforms, days, country, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        ...result.meta,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Research failed', message: err?.message || String(err) }, 502);
  }
});

// Also support GET for simple usage
serviceRouter.get('/research', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/research',
      'Cross-platform trend research (GET). Use POST for full control over platforms and timeframe.',
      0.05,
      WALLET_ADDRESS,
      {
        input: {
          topic: 'string (required) — research topic',
          platforms: 'string (optional, comma-separated, default: "reddit,twitter,youtube,web")',
          days: 'number (optional, default: 30)',
          country: 'string (optional, default: "US")',
        },
        output: 'Same as POST /api/research',
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.05);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const topic = c.req.query('topic');
  if (!topic) return c.json({ error: 'Missing required parameter: topic' }, 400);

  const platforms = (c.req.query('platforms') || 'reddit,twitter,youtube,web').split(',').map(p => p.trim());
  const days = parseInt(c.req.query('days') || '30') || 30;
  const country = c.req.query('country') || 'US';

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await researchTopic(topic, platforms, days, country, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        ...result.meta,
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Research failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GET /api/trending ──────────────────────────────

serviceRouter.get('/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/trending',
      'Get trending topics across platforms (Reddit, X/Twitter, YouTube). Finds cross-platform trend overlaps.',
      0.02,
      WALLET_ADDRESS,
      {
        input: {
          country: 'string (optional, default: "US")',
          platforms: 'string (optional, comma-separated, default: "reddit,twitter,youtube")',
        },
        output: {
          country: 'string',
          platforms: 'string[]',
          trends: '{ topic, platforms_trending, combined_engagement, urls[] }[]',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, 0.02);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const country = c.req.query('country') || 'US';
  const platforms = (c.req.query('platforms') || 'reddit,twitter,youtube').split(',').map(p => p.trim());

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    const result = await getCrossPlatformTrending(country, platforms, proxyFetch);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      meta: {
        proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Trending fetch failed', message: err?.message || String(err) }, 502);
  }
});
