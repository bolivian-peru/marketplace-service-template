import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getZillowProperty, searchZillow, getZillowMarket, getZillowComps } from '../scrapers/zillow';
import { getProxyExitIp, getProxy } from '../proxy';

export const realestateRouter = new Hono();

const PRICES = {
  property: 0.02,
  search: 0.01,
  market: 0.05,
  comps: 0.03,
};

async function enforcePayment(c: any, type: keyof typeof PRICES, resource: string, description: string) {
  const payment = extractPayment(c);
  const price = PRICES[type];
  const SOLANA_WALLET = process.env.WALLET_ADDRESS_SOLANA || 'GNVMZuA1vVsRrz7Ug5Rpws1toBofKnbXqKshxSfTDgnr';
  const BASE_WALLET = process.env.WALLET_ADDRESS_BASE || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';
  
  if (!payment) {
    return c.json(build402Response(resource, description, price, SOLANA_WALLET), 402);
  }

  const verified = await verifyPayment(
    payment, 
    payment.network === 'solana' ? SOLANA_WALLET : BASE_WALLET, 
    price
  );

  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }

  c.header('X-Payment-Settled', 'true');
  return payment;
}

realestateRouter.get('/property/:zpid', async (c) => {
  const zpid = c.req.param('zpid');
  const payment = await enforcePayment(c, 'property', `/api/realestate/property/${zpid}`, 'Zillow Property Details');
  if (payment instanceof Response) return payment;

  try {
    const data = await getZillowProperty(zpid);
    const proxyIp = await getProxyExitIp();
    const proxy = getProxy();
    
    return c.json({
      ...data,
      meta: {
        proxy: { ip: proxyIp, country: proxy.country, carrier: 'AT&T', type: 'mobile' }
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        settled: true
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

realestateRouter.get('/search', async (c) => {
  const address = c.req.query('address');
  const zip = c.req.query('zip');
  const city = c.req.query('city');
  const type = c.req.query('type');
  const min_price = c.req.query('min_price');
  
  const query = address || zip || city || 'United States';

  const payment = await enforcePayment(c, 'search', `/api/realestate/search?query=${query}`, 'Zillow Search');
  if (payment instanceof Response) return payment;

  try {
    const data = await searchZillow(query, { type, min_price });
    const proxyIp = await getProxyExitIp();
    const proxy = getProxy();
    
    return c.json({
      query,
      results: data,
      meta: {
        proxy: { ip: proxyIp, country: proxy.country, carrier: 'AT&T', type: 'mobile' }
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        settled: true
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

realestateRouter.get('/market', async (c) => {
  const zip = c.req.query('zip');
  if (!zip) return c.json({ error: 'Missing zip parameter' }, 400);

  const payment = await enforcePayment(c, 'market', `/api/realestate/market?zip=${zip}`, 'Zillow Market Data');
  if (payment instanceof Response) return payment;

  try {
    const data = await getZillowMarket(zip);
    const proxyIp = await getProxyExitIp();
    const proxy = getProxy();
    
    return c.json({
      ...data,
      meta: {
        proxy: { ip: proxyIp, country: proxy.country, carrier: 'AT&T', type: 'mobile' }
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        settled: true
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

realestateRouter.get('/comps/:zpid', async (c) => {
  const zpid = c.req.param('zpid');
  const radius = c.req.query('radius') || '0.5mi';

  const payment = await enforcePayment(c, 'comps', `/api/realestate/comps/${zpid}`, 'Zillow Comps');
  if (payment instanceof Response) return payment;

  try {
    const data = await getZillowComps(zpid, radius);
