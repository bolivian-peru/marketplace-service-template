/**
 * ┌─────────────────────────────────────────────────┐
 * │       Travel Price Tracker API                  │
 * │  Flights from Google + Hotels from Booking.com │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { searchTravel } from './scrapers/travel-scraper';

export const serviceRouter = new Hono();

const SERVICE_NAME = 'travel-price-tracker';
const PRICE_USDC = 0.005;
const DESCRIPTION = 'Real-time flight and hotel prices from Google Flights and Booking.com. Search by route, dates, and travel type. Returns structured pricing data.';

const OUTPUT_SCHEMA = {
  input: {
    destination: 'string — Destination city (required)',
    origin: 'string — Origin city (required for flights)',
    checkIn: 'string — Check-in/departure date YYYY-MM-DD (required)',
    checkOut: 'string — Check-out/return date YYYY-MM-DD (required for hotels)',
    type: 'string — "flights", "hotels", or "both" (default: "both")',
    adults: 'number — Number of adults (default: 2)',
  },
  output: {
    flights: [{ airline: 'string', departure: 'string', arrival: 'string', duration: 'string | null', stops: 'number', price: 'number | null', source: 'string' }],
    hotels: [{ name: 'string', rating: 'number | null', price: 'number | null', pricePerNight: 'boolean', amenities: 'string[]', source: 'string' }],
    query: '{ origin, destination, checkIn, checkOut }',
    totalResults: 'number',
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

  const destination = c.req.query('destination');
  if (!destination) {
    return c.json({
      error: 'Missing required parameter: destination',
      example: '/api/run?origin=NYC&destination=London&checkIn=2026-03-01&checkOut=2026-03-07&type=both',
    }, 400);
  }

  const origin = c.req.query('origin');
  const checkIn = c.req.query('checkIn');
  const checkOut = c.req.query('checkOut');
  const type = (c.req.query('type') || 'both') as 'flights' | 'hotels' | 'both';
  const adults = c.req.query('adults') ? parseInt(c.req.query('adults')!) : 2;

  if (!checkIn) {
    return c.json({ error: 'Missing required parameter: checkIn (YYYY-MM-DD format)' }, 400);
  }

  if ((type === 'flights' || type === 'both') && !origin) {
    return c.json({ error: 'Origin is required for flight searches' }, 400);
  }

  if ((type === 'hotels' || type === 'both') && !checkOut) {
    return c.json({ error: 'checkOut date is required for hotel searches' }, 400);
  }

  try {
    const proxy = getProxy();
    const result = await searchTravel(destination, { origin: origin || undefined, checkIn, checkOut: checkOut || undefined, type, adults });

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
