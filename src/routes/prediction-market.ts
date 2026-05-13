/**
 * Prediction Market Signal Aggregator Routes (Bounty #55)
 * ───────────────────────────────────────────────────────
 * Aggregates prediction market odds (Polymarket, Kalshi) with
 * social sentiment signals (Reddit, Twitter/X) to detect mispricings
 * and generate trading signals.
 *
 * Pricing (x402):
 *   GET /signal  — $0.05  Single market signal
 *   GET /arbitrage — $0.10 Cross-platform arbitrage opportunities
 *   GET /sentiment — $0.08 Sentiment analysis for a topic
 *   GET /trending   — $0.03 Trending prediction markets
 *
 * Uses Zod v4 for input/output validation.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod/v4';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import {
  searchPolymarketMarkets,
  getTrendingMarkets,
  getMarketDetail,
  searchMarketsByQuery,
  type MarketOdds,
  calculateSentimentDivergence,
  generateSignal,
} from '../scrapers/polymarket';
import {
  searchKalshiMarkets,
  getTrendingKalshiMarkets,
  getKalshiMarketDetail,
  type KalshiMarket,
} from '../scrapers/kalshi';
import { searchReddit } from '../scrapers/reddit';
import { searchWeb } from '../scrapers/web';
import { aggregateSentiment } from '../analysis/sentiment';

// ─── ZOD V4 SCHEMAS ──────────────────────────────────────

const SignalQuerySchema = z.object({
  market: z.string().min(1).max(200).describe('Market slug, condition ID, or search query (e.g. "us-presidential-election-2028")'),
  include_sentiment: z.enum(['true', 'false', '1', '0']).optional().default('false').transform(v => v === 'true' || v === '1'),
  country: z.string().max(2).optional().default('US'),
});

const ArbitrageQuerySchema = z.object({
  category: z.string().max(100).optional().describe('Category filter (e.g. "politics", "crypto", "sports")'),
  min_spread: z.string().optional().default('0.02').transform(v => Math.max(0.01, Math.min(parseFloat(v) || 0.02, 0.5))),
  limit: z.string().optional().default('10').transform(v => Math.min(Math.max(parseInt(v) || 10, 1), 50)),
});

const SentimentQuerySchema = z.object({
  topic: z.string().min(2).max(200).describe('Topic for sentiment analysis (e.g. "bitcoin ETF")'),
  market: z.string().max(200).optional().describe('Optional market slug to compare sentiment against'),
  days: z.string().optional().default('7').transform(v => Math.min(Math.max(parseInt(v) || 7, 1), 30)),
  country: z.string().max(2).optional().default('US'),
});

const TrendingQuerySchema = z.object({
  category: z.string().max(100).optional().describe('Category filter (e.g. "politics", "crypto")'),
  limit: z.string().optional().default('20').transform(v => Math.min(Math.max(parseInt(v) || 20, 1), 50)),
});

// ─── TYPES ───────────────────────────────────────────────

interface SignalResponse {
  type: 'signal';
  market: string;
  timestamp: string;
  odds: {
    polymarket: MarketOdds | null;
    kalshi: KalshiMarket | null;
  };
  sentiment: {
    overall: string;
    positive: number;
    neutral: number;
    negative: number;
    sources?: number;
    topSentiment?: Array<{ text: string; platform: string; score: number }>;
  } | null;
  divergence: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
  proxy: { ip: string | null; country: string; type: string };
  payment: { txHash: string; network: string; amount: number; settled: boolean };
}

interface ArbitrageResponse {
  type: 'arbitrage';
  opportunities: Array<{
    question: string;
    markets: Array<{
      platform: string;
      yes: number;
      no: number;
      volume: number;
      url: string;
    }>;
    spread: number;
    direction: string;
  }>;
  timestamp: string;
  proxy: { ip: string | null; country: string; type: string };
  payment: { txHash: string; network: string; amount: number; settled: boolean };
}

interface SentimentReportResponse {
  type: 'sentiment';
  topic: string;
  timestamp: string;
  marketOdds: MarketOdds | null;
  sentiment: {
    overall: string;
    positive: number;
    neutral: number;
    negative: number;
    byPlatform: Record<string, { overall: string; positive: number; neutral: number; negative: number }>;
  };
  divergence: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
  topDiscussions: Array<{ platform: string; title: string; engagement: number; url: string }>;
  proxy: { ip: string | null; country: string; type: string };
  payment: { txHash: string; network: string; amount: number; settled: boolean };
}

interface TrendingResponse {
  type: 'trending';
  markets: Array<MarketOdds | KalshiMarket>;
  timestamp: string;
  proxy: { ip: string | null; country: string; type: string };
  payment: { txHash: string; network: string; amount: number; settled: boolean };
}

// ─── CONSTANTS ────────────────────────────────────────────

const WALLET_ADDRESS = process.env.WALLET_ADDRESS ?? '';

const PRICE_SIGNAL = 0.05;
const PRICE_ARBITRAGE = 0.10;
const PRICE_SENTIMENT = 0.08;
const PRICE_TRENDING = 0.03;

const RATE_LIMIT_PER_MIN = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const DESCRIPTION_SIGNAL =
  'Prediction Market Signal: aggregated odds + social sentiment divergence for a specific market. ' +
  'Returns Polymarket & Kalshi odds, Reddit/Twitter sentiment analysis, and a bullish/bearish/neutral signal.';

const DESCRIPTION_ARBITRAGE =
  'Prediction Market Arbitrage: cross-platform arbitrage opportunities between Polymarket and Kalshi. ' +
  'Finds markets where odds differ significantly between platforms, enabling risk-free or low-risk arbitrage.';

const DESCRIPTION_SENTIMENT =
  'Predictive Sentiment Analysis: deep sentiment analysis for a topic with prediction market odds comparison. ' +
  'Combines Reddit + web sentiment with market probabilities to find mispricings.';

const DESCRIPTION_TRENDING =
  'Trending Prediction Markets: hottest prediction markets ranked by volume and activity. ' +
  'Returns real-time odds, volume, and category data from Polymarket and Kalshi.';

const OUTPUT_SCHEMA_SIGNAL = {
  input: {
    market: 'string (required) — market slug, condition ID, or search query',
    include_sentiment: 'boolean (optional, default: false) — include social sentiment analysis',
    country: 'string (optional, default: "US") — ISO country code',
  },
  output: {
    type: '"signal"',
    market: 'string — market identifier',
    odds: { polymarket: 'MarketOdds | null', kalshi: 'KalshiMarket | null' },
    sentiment: '{ overall, positive%, neutral%, negative%, sources, topSentiment[] } | null',
    divergence: 'number | null — sentiment-vs-odds divergence (-1 to 1)',
    signal: '"bullish" | "bearish" | "neutral"',
    payment: '{ txHash, network, amount, settled }',
  },
  pricing: { signal: '$0.05 USDC', sentiment: '$0.08 USDC' },
};

const OUTPUT_SCHEMA_ARBITRAGE = {
  input: {
    category: 'string (optional) — filter by category',
    min_spread: 'number (optional, default: 0.02) — minimum spread to report',
    limit: 'number (optional, default: 10, max: 50)',
  },
  output: {
    type: '"arbitrage"',
    opportunities: 'ArbitrageOpportunity[] — markets with cross-platform price differences',
    payment: '{ txHash, network, amount, settled }',
  },
  pricing: { arbitrage: '$0.10 USDC' },
};

const OUTPUT_SCHEMA_SENTIMENT = {
  input: {
    topic: 'string (required) — topic for sentiment analysis',
    market: 'string (optional) — market slug to compare',
    days: 'number (optional, default: 7) — lookback days',
    country: 'string (optional, default: "US")',
  },
  output: {
    type: '"sentiment"',
    topic: 'string',
    marketOdds: 'MarketOdds | null',
    sentiment: '{ overall, byPlatform, divergence, signal }',
    payment: '{ txHash, network, amount, settled }',
  },
  pricing: { sentiment: '$0.08 USDC' },
};

const OUTPUT_SCHEMA_TRENDING = {
  input: {
    category: 'string (optional) — filter by category',
    limit: 'number (optional, default: 20, max: 50)',
  },
  output: {
    type: '"trending"',
    markets: 'MarketOdds[] — trending markets with odds and volume',
    payment: '{ txHash, network, amount, settled }',
  },
  pricing: { trending: '$0.03 USDC' },
};

// ─── HELPERS ──────────────────────────────────────────────

function normalizeClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = c.req.header('x-real-ip')?.trim();
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  const candidate = forwarded || realIp || cfIp || 'unknown';
  if (!candidate || candidate.length > 64 || /[\r\n]/.test(candidate)) return 'unknown';
  return candidate;
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (rateLimits.size > 10_000) {
    const keysToDelete: string[] = [];
    rateLimits.forEach((value, key) => {
      if (now > value.resetAt) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => rateLimits.delete(key));
  }
  const current = rateLimits.get(ip);
  if (!current || now > current.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_PER_MIN) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
}

function toSafeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '').slice(0, 256);
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const proxy = getProxy();
    const ipRes = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 5_000,
    });
    if (!ipRes.ok) return null;
    const ipData = await ipRes.json() as { ip?: string };
    const ip = typeof ipData?.ip === 'string' ? ipData.ip.trim() : '';
    return ip && ip.length <= 64 ? ip : null;
  } catch {
    return null;
  }
}

function toPolymarketOdds(market: MarketOdds): { platform: string; yes: number; no: number; volume: number; url: string } {
  const yesOutcome = market.outcomes.find(o => o.name.toLowerCase() === 'yes') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find(o => o.name.toLowerCase() === 'no') ?? market.outcomes[1];
  return {
    platform: 'polymarket',
    yes: yesOutcome?.probability ?? yesOutcome?.price ?? 0.5,
    no: noOutcome?.probability ?? noOutcome?.price ?? 0.5,
    volume: market.volume24h,
    url: market.url,
  };
}

function toKalshiOdds(market: KalshiMarket): { platform: string; yes: number; no: number; volume: number; url: string } {
  return {
    platform: 'kalshi',
    yes: market.yesPrice,
    no: market.noPrice,
    volume: market.volume,
    url: market.url,
  };
}

// ─── ROUTER ──────────────────────────────────────────────

export const predictionMarketRouter = new Hono();

// ─── GET /signal ─────────────────────────────────────────
predictionMarketRouter.get('/signal', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, 429);
  }

  // Validate input with Zod v4
  const parsed = SignalQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.issues }, 400);
  }
  const { market, include_sentiment, country } = parsed.data;

  // x402 payment gate
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/prediction-market/signal', DESCRIPTION_SIGNAL, PRICE_SIGNAL, WALLET_ADDRESS, OUTPUT_SCHEMA_SIGNAL),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_SIGNAL);
  } catch {
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch Polymarket data
  const polymarketResults = await searchMarketsByQuery(market, 5);
  const polymarketMarket = polymarketResults.length > 0 ? polymarketResults[0] : null;

  // Fetch Kalshi data
  const kalshiResults = await searchKalshiMarkets(market, 5);
  const kalshiMarket = kalshiResults.length > 0 ? kalshiResults[0] : null;

  // Optional sentiment analysis
  let sentiment: SignalResponse['sentiment'] = null;
  let divergence = null;
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';

  if (include_sentiment) {
    try {
      const redditPosts = await searchReddit(market, 7, 20);
      const webResults = await searchWeb(market, 10);

      const allTexts = [
        ...redditPosts.map(p => `${p.title} ${p.selftext}`.slice(0, 500)),
        ...webResults.map(r => `${r.title} ${r.snippet}`.slice(0, 500)),
      ];

      if (allTexts.length > 0) {
        const sentimentResult = aggregateSentiment(allTexts);
        sentiment = {
          overall: sentimentResult.overall,
          positive: Math.round(sentimentResult.positive),
          neutral: Math.round(sentimentResult.neutral),
          negative: Math.round(sentimentResult.negative),
          sources: allTexts.length,
          topSentiment: redditPosts
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(p => ({ text: p.title.slice(0, 200), platform: 'reddit', score: p.score })),
        };

        // Calculate divergence between social sentiment and market odds
        const marketOddsValue = polymarketMarket?.outcomes?.[0]?.probability
          ?? kalshiMarket?.yesPrice
          ?? 0.5;

        divergence = calculateSentimentDivergence(
          { positive: sentiment.positive, neutral: sentiment.neutral, negative: sentiment.negative },
          marketOddsValue,
        );
        signal = generateSignal(polymarketMarket ?? kalshiMarket as any, sentiment, divergence);
      }
    } catch (err: any) {
      console.error('[prediction-market] Sentiment error:', err.message);
    }
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response: SignalResponse = {
    type: 'signal',
    market,
    timestamp: new Date().toISOString(),
    odds: {
      polymarket: polymarketMarket,
      kalshi: kalshiMarket,
    },
    sentiment,
    divergence,
    signal,
    proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_SIGNAL,
      settled: true,
    },
  };

  return c.json(response);
});

// ─── GET /arbitrage ──────────────────────────────────────
predictionMarketRouter.get('/arbitrage', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, 429);
  }

  const parsed = ArbitrageQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.issues }, 400);
  }
  const { category, min_spread, limit } = parsed.data;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/prediction-market/arbitrage', DESCRIPTION_ARBITRAGE, PRICE_ARBITRAGE, WALLET_ADDRESS, OUTPUT_SCHEMA_ARBITRAGE),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_ARBITRAGE);
  } catch {
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch trending markets from both platforms
  const [polymarketMarkets, kalshiMarkets] = await Promise.all([
    getTrendingMarkets(limit, category),
    getTrendingKalshiMarkets(limit, category),
  ]);

  // Find matching markets (by title similarity)
  const opportunities: ArbitrageResponse['opportunities'] = [];

  for (const pm of polymarketMarkets) {
    const pmTitle = pm.question.toLowerCase();
    // Find Kalshi markets with similar titles
    for (const km of kalshiMarkets) {
      const kmTitle = km.title.toLowerCase();

      // Simple similarity: check for 3+ word overlap
      const pmWords = pmTitle.split(/\s+/).filter(w => w.length > 3);
      const kmWords = kmTitle.split(/\s+/).filter(w => w.length > 3);
      const kmWordsSet = new Set(kmWords);
      const overlap = pmWords.filter(w => kmWordsSet.has(w)).length;
      const minWords = Math.min(pmWords.length, kmWords.length);

      if (minWords > 0 && overlap / minWords >= 0.3) {
        const pmOdds = toPolymarketOdds(pm);
        const kmOdds = toKalshiOdds(km);
        const spread = Math.abs(pmOdds.yes - kmOdds.yes);

        if (spread >= min_spread) {
          opportunities.push({
            question: pm.question,
            markets: [pmOdds, kmOdds],
            spread: Math.round(spread * 10000) / 10000,
            direction: pmOdds.yes > kmOdds.yes ? 'buy_yes_kalshi' : 'buy_yes_polymarket',
          });
        }
      }
    }
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response: ArbitrageResponse = {
    type: 'arbitrage',
    opportunities: opportunities.slice(0, limit),
    timestamp: new Date().toISOString(),
    proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_ARBITRAGE,
      settled: true,
    },
  };

  return c.json(response);
});

// ─── GET /sentiment ─────────────────────────────────────
predictionMarketRouter.get('/sentiment', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, 429);
  }

  const parsed = SentimentQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.issues }, 400);
  }
  const { topic, market, days, country } = parsed.data;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/prediction-market/sentiment', DESCRIPTION_SENTIMENT, PRICE_SENTIMENT, WALLET_ADDRESS, OUTPUT_SCHEMA_SENTIMENT),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_SENTIMENT);
  } catch {
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch sentiment from Reddit + web
  const [redditPosts, webResults] = await Promise.allSettled([
    searchReddit(topic, days, 30),
    searchWeb(topic, 15),
  ]);

  const reddit = redditPosts.status === 'fulfilled' ? redditPosts.value : [];
  const web = webResults.status === 'fulfilled' ? webResults.value : [];

  const redditTexts = reddit.map(p => `${p.title} ${p.selftext}`.slice(0, 500));
  const webTexts = web.map(r => `${r.title} ${r.snippet}`.slice(0, 500));

  const redditSentiment = redditTexts.length > 0 ? aggregateSentiment(redditTexts) : null;
  const webSentiment = webTexts.length > 0 ? aggregateSentiment(webTexts) : null;

  const allTexts = [...redditTexts, ...webTexts];
  const overallSentiment = allTexts.length > 0 ? aggregateSentiment(allTexts) : {
    overall: 'neutral' as const,
    positive: 33,
    neutral: 34,
    negative: 33,
  };

  const sentimentByPlatform: Record<string, { overall: string; positive: number; neutral: number; negative: number }> = {};
  if (redditSentiment) sentimentByPlatform.reddit = redditSentiment;
  if (webSentiment) sentimentByPlatform.web = webSentiment;

  // Fetch market odds if market slug provided
  let marketOdds: MarketOdds | null = null;
  if (market) {
    const results = await searchMarketsByQuery(market, 1);
    marketOdds = results[0] ?? null;
  }

  // Calculate divergence
  let divergence: number | null = null;
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (marketOdds) {
    divergence = calculateSentimentDivergence(
      { positive: overallSentiment.positive, neutral: overallSentiment.neutral, negative: overallSentiment.negative },
      marketOdds.outcomes?.[0]?.probability ?? 0.5,
    );
    signal = generateSignal(marketOdds, overallSentiment, divergence);
  }

  const topDiscussions = [
    ...reddit.map(p => ({ platform: 'reddit', title: p.title.slice(0, 200), engagement: p.score, url: p.permalink })),
    ...web.map(r => ({ platform: 'web', title: r.title.slice(0, 200), engagement: 0, url: r.url })),
  ].sort((a, b) => b.engagement - a.engagement).slice(0, 10);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response: SentimentReportResponse = {
    type: 'sentiment',
    topic,
    timestamp: new Date().toISOString(),
    marketOdds,
    sentiment: {
      overall: overallSentiment.overall,
      positive: Math.round(overallSentiment.positive),
      neutral: Math.round(overallSentiment.neutral),
      negative: Math.round(overallSentiment.negative),
      byPlatform: sentimentByPlatform,
    },
    divergence,
    signal,
    topDiscussions,
    proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_SENTIMENT,
      settled: true,
    },
  };

  return c.json(response);
});

// ─── GET /trending ───────────────────────────────────────
predictionMarketRouter.get('/trending', async (c) => {
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const ip = normalizeClientIp(c);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, 429);
  }

  const parsed = TrendingQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.issues }, 400);
  }
  const { category, limit } = parsed.data;

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/prediction-market/trending', DESCRIPTION_TRENDING, PRICE_TRENDING, WALLET_ADDRESS, OUTPUT_SCHEMA_TRENDING),
      402,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyPayment>>;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_TRENDING);
  } catch {
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  const [polymarketMarkets, kalshiMarkets] = await Promise.all([
    getTrendingMarkets(limit, category),
    getTrendingKalshiMarkets(limit, category),
  ]);

  const markets = [...polymarketMarkets, ...kalshiMarkets]
    .sort((a, b) => {
      const volA = 'volume24h' in a ? a.volume24h : (a as KalshiMarket).volume;
      const volB = 'volume24h' in b ? b.volume24h : (b as KalshiMarket).volume;
      return volB - volA;
    })
    .slice(0, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', toSafeHeaderValue(payment.txHash));

  const response: TrendingResponse = {
    type: 'trending',
    markets,
    timestamp: new Date().toISOString(),
    proxy: { ip: proxyIp, country: proxyConfig.country, type: 'mobile' },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount ?? PRICE_TRENDING,
      settled: true,
    },
  };

  return c.json(response);
});