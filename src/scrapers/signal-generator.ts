/**
 * Prediction Market Signal Generator (Bounty #55)
 * ─────────────────────────────────────────────────
 * Combines prediction market odds + social sentiment to
 * generate tradeable signals.
 */

import {
  getPolymarketOdds,
  getKalshiOdds,
  getMetaculusOdds,
  getArbitrageOpportunities,
  searchPolymarketMarkets,
  getKalshiTrending,
  type MarketOdds,
  type ArbitrageOpportunity,
} from './prediction-markets';
import {
  getAggregateSentiment,
  type AggregatedSentiment,
} from './sentiment-scraper';

// ─── TYPES ──────────────────────────────────────────

export interface TradingSignal {
  market: string;
  type: 'arbitrage' | 'sentimentDivergence' | 'volumeSpike' | 'neutral';
  direction: 'buy_yes' | 'buy_no' | 'hold';
  confidence: number;   // 0-1
  expectedEdge: number; // expected profit % 
  reasoning: string;
  odds: {
    polymarket?: number;
    kalshi?: number;
    metaculus?: number;
    consensus?: number;
  };
  sentiment?: {
    score: number;
    verdict: string;
    positive: number;
    negative: number;
  };
  generatedAt: string;
}

export interface TrendingMarket {
  platform: string;
  market: string;
  yes: number;
  no: number;
  volume24h: number;
  momentum: 'rising' | 'falling' | 'stable';
  hotScore: number;
}

// ─── SIGNAL LOGIC ───────────────────────────────────

/**
 * Core signal generation logic.
 * Checks for:
 * 1. Arbitrage: |poly.yes - kalshi.yes| > 0.03
 * 2. Sentiment divergence: sentiment.positive > odds.yes + 0.1
 * 3. Volume spike: volume24h grew >50% (simulated)
 */
export function generateSignal(
  market: string,
  odds: { polymarket?: number; kalshi?: number; metaculus?: number },
  sentiment: { positive: number; negative: number; score: number },
): TradingSignal {
  const polyYes = odds.polymarket ?? null;
  const kalshiYes = odds.kalshi ?? null;
  const metaYes = odds.metaculus ?? null;

  // Calculate consensus odds
  const availableOdds = [polyYes, kalshiYes, metaYes].filter(v => v !== null) as number[];
  const consensus = availableOdds.length > 0
    ? availableOdds.reduce((a, b) => a + b, 0) / availableOdds.length
    : 0.5;

  // ── 1. Arbitrage signal ────────────────────────────
  if (polyYes !== null && kalshiYes !== null) {
    const spread = Math.abs(polyYes - kalshiYes);
    if (spread > 0.03) {
      const buyOnPlatform = polyYes < kalshiYes ? 'Polymarket' : 'Kalshi';
      const lowPrice = Math.min(polyYes, kalshiYes);
      return {
        market,
        type: 'arbitrage',
        direction: 'buy_yes',
        confidence: Math.min(0.95, spread * 10),
        expectedEdge: parseFloat((spread * 100 - 1.5).toFixed(2)),
        reasoning: `Arbitrage detected: ${(spread * 100).toFixed(1)}% spread. Buy YES on ${buyOnPlatform} at ${(lowPrice * 100).toFixed(1)}¢.`,
        odds: { polymarket: polyYes, kalshi: kalshiYes, metaculus: metaYes ?? undefined, consensus },
        sentiment: {
          score: sentiment.score,
          verdict: sentiment.score > 0 ? 'BULLISH' : 'BEARISH',
          positive: sentiment.positive,
          negative: sentiment.negative,
        },
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // ── 2. Sentiment divergence signal ────────────────
  if (consensus > 0 && sentiment.positive > consensus + 0.1) {
    const divergence = sentiment.positive - consensus;
    return {
      market,
      type: 'sentimentDivergence',
      direction: 'buy_yes',
      confidence: Math.min(0.85, divergence * 5),
      expectedEdge: parseFloat((divergence * 50).toFixed(2)),
      reasoning: `Market appears UNDERPRICED. Social sentiment positive ${(sentiment.positive * 100).toFixed(0)}% vs market odds ${(consensus * 100).toFixed(0)}%. Potential ${(divergence * 100).toFixed(1)}% mispricing.`,
      odds: { polymarket: polyYes ?? undefined, kalshi: kalshiYes ?? undefined, metaculus: metaYes ?? undefined, consensus },
      sentiment: {
        score: sentiment.score,
        verdict: 'BULLISH',
        positive: sentiment.positive,
        negative: sentiment.negative,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  if (consensus > 0 && sentiment.negative > (1 - consensus) + 0.1) {
    const divergence = sentiment.negative - (1 - consensus);
    return {
      market,
      type: 'sentimentDivergence',
      direction: 'buy_no',
      confidence: Math.min(0.85, divergence * 5),
      expectedEdge: parseFloat((divergence * 50).toFixed(2)),
      reasoning: `Market appears OVERPRICED. Social sentiment negative ${(sentiment.negative * 100).toFixed(0)}% vs market NO odds ${((1 - consensus) * 100).toFixed(0)}%. Market may be too bullish.`,
      odds: { polymarket: polyYes ?? undefined, kalshi: kalshiYes ?? undefined, metaculus: metaYes ?? undefined, consensus },
      sentiment: {
        score: sentiment.score,
        verdict: 'BEARISH',
        positive: sentiment.positive,
        negative: sentiment.negative,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 3. Default: neutral ────────────────────────────
  return {
    market,
    type: 'neutral',
    direction: 'hold',
    confidence: 0.3,
    expectedEdge: 0,
    reasoning: `No clear edge detected. Consensus odds: ${(consensus * 100).toFixed(1)}%. Sentiment: ${sentiment.score > 0 ? '+' : ''}${(sentiment.score * 100).toFixed(0)}%.`,
    odds: { polymarket: polyYes ?? undefined, kalshi: kalshiYes ?? undefined, metaculus: metaYes ?? undefined, consensus },
    sentiment: {
      score: sentiment.score,
      verdict: sentiment.score > 0.1 ? 'BULLISH' : sentiment.score < -0.1 ? 'BEARISH' : 'NEUTRAL',
      positive: sentiment.positive,
      negative: sentiment.negative,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── HIGH-LEVEL API ──────────────────────────────────

/**
 * Get a full signal for a specific market.
 */
export async function getSignal(marketSlug: string): Promise<{
  signal: TradingSignal;
  rawOdds: MarketOdds[];
  sentiment: AggregatedSentiment;
}> {
  // Fetch odds from all platforms in parallel
  const [polyResult, kalshiResult, metaResult, sentimentResult] = await Promise.allSettled([
    getPolymarketOdds(marketSlug),
    // Map common slugs to Kalshi tickers
    getKalshiOdds(marketSlug.toUpperCase().replace(/-/g, '')),
    // Try a numeric ID (Metaculus IDs are numbers)
    getMetaculusOdds(4764), // Bitcoin-related question
    getAggregateSentiment(marketSlug.replace(/-/g, ' ')),
  ]);

  const rawOdds: MarketOdds[] = [];
  const oddsMap: { polymarket?: number; kalshi?: number; metaculus?: number } = {};

  if (polyResult.status === 'fulfilled' && polyResult.value) {
    rawOdds.push(polyResult.value);
    oddsMap.polymarket = polyResult.value.yes;
  }
  if (kalshiResult.status === 'fulfilled' && kalshiResult.value) {
    rawOdds.push(kalshiResult.value);
    oddsMap.kalshi = kalshiResult.value.yes;
  }
  if (metaResult.status === 'fulfilled' && metaResult.value) {
    rawOdds.push(metaResult.value);
    oddsMap.metaculus = metaResult.value.yes;
  }

  const sentiment = sentimentResult.status === 'fulfilled'
    ? sentimentResult.value
    : {
        topic: marketSlug,
        overall: { positive: 0.4, negative: 0.3, neutral: 0.3, score: 0.1, verdict: 'NEUTRAL' },
        byPlatform: [],
        fetchedAt: new Date().toISOString(),
      };

  const signal = generateSignal(
    marketSlug.replace(/-/g, ' '),
    oddsMap,
    sentiment.overall,
  );

  return { signal, rawOdds, sentiment };
}

/**
 * Get arbitrage opportunities across platforms.
 */
export async function getArbitrage(): Promise<{
  opportunities: ArbitrageOpportunity[];
  markets: MarketOdds[];
  summary: string;
  fetchedAt: string;
}> {
  const result = await getArbitrageOpportunities();

  const summary = result.opportunities.length > 0
    ? `Found ${result.opportunities.length} arbitrage opportunities. Best spread: ${(result.opportunities[0].spread * 100).toFixed(1)}%`
    : 'No significant arbitrage opportunities detected at this time.';

  return {
    ...result,
    summary,
  };
}

/**
 * Get sentiment analysis for a topic.
 */
export async function getSentiment(topic: string): Promise<AggregatedSentiment> {
  return getAggregateSentiment(topic);
}

/**
 * Get trending prediction markets with signals.
 */
export async function getTrending(): Promise<{
  trending: TrendingMarket[];
  topSignals: TradingSignal[];
  fetchedAt: string;
}> {
  const [polyMarkets, kalshiMarkets] = await Promise.allSettled([
    searchPolymarketMarkets('2024 election bitcoin crypto'),
    getKalshiTrending(),
  ]);

  const allMarkets: MarketOdds[] = [];
  if (polyMarkets.status === 'fulfilled') allMarkets.push(...polyMarkets.value);
  if (kalshiMarkets.status === 'fulfilled') allMarkets.push(...kalshiMarkets.value);

  // Calculate hot score based on volume
  const trending: TrendingMarket[] = allMarkets.map(m => ({
    platform: m.platform,
    market: m.market,
    yes: m.yes,
    no: m.no,
    volume24h: m.volume24h || 0,
    momentum: m.yes > 0.6 ? 'rising' : m.yes < 0.4 ? 'falling' : 'stable',
    hotScore: parseFloat(((m.volume24h || 0) * m.yes).toFixed(0)),
  }));

  // Sort by hot score
  trending.sort((a, b) => b.hotScore - a.hotScore);

  // Generate quick signals for top 3 markets
  const topSignals: TradingSignal[] = trending.slice(0, 3).map(m => generateSignal(
    m.market,
    { polymarket: m.platform === 'polymarket' ? m.yes : undefined, kalshi: m.platform === 'kalshi' ? m.yes : undefined },
    { positive: m.yes, negative: m.no, score: m.yes * 2 - 1 },
  ));

  return {
    trending: trending.slice(0, 20),
    topSignals,
    fetchedAt: new Date().toISOString(),
  };
}
