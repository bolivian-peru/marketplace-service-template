import { serve } from '@hono/node-server';
import app from './src/index';

serve(app, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
