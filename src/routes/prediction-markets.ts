/**
 * Prediction Market Signal Aggregator Routes
 *
 * Endpoints:
 *   GET /api/prediction/signals    - Market signals for a topic + social sentiment
 *   GET /api/prediction/arbitrage  - Cross-platform arbitrage opportunities
 *   GET /api/prediction/sentiment  - Social sentiment for a topic
 *   GET /api/prediction/trending   - Trending markets with sentiment divergence
 *
 * All endpoints require x402 USDC payment (Solana or Base).
 * Price: $0.05 per request.
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { proxyFetch } from '../proxy';
import {
  fetchAllMarkets,
  fetchPolymarketMarkets,
  fetchKalshiMarkets,
  fetchMetaculusMarkets,
  detectArbitrage,
  type MarketOdds,
} from '../scrapers/prediction-markets';
import { searchReddit } from '../scrapers/reddit';
import { searchTwitter } from '../scrapers/twitter';

export const predictionRouter = new Hono();

const DEFAULT_WALLET = '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';
const DEFAULT_BASE_WALLET = '0xF8cD900794245fc36CBE65be9afc23CDF5103042';
const PRICE_USDC = parseFloat(process.env.PREDICTION_PRICE_USDC || '0.05');

function getWallets() {
  return {
    solana: process.env.WALLET_ADDRESS || process.env.SOLANA_WALLET_ADDRESS || DEFAULT_WALLET,
    base: process.env.WALLET_ADDRESS_BASE || process.env.BASE_WALLET_ADDRESS || DEFAULT_BASE_WALLET,
  };
}

/** Simple keyword-based sentiment scorer for text. Returns -1 to 1. */
function scoreSentiment(texts: string[]): number {
  const bullish = ['bullish', 'up', 'moon', 'surge', 'rise', 'win', 'yes', 'likely', 'confident', 'buy', 'positive', 'good', 'strong', 'gain'];
  const bearish = ['bearish', 'down', 'crash', 'drop', 'fall', 'lose', 'no', 'unlikely', 'doubt', 'sell', 'negative', 'bad', 'weak', 'loss'];

  let score = 0;
  let count = 0;
  for (const text of texts) {
    const lower = text.toLowerCase();
    let textScore = 0;
    for (const w of bullish) if (lower.includes(w)) textScore += 1;
    for (const w of bearish) if (lower.includes(w)) textScore -= 1;
    score += Math.max(-3, Math.min(3, textScore));
    count++;
  }
  if (count === 0) return 0;
  return Math.max(-1, Math.min(1, score / count));
}

function sentimentLabel(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score > 0.15) return 'bullish';
  if (score < -0.15) return 'bearish';
  return 'neutral';
}

// ─── GET /signals ──────────────────────────────────────────────────────────

predictionRouter.get('/signals', async (c) => {
  const { solana, base } = getWallets();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/signals',
        'Prediction Market Signals — aggregated odds + social sentiment',
        PRICE_USDC,
        solana,
        base,
        {
          input: { topic: 'string (required) — search topic, e.g. "bitcoin ETF"', limit: 'number (optional, default 10, max 20)' },
          output: { markets: 'MarketOdds[]', sentiment: 'SentimentSummary', signals: 'TradingSignal[]' },
        },
      ),
      402,
    );
  }

  const wallet = payment.network === 'base' ? base : solana;
  const valid = await verifyPayment(payment, wallet, PRICE_USDC);
  if (!valid) {
    return c.json({ error: 'Payment verification failed. Please check your transaction.' }, 402);
  }

  const topic = c.req.query('topic');
  if (!topic || topic.trim().length < 2) {
    return c.json({ error: 'Missing or invalid "topic" query parameter' }, 400);
  }

  const rawLimit = parseInt(c.req.query('limit') || '10', 10);
  const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? rawLimit : 10));
  const safeTopic = topic.trim().slice(0, 200);

  // Fetch markets and social data in parallel
  const [markets, twitterResults, redditResults] = await Promise.allSettled([
    fetchAllMarkets(safeTopic, Math.ceil(limit / 2)),
    searchTwitter(safeTopic, 7, 20),
    searchReddit(safeTopic, 7, 20),
  ]);

  const marketData: MarketOdds[] = markets.status === 'fulfilled' ? markets.value : [];
  const tweets = twitterResults.status === 'fulfilled' ? twitterResults.value : [];
  const redditPosts = redditResults.status === 'fulfilled' ? redditResults.value : [];

  // Compute sentiment
  const tweetTexts = tweets.map((t) => t.text);
  const redditTexts = redditPosts.map((p) => `${p.title} ${p.selftext}`);
  const allTexts = [...tweetTexts, ...redditTexts];

  const twitterSentimentScore = scoreSentiment(tweetTexts);
  const redditSentimentScore = scoreSentiment(redditTexts);
  const overallSentimentScore = scoreSentiment(allTexts);
  const overallSentiment = sentimentLabel(overallSentimentScore);

  // Compute average market probability
  const avgMarketProb = marketData.length > 0
    ? marketData.reduce((sum, m) => sum + m.probability, 0) / marketData.length
    : null;

  // Sentiment-to-market divergence
  const sentimentProbEstimate = ((overallSentimentScore + 1) / 2) * 100; // convert -1..1 to 0..100
  const divergence = avgMarketProb !== null
    ? Math.round((sentimentProbEstimate - avgMarketProb) * 100) / 100
    : null;

  // Generate trading signals
  const signals: Array<{ type: string; description: string; confidence: string }> = [];
  if (divergence !== null && Math.abs(divergence) > 10) {
    signals.push({
      type: divergence > 0 ? 'sentiment_bullish_vs_market' : 'sentiment_bearish_vs_market',
      description: divergence > 0
        ? `Social sentiment is ${Math.abs(divergence).toFixed(1)}pp more bullish than current market odds — potential underpricing`
        : `Social sentiment is ${Math.abs(divergence).toFixed(1)}pp more bearish than market odds — potential overpricing`,
      confidence: Math.abs(divergence) > 20 ? 'high' : 'medium',
    });
  }

  const arbitrage = detectArbitrage(marketData, 5);
  for (const arb of arbitrage.slice(0, 3)) {
    signals.push({
      type: 'cross_platform_arbitrage',
      description: `${arb.spread.toFixed(1)}pp spread between ${arb.markets.map((m) => m.platform).join(' and ')} — ${arb.signal}`,
      confidence: arb.confidence,
    });
  }

  return c.json({
    topic: safeTopic,
    markets: marketData.slice(0, limit),
    sentiment: {
      overall: overallSentiment,
      score: Math.round(overallSentimentScore * 100),
      sources: {
        twitter: {
          count: tweets.length,
          sentiment: sentimentLabel(twitterSentimentScore),
          score: Math.round(twitterSentimentScore * 100),
        },
        reddit: {
          count: redditPosts.length,
          sentiment: sentimentLabel(redditSentimentScore),
          score: Math.round(redditSentimentScore * 100),
        },
      },
    },
    marketProbability: avgMarketProb !== null ? Math.round(avgMarketProb * 100) / 100 : null,
    sentimentDivergence: divergence,
    signals,
    socialSamples: {
      tweets: tweets.slice(0, 5).map((t) => ({ text: t.text, url: t.url, author: t.author })),
      redditPosts: redditPosts.slice(0, 5).map((p) => ({ title: p.title, score: p.score, subreddit: p.subreddit, url: p.permalink })),
    },
    meta: {
      platformsQueried: ['polymarket', 'kalshi', 'metaculus'],
      marketsFound: marketData.length,
      socialPostsAnalyzed: allTexts.length,
    },
    payment: { verified: true, network: payment.network, txHash: payment.txHash },
  });
});

// ─── GET /arbitrage ────────────────────────────────────────────────────────

predictionRouter.get('/arbitrage', async (c) => {
  const { solana, base } = getWallets();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/arbitrage',
        'Cross-platform prediction market arbitrage scanner',
        PRICE_USDC,
        solana,
        base,
        {
          input: { topic: 'string (optional) — filter by topic', minSpread: 'number (optional, default 5) — minimum probability spread in percentage points' },
          output: { opportunities: 'ArbitrageOpportunity[]' },
        },
      ),
      402,
    );
  }

  const wallet = payment.network === 'base' ? base : solana;
  const valid = await verifyPayment(payment, wallet, PRICE_USDC);
  if (!valid) {
    return c.json({ error: 'Payment verification failed.' }, 402);
  }

  const topic = c.req.query('topic')?.trim().slice(0, 200) || undefined;
  const rawMinSpread = parseFloat(c.req.query('minSpread') || '5');
  const minSpread = Number.isFinite(rawMinSpread) ? Math.max(1, Math.min(50, rawMinSpread)) : 5;

  const markets = await fetchAllMarkets(topic, 15);
  const opportunities = detectArbitrage(markets, minSpread);

  return c.json({
    topic: topic || null,
    minSpread,
    opportunities,
    totalMarketsScanned: markets.length,
    platformBreakdown: {
      polymarket: markets.filter((m) => m.platform === 'polymarket').length,
      kalshi: markets.filter((m) => m.platform === 'kalshi').length,
      metaculus: markets.filter((m) => m.platform === 'metaculus').length,
    },
    payment: { verified: true, network: payment.network, txHash: payment.txHash },
  });
});

// ─── GET /sentiment ────────────────────────────────────────────────────────

predictionRouter.get('/sentiment', async (c) => {
  const { solana, base } = getWallets();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/sentiment',
        'Social sentiment analysis for prediction market topics',
        PRICE_USDC,
        solana,
        base,
        {
          input: { topic: 'string (required)', days: 'number (optional, default 7)' },
          output: { sentiment: 'SentimentSummary', topPosts: 'Post[]', keywords: 'string[]' },
        },
      ),
      402,
    );
  }

  const wallet = payment.network === 'base' ? base : solana;
  const valid = await verifyPayment(payment, wallet, PRICE_USDC);
  if (!valid) {
    return c.json({ error: 'Payment verification failed.' }, 402);
  }

  const topic = c.req.query('topic');
  if (!topic || topic.trim().length < 2) {
    return c.json({ error: 'Missing or invalid "topic" query parameter' }, 400);
  }

  const rawDays = parseInt(c.req.query('days') || '7', 10);
  const days = Math.max(1, Math.min(30, Number.isFinite(rawDays) ? rawDays : 7));
  const safeTopic = topic.trim().slice(0, 200);

  const [twitterResults, redditResults] = await Promise.allSettled([
    searchTwitter(safeTopic, days, 25),
    searchReddit(safeTopic, days, 25),
  ]);

  const tweets = twitterResults.status === 'fulfilled' ? twitterResults.value : [];
  const redditPosts = redditResults.status === 'fulfilled' ? redditResults.value : [];

  const tweetTexts = tweets.map((t) => t.text);
  const redditTexts = redditPosts.map((p) => `${p.title} ${p.selftext}`);
  const allTexts = [...tweetTexts, ...redditTexts];

  const twitterScore = scoreSentiment(tweetTexts);
  const redditScore = scoreSentiment(redditTexts);
  const overallScore = scoreSentiment(allTexts);

  // Extract frequent keywords
  const wordFreq = new Map<string, number>();
  const stopWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'from', 'they', 'have', 'will', 'been', 'but', 'not']);
  for (const text of allTexts) {
    for (const word of text.toLowerCase().split(/\W+/)) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }
  }
  const keywords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);

  return c.json({
    topic: safeTopic,
    days,
    sentiment: {
      overall: sentimentLabel(overallScore),
      score: Math.round(overallScore * 100),
      twitter: {
        count: tweets.length,
        sentiment: sentimentLabel(twitterScore),
        score: Math.round(twitterScore * 100),
        topEngagement: tweets.slice(0, 3).map((t) => ({ text: t.text, url: t.url, engagementScore: t.engagementScore })),
      },
      reddit: {
        count: redditPosts.length,
        sentiment: sentimentLabel(redditScore),
        score: Math.round(redditScore * 100),
        topPosts: redditPosts.slice(0, 3).map((p) => ({ title: p.title, score: p.score, subreddit: p.subreddit, url: p.permalink })),
      },
    },
    keywords,
    totalPostsAnalyzed: allTexts.length,
    payment: { verified: true, network: payment.network, txHash: payment.txHash },
  });
});

// ─── GET /trending ─────────────────────────────────────────────────────────

predictionRouter.get('/trending', async (c) => {
  const { solana, base } = getWallets();

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/prediction/trending',
        'Trending prediction markets with social sentiment divergence signals',
        PRICE_USDC,
        solana,
        base,
        {
          input: { limit: 'number (optional, default 10, max 20)' },
          output: { markets: 'TrendingMarket[]' },
        },
      ),
      402,
    );
  }

  const wallet = payment.network === 'base' ? base : solana;
  const valid = await verifyPayment(payment, wallet, PRICE_USDC);
  if (!valid) {
    return c.json({ error: 'Payment verification failed.' }, 402);
  }

  const rawLimit = parseInt(c.req.query('limit') || '10', 10);
  const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? rawLimit : 10));

  // Fetch trending markets from each platform by volume
  const [poly, kalshi, meta] = await Promise.allSettled([
    fetchPolymarketMarkets(undefined, 10),
    fetchKalshiMarkets(undefined, 10),
    fetchMetaculusMarkets(undefined, 10),
  ]);

  const allMarkets: MarketOdds[] = [
    ...(poly.status === 'fulfilled' ? poly.value : []),
    ...(kalshi.status === 'fulfilled' ? kalshi.value : []),
    ...(meta.status === 'fulfilled' ? meta.value : []),
  ];

  // For top markets, get quick sentiment
  const topMarkets = allMarkets.slice(0, limit);
  const enriched = await Promise.all(
    topMarkets.map(async (market) => {
      try {
        const keywords = market.question
          .split(/\W+/)
          .filter((w) => w.length > 4)
          .slice(0, 3)
          .join(' ');

        if (!keywords) return { ...market, socialSentiment: null, divergence: null };

        const [tweets, posts] = await Promise.allSettled([
          searchTwitter(keywords, 3, 5),
          searchReddit(keywords, 3, 5),
        ]);

        const tweetTexts = tweets.status === 'fulfilled' ? tweets.value.map((t) => t.text) : [];
        const redditTexts = posts.status === 'fulfilled' ? posts.value.map((p) => p.title) : [];
        const allTexts = [...tweetTexts, ...redditTexts];

        if (allTexts.length === 0) return { ...market, socialSentiment: null, divergence: null };

        const sentimentScore = scoreSentiment(allTexts);
        const sentimentProb = ((sentimentScore + 1) / 2) * 100;
        const divergence = Math.round((sentimentProb - market.probability) * 100) / 100;

        return {
          ...market,
          socialSentiment: {
            label: sentimentLabel(sentimentScore),
            score: Math.round(sentimentScore * 100),
            postCount: allTexts.length,
          },
          divergence,
          signal: Math.abs(divergence) > 15
            ? (divergence > 0 ? 'sentiment_more_bullish' : 'sentiment_more_bearish')
            : 'aligned',
        };
      } catch {
        return { ...market, socialSentiment: null, divergence: null };
      }
    }),
  );

  // Sort by absolute divergence (highest signal first)
  enriched.sort((a, b) => Math.abs(b.divergence || 0) - Math.abs(a.divergence || 0));

  return c.json({
    markets: enriched,
    totalFetched: allMarkets.length,
    platformBreakdown: {
      polymarket: allMarkets.filter((m) => m.platform === 'polymarket').length,
      kalshi: allMarkets.filter((m) => m.platform === 'kalshi').length,
      metaculus: allMarkets.filter((m) => m.platform === 'metaculus').length,
    },
    payment: { verified: true, network: payment.network, txHash: payment.txHash },
  });
});
