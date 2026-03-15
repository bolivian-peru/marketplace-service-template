import { Hono } from 'hono';
import { healthRouter } from './health';
import { listingRouter } from './listing';
import { statsRouter } from './market-stats';
import { reviewsRouter } from './reviews';

const airbnbRouter = new Hono();

airbnbRouter.route('/health', healthRouter);
airbnbRouter.route('/listing', listingRouter);
airbnbRouter.route('/market-stats', statsRouter);
airbnbRouter.route('/reviews', reviewsRouter);

export default airbnbRouter;