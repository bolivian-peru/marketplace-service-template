/**
 * Prediction Market Signal Routes (Bounty #55)
 * ─────────────────────────────────────────────
 * Endpoints:
 *   GET /predictions/signal?market=<slug>     — Full signal for a specific market
 *   GET /predictions/arbitrage                — Active arbitrage opportunities
 *   GET /predictions/sentiment?topic=<topic>  — Sentiment analysis for a topic
 *   GET /predictions/trending                 — Trending markets with sentiment divergence
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  getMarketSignal,
  findArbitrageOpportunities,
  getTopicSentiment,
  getTrendingMarkets,
} from '../scrapers/prediction-market';

export const predictionsRouter = new Hono();

const WALLET = () => process.env.WALLET_ADDRESS || '';
const PRICE_SIGNAL = 0.05;    // Full signal with sentiment
const PRICE_ARBITRAGE = 0.03; // Arbitrage scan
const PRICE_SENTIMENT = 0.02; // Sentiment only
const PRICE_TRENDING = 0.01;  // Trending markets

const OUTPUT_SCHEMA = {
  signal: {
    input: {
      market: 'string — Market slug or keyword (required). Example: us-presidential-election-2028',
    },
    output: {
      type: 'signal',
      market: 'string',
      timestamp: 'ISO 8601',
      odds: {
        polymarket: '{ yes, no, volume24h, liquidity } | null',
        kalshi: '{ yes, no, volume24h, liquidity } | null',
        metaculus: '{ median, forecasters } | null',
      },
      sentiment: {
        twitter: '{ positive, negative, neutral, volume, trending, topTweets } | null',
        reddit: '{ positive, negative, neutral, volume, trending, topSubreddits } | null',
      },
      signals: {
        arbitrage: '{ detected, spread, direction, confidence }',
        sentimentDivergence: '{ detected, description, magnitude }',
        volumeSpike: '{ detected, platform?, volume24h?, description? }',
      },
    },
  },
  arbitrage: {
    input: {},
    output: {
      opportunities: '[{ market, platformA, platformB, priceA, priceB, spread, direction, confidence }]',
      count: 'number',
    },
  },
  sentiment: {
    input: {
      topic: 'string — Topic to analyze (required)',
      country: 'string — ISO country code (default: US)',
    },
    output: {
      topic: 'string',
      twitter: '{ positive, negative, neutral, volume, trending, topTweets } | null',
      reddit: '{ positive, negative, neutral, volume, trending, topSubreddits } | null',
    },
  },
  trending: {
    input: {},
    output: {
      markets: '[{ market, question, platform, probability, volume24h, sentimentDivergence }]',
    },
  },
};

// ─── GET /predictions/signal ────────────────────────

predictionsRouter.get('/signal', async (c) => {
  const wallet = WALLET();
  if (!wallet) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/predictions/signal',
        'Prediction Market Signal — aggregated odds from Polymarket/Kalshi/Metaculus with social sentiment analysis via mobile proxies',
        PRICE_SIGNAL,
        wallet,
        OUTPUT_SCHEMA.signal,
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, wallet, PRICE_SIGNAL);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 403);
  }

  const market = c.req.query('market');
  if (!market) {
    return c.json({ error: 'Missing required parameter: market', example: '?market=us-presidential-election-2028' }, 400);
  }

  try {
    const signal = await getMarketSignal(market);
    const proxy = getProxy();

    return c.json({
      ...signal,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: PRICE_SIGNAL,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[predictions] Signal error: ${err.message}`);
    return c.json({ error: 'Failed to generate signal', details: err.message }, 500);
  }
});

// ─── GET /predictions/arbitrage ─────────────────────

predictionsRouter.get('/arbitrage', async (c) => {
  const wallet = WALLET();
  if (!wallet) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/predictions/arbitrage',
        'Cross-platform prediction market arbitrage scanner — finds price spreads between Polymarket and Kalshi',
        PRICE_ARBITRAGE,
        wallet,
        OUTPUT_SCHEMA.arbitrage,
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, wallet, PRICE_ARBITRAGE);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 403);
  }

  try {
    const opportunities = await findArbitrageOpportunities();
    const proxy = getProxy();

    return c.json({
      type: 'arbitrage',
      timestamp: new Date().toISOString(),
      opportunities,
      count: opportunities.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: PRICE_ARBITRAGE,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[predictions] Arbitrage error: ${err.message}`);
    return c.json({ error: 'Failed to scan arbitrage', details: err.message }, 500);
  }
});

// ─── GET /predictions/sentiment ─────────────────────

predictionsRouter.get('/sentiment', async (c) => {
  const wallet = WALLET();
  if (!wallet) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/predictions/sentiment',
        'Social sentiment analysis for prediction market topics — Twitter/X and Reddit scraped via mobile proxies',
        PRICE_SENTIMENT,
        wallet,
        OUTPUT_SCHEMA.sentiment,
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, wallet, PRICE_SENTIMENT);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 403);
  }

  const topic = c.req.query('topic');
  if (!topic) {
    return c.json({ error: 'Missing required parameter: topic', example: '?topic=bitcoin+etf&country=US' }, 400);
  }

  const country = c.req.query('country') || 'US';

  try {
    const sentiment = await getTopicSentiment(topic, country);
    const proxy = getProxy();

    return c.json({
      type: 'sentiment',
      topic,
      country,
      timestamp: new Date().toISOString(),
      ...sentiment,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: PRICE_SENTIMENT,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[predictions] Sentiment error: ${err.message}`);
    return c.json({ error: 'Failed to analyze sentiment', details: err.message }, 500);
  }
});

// ─── GET /predictions/trending ──────────────────────

predictionsRouter.get('/trending', async (c) => {
  const wallet = WALLET();
  if (!wallet) return c.json({ error: 'WALLET_ADDRESS not configured' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/predictions/trending',
        'Trending prediction markets from Polymarket and Metaculus with sentiment divergence signals',
        PRICE_TRENDING,
        wallet,
        OUTPUT_SCHEMA.trending,
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, wallet, PRICE_TRENDING);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', details: verification.error }, 403);
  }

  try {
    const markets = await getTrendingMarkets();
    const proxy = getProxy();

    return c.json({
      type: 'trending',
      timestamp: new Date().toISOString(),
      markets,
      count: markets.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: PRICE_TRENDING,
        settled: true,
      },
    });
  } catch (err: any) {
    console.error(`[predictions] Trending error: ${err.message}`);
    return c.json({ error: 'Failed to fetch trending markets', details: err.message }, 500);
  }
});
