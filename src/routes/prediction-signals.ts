import { Hono } from 'hono';
import { build402Response, extractPayment, verifyPayment } from '../payment';
import { getProxy } from '../proxy';
import {
  fetchKalshiOdds,
  fetchMetaculusForecasts,
  fetchPolymarketOdds,
  fetchRedditSentiment,
  classifySentiment,
} from '../scrapers/prediction-markets';

export const predictionRouter = new Hono();

const PRICE_USDC = 0.05;
const DESCRIPTION = 'Prediction market signal aggregator with cross-market spread + proxy-backed social sentiment.';

const OUTPUT_SCHEMA = {
  input: {
    type: 'signal | arbitrage | sentiment | trending',
    market: 'string (optional)',
    topic: 'string (optional)',
    country: 'string (optional)',
  },
  output: {
    timestamp: 'ISO string',
    odds: 'polymarket/kalshi/metaculus normalized objects',
    sentiment: 'platform sentiment summary + sample volume',
    signals: 'arbitrage + divergence flags with confidence',
    proxy: '{ country, type }',
    payment: '{ txHash, network, amount, settled }',
  },
};

predictionRouter.get('/', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/prediction', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const type = (c.req.query('type') || 'signal').toLowerCase();
  const market = c.req.query('market') || 'us-election';
  const topic = c.req.query('topic') || market;

  const [polymarket, kalshi, metaculus, reddit] = await Promise.all([
    fetchPolymarketOdds(10).catch(() => []),
    fetchKalshiOdds(10).catch(() => []),
    fetchMetaculusForecasts(10).catch(() => []),
    fetchRedditSentiment(topic, 20).catch(() => []),
  ]);

  const social = classifySentiment(reddit);

  const pYes = polymarket[0]?.yes;
  const kYes = kalshi[0]?.yes;
  const spread = pYes !== undefined && kYes !== undefined ? Number(Math.abs(pYes - kYes).toFixed(4)) : 0;

  const bullish = social.positive - social.negative;
  const divergence = pYes !== undefined ? Number((bullish - (pYes - 0.5)).toFixed(4)) : 0;

  const payload = {
    type,
    market,
    timestamp: new Date().toISOString(),
    odds: {
      polymarket: polymarket[0] ?? null,
      kalshi: kalshi[0] ?? null,
      metaculus: metaculus[0] ?? null,
    },
    sentiment: {
      reddit: social,
      redditSamples: reddit.slice(0, 5),
      x: { status: 'not_implemented_in_v1', reason: 'requires auth/session-safe scraper path' },
    },
    signals: {
      arbitrage: {
        detected: spread >= 0.03,
        spread,
        confidence: spread >= 0.05 ? 0.8 : spread >= 0.03 ? 0.65 : 0.4,
      },
      sentimentDivergence: {
        detected: Math.abs(divergence) >= 0.08,
        magnitude: Math.abs(divergence),
      },
    },
    proxy: { country: getProxy().country, type: 'mobile' as const },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount,
      settled: true,
    },
  };

  return c.json(payload);
});
