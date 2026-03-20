/**
 * Prediction Market Signal Aggregator — Routes (Bounty #55)
 * ──────────────────────────────────────────────────────────
 * GET /api/prediction/signal?market=<query>&country=US
 * GET /api/prediction/arbitrage
 * GET /api/prediction/sentiment?topic=<query>&country=US
 * GET /api/prediction/trending
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getSignal, getArbitrage, getSentiment, getTrending } from '../scrapers/prediction-market';

export const predictionRouter = new Hono();

const WALLET = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';
const PRICE_SIGNAL = 0.05;
const PRICE_ARBITRAGE = 0.03;
const PRICE_SENTIMENT = 0.02;
const PRICE_TRENDING = 0.01;

// ─── Signal endpoint ────────────────────────────────

predictionRouter.get('/signal', async (c) => {
  const market = c.req.query('market');
  const country = c.req.query('country') || 'US';

  if (!market) {
    return c.json({ error: 'Missing required parameter: market', example: '/api/prediction/signal?market=bitcoin' }, 400);
  }

  // Check payment
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/signal',
        'Prediction market signal with cross-platform odds + social sentiment + arbitrage detection',
        PRICE_SIGNAL,
        WALLET,
        {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'signal' },
            market: { type: 'string' },
            odds: { type: 'object', description: 'Polymarket + Kalshi + Metaculus odds' },
            sentiment: { type: 'object', description: 'Twitter + Reddit sentiment via mobile proxy' },
            signals: { type: 'object', description: 'Arbitrage + sentiment divergence + volume spike alerts' },
          },
        },
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_SIGNAL);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const result = await getSignal(market, country);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: PRICE_SIGNAL, verified: true } });
  } catch (err: any) {
    console.error('[PREDICTION] Signal error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});

// ─── Arbitrage endpoint ─────────────────────────────

predictionRouter.get('/arbitrage', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/arbitrage',
        'Cross-platform prediction market arbitrage opportunities (Polymarket vs Kalshi spread detection)',
        PRICE_ARBITRAGE,
        WALLET,
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_ARBITRAGE);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const result = await getArbitrage();
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: PRICE_ARBITRAGE, verified: true } });
  } catch (err: any) {
    console.error('[PREDICTION] Arbitrage error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});

// ─── Sentiment endpoint ─────────────────────────────

predictionRouter.get('/sentiment', async (c) => {
  const topic = c.req.query('topic');
  const country = c.req.query('country') || 'US';

  if (!topic) {
    return c.json({ error: 'Missing required parameter: topic', example: '/api/prediction/sentiment?topic=bitcoin+etf' }, 400);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/sentiment',
        'Real-time social sentiment analysis via mobile proxy (Twitter/X + Reddit)',
        PRICE_SENTIMENT,
        WALLET,
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_SENTIMENT);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const result = await getSentiment(topic, country);
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: PRICE_SENTIMENT, verified: true } });
  } catch (err: any) {
    console.error('[PREDICTION] Sentiment error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});

// ─── Trending endpoint ──────────────────────────────

predictionRouter.get('/trending', async (c) => {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/trending',
        'Trending prediction markets with volume and odds data',
        PRICE_TRENDING,
        WALLET,
      ),
      402,
    );
  }

  const verify = await verifyPayment(payment, WALLET, PRICE_TRENDING);
  if (!verify.valid) {
    return c.json({ error: 'Payment verification failed', details: verify.error }, 402);
  }

  try {
    const result = await getTrending();
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: PRICE_TRENDING, verified: true } });
  } catch (err: any) {
    console.error('[PREDICTION] Trending error:', err.message);
    return c.json({ error: 'Scrape failed', message: err.message }, 503);
  }
});
