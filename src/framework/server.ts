/**
 * createServer(agent) — turns a declared agent into a running x402 service.
 * Wires the shared payment gate per task, the generated discovery surface, the
 * receipt lookup, health, CORS + per-IP rate limiting, and fail-closed boot
 * assertions. Authors never touch this file.
 */

import { Hono } from 'hono';
import { validateAgent } from './config';
import { taskHandler } from './payment-gate';
import { createReplayStore } from './replay-store';
import { agentCard, discoveryDoc, manifest, wellKnownX402 } from './generate';
import type { AgentConfig, ReplayStore } from './types';

interface ServerOptions {
  store?: ReplayStore; // inject for tests
  rateLimitPerMin?: number;
}

export function createServer(agent: AgentConfig, options: ServerOptions = {}) {
  // Fail-closed: a misconfigured agent (bad task, no wallet, prod bypass) throws
  // here and never starts serving.
  const { wallets } = validateAgent(agent);
  const store = options.store ?? createReplayStore();
  const app = new Hono();

  // ── CORS (payment + receipt headers) ──
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Payment-Signature, X-Payment-Signature, X-Payment-Network');
    c.header('Access-Control-Expose-Headers', 'X-Payment-Settled, X-Payment-TxHash, payment-response');
    c.header('X-Content-Type-Options', 'nosniff');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // ── Per-IP rate limit (in-memory sliding minute; a coarse abuse brake) ──
  const limit = options.rateLimitPerMin ?? parseInt(process.env.RATE_LIMIT || '60', 10);
  const hits = new Map<string, number[]>();
  app.use('*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    if (arr.length >= limit) return c.json({ error: 'Rate limit exceeded' }, 429);
    arr.push(now);
    hits.set(ip, arr);
    await next();
  });

  // ── Generated discovery surface ──
  app.get('/', (c) => c.json(discoveryDoc(agent, wallets)));
  app.get('/.well-known/x402.json', (c) => c.json(wellKnownX402(agent, wallets)));
  app.get('/agent-card.json', (c) => c.json(agentCard(agent, wallets)));
  app.get('/manifest.json', (c) => c.json(manifest(agent, wallets)));
  app.get('/health', (c) => c.json({ status: 'healthy', agent: agent.identity.name, tasks: agent.tasks.length, networks: [wallets.solana && 'solana', wallets.base && 'base'].filter(Boolean) }));

  // ── Receipt lookup: re-serve a stored result by tx hash, free ──
  app.get('/receipts/:txHash', (c) => {
    const rec = store.get(c.req.param('txHash'));
    if (!rec) return c.json({ error: 'No payment on record for that tx hash' }, 404);
    if (rec.status === 'served' && rec.result) return c.json({ status: 'served', taskId: rec.taskId, servedAt: rec.servedAt, result: JSON.parse(rec.result) });
    return c.json({ status: rec.status, taskId: rec.taskId, redeemable: rec.status === 'failed' });
  });

  // ── One route per task, behind the shared gate ──
  for (const task of agent.tasks) {
    const handler = taskHandler(task, wallets, store);
    if ((task.method ?? 'GET') === 'POST') app.post(`/tasks/${task.id}`, handler);
    else app.get(`/tasks/${task.id}`, handler);
  }

  return app;
}
