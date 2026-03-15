import { Hono } from 'hono';
import { z } from 'zod';

const reviewsRouter = new Hono();

const listingIdSchema = z.string().regex(/^\d+$/);

reviewsRouter.get('/:listing_id', async (c) => {
  const listingId = listingIdSchema.parse(c.req.param('listing_id'));
  
  // Mock reviews data (replace with scraper)
  const mockReviews = [
    {
      id: 'rev1',
      listingId,
      author: 'Traveler123',
      date: '2026-03-01',
      rating: 5,
      title: 'Amazing stay!',
      body: 'Perfect location, super clean, host responsive.',
      verified: true
    },
    {
      id: 'rev2',
      listingId,
      author: 'FamilyVacay',
      date: '2026-02-20',
      rating: 4,
      title: 'Great value',
      body: 'Kids loved the pool. Minor check-in hiccup.',
      verified: true
    },
    {
      id: 'rev3',
      listingId,
      author: 'BusinessTrip',
      date: '2026-02-15',
      rating: 5,
      title: 'Excellent',
      body: 'Quiet, well-equipped, fast WiFi.',
      verified: false
    }
  ];
  
  return c.json({
    status: 'ok',
    listingId,
    reviews: mockReviews,
    count: mockReviews.length,
    avgRating: 4.67,
    timestamp: new Date().toISOString(),
    notes: 'Mock data - full scraper pending'
  });
});

export { reviewsRouter };
