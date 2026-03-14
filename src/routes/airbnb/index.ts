import { Hono } from 'hono';
import { healthRouter } from './health';
// import searchRouter from './search';
// import listingRouter from './listing';

const airbnbRouter = new Hono();

airbnbRouter.route('/health', healthRouter);

// TODO: Mount other routers
// airbnbRouter.route('/search', searchRouter);
// airbnbRouter.route('/listing', listingRouter);

export default airbnbRouter;