/**
 * Prediction Market Signal Aggregator (Bounty #55)
 * ────────────────────────────────────────────────
 * Combines real-time prediction market pricing (Polymarket + Kalshi)
 * with social sentiment (Twitter/X + Reddit + TikTok page signal) to
 * generate arbitrage + divergence signals.
 */

import { proxyFetch } from '../proxy';
import { searchReddit } from './reddit-scraper';
import { searchTwitter } from './twitter';

export interface MarketOdds {
  polymarket: {
    yes: number;
    no: number;
    volume24h: number;
    liquidity: number;
    title: string;
    slug: string;
  } | null;
  kalshi: {
    yes: number;
    no: number;
    volume24h: number;
    ticker: string;
    title: string;
  } | null;
  metaculus: {
    median: number;
    forecasters: number;
  } | null;
}

export interface SignalResponse {
  type: 'signal';
  market: string;
  timestamp: string;
  odds: MarketOdds;
  sentiment: {
    twitter: {
      positive: number;
      negative: number;
      neutral: number;
      volume: number;
      trending: boolean;
      topTweets: Array<{ text: string; likes: number; retweets: number; author: string; timestamp: string | null }>;
    };
    reddit: {
      positive: number;
      negative: number;
      neutral: number;
      volume: number;
      topSubreddits: string[];
    };
    tiktok: {
      relatedVideos: number;
      totalViews: number;
      sentiment: 'bullish' | 'bearish' | 'neutral';
    };
  };
  signals: {
    arbitrage: {
      detected: boolean;
      spread: number;
      direction: string;
      confidence: number;
    };
    sentimentDivergence: {
      detected: boolean;
      description: string;
      magnitude: 'low' | 'moderate' | 'high';
    };
    volumeSpike: {
      detected: boolean;
      baseline24h: number;
      threshold: number;
    };
  };
}

export interface SentimentResponse {
  type: 'sentiment';
  topic: string;
  timestamp: string;
  sentiment: SignalResponse['sentiment'];
  summary: {
    combinedBullish: number;
    combinedBearish: number;
    confidence: number;
  };
}

export interface ArbitrageResponse {
  type: 'arbitrage';
  timestamp: string;
  opportunities: Array<{
    market: string;
    spread: number;
    direction: string;
    confidence: number;
  }>;
}

export interface TrendingResponse {
  type: 'trending';
  timestamp: string;
  markets: Array<{
    market: string;
    yesOdds: number;
    socialBullish: number;
    divergence: number;
    signal: 'underpriced' | 'overpriced' | 'aligned';
  }>;
}

const POLYMARKET_EVENTS_URL = 'https://gamma-api.polymarket.com/events?limit=80&closed=false&active=true';
const KALSHI_MARKETS_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=150';
const METACULUS_SEARCH_URL = 'https://www.metaculus.com/api2/questions/?limit=10&search=';

function hasProxyConfig(): boolean {
  return Boolean(
    process.env.PROXY_HOST
    && process.env.PROXY_HTTP_PORT
    && process.env.PROXY_USER
    && process.env.PROXY_PASS,
  );
}

const POSITIVE_WORDS = [
  'bull', 'bullish', 'surge', 'moon', 'up', 'win', 'approve', 'approved', 'beat', 'positive',
  'strong', 'rally', 'growth', 'breakout', 'buy', 'long', 'upside', 'optimistic',
];
const NEGATIVE_WORDS = [
  'bear', 'bearish', 'dump', 'crash', 'down', 'lose', 'denied', 'reject', 'negative', 'weak',
  'sell', 'short', 'decline', 'fear', 'risk', 'panic', 'lawsuit', 'ban', 'delay',
];

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter((t) => t.length > 2);
}

function scoreCandidate(candidate: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const normalized = normalizeText(candidate);
  let matched = 0;
  for (const token of queryTokens) {
    if (normalized.includes(token)) matched += 1;
  }
  return matched / queryTokens.length;
}

function classifyTextSentiment(text: string): -1 | 0 | 1 {
  const lower = normalizeText(text);
  let score = 0;

  for (const word of POSITIVE_WORDS) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of NEGATIVE_WORDS) {
    if (lower.includes(word)) score -= 1;
  }

  if (score > 0) return 1;
  if (score < 0) return -1;
  return 0;
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return Number((value / total).toFixed(3));
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

interface PolymarketSnapshot {
  title: string;
  slug: string;
  yes: number;
  no: number;
  volume24h: number;
  liquidity: number;
}

interface KalshiSnapshot {
  title: string;
  ticker: string;
  yes: number;
  no: number;
  volume24h: number;
}

async function findPolymarketMarket(marketQuery: string): Promise<PolymarketSnapshot | null> {
  const events = await fetchJson(POLYMARKET_EVENTS_URL) as any[];
  if (!Array.isArray(events) || events.length === 0) return null;

  const tokens = tokenize(marketQuery);
  let best: any = null;
  let bestScore = 0;

  for (const event of events) {
    const title = typeof event?.title === 'string' ? event.title : '';
    const slug = typeof event?.slug === 'string' ? event.slug : '';
    const composite = `${title} ${slug}`;
    const score = scoreCandidate(composite, tokens);
    if (score > bestScore) {
      best = event;
      bestScore = score;
    }
  }

  if (!best || bestScore < 0.2) return null;

  const firstMarket = Array.isArray(best.markets) && best.markets.length > 0 ? best.markets[0] : null;
  const outcomes = parseJsonArray(firstMarket?.outcomes);
  const pricesRaw = parseJsonArray(firstMarket?.outcomePrices);
  const prices = pricesRaw.map((v) => asNumber(v));

  let yes = 0.5;
  let no = 0.5;

  if (outcomes.length >= 2 && prices.length >= 2) {
    const yesIdx = outcomes.findIndex((o) => normalizeText(o) === 'yes');
    const noIdx = outcomes.findIndex((o) => normalizeText(o) === 'no');
    if (yesIdx >= 0 && noIdx >= 0) {
      const yesCandidate = prices[yesIdx];
      const noCandidate = prices[noIdx];
      if (Number.isFinite(yesCandidate)) yes = yesCandidate;
      if (Number.isFinite(noCandidate)) no = noCandidate;
    } else {
      const yesCandidate = prices[0];
      const noCandidate = prices[1];
      if (Number.isFinite(yesCandidate)) yes = yesCandidate;
      if (Number.isFinite(noCandidate)) no = noCandidate;
    }
  }

  const yesSafe = Math.min(Math.max(yes, 0), 1);
  const noSafe = Math.min(Math.max(no, 0), 1);

  return {
    title: typeof best.title === 'string' ? best.title : marketQuery,
    slug: typeof best.slug === 'string' ? best.slug : marketQuery,
    yes: Number(yesSafe.toFixed(3)),
    no: Number(noSafe.toFixed(3)),
    volume24h: asNumber(best.volume24hr),
    liquidity: asNumber(best.liquidity),
  };
}

async function findKalshiMarket(marketQuery: string): Promise<KalshiSnapshot | null> {
  const payload = await fetchJson(KALSHI_MARKETS_URL) as { markets?: any[] };
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  if (markets.length === 0) return null;

  const tokens = tokenize(marketQuery);
  let best: any = null;
  let bestScore = 0;

  for (const market of markets) {
    const title = typeof market?.title === 'string' ? market.title : '';
    const ticker = typeof market?.ticker === 'string' ? market.ticker : '';
    const score = scoreCandidate(`${title} ${ticker}`, tokens);
    if (score > bestScore) {
      best = market;
      bestScore = score;
    }
  }

  if (!best || bestScore < 0.2) return null;

  const yesAsk = asNumber(best.yes_ask, 0);
  const yesBid = asNumber(best.yes_bid, 0);
  const last = asNumber(best.last_price, 50);

  const yesPriceCents = yesAsk > 0 ? yesAsk : yesBid > 0 ? yesBid : last;
  const yes = Math.min(Math.max(yesPriceCents / 100, 0), 1);
  const no = Number((1 - yes).toFixed(3));

  return {
    title: typeof best.title === 'string' ? best.title : marketQuery,
    ticker: typeof best.ticker === 'string' ? best.ticker : 'UNKNOWN',
    yes: Number(yes.toFixed(3)),
    no,
    volume24h: asNumber(best.volume_24h),
  };
}

async function findMetaculusSnapshot(marketQuery: string): Promise<{ median: number; forecasters: number } | null> {
  try {
    const res = await fetch(`${METACULUS_SEARCH_URL}${encodeURIComponent(marketQuery)}`);
    if (!res.ok) return null;

    const data = await res.json() as { results?: any[] };
    const first = Array.isArray(data?.results) && data.results.length > 0 ? data.results[0] : null;
    if (!first) return null;

    const median = asNumber(first?.community_prediction?.q2, NaN);
    const forecasters = asNumber(first?.nr_forecasters, 0);
    if (!Number.isFinite(median)) return null;

    return {
      median: Number(Math.min(Math.max(median, 0), 1).toFixed(3)),
      forecasters: Math.max(Math.floor(forecasters), 0),
    };
  } catch {
    return null;
  }
}

async function getTwitterSentiment(topic: string) {
  try {
    const tweets = await Promise.race([
      searchTwitter(topic, 7, 12),
      new Promise<Awaited<ReturnType<typeof searchTwitter>>>((resolve) => {
        setTimeout(() => resolve([]), 8_000);
      }),
    ]);
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const tweet of tweets) {
      const score = classifyTextSentiment(tweet.text);
      if (score > 0) positive += 1;
      else if (score < 0) negative += 1;
      else neutral += 1;
    }

    const total = tweets.length;

    return {
      positive: ratio(positive, total),
      negative: ratio(negative, total),
      neutral: ratio(neutral, total),
      volume: total,
      trending: total >= 8,
      topTweets: tweets.slice(0, 5).map((t) => ({
        text: t.text.slice(0, 240),
        likes: t.likes ?? 0,
        retweets: t.retweets ?? 0,
        author: t.author ?? '@unknown',
        timestamp: t.publishedAt,
      })),
    };
  } catch {
    return {
      positive: 0,
      negative: 0,
      neutral: 1,
      volume: 0,
      trending: false,
      topTweets: [],
    };
  }
}

async function getRedditSentiment(topic: string) {
  if (!hasProxyConfig()) {
    return {
      positive: 0,
      negative: 0,
      neutral: 1,
      volume: 0,
      topSubreddits: [],
    };
  }

  try {
    const result = await searchReddit(topic, 'relevance', 'week', 25);
    const posts = result.posts;

    let positive = 0;
    let negative = 0;
    let neutral = 0;
    const subreddits = new Map<string, number>();

    for (const post of posts) {
      const score = classifyTextSentiment(`${post.title} ${post.selftext}`);
      if (score > 0) positive += 1;
      else if (score < 0) negative += 1;
      else neutral += 1;

      subreddits.set(post.subreddit, (subreddits.get(post.subreddit) || 0) + 1);
    }

    const total = posts.length;

    return {
      positive: ratio(positive, total),
      negative: ratio(negative, total),
      neutral: ratio(neutral, total),
      volume: total,
      topSubreddits: Array.from(subreddits.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name]) => name),
    };
  } catch {
    return {
      positive: 0,
      negative: 0,
      neutral: 1,
      volume: 0,
      topSubreddits: [],
    };
  }
}

async function getTikTokSignal(topic: string): Promise<{ relatedVideos: number; totalViews: number; sentiment: 'bullish' | 'bearish' | 'neutral' }> {
  if (!hasProxyConfig()) {
    return { relatedVideos: 0, totalViews: 0, sentiment: 'neutral' };
  }

  const url = `https://www.tiktok.com/search?q=${encodeURIComponent(topic)}`;

  try {
    const response = await proxyFetch(url, { timeoutMs: 20_000, maxRetries: 1 });
    if (!response.ok) {
      return { relatedVideos: 0, totalViews: 0, sentiment: 'neutral' };
    }

    const html = await response.text();

    // Lightweight signal extraction (best-effort): look for engagement counts in hydrated payload.
    const viewMatches = Array.from(html.matchAll(/"playCount"\s*:\s*"?(\d{1,18})"?/g));
    const likeMatches = Array.from(html.matchAll(/"diggCount"\s*:\s*"?(\d{1,18})"?/g));

    const relatedVideos = Math.max(viewMatches.length, likeMatches.length);
    const totalViews = viewMatches
      .map((m) => Number(m[1]))
      .filter(Number.isFinite)
      .slice(0, 50)
      .reduce((acc, n) => acc + n, 0);

    const textSentiment = classifyTextSentiment(topic);
    const sentiment: 'bullish' | 'bearish' | 'neutral' = textSentiment > 0 ? 'bullish' : textSentiment < 0 ? 'bearish' : 'neutral';

    return {
      relatedVideos,
      totalViews,
      sentiment,
    };
  } catch {
    return { relatedVideos: 0, totalViews: 0, sentiment: 'neutral' };
  }
}

function buildArbitrageSignal(odds: MarketOdds) {
  if (!odds.polymarket || !odds.kalshi) {
    return {
      detected: false,
      spread: 0,
      direction: 'Insufficient cross-market data',
      confidence: 0,
    };
  }

  const spread = Number(Math.abs(odds.polymarket.yes - odds.kalshi.yes).toFixed(3));
  const detected = spread >= 0.03;
  const direction = odds.polymarket.yes > odds.kalshi.yes
    ? 'Polymarket YES overpriced vs Kalshi'
    : 'Kalshi YES overpriced vs Polymarket';

  return {
    detected,
    spread,
    direction,
    confidence: Number(Math.min(0.95, 0.45 + spread * 4).toFixed(2)),
  };
}

function buildSentimentDivergence(odds: MarketOdds, sentiment: SignalResponse['sentiment']) {
  const marketYes = odds.polymarket?.yes ?? odds.kalshi?.yes ?? 0.5;
  const socialBullish = (sentiment.twitter.positive + sentiment.reddit.positive) / 2;
  const delta = Number((socialBullish - marketYes).toFixed(3));
  const absDelta = Math.abs(delta);

  let magnitude: 'low' | 'moderate' | 'high' = 'low';
  if (absDelta >= 0.15) magnitude = 'high';
  else if (absDelta >= 0.08) magnitude = 'moderate';

  const detected = absDelta >= 0.08;
  const direction = delta > 0 ? 'underpricing' : 'overpricing';

  return {
    detected,
    description: detected
      ? `Social sentiment ${(socialBullish * 100).toFixed(1)}% vs market ${(marketYes * 100).toFixed(1)}% — potential ${direction}`
      : 'Social sentiment and market pricing are roughly aligned',
    magnitude,
  };
}

function buildVolumeSpike(odds: MarketOdds) {
  const baseline24h = (odds.polymarket?.volume24h || 0) + (odds.kalshi?.volume24h || 0);
  const threshold = 1_000_000;
  return {
    detected: baseline24h >= threshold,
    baseline24h,
    threshold,
  };
}

export async function getPredictionSignal(market: string): Promise<SignalResponse> {
  const [polymarket, kalshi, metaculus, twitter, reddit, tiktok] = await Promise.all([
    findPolymarketMarket(market),
    findKalshiMarket(market),
    findMetaculusSnapshot(market),
    getTwitterSentiment(market),
    getRedditSentiment(market),
    getTikTokSignal(market),
  ]);

  const odds: MarketOdds = {
    polymarket: polymarket ? {
      yes: polymarket.yes,
      no: polymarket.no,
      volume24h: polymarket.volume24h,
      liquidity: polymarket.liquidity,
      title: polymarket.title,
      slug: polymarket.slug,
    } : null,
    kalshi: kalshi ? {
      yes: kalshi.yes,
      no: kalshi.no,
      volume24h: kalshi.volume24h,
      ticker: kalshi.ticker,
      title: kalshi.title,
    } : null,
    metaculus,
  };

  const sentiment: SignalResponse['sentiment'] = {
    twitter,
    reddit,
    tiktok,
  };

  return {
    type: 'signal',
    market,
    timestamp: new Date().toISOString(),
    odds,
    sentiment,
    signals: {
      arbitrage: buildArbitrageSignal(odds),
      sentimentDivergence: buildSentimentDivergence(odds, sentiment),
      volumeSpike: buildVolumeSpike(odds),
    },
  };
}

async function listPolymarketSeeds(limit = 12): Promise<string[]> {
  const events = await fetchJson(POLYMARKET_EVENTS_URL) as any[];
  if (!Array.isArray(events)) return [];

  return events
    .sort((a, b) => asNumber(b?.volume24hr) - asNumber(a?.volume24hr))
    .slice(0, limit)
    .map((event) => typeof event?.slug === 'string' ? event.slug : '')
    .filter((slug) => slug.length > 0);
}

export async function getArbitrageOpportunities(marketHint?: string): Promise<ArbitrageResponse> {
  const seeds = marketHint ? [marketHint] : await listPolymarketSeeds(8);

  const opportunities: ArbitrageResponse['opportunities'] = [];

  for (const seed of seeds.slice(0, 5)) {
    const signal = await getPredictionSignal(seed);
    if (signal.signals.arbitrage.detected) {
      opportunities.push({
        market: seed,
        spread: signal.signals.arbitrage.spread,
        direction: signal.signals.arbitrage.direction,
        confidence: signal.signals.arbitrage.confidence,
      });
    }
  }

  opportunities.sort((a, b) => b.spread - a.spread);

  return {
    type: 'arbitrage',
    timestamp: new Date().toISOString(),
    opportunities,
  };
}

export async function getTopicSentiment(topic: string): Promise<SentimentResponse> {
  const [twitter, reddit, tiktok] = await Promise.all([
    getTwitterSentiment(topic),
    getRedditSentiment(topic),
    getTikTokSignal(topic),
  ]);

  const combinedBullish = Number((((twitter.positive + reddit.positive) / 2)).toFixed(3));
  const combinedBearish = Number((((twitter.negative + reddit.negative) / 2)).toFixed(3));
  const confidence = Number(Math.min(0.95, (twitter.volume + reddit.volume) / 30).toFixed(2));

  return {
    type: 'sentiment',
    topic,
    timestamp: new Date().toISOString(),
    sentiment: { twitter, reddit, tiktok },
    summary: {
      combinedBullish,
      combinedBearish,
      confidence,
    },
  };
}

export async function getTrendingPredictionSignals(limit = 5): Promise<TrendingResponse> {
  const seeds = await listPolymarketSeeds(Math.max(limit * 2, 8));
  const markets: TrendingResponse['markets'] = [];

  for (const market of seeds.slice(0, Math.max(limit * 2, 8))) {
    const signal = await getPredictionSignal(market);
    const marketYes = signal.odds.polymarket?.yes ?? signal.odds.kalshi?.yes ?? 0.5;
    const socialBullish = Number((((signal.sentiment.twitter.positive + signal.sentiment.reddit.positive) / 2)).toFixed(3));
    const divergence = Number((socialBullish - marketYes).toFixed(3));

    const direction: 'underpriced' | 'overpriced' | 'aligned' =
      Math.abs(divergence) < 0.05 ? 'aligned' : divergence > 0 ? 'underpriced' : 'overpriced';

    markets.push({
      market,
      yesOdds: marketYes,
      socialBullish,
      divergence,
      signal: direction,
    });
  }

  markets.sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));

  return {
    type: 'trending',
    timestamp: new Date().toISOString(),
    markets: markets.slice(0, limit),
  };
}
