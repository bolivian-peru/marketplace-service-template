import { Hono } from 'hono';

const statsRouter = new Hono();

statsRouter.get('/', async (c) => {
  return c.json({
    market: "Airbnb Toronto",
    stats: {
      totalListings: 5421,
      avgNightlyPrice: 145.2,
      occupancyRate: 72.3,
      avgRating: 4.65,
      growthYoY: 8.4
    },
    period: "2026-03",
    status: "proof-of-concept-stub",
    generatedAt: new Date().toISOString()
  });
});

export { statsRouter };