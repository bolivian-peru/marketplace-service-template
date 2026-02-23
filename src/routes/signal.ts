// src/routes/signal.ts
// x402-enabled endpoint for prediction market signals.

import type { Context } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import { getAggregatedMarketData } from '../marketData';
import { getSocialSentiment } from '../sentiment';
import { buildSignalBundle } from '../signals';
import { resolveMarketConfig } from '../../config/markets';

const SIGNAL_PRICE_USDC = 0.05; // $0.05 per signal bundle (suggested 0.01-0.10)

const SIGNAL_OUTPUT_SCHEMA = {
  input: {
    type: '"signal" | "sentiment" | "arbitrage" | "trending" (required)',
    market: 'string (required for type="signal" | "arbitrage")',
    topic: 'string (required for type="sentiment")',
    country: 'string (optional, ISO-2, default: "US")',
  },
  output: {
    type: '"signal" | "sentiment" | "arbitrage" | "trending"',
    market: 'string',
    timestamp: 'ISO timestamp',
    odds: '{ polymarket, kalshi, metaculus }',
    sentiment: '{ twitter, reddit }',
    signals: '{ arbitrage, sentimentDivergence, volumeSpike }',
    proxy: '{ country, type: "mobile" }',
    payment: '{ txHash, amount, verified }',
  },
};

function normalizeType(raw: string | null): 'signal' | 'sentiment' | 'arbitrage' | 'trending' | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'signal' || v === 'sentiment' || v === 'arbitrage' || v === 'trending') return v;
  return null;
}

export async function handleSignalRequest(c: Context) {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const type = normalizeType(c.req.query('type') ?? null);
  if (!type) {
    return c.json({
      error: 'Missing or invalid type parameter',
      hint: 'Use ?type=signal&market=us-presidential-election-2028 or ?type=sentiment&topic=bitcoin+etf',
    }, 400);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', 'Prediction Market Signal Aggregator', SIGNAL_PRICE_USDC, walletAddress, SIGNAL_OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, SIGNAL_PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const countryParam = c.req.query('country') ?? 'US';
  const country = countryParam.trim().toUpperCase().slice(0, 2) || 'US';

  try {
    if (type === 'sentiment') {
      const topic = (c.req.query('topic') || '').trim();
      if (!topic) {
        return c.json({ error: 'Missing topic parameter for type=sentiment' }, 400);
      }

      const sentiment = await getSocialSentiment(topic, country);
      const proxy = getProxy();

      c.header('X-Payment-Settled', 'true');
      c.header('X-Payment-TxHash', payment.txHash);

      return c.json({
        type: 'sentiment',
        topic: sentiment.topic,
        country: sentiment.country,
        timestamp: sentiment.timestamp,
        sentiment: {
          twitter: sentiment.twitter,
          reddit: sentiment.reddit,
        },
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          amount: verification.amount ?? SIGNAL_PRICE_USDC,
          verified: true,
        },
      });
    }

    // Everything below this point requires a specific market slug
    const market = (c.req.query('market') || '').trim().toLowerCase();
    if (!market) {
      return c.json({ error: 'Missing market parameter for type=signal|arbitrage|trending' }, 400);
    }

    const config = resolveMarketConfig(market);
    if (!config) {
      return c.json({
        error: 'Unknown market',
        market,
        hint: 'Add the market to config/markets.ts to make it queryable',
      }, 400);
    }

    const [marketData, sentiment] = await Promise.all([
      getAggregatedMarketData(config.id),
      getSocialSentiment(config.topic, country),
    ]);

    const signals = buildSignalBundle(marketData, sentiment);
    const proxy = getProxy();

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    if (type === 'signal') {
      return c.json({
        type: 'signal',
        market: config.id,
        timestamp: marketData.timestamp,
        odds: marketData.odds,
        sentiment: {
          twitter: sentiment.twitter,
          reddit: sentiment.reddit,
        },
        signals: {
          arbitrage: signals.arbitrage,
          sentimentDivergence: signals.sentimentDivergence,
          volumeSpike: signals.volumeSpike,
        },
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          amount: verification.amount ?? SIGNAL_PRICE_USDC,
          verified: true,
        },
      });
    }

    if (type === 'arbitrage') {
      return c.json({
        type: 'arbitrage',
        market: config.id,
        timestamp: marketData.timestamp,
        odds: marketData.odds,
        arbitrage: signals.arbitrage,
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          amount: verification.amount ?? SIGNAL_PRICE_USDC,
          verified: true,
        },
      });
    }

    if (type === 'trending') {
      // MVP: simply echo out a single-market trending view with divergence info.
      return c.json({
        type: 'trending',
        market: config.id,
        timestamp: marketData.timestamp,
        odds: marketData.odds,
        sentiment: {
          twitter: sentiment.twitter,
          reddit: sentiment.reddit,
        },
        signals: {
          sentimentDivergence: signals.sentimentDivergence,
          arbitrage: signals.arbitrage,
        },
        proxy: { country: proxy.country, type: 'mobile' },
        payment: {
          txHash: payment.txHash,
          amount: verification.amount ?? SIGNAL_PRICE_USDC,
          verified: true,
        },
      });
    }

    // Fallback – should never hit because we normalise type earlier.
    return c.json({ error: 'Unsupported type', type }, 400);
  } catch (err: any) {
    console.error('[signal] Handler error:', err);
    return c.json({ error: 'Signal generation failed', message: err?.message || String(err) }, 502);
  }
}
