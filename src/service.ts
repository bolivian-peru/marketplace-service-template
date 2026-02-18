import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchApps, getAppDetails, getTopCharts, getAppReviews } from './scrapers/app-store-scraper';

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

serviceRouter.get('/run', async (c) => {
  const type = c.req.query('type') || 'search';
  const priceMap: Record<string, number> = { search: 0.02, details: 0.02, charts: 0.02, reviews: 0.01 };
  const price = priceMap[type] || 0.02;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/run',
      'App Store Intelligence — search, rankings, details, and reviews from Apple App Store and Google Play Store.',
      price,
      WALLET_ADDRESS,
      {
        input: {
          type: 'string — search | details | charts | reviews',
          query: 'string (for search) — search term',
          appId: 'string (for details/reviews) — app bundle ID or package name',
          store: 'string (optional) — apple | google | both (default: both)',
          country: 'string (optional, default: US) — ISO country code',
          category: 'string (optional, for charts) — app category',
          limit: 'number (optional, default: 20) — max results',
        },
        output: {
          type: 'string',
          apps: '{ name, appId, store, developer, rating, ratingCount, price, icon, url, category, description, version, size, lastUpdated }[]',
          reviews: '{ author, rating, title, text, date, version, helpful }[]',
          metadata: '{ totalResults, store, country, scrapedAt }',
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

    const store = c.req.query('store') || 'both';
    const country = c.req.query('country') || 'US';

    switch (type) {
      case 'search': {
        const query = c.req.query('query') || '';
        if (!query) return c.json({ error: 'Missing query parameter' }, 400);
        const limit = parseInt(c.req.query('limit') || '20');
        result = await searchApps(query, store, country, limit, proxyFetch);
        break;
      }
      case 'details': {
        const appId = c.req.query('appId') || '';
        if (!appId) return c.json({ error: 'Missing appId parameter' }, 400);
        result = await getAppDetails(appId, store, country, proxyFetch);
        break;
      }
      case 'charts': {
        const category = c.req.query('category') || '';
        const limit = parseInt(c.req.query('limit') || '20');
        result = await getTopCharts(category, store, country, limit, proxyFetch);
        break;
      }
      case 'reviews': {
        const appId = c.req.query('appId') || '';
        if (!appId) return c.json({ error: 'Missing appId parameter' }, 400);
        const limit = parseInt(c.req.query('limit') || '20');
        result = await getAppReviews(appId, store, country, limit, proxyFetch);
        break;
      }
      default:
        return c.json({ error: `Invalid type: ${type}`, valid_types: ['search', 'details', 'charts', 'reviews'] }, 400);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'App store scrape failed', message: err?.message || String(err) }, 502);
  }
});
