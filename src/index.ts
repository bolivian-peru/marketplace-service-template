/**
 * Server entry. You do not edit this — declare your agent in agent.config.ts.
 * createServer validates the config + wallets fail-closed, then serves.
 */

import { createServer } from './framework';
import agent from './agent.config';

const app = createServer(agent);
const port = parseInt(process.env.PORT || '3000', 10);

console.log(`[${agent.identity.name}] listening on :${port} — ${agent.tasks.length} task(s)`);
console.log('  discovery: GET /   ·   health: GET /health   ·   tasks: /tasks/:id');

export default { port, hostname: '0.0.0.0', fetch: app.fetch };

// Exported so tests can drive the app in-process via app.fetch(...).
export { app };
