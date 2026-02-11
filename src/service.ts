/**
 * ┌─────────────────────────────────────────────────┐
 * │       Real Estate Listing Aggregator            │
 * │  Aggregate listings from Zillow + Redfin       │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchProperties } from './scrapers/realestate-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'real-estate-aggregator';
const PRICE_USDC = 0.01;
const DESCRIPTION = 'Aggregate property listings from Zillow and Redfin. Returns structured data: address, price, beds/baths, sqft, price history, days on market, listing agent. Search by ZIP, city, or address.';

const OUTPUT_SCHEMA = {
  input: {
    location: 'string — ZIP code, city, or address to search (required)',
    minPrice: 'number — Minimum price filter (optional)',
    maxPrice: 'number — Maximum price filter (optional)',
    beds: 'number — Minimum bedrooms (optional)',
    sources: 'string — Comma-separated: "zillow,redfin" (default: both)',
  },
  output: {
    listings: [{
      address: 'string — Full property address',
      price: 'number | null — Listing price',
      priceFormatted: 'string | null — Formatted price string',
      beds: 'number | null — Number of bedrooms',
      baths: 'number | null — Number of bathrooms',
      sqft: 'number | null — Square footage',
      lotSize: 'string | null — Lot size',
      yearBuilt: 'number | null — Year built',
      propertyType: 'string | null — e.g. SingleFamilyResidence, Condo',
      listingStatus: 'string — e.g. For Sale, Pending',
      daysOnMarket: 'number | null — Days listed',
      priceHistory: 'PriceChange[] — Historical price changes',
      listingAgent: 'string | null — Agent or broker name',
      listingUrl: 'string — Direct link to listing',
      imageUrl: 'string | null — Primary listing image',
      source: 'string — "zillow" or "redfin"',
      latitude: 'number | null',
      longitude: 'number | null',
    }],
    totalFound: 'number',
    query: 'string',
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

  const location = c.req.query('location');
  if (!location) {
    return c.json({
      error: 'Missing required parameter: location',
      example: '/api/run?location=Austin+TX&minPrice=200000&maxPrice=500000&beds=3',
    }, 400);
  }

  const minPrice = c.req.query('minPrice') ? parseInt(c.req.query('minPrice')!) : undefined;
  const maxPrice = c.req.query('maxPrice') ? parseInt(c.req.query('maxPrice')!) : undefined;
  const beds = c.req.query('beds') ? parseInt(c.req.query('beds')!) : undefined;
  const sources = c.req.query('sources')?.split(',').map(s => s.trim().toLowerCase()) || ['zillow', 'redfin'];

  try {
    const proxy = getProxy();
    const result = await searchProperties(location, { minPrice, maxPrice, beds, sources });

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
