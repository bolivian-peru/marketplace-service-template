import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getTrendingMarkets, searchMarkets, getMarketDetails } from './scrapers/prediction-market-scraper';

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

// GET /api/run?type=trending|search|details
serviceRouter.get('/run', async (c) => {
  const type = c.req.query('type') || 'trending';
  const priceMap: Record<string, number> = { trending: 0.02, search: 0.02, details: 0.01 };
  const price = priceMap[type] || 0.02;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/run',
      'Prediction Market Signal Aggregator — real-time odds and probabilities from Polymarket, Metaculus, and PredictIt. Supports trending markets, search, and detailed market analysis.',
      price,
      WALLET_ADDRESS,
      {
        input: {
          type: 'string — trending | search | details',
          query: 'string (for search) — search query',
          url: 'string (for details) — market URL',
          category: 'string (optional) — politics, crypto, sports, science, etc.',
          limit: 'number (optional, default 20) — max results',
        },
        output: {
          type: 'string',
          markets: '{ title, platform, probability, volume, url, category, lastUpdated, traders, description }[]',
          metadata: '{ totalMarkets, platforms, scrapedAt }',
        },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, price);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    let result: any;

    switch (type) {
      case 'trending': {
        const category = c.req.query('category') || '';
        const limit = parseInt(c.req.query('limit') || '20');
        result = await getTrendingMarkets(category, limit, proxyFetch);
        break;
      }
      case 'search': {
        const query = c.req.query('query') || '';
        if (!query) return c.json({ error: 'Missing query parameter' }, 400);
        const limit = parseInt(c.req.query('limit') || '20');
        result = await searchMarkets(query, limit, proxyFetch);
        break;
      }
      case 'details': {
        const url = c.req.query('url') || '';
        if (!url) return c.json({ error: 'Missing url parameter' }, 400);
        result = await getMarketDetails(url, proxyFetch);
        break;
      }
      default:
        return c.json({ error: `Invalid type: ${type}`, valid_types: ['trending', 'search', 'details'] }, 400);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Prediction market scrape failed', message: err?.message || String(err) }, 502);
  }
});
