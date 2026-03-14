import { Hono } from 'hono';

const healthRouter = new Hono();

healthRouter.get('/', (c) => c.json({
  status: 'ok',
  service: 'airbnb-intelligence-api',
  version: '0.1.0',
  timestamp: new Date().toISOString(),
  endpoints: {
    health: '/api/airbnb/health',
    search: '/api/airbnb/search',
    listing: '/api/airbnb/listing/:id',
    stats: '/api/airbnb/market-stats'
  }
}));

export { healthRouter };