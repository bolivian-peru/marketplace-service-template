import { Hono } from 'hono';

const airbnbRouter = new Hono();

airbnbRouter.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'Airbnb Intelligence API (Bounty #78)',
    timestamp: new Date().toISOString(),
    uptime: process.uptime().toFixed(2),
    endpoints: ['/health', '/intelligence'],
    version: '0.1.0 - WIP'
  });
});

import { scrapeIntelligence } from '../scrapers/airbnb/intelligence.js';

// MVP scraper (mock data; real browser next)
airbnbRouter.get('/intelligence', async (c) => {
  const { searchParams } = new URL(c.req.url);
  const city = searchParams.get('city');
  const query = searchParams.get('query') || '';
  const limit = parseInt(searchParams.get('limit') || '20');

  if (!city) {
    return c.json({ error: 'city required' }, 400);
  }

  try {
    const data = await scrapeIntelligence(city, query, limit);
    return c.json(data);
  } catch (e) {
    return c.json({ error: 'Scrape failed', details: e.message }, 500);
  }
});


export default airbnbRouter;
