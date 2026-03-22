/**
 * GET /api/run?type=signal|arbitrage|sentiment
 *
 * Prediction Market Signal Aggregator — Bounty #55
 *
 * Endpoints:
 *   GET /api/run?type=signal&market=<slug>
 *     → Aggregate market odds from Polymarket/Kalshi/Metaculus
 *       + sentiment signals from Reddit & Twitter/X for the same topic
 *
 *   GET /api/run?type=arbitrage
 *     → Scan all active markets across platforms for cross-platform
 *       odds divergence (arbitrage opportunities)
 *
 *   GET /api/run?type=sentiment&topic=<topic>&country=<CC>
 *     → Social sentiment analysis for any prediction-market topic
 *       using Reddit + Twitter/X data via mobile proxy
 *
 * Pricing (x402 / USDC):
 *   signal     → $0.05
 *   arbitrage  → $0.10
 *   sentiment  → $0.05
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import { searchReddit } from '../scrapers/reddit';
import { searchTwitter } from '../scrapers/twitter';
import { aggregateSentiment, type PlatformSentiment } from '../analysis/sentiment';
import {
  fetchPolymarketOdds,
  fetchKalshiOdds,
  fetchMetaculusOdds,
  fetchAllMarketOdds,
  detectArbitrageOpportunities,
  type MarketOdds,
  type ArbitrageOpportunity,
} from '../scrapers/prediction-markets';

export const signalsRouter = new Hono();

// ─── CONSTANTS ────────────────────────────────────────

const PRICE_SIGNAL = 0.05;
const PRICE_ARBITRAGE = 0.10;
const PRICE_SENTIMENT = 0.05;

const MAX_TOPIC_LENGTH = 200;
const MAX_COUNTRY_LENGTH = 2;
const MAX_REDDIT_RESULTS = 30;
const MAX_TWITTER_RESULTS = 20;

const SERVICE_DESCRIPTION =
  'Prediction Market Signal Aggregator: real-time odds from Polymarket/Kalshi/Metaculus ' +
  'combined with social sentiment from Reddit & Twitter/X. ' +
  'Detect arbitrage spreads, sentiment divergence, and trading signals.';

const OUTPUT_SCHEMA = {
  endpoints: {
    signal: {
      params: 'type=signal&market=<slug-or-topic>',
      price: `$${PRICE_SIGNAL} USDC`,
      output: 'cross-platform odds + sentiment analysis + signal strength',
    },
    arbitrage: {
      params: 'type=arbitrage',
      price: `$${PRICE_ARBITRAGE} USDC`,
      output: 'detected arbitrage spreads across platforms',
    },
    sentiment: {
      params: 'type=sentiment&topic=<topic>&country=<CC>',
      price: `$${PRICE_SENTIMENT} USDC`,
      output: 'positive/negative/neutral breakdown + top discussions',
    },
  },
};

// ─── HELPERS ─────────────────────────────────────────

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const proxy = getProxy();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch('https://api.ipify.org?format=json', {
        signal: ctrl.signal,
        // @ts-ignore — bun supports proxy option
        proxy: proxy.url,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json() as { ip?: unknown };
      return typeof data?.ip === 'string' ? data.ip : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Compute a trading signal from combined market odds and sentiment.
 * Returns: 'STRONG_YES' | 'LEAN_YES' | 'NEUTRAL' | 'LEAN_NO' | 'STRONG_NO' | 'DIVERGENCE'
 */
function computeSignal(
  markets: MarketOdds[],
  sentimentScore: PlatformSentiment,
): {
  signal: string;
  confidence: number;
  reasoning: string;
  sentimentDivergence: boolean;
} {
  const withOdds = markets.filter((m) => m.yesOdds !== null);
  if (withOdds.length === 0) {
    return { signal: 'INSUFFICIENT_DATA', confidence: 0, reasoning: 'No market odds available', sentimentDivergence: false };
  }

  const avgYes = withOdds.reduce((sum, m) => sum + m.yesOdds!, 0) / withOdds.length;
  const maxYes = Math.max(...withOdds.map((m) => m.yesOdds!));
  const minYes = Math.min(...withOdds.map((m) => m.yesOdds!));
  const spread = maxYes - minYes;

  // Determine market consensus
  let marketSignal: string;
  if (avgYes >= 75) marketSignal = 'STRONG_YES';
  else if (avgYes >= 60) marketSignal = 'LEAN_YES';
  else if (avgYes <= 25) marketSignal = 'STRONG_NO';
  else if (avgYes <= 40) marketSignal = 'LEAN_NO';
  else marketSignal = 'NEUTRAL';

  // Sentiment alignment check
  const sentimentBullish = sentimentScore.positive > sentimentScore.negative + 15;
  const sentimentBearish = sentimentScore.negative > sentimentScore.positive + 15;

  const marketBullish = avgYes > 55;
  const marketBearish = avgYes < 45;

  const sentimentDivergence =
    (marketBullish && sentimentBearish) || (marketBearish && sentimentBullish);

  // Override signal with DIVERGENCE if social sentiment strongly disagrees
  const signal = sentimentDivergence ? 'DIVERGENCE' : marketSignal;

  // Confidence: higher when multiple platforms agree and sentiment aligns
  let confidence = Math.min(Math.abs(avgYes - 50) * 2, 100);
  if (spread < 5 && withOdds.length >= 2) confidence = Math.min(confidence + 10, 100); // platforms agree
  if (sentimentDivergence) confidence = Math.max(confidence - 20, 10); // divergence reduces confidence

  const reasoning = sentimentDivergence
    ? `Market consensus ${avgYes.toFixed(1)}% YES but social sentiment is ${sentimentScore.overall}. Possible mispricing or sentiment lag.`
    : `${withOdds.length} platform(s) average ${avgYes.toFixed(1)}% YES. Sentiment (${sentimentScore.overall}) ${sentimentBullish || sentimentBearish ? 'confirms' : 'is neutral on'} this direction.`;

  return {
    signal,
    confidence: Math.round(confidence),
    reasoning,
    sentimentDivergence,
  };
}

// ─── TYPE=SIGNAL HANDLER ─────────────────────────────

async function handleSignal(c: any, market: string, walletAddress: string): Promise<Response> {
  const price = PRICE_SIGNAL;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        `${c.req.url}`,
        `Signal: cross-platform odds + sentiment for "${market}"`,
        price,
        walletAddress,
        OUTPUT_SCHEMA,
      ),
      402,
    );
  }

  const verified = await verifyPayment(payment, walletAddress, price);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', reason: verified.error }, 402);
  }

  // Fetch in parallel
  const [poly, kalshi, meta, redditPosts, tweets, proxyIp] = await Promise.allSettled([
    fetchPolymarketOdds(market),
    fetchKalshiOdds(undefined),
    fetchMetaculusOdds(market),
    searchReddit(market, 30, MAX_REDDIT_RESULTS),
    searchTwitter(market, 30, MAX_TWITTER_RESULTS),
    getProxyExitIp(),
  ]);

  const markets: MarketOdds[] = [
    ...(poly.status === 'fulfilled' ? poly.value : []),
    ...(kalshi.status === 'fulfilled' ? kalshi.value : []),
    ...(meta.status === 'fulfilled' ? meta.value : []),
  ];

  const redditTexts = (redditPosts.status === 'fulfilled' ? redditPosts.value : []).map(
    (p) => `${p.title} ${p.selftext}`,
  );
  const twitterTexts = (tweets.status === 'fulfilled' ? tweets.value : []).map((t) => t.text);
  const allTexts = [...redditTexts, ...twitterTexts];

  const sentiment: PlatformSentiment = allTexts.length > 0
    ? aggregateSentiment(allTexts)
    : { overall: 'neutral' as const, positive: 0, neutral: 100, negative: 0 };

  const signal = computeSignal(markets, sentiment);

  const oddsComparison = markets
    .filter((m) => m.yesOdds !== null)
    .map((m) => ({
      platform: m.platform,
      market: m.title,
      yes: m.yesOdds,
      no: m.noOdds,
      volume: m.volume,
      url: m.url,
    }));

  const arbitrageOpportunities = detectArbitrageOpportunities(markets);

  return c.json({
    market,
    signal: signal.signal,
    confidence: signal.confidence,
    reasoning: signal.reasoning,
    sentimentDivergence: signal.sentimentDivergence,
    oddsComparison,
    sentiment: {
      overall: sentiment.overall,
      positive: sentiment.positive,
      neutral: sentiment.neutral,
      negative: sentiment.negative,
      sampleSize: allTexts.length,
      // Higher positive% - negative% gives a directional sentiment score
      score: sentiment.positive - sentiment.negative,
    },
    arbitrageOpportunities: arbitrageOpportunities.slice(0, 3),
    meta: {
      marketsFound: markets.length,
      platforms: {
        polymarket: poly.status === 'fulfilled' ? poly.value.length : 0,
        kalshi: kalshi.status === 'fulfilled' ? kalshi.value.length : 0,
        metaculus: meta.status === 'fulfilled' ? meta.value.length : 0,
      },
      socialDataPoints: allTexts.length,
      proxy: {
        ip: proxyIp.status === 'fulfilled' ? proxyIp.value : null,
        country: getProxy().country,
        type: 'mobile',
      },
      generatedAt: new Date().toISOString(),
    },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: price,
      settled: true,
    },
  });
}

// ─── TYPE=ARBITRAGE HANDLER ──────────────────────────

async function handleArbitrage(c: any, walletAddress: string): Promise<Response> {
  const price = PRICE_ARBITRAGE;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        `${c.req.url}`,
        'Arbitrage scanner: cross-platform odds divergence detection',
        price,
        walletAddress,
        OUTPUT_SCHEMA,
      ),
      402,
    );
  }

  const verified = await verifyPayment(payment, walletAddress, price);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', reason: verified.error }, 402);
  }

  const [proxyIp, markets] = await Promise.allSettled([
    getProxyExitIp(),
    fetchAllMarketOdds(),
  ]);

  const allMarkets = markets.status === 'fulfilled' ? markets.value : [];
  const opportunities = detectArbitrageOpportunities(allMarkets);

  return c.json({
    arbitrageOpportunities: opportunities,
    totalMarketsScanned: allMarkets.length,
    opportunitiesFound: opportunities.length,
    platformBreakdown: {
      polymarket: allMarkets.filter((m) => m.platform === 'polymarket').length,
      kalshi: allMarkets.filter((m) => m.platform === 'kalshi').length,
      metaculus: allMarkets.filter((m) => m.platform === 'metaculus').length,
    },
    meta: {
      proxy: {
        ip: proxyIp.status === 'fulfilled' ? proxyIp.value : null,
        country: getProxy().country,
        type: 'mobile',
      },
      generatedAt: new Date().toISOString(),
    },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: price,
      settled: true,
    },
  });
}

// ─── TYPE=SENTIMENT HANDLER ──────────────────────────

async function handleSentiment(c: any, topic: string, country: string, walletAddress: string): Promise<Response> {
  const price = PRICE_SENTIMENT;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        `${c.req.url}`,
        `Sentiment analysis for prediction market topic: "${topic}"`,
        price,
        walletAddress,
        OUTPUT_SCHEMA,
      ),
      402,
    );
  }

  const verified = await verifyPayment(payment, walletAddress, price);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', reason: verified.error }, 402);
  }

  const [redditResult, twitterResult, proxyIp] = await Promise.allSettled([
    searchReddit(topic, 30, MAX_REDDIT_RESULTS),
    searchTwitter(topic, 30, MAX_TWITTER_RESULTS),
    getProxyExitIp(),
  ]);

  const redditPosts = redditResult.status === 'fulfilled' ? redditResult.value : [];
  const tweets = twitterResult.status === 'fulfilled' ? twitterResult.value : [];

  const redditTexts = redditPosts.map((p) => `${p.title} ${p.selftext}`);
  const twitterTexts = tweets.map((t) => t.text);

  const redditSentiment: PlatformSentiment = redditTexts.length > 0
    ? aggregateSentiment(redditTexts)
    : { overall: 'neutral' as const, positive: 0, neutral: 100, negative: 0 };

  const twitterSentiment: PlatformSentiment = twitterTexts.length > 0
    ? aggregateSentiment(twitterTexts)
    : { overall: 'neutral' as const, positive: 0, neutral: 100, negative: 0 };

  const allTexts = [...redditTexts, ...twitterTexts];
  const overallSentiment: PlatformSentiment = allTexts.length > 0
    ? aggregateSentiment(allTexts)
    : { overall: 'neutral' as const, positive: 0, neutral: 100, negative: 0 };

  const topDiscussions = [
    ...redditPosts.slice(0, 5).map((p) => ({
      platform: 'reddit',
      title: p.title,
      url: p.permalink,
      score: p.score,
      comments: p.numComments,
    })),
    ...tweets.slice(0, 5).map((t) => ({
      platform: 'twitter',
      title: t.text.slice(0, 120),
      url: t.url,
      score: Math.round(t.engagementScore),
      comments: null,
    })),
  ].sort((a, b) => b.score - a.score).slice(0, 10);

  return c.json({
    topic,
    country: country.toUpperCase(),
    sentiment: {
      overall: overallSentiment.overall,
      positive: overallSentiment.positive,
      neutral: overallSentiment.neutral,
      negative: overallSentiment.negative,
      score: overallSentiment.positive - overallSentiment.negative,
      byPlatform: {
        reddit: {
          overall: redditSentiment.overall,
          positive: redditSentiment.positive,
          neutral: redditSentiment.neutral,
          negative: redditSentiment.negative,
          sampleSize: redditPosts.length,
        },
        twitter: {
          overall: twitterSentiment.overall,
          positive: twitterSentiment.positive,
          neutral: twitterSentiment.neutral,
          negative: twitterSentiment.negative,
          sampleSize: tweets.length,
        },
      },
    },
    topDiscussions,
    meta: {
      totalDataPoints: allTexts.length,
      proxy: {
        ip: proxyIp.status === 'fulfilled' ? proxyIp.value : null,
        country: getProxy().country,
        type: 'mobile',
      },
      generatedAt: new Date().toISOString(),
    },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: price,
      settled: true,
    },
  });
}

// ─── MAIN ROUTER ─────────────────────────────────────

signalsRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const type = sanitizeText(c.req.query('type'), 32).toLowerCase();
  const market = sanitizeText(c.req.query('market') || c.req.query('topic') || '', MAX_TOPIC_LENGTH);
  const topic = sanitizeText(c.req.query('topic') || c.req.query('market') || '', MAX_TOPIC_LENGTH);
  const country = sanitizeText(c.req.query('country') || 'US', MAX_COUNTRY_LENGTH + 4)
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2) || 'US';

  switch (type) {
    case 'signal': {
      if (!market) {
        return c.json({
          error: 'Missing required parameter: market',
          example: '/api/run?type=signal&market=us-presidential-election-2028',
        }, 400);
      }
      return handleSignal(c, market, walletAddress);
    }

    case 'arbitrage': {
      return handleArbitrage(c, walletAddress);
    }

    case 'sentiment': {
      if (!topic) {
        return c.json({
          error: 'Missing required parameter: topic',
          example: '/api/run?type=sentiment&topic=bitcoin+etf&country=US',
        }, 400);
      }
      return handleSentiment(c, topic, country, walletAddress);
    }

    default: {
      return c.json({
        service: 'Prediction Market Signal Aggregator',
        description: SERVICE_DESCRIPTION,
        endpoints: OUTPUT_SCHEMA.endpoints,
        usage: [
          '/api/run?type=signal&market=us-presidential-election-2028',
          '/api/run?type=arbitrage',
          '/api/run?type=sentiment&topic=bitcoin+etf&country=US',
        ],
      });
    }
  }
});
