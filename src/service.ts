import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchRestaurants, getMenuPrices, comparePrices } from './scrapers/food-delivery-scraper';

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
  const priceMap: Record<string, number> = { search: 0.02, menu: 0.02, compare: 0.03 };
  const price = priceMap[type] || 0.02;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      '/api/run',
      'Food Delivery Price Intelligence — restaurant search, menu prices, and cross-platform price comparison from DoorDash, Uber Eats, and Grubhub.',
      price,
      WALLET_ADDRESS,
      {
        input: {
          type: 'string — search | menu | compare',
          query: 'string (for search) — restaurant name or cuisine',
          location: 'string — city, zip, or address',
          url: 'string (for menu/compare) — restaurant URL from any platform',
        },
        output: {
          type: 'string',
          restaurants: '{ name, platform, rating, deliveryFee, deliveryTime, priceRange, cuisine, url, address }[]',
          menu: '{ items: { name, price, description, category }[] }',
          metadata: '{ totalResults, platforms, scrapedAt }',
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
      case 'search': {
        const query = c.req.query('query') || '';
        const location = c.req.query('location') || '';
        if (!location) return c.json({ error: 'Missing location parameter' }, 400);
        result = await searchRestaurants(query, location, proxyFetch);
        break;
      }
      case 'menu': {
        const url = c.req.query('url') || '';
        if (!url) return c.json({ error: 'Missing url parameter' }, 400);
        result = await getMenuPrices(url, proxyFetch);
        break;
      }
      case 'compare': {
        const query = c.req.query('query') || '';
        const location = c.req.query('location') || '';
        if (!query || !location) return c.json({ error: 'Missing query and location parameters' }, 400);
        result = await comparePrices(query, location, proxyFetch);
        break;
      }
      default:
        return c.json({ error: `Invalid type: ${type}`, valid_types: ['search', 'menu', 'compare'] }, 400);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { ip, country: proxy.country, carrier: proxy.host, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Food delivery scrape failed', message: err?.message || String(err) }, 502);
  }
});
