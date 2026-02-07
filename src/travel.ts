import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getProxy } from './proxy';

export const travelRouter = new Hono();

const SERVICE_NAME = 'travel-price-tracker-api';
const PRICE_USDC = 0.50;
const DESCRIPTION = 'Get real-time flight and hotel prices from Google Flights and Booking.com.';

const OUTPUT_SCHEMA = {
  input: {
    origin: 'string — origin airport/city code',
    destination: 'string — destination airport/city code',
    date: 'string — travel date (YYYY-MM-DD)',
    type: 'string — "flight" or "hotel"',
    nights: 'number — nights for hotel (optional)',
  },
  output: {
    source: 'string — data source',
    prices: 'array — price results',
    query: 'object — input parameters',
  },
};

// Dummy scraper for Google Flights (replace with real browser automation)
async function scrapeGoogleFlights(origin: string, destination: string, date: string) {
  // ...simulate scraping...
  return [
    {
      airline: 'Delta',
      price: 320,
      currency: 'USD',
      depart: `${date}T08:00`,
      arrive: `${date}T12:00`,
      duration: '4h',
      stops: 0,
    },
    {
      airline: 'United',
      price: 350,
      currency: 'USD',
      depart: `${date}T09:00`,
      arrive: `${date}T13:00`,
      duration: '4h',
      stops: 0,
    },
  ];
}

// Dummy scraper for Booking.com (replace with real browser automation)
async function scrapeBooking(destination: string, date: string, nights: number) {
  // ...simulate scraping...
  return [
    {
      hotel: 'Grand Hotel',
      price: 120,
      currency: 'USD',
      checkin: date,
      nights,
      rating: 8.7,
    },
    {
      hotel: 'City Inn',
      price: 90,
      currency: 'USD',
      checkin: date,
      nights,
      rating: 8.1,
    },
  ];
}

travelRouter.post('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // Payment check
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/travel/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // Payment verification
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // Parse input
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const { origin, destination, date, type, nights = 1 } = body;
  if (!origin || !destination || !date || !type) {
    return c.json({ error: 'Missing required parameters: origin, destination, date, type' }, 400);
  }

  // Scrape data
  let prices = [];
  let source = '';
  if (type === 'flight') {
    prices = await scrapeGoogleFlights(origin, destination, date);
    source = 'Google Flights';
  } else if (type === 'hotel') {
    prices = await scrapeBooking(destination, date, nights);
    source = 'Booking.com';
  } else {
    return c.json({ error: 'Invalid type. Use "flight" or "hotel".' }, 400);
  }

  return c.json({
    source,
    prices,
    query: { origin, destination, date, type, nights },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount,
      settled: true,
    },
  });
});
