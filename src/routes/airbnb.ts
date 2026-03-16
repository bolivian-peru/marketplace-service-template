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

// TODO: /intelligence endpoint with payment & scraper
airbnbRouter.get('/intelligence', (c) => {
  return c.json({ error: 'Not implemented yet. Coming soon: scrape Airbnb listings by city/query with structured output.' }, 501);
});

export default airbnbRouter;
