import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxyExitIp } from '../proxy';
import * as amazonScraper from '../scrapers/amazon';

export const amazonRouter = new Hono();

amazonRouter.get('/product/:asin', async (c) => {
  const asin = c.req.param('asin');
  const marketplace = c.req.query('marketplace') || 'US';
  const priceUSDC = 0.005;

  const payment = extractPayment(c);
  const recipient = process.env.WALLET_ADDRESS || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';

  if (!payment) {
    return c.json(build402Response(c.req.path, 'Amazon Product Lookup', priceUSDC, recipient), 402);
  }

  const verified = await verifyPayment(payment, recipient, priceUSDC);
  if (!verified.valid) {
    return c.json({ error: verified.error }, 400);
  }

  try {
    const data = await amazonScraper.scrapeProduct(asin, marketplace);
    const ip = await getProxyExitIp();
    c.header('X-Payment-Settled', 'true');
    return c.json({
      ...data,
      meta: {
        marketplace,
        proxy: { ip, type: 'mobile', country: 'US' }
      },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

amazonRouter.get('/search', async (c) => {
  const query = c.req.query('query');
  const category = c.req.query('category') || 'aps';
  const marketplace = c.req.query('marketplace') || 'US';
  const priceUSDC = 0.01;

  if (!query) return c.json({ error: 'Missing query' }, 400);

  const payment = extractPayment(c);
  const recipient = process.env.WALLET_ADDRESS || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';

  if (!payment) {
    return c.json(build402Response(c.req.path, 'Amazon Search', priceUSDC, recipient), 402);
  }

  const verified = await verifyPayment(payment, recipient, priceUSDC);
  if (!verified.valid) {
    return c.json({ error: verified.error }, 400);
  }

  try {
    const data = await amazonScraper.scrapeSearch(query, category, marketplace);
    const ip = await getProxyExitIp();
    c.header('X-Payment-Settled', 'true');
    return c.json({
      results: data,
      meta: {
        marketplace,
        proxy: { ip, type: 'mobile', country: 'US' }
      },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

amazonRouter.get('/bestsellers', async (c) => {
  const category = c.req.query('category') || 'electronics';
  const marketplace = c.req.query('marketplace') || 'US';
  const priceUSDC = 0.01;

  const payment = extractPayment(c);
  const recipient = process.env.WALLET_ADDRESS || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';

  if (!payment) {
    return c.json(build402Response(c.req.path, 'Amazon Bestsellers', priceUSDC, recipient), 402);
  }

  const verified = await verifyPayment(payment, recipient, priceUSDC);
  if (!verified.valid) {
    return c.json({ error: verified.error }, 400);
  }

  try {
    const data = await amazonScraper.scrapeBestsellers(category, marketplace);
    const ip = await getProxyExitIp();
    c.header('X-Payment-Settled', 'true');
    return c.json({
      results: data,
      meta: {
        marketplace,
        proxy: { ip, type: 'mobile', country: 'US' }
      },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

amazonRouter.get('/reviews/:asin', async (c) => {
  const asin = c.req.param('asin');
  const sort = c.req.query('sort') || 'recent';
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const marketplace = c.req.query('marketplace') || 'US';
  const priceUSDC = 0.02;

  const payment = extractPayment(c);
  const recipient = process.env.WALLET_ADDRESS || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';

  if (!payment) {
    return c.json(build402Response(c.req.path, 'Amazon Reviews', priceUSDC, recipient), 402);
  }

  const verified = await verifyPayment(payment, recipient, priceUSDC);
  if (!verified.valid) {
    return c.json({ error: verified.error }, 400);
  }

  try {
    const data = await amazonScraper.scrapeReviews(asin, sort, limit, marketplace);
    const ip = await getProxyExitIp();
    c.header('X-Payment-Settled', 'true');
    return c.json({
      asin,
      reviews: data,
      meta: {
        marketplace,
        proxy: { ip, type: 'mobile', country: 'US' }
      },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});
