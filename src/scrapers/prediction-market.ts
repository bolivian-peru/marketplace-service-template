/**
 * Prediction Market Signal Aggregator (Bounty #55)
 * ─────────────────────────────────────────────────
 * Aggregates real-time odds from Polymarket, Kalshi, and Metaculus.
 * Combines with social sentiment data (Twitter/X, Reddit) scraped via
 * mobile proxies to detect mispricings and generate trading signals.
 *
 * Market data: public APIs (no proxy needed)
 * Sentiment data: mobile proxies required (Twitter, Reddit anti-bot)
 */

import { proxyFetch } from '../proxy';
import { searchTwitter } from './twitter';
import { searchReddit, type RedditPost } from './reddit-scraper';

// ─── TYPES ──────────────────────────────────────────

export interface MarketOdds {
  yes: number;
  no: number;
  volume24h: number | null;
  liquidity: number | null;
}

export interface MetaculusOdds {
  median: number;
  forecasters: number | null;
}

export interface PlatformOdds {
  polymarket: MarketOdds | null;
  kalshi: MarketOdds | null;
  metaculus: MetaculusOdds | null;
}

export interface TweetSignal {
  text: string;
  likes: number | null;
  retweets: number | null;
  author: string | null;
  timestamp: string | null;
}

export interface SentimentBreakdown {
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  trending: boolean;
  topTweets?: TweetSignal[];
  topSubreddits?: string[];
}

export interface SentimentData {
  twitter: SentimentBreakdown | null;
  reddit: SentimentBreakdown | null;
}

export interface ArbitrageSignal {
  detected: boolean;
  spread: number;
  direction: string;
  confidence: number;
}

export interface SentimentDivergenceSignal {
  detected: boolean;
  description: string;
  magnitude: 'low' | 'moderate' | 'high';
}

export interface VolumeSpikeSignal {
  detected: boolean;
  platform?: string;
  volume24h?: number;
  description?: string;
}

export interface Signals {
  arbitrage: ArbitrageSignal;
  sentimentDivergence: SentimentDivergenceSignal;
  volumeSpike: VolumeSpikeSignal;
}

export interface MarketSignalResponse {
  type: 'signal';
  market: string;
  timestamp: string;
  odds: PlatformOdds;
  sentiment: SentimentData;
  signals: Signals;
}

export interface ArbitrageOpportunity {
  market: string;
  platformA: string;
  platformB: string;
  priceA: number;
  priceB: number;
  spread: number;
  direction: string;
  confidence: number;
}

export interface TrendingMarket {
  market: string;
  question: string;
  platform: string;
  probability: number;
  volume24h: number | null;
  sentimentDivergence: number | null;
}

// ─── POLYMARKET ─────────────────────────────────────

const POLYMARKET_API = 'https://clob.polymarket.com';
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';

interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  markets: PolymarketMarket[];
}

interface PolymarketMarket {
  id: string;
  question: string;
  outcomePrices: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
}

/**
 * Search Polymarket events by keyword.
 */
export async function searchPolymarket(query: string, limit: number = 10): Promise<PolymarketEvent[]> {
  try {
    const url = `${POLYMARKET_GAMMA}/events?title_contains=${encodeURIComponent(query)}&closed=false&limit=${limit}&active=true`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return [];
    const data = await res.json() as any[];
    if (!Array.isArray(data)) return [];

    return data.map((e: any) => ({
      id: e.id || '',
      slug: e.slug || '',
      title: e.title || '',
      markets: Array.isArray(e.markets)
        ? e.markets.map((m: any) => ({
            id: m.id || '',
            question: m.question || '',
            outcomePrices: m.outcomePrices || '[]',
            volume: m.volume || '0',
            liquidity: m.liquidity || '0',
            active: m.active ?? true,
            closed: m.closed ?? false,
          }))
        : [],
    }));
  } catch (err: any) {
    console.error(`[prediction] Polymarket search error: ${err.message}`);
    return [];
  }
}

/**
 * Extract odds from a Polymarket market.
 */
function parsePolymarketOdds(market: PolymarketMarket): MarketOdds | null {
  try {
    let prices: number[];
    try {
      prices = JSON.parse(market.outcomePrices);
    } catch {
      return null;
    }

    if (!Array.isArray(prices) || prices.length < 2) return null;

    const yes = typeof prices[0] === 'string' ? parseFloat(prices[0]) : prices[0];
    const no = typeof prices[1] === 'string' ? parseFloat(prices[1]) : prices[1];

    return {
      yes: Math.round(yes * 100) / 100,
      no: Math.round(no * 100) / 100,
      volume24h: parseFloat(market.volume) || null,
      liquidity: parseFloat(market.liquidity) || null,
    };
  } catch {
    return null;
  }
}

// ─── KALSHI ─────────────────────────────────────────

const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

interface KalshiEvent {
  event_ticker: string;
  title: string;
  markets: KalshiMarket[];
}

interface KalshiMarket {
  ticker: string;
  title: string;
  yes_ask: number;
  no_ask: number;
  yes_bid: number;
  no_bid: number;
  volume: number;
  volume_24h: number;
  open_interest: number;
  status: string;
}

/**
 * Search Kalshi events/markets.
 */
export async function searchKalshi(query: string, limit: number = 10): Promise<KalshiMarket[]> {
  try {
    const url = `${KALSHI_API}/markets?limit=${limit}&status=open`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return [];
    const data = await res.json() as any;
    const markets = data?.markets;
    if (!Array.isArray(markets)) return [];

    const queryLower = query.toLowerCase();
    return markets
      .filter((m: any) =>
        (m.title || '').toLowerCase().includes(queryLower) ||
        (m.ticker || '').toLowerCase().includes(queryLower)
      )
      .slice(0, limit)
      .map((m: any) => ({
        ticker: m.ticker || '',
        title: m.title || '',
        yes_ask: m.yes_ask ?? 0,
        no_ask: m.no_ask ?? 0,
        yes_bid: m.yes_bid ?? 0,
        no_bid: m.no_bid ?? 0,
        volume: m.volume ?? 0,
        volume_24h: m.volume_24h ?? 0,
        open_interest: m.open_interest ?? 0,
        status: m.status || 'unknown',
      }));
  } catch (err: any) {
    console.error(`[prediction] Kalshi search error: ${err.message}`);
    return [];
  }
}

function parseKalshiOdds(market: KalshiMarket): MarketOdds | null {
  const yesPrice = market.yes_ask || market.yes_bid;
  const noPrice = market.no_ask || market.no_bid;
  if (!yesPrice && !noPrice) return null;

  // Kalshi prices are in cents (0-100), convert to probability (0-1)
  const yes = yesPrice <= 1 ? yesPrice : yesPrice / 100;
  const no = noPrice <= 1 ? noPrice : noPrice / 100;

  return {
    yes: Math.round(yes * 100) / 100,
    no: Math.round(no * 100) / 100,
    volume24h: market.volume_24h || null,
    liquidity: market.open_interest || null,
  };
}

// ─── METACULUS ───────────────────────────────────────

const METACULUS_API = 'https://www.metaculus.com/api2';

interface MetaculusQuestion {
  id: number;
  title: string;
  url: string;
  community_prediction: {
    full: { q2: number } | null;
  } | null;
  number_of_forecasters: number | null;
  active_state: string;
}

/**
 * Search Metaculus questions.
 */
export async function searchMetaculus(query: string, limit: number = 10): Promise<MetaculusQuestion[]> {
  try {
    const url = `${METACULUS_API}/questions/?search=${encodeURIComponent(query)}&limit=${limit}&status=open&type=forecast&order_by=-activity`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return [];
    const data = await res.json() as any;
    const results = data?.results;
    if (!Array.isArray(results)) return [];

    return results.slice(0, limit).map((q: any) => ({
      id: q.id || 0,
      title: q.title || '',
      url: q.url || `https://www.metaculus.com/questions/${q.id}/`,
      community_prediction: q.community_prediction || null,
      number_of_forecasters: q.number_of_forecasters || null,
      active_state: q.active_state || 'unknown',
    }));
  } catch (err: any) {
    console.error(`[prediction] Metaculus search error: ${err.message}`);
    return [];
  }
}

function parseMetaculusOdds(question: MetaculusQuestion): MetaculusOdds | null {
  const median = question.community_prediction?.full?.q2;
  if (typeof median !== 'number') return null;

  return {
    median: Math.round(median * 100) / 100,
    forecasters: question.number_of_forecasters || null,
  };
}

// ─── SENTIMENT ANALYSIS ─────────────────────────────

/**
 * Simple keyword-based sentiment classification.
 * Classifies text as positive, negative, or neutral.
 */
function classifySentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();

  const positiveWords = [
    'bullish', 'buy', 'moon', 'up', 'gain', 'win', 'winning', 'surge',
    'rally', 'pump', 'soar', 'rocket', 'strong', 'confident', 'great',
    'excellent', 'amazing', 'good', 'positive', 'yes', 'likely', 'certain',
    'bet on', 'going up', 'all in', 'huge', 'massive', 'crush', 'dominate',
    'lead', 'ahead', 'outperform', 'breakout', 'explosive',
  ];

  const negativeWords = [
    'bearish', 'sell', 'crash', 'down', 'drop', 'loss', 'lose', 'losing',
    'dump', 'tank', 'plunge', 'weak', 'worried', 'bad', 'terrible',
    'awful', 'negative', 'no', 'unlikely', 'doubt', 'risk', 'danger',
    'fail', 'collapse', 'bubble', 'overpriced', 'scam', 'fraud',
    'behind', 'underperform', 'decline', 'slump',
  ];

  let posCount = 0;
  let negCount = 0;

  for (const word of positiveWords) {
    if (lower.includes(word)) posCount++;
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) negCount++;
  }

  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

/**
 * Scrape Twitter/X sentiment for a prediction market topic via mobile proxy.
 */
export async function getTwitterSentiment(topic: string, limit: number = 20): Promise<SentimentBreakdown | null> {
  try {
    const tweets = await searchTwitter(topic, 7, limit);
    if (tweets.length === 0) return null;

    let positive = 0;
    let negative = 0;
    let neutral = 0;

    const topTweets: TweetSignal[] = [];

    for (const tweet of tweets) {
      const sentiment = classifySentiment(tweet.text);
      if (sentiment === 'positive') positive++;
      else if (sentiment === 'negative') negative++;
      else neutral++;

      topTweets.push({
        text: tweet.text.slice(0, 280),
        likes: tweet.likes,
        retweets: tweet.retweets,
        author: tweet.author,
        timestamp: tweet.publishedAt,
      });
    }

    const total = positive + negative + neutral;

    return {
      positive: Math.round((positive / total) * 100) / 100,
      negative: Math.round((negative / total) * 100) / 100,
      neutral: Math.round((neutral / total) * 100) / 100,
      volume: total,
      trending: total >= 10,
      topTweets: topTweets.slice(0, 10),
    };
  } catch (err: any) {
    console.error(`[prediction] Twitter sentiment error: ${err.message}`);
    return null;
  }
}

/**
 * Scrape Reddit sentiment for a prediction market topic via mobile proxy.
 */
export async function getRedditSentiment(topic: string, limit: number = 20): Promise<SentimentBreakdown | null> {
  try {
    const result = await searchReddit(topic, 'relevance', 'week', limit);
    const posts = result.posts;
    if (posts.length === 0) return null;

    let positive = 0;
    let negative = 0;
    let neutral = 0;

    const subredditMap = new Map<string, number>();

    for (const post of posts) {
      const text = `${post.title} ${post.selftext}`;
      const sentiment = classifySentiment(text);
      if (sentiment === 'positive') positive++;
      else if (sentiment === 'negative') negative++;
      else neutral++;

      const sub = post.subreddit;
      subredditMap.set(sub, (subredditMap.get(sub) || 0) + post.score);
    }

    const total = positive + negative + neutral;

    // Top subreddits by engagement
    const topSubreddits = [...subredditMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sub]) => sub);

    return {
      positive: Math.round((positive / total) * 100) / 100,
      negative: Math.round((negative / total) * 100) / 100,
      neutral: Math.round((neutral / total) * 100) / 100,
      volume: total,
      trending: total >= 8,
      topSubreddits,
    };
  } catch (err: any) {
    console.error(`[prediction] Reddit sentiment error: ${err.message}`);
    return null;
  }
}

// ─── SIGNAL GENERATION ──────────────────────────────

/**
 * Detect cross-platform arbitrage between Polymarket and Kalshi.
 */
export function detectArbitrage(
  polymarket: MarketOdds | null,
  kalshi: MarketOdds | null,
): ArbitrageSignal {
  if (!polymarket || !kalshi) {
    return { detected: false, spread: 0, direction: 'Insufficient data', confidence: 0 };
  }

  const spread = Math.abs(polymarket.yes - kalshi.yes);
  const detected = spread >= 0.03; // 3% minimum spread to flag

  let direction = 'No significant spread';
  if (detected) {
    if (polymarket.yes > kalshi.yes) {
      direction = `Polymarket YES overpriced vs Kalshi (${(polymarket.yes * 100).toFixed(1)}% vs ${(kalshi.yes * 100).toFixed(1)}%)`;
    } else {
      direction = `Kalshi YES overpriced vs Polymarket (${(kalshi.yes * 100).toFixed(1)}% vs ${(polymarket.yes * 100).toFixed(1)}%)`;
    }
  }

  // Confidence based on spread size and liquidity
  const liquidityFactor = Math.min(
    ((polymarket.volume24h || 0) + (kalshi.volume24h || 0)) / 1_000_000,
    1,
  );
  const confidence = detected
    ? Math.min(0.5 + spread * 2 + liquidityFactor * 0.2, 0.95)
    : 0;

  return {
    detected,
    spread: Math.round(spread * 1000) / 1000,
    direction,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Detect sentiment divergence — when social sentiment disagrees with market price.
 */
export function detectSentimentDivergence(
  odds: PlatformOdds,
  sentiment: SentimentData,
): SentimentDivergenceSignal {
  // Get average market probability
  const probabilities: number[] = [];
  if (odds.polymarket) probabilities.push(odds.polymarket.yes);
  if (odds.kalshi) probabilities.push(odds.kalshi.yes);
  if (odds.metaculus) probabilities.push(odds.metaculus.median);

  if (probabilities.length === 0) {
    return { detected: false, description: 'No market data available', magnitude: 'low' };
  }

  const avgMarketProb = probabilities.reduce((a, b) => a + b, 0) / probabilities.length;

  // Get average social sentiment (positive ratio)
  const sentimentScores: number[] = [];
  if (sentiment.twitter) sentimentScores.push(sentiment.twitter.positive);
  if (sentiment.reddit) sentimentScores.push(sentiment.reddit.positive);

  if (sentimentScores.length === 0) {
    return { detected: false, description: 'No sentiment data available', magnitude: 'low' };
  }

  const avgSentiment = sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length;

  // Compare: if sentiment is much higher than market price, potential underpricing
  const divergence = avgSentiment - avgMarketProb;
  const absDivergence = Math.abs(divergence);

  let magnitude: 'low' | 'moderate' | 'high' = 'low';
  if (absDivergence >= 0.15) magnitude = 'high';
  else if (absDivergence >= 0.08) magnitude = 'moderate';

  const detected = absDivergence >= 0.05;

  let description = 'No significant divergence';
  if (detected) {
    const sentimentPct = (avgSentiment * 100).toFixed(0);
    const marketPct = (avgMarketProb * 100).toFixed(0);
    if (divergence > 0) {
      description = `Social sentiment ${sentimentPct}% bullish but market only ${marketPct}% — potential underpricing`;
    } else {
      description = `Market at ${marketPct}% but social sentiment only ${sentimentPct}% bullish — potential overpricing`;
    }
  }

  return { detected, description, magnitude };
}

/**
 * Detect unusual volume spikes.
 */
export function detectVolumeSpike(odds: PlatformOdds): VolumeSpikeSignal {
  const VOLUME_THRESHOLD = 500_000; // $500k in 24h is noteworthy

  if (odds.polymarket?.volume24h && odds.polymarket.volume24h > VOLUME_THRESHOLD) {
    return {
      detected: true,
      platform: 'polymarket',
      volume24h: odds.polymarket.volume24h,
      description: `Polymarket 24h volume: $${(odds.polymarket.volume24h / 1_000_000).toFixed(2)}M — elevated activity`,
    };
  }

  if (odds.kalshi?.volume24h && odds.kalshi.volume24h > VOLUME_THRESHOLD) {
    return {
      detected: true,
      platform: 'kalshi',
      volume24h: odds.kalshi.volume24h,
      description: `Kalshi 24h volume: ${odds.kalshi.volume24h.toLocaleString()} contracts — elevated activity`,
    };
  }

  return { detected: false };
}

// ─── MAIN AGGREGATION ───────────────────────────────

/**
 * Full signal aggregation for a market/topic.
 * Fetches odds from all platforms + sentiment from social media.
 */
export async function getMarketSignal(market: string): Promise<MarketSignalResponse> {
  // Normalize the market query
  const query = market.replace(/-/g, ' ').trim();

  // Fetch market data and sentiment in parallel
  const [polyEvents, kalshiMarkets, metaculusQuestions, twitterSentiment, redditSentiment] =
    await Promise.all([
      searchPolymarket(query, 5),
      searchKalshi(query, 5),
      searchMetaculus(query, 5),
      getTwitterSentiment(query, 20),
      getRedditSentiment(query, 20),
    ]);

  // Extract best matching odds from each platform
  let polyOdds: MarketOdds | null = null;
  for (const event of polyEvents) {
    for (const m of event.markets) {
      const odds = parsePolymarketOdds(m);
      if (odds) {
        polyOdds = odds;
        break;
      }
    }
    if (polyOdds) break;
  }

  let kalshiOdds: MarketOdds | null = null;
  if (kalshiMarkets.length > 0) {
    kalshiOdds = parseKalshiOdds(kalshiMarkets[0]);
  }

  let metaculusOdds: MetaculusOdds | null = null;
  if (metaculusQuestions.length > 0) {
    metaculusOdds = parseMetaculusOdds(metaculusQuestions[0]);
  }

  const odds: PlatformOdds = {
    polymarket: polyOdds,
    kalshi: kalshiOdds,
    metaculus: metaculusOdds,
  };

  const sentiment: SentimentData = {
    twitter: twitterSentiment,
    reddit: redditSentiment,
  };

  // Generate signals
  const arbitrage = detectArbitrage(polyOdds, kalshiOdds);
  const sentimentDivergence = detectSentimentDivergence(odds, sentiment);
  const volumeSpike = detectVolumeSpike(odds);

  return {
    type: 'signal',
    market,
    timestamp: new Date().toISOString(),
    odds,
    sentiment,
    signals: {
      arbitrage,
      sentimentDivergence,
      volumeSpike,
    },
  };
}

/**
 * Scan for arbitrage opportunities across active markets.
 */
export async function findArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
  // Fetch popular/trending markets from Polymarket
  const opportunities: ArbitrageOpportunity[] = [];

  try {
    const url = `${POLYMARKET_GAMMA}/events?closed=false&limit=20&active=true&order=volume24hr&ascending=false`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return [];
    const events = await res.json() as any[];
    if (!Array.isArray(events)) return [];

    // For each high-volume Polymarket event, check Kalshi for same market
    for (const event of events.slice(0, 10)) {
      if (!event.markets || !Array.isArray(event.markets)) continue;

      for (const market of event.markets) {
        const polyOdds = parsePolymarketOdds(market);
        if (!polyOdds) continue;

        // Search Kalshi for matching market
        const query = (market.question || event.title || '').slice(0, 100);
        if (!query) continue;

        const kalshiResults = await searchKalshi(query, 3);
        if (kalshiResults.length === 0) continue;

        const kalshiOdds = parseKalshiOdds(kalshiResults[0]);
        if (!kalshiOdds) continue;

        const spread = Math.abs(polyOdds.yes - kalshiOdds.yes);
        if (spread < 0.02) continue; // Skip trivial spreads

        let direction: string;
        if (polyOdds.yes > kalshiOdds.yes) {
          direction = `Polymarket YES overpriced vs Kalshi`;
        } else {
          direction = `Kalshi YES overpriced vs Polymarket`;
        }

        const liquidityFactor = Math.min(
          ((polyOdds.volume24h || 0) + (kalshiOdds.volume24h || 0)) / 1_000_000,
          1,
        );
        const confidence = Math.min(0.5 + spread * 2 + liquidityFactor * 0.2, 0.95);

        opportunities.push({
          market: query,
          platformA: 'polymarket',
          platformB: 'kalshi',
          priceA: polyOdds.yes,
          priceB: kalshiOdds.yes,
          spread: Math.round(spread * 1000) / 1000,
          direction,
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }
  } catch (err: any) {
    console.error(`[prediction] Arbitrage scan error: ${err.message}`);
  }

  // Sort by spread descending
  return opportunities.sort((a, b) => b.spread - a.spread);
}

/**
 * Get trending prediction markets with sentiment data.
 */
export async function getTrendingMarkets(): Promise<TrendingMarket[]> {
  const markets: TrendingMarket[] = [];

  try {
    // Fetch top Polymarket events by volume
    const url = `${POLYMARKET_GAMMA}/events?closed=false&limit=15&active=true&order=volume24hr&ascending=false`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const events = await res.json() as any[];
      if (Array.isArray(events)) {
        for (const event of events) {
          if (!event.markets || !Array.isArray(event.markets)) continue;
          for (const m of event.markets.slice(0, 2)) {
            const odds = parsePolymarketOdds(m);
            if (!odds) continue;

            markets.push({
              market: event.slug || event.title || '',
              question: m.question || event.title || '',
              platform: 'polymarket',
              probability: odds.yes,
              volume24h: odds.volume24h,
              sentimentDivergence: null,
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[prediction] Trending Polymarket error: ${err.message}`);
  }

  // Add Metaculus trending
  try {
    const metaQuestions = await searchMetaculus('', 10);
    for (const q of metaQuestions) {
      const odds = parseMetaculusOdds(q);
      if (!odds) continue;

      markets.push({
        market: q.title.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
        question: q.title,
        platform: 'metaculus',
        probability: odds.median,
        volume24h: null,
        sentimentDivergence: null,
      });
    }
  } catch (err: any) {
    console.error(`[prediction] Trending Metaculus error: ${err.message}`);
  }

  return markets.slice(0, 20);
}

/**
 * Get sentiment analysis for a specific topic with country targeting.
 */
export async function getTopicSentiment(
  topic: string,
  country: string = 'US',
): Promise<SentimentData> {
  const searchTopic = `${topic} ${country}`;

  const [twitterSentiment, redditSentiment] = await Promise.all([
    getTwitterSentiment(searchTopic, 25),
    getRedditSentiment(topic, 25),
  ]);

  return {
    twitter: twitterSentiment,
    reddit: redditSentiment,
  };
}
