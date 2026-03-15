import { Hono } from 'hono';
import { healthRouter } from './health';
import { listingRouter } from './listing';
import { statsRouter } from './market-stats';
import { reviewsRouter } from './reviews';
import { searchRouter } from './search';

const airbnbRouter = new Hono();

airbnbRouter.route('/health', healthRouter);
airbnbRouter.route('/search', searchRouter);
airbnbRouter.route('/listing', listingRouter);
airbnbRouter.route('/market-stats', statsRouter);
airbnbRouter.route('/reviews', reviewsRouter);

export default airbnbRouter;