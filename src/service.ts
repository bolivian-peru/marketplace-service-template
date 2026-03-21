/**
 * Trend Intelligence Service Router
 * ────────────────────────────────────────────────────────
 * Bounty #70 — Cross-Platform Research API
 *
 * Endpoints:
 *   POST /api/research     — Full intelligence report (Reddit + X + YouTube)
 *   GET  /api/trending     — Trending topics aggregated across platforms
 */

import { Hono } from 'hono';
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';

export const serviceRouter = new Hono();

// ─── TREND INTELLIGENCE ROUTES ───────────────────────
serviceRouter.route('/research', researchRouter);
serviceRouter.route('/trending', trendingRouter);
