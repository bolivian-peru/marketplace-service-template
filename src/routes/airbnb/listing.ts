import { Hono } from 'hono';

const listingRouter = new Hono();

listingRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    name: `Airbnb Listing ${id}`,
    description: "Cozy apartment in the heart of the city",
    price: {
      nightly: 120,
      currency: "USD"
    },
    rating: 4.85,
    reviewsCount: 156,
    amenities: ["WiFi", "Kitchen", "AC"],
    location: "Toronto, ON",
    status: "proof-of-concept-stub",
    generatedAt: new Date().toISOString()
  });
});

export { listingRouter };