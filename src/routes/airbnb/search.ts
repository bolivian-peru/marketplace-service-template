import { Hono } from 'hono';

const searchRouter = new Hono();

searchRouter.get('/', async (c) => {
  const query = c.req.query('q') || 'Toronto';
  const limit = parseInt(c.req.query('limit') || '10');
  
  const listings = Array.from({length: limit}, (_, idx) => ({
    id: `airbnb-${Date.now()}-${idx}`,
    name: `${query} Apt ${idx + 1}`,
    price: { nightly: 120 + idx * 5, currency: 'USD' },
    rating: (4.5 + (Math.random() - 0.5) * 0.5).toFixed(2),
    reviewsCount: Math.floor(50 + Math.random() * 200),
    location: query,
    url: `https://airbnb.com/rooms/${Date.now()}-${idx}`,
    status: 'proof-of-concept-stub'
  }));

  return c.json({
    query,
    count: listings.length,
    listings,
    generatedAt: new Date().toISOString()
  });
});

export { searchRouter };