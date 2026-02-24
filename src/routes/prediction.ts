import { Hono } from 'hono';
import { proxyFetch, getProxy } from '../proxy';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { fetchPolymarket, fetchKalshi, fetchMetaculus } from '../scrapers/prediction';
import { analyzeMarketSentiment, generateSignals } from '../analysis/prediction-logic';
import { searchTwitter } from '../scrapers/twitter';
import { searchReddit } from '../scrapers/reddit';

export const predictionRouter = new Hono();

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';
const PRICE_USDC = 0.05;
const DESCRIPTION = 'Prediction Market Signal Aggregator: real-time odds + social sentiment arbitrage.';

const OUTPUT_SCHEMA = {
  type: "signal",
  market: "string",
  odds: "object",
  sentiment: "object",
  signals: "object"
};

predictionRouter.get('/run', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/prediction/run', DESCRIPTION, PRICE_USDC, WALLET_ADDRESS, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const market = c.req.query('market') || 'us-presidential-election-2028';
  const topic = market.replace(/-/g, ' ');

  try {
    const proxy = getProxy();

    // 1. Fetch Market Data
    const [poly, kalshi, meta] = await Promise.all([
      fetchPolymarket(market),
      fetchKalshi(market),
      fetchMetaculus(market)
    ]);

    // 2. Fetch Sentiment Data
    const [twitter, reddit] = await Promise.all([
      searchTwitter(topic, 7, 20),
      searchReddit(topic, 7, 20)
    ]);

    // 3. Analyze
    const twitterSentiment = analyzeMarketSentiment([], twitter);
    const redditSentiment = analyzeMarketSentiment(reddit, []);
    
    const signals = generateSignals(
      { polymarket: poly, kalshi: kalshi, metaculus: meta },
      { twitter: twitterSentiment, reddit: redditSentiment }
    );

    return c.json({
      type: "signal",
      market,
      timestamp: new Date().toISOString(),
      odds: {
        polymarket: poly,
        kalshi: kalshi,
        metaculus: meta
      },
      sentiment: {
        twitter: twitterSentiment,
        reddit: redditSentiment
      },
      signals,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true
      }
    });
  } catch (err: any) {
    return c.json({ error: 'Signal generation failed', message: err.message }, 502);
  }
});
