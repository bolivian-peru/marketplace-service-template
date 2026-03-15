import { Hono } from 'hono';

const reviewsRouter = new Hono();

reviewsRouter.get('/:listing_id', async (c) => {
  const listingId = c.req.param('listing_id');
  const limit = parseInt(c.req.query('limit') || '10');
  
  const reviews = Array.from({length: limit}, (_, idx) => ({
    id: `review-${listingId}-${idx}`,
    listingId,
    author: `Guest ${idx + 1}`,
    rating: Math.floor(3 + Math.random() * 2),
    title: 'Great stay!',
    comment: 'Clean and comfortable. Highly recommend.',
    date: new Date(Date.now() - idx * 86400000).toISOString().split('T')[0],
    verified: true
  }));

  return c.json({
    listingId,
    count: reviews.length,
    avgRating: (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(2),
    reviews,
    generatedAt: new Date().toISOString(),
    status: 'proof-of-concept-stub'
  });
});

export { reviewsRouter };