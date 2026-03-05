import { proxyFetch, getProxy } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

export interface OddsSnapshot {
  yes: number | null;
  no: number | null;
  volume24h: number;
  liquidity: number;
}

export interface MetaculusSnapshot {
  median: number | null;
  forecasters: number;
}

export interface TweetSignal {
  text: string;
  likes: number;
  retweets: number;
  author: string;
  timestamp: string;
}

export interface TwitterSentiment {
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  trending: boolean;
  topTweets: TweetSignal[];
}

export interface RedditSentiment {
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  topSubreddits: string[];
}

export interface TikTokSentiment {
  relatedVideos: number;
  totalViews: number;
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'unknown';
}

export interface SignalBundle {
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
  };
}

export interface FullSignalResponse {
  type: 'signal';
  market: string;
  timestamp: string;
  odds: {
    polymarket: OddsSnapshot;
    kalshi: OddsSnapshot;
    metaculus: MetaculusSnapshot;
  };
  sentiment: {
    twitter: TwitterSentiment;
    reddit: RedditSentiment;
    tiktok: TikTokSentiment;
  };
  signals: SignalBundle;
  proxy: {
    country: string;
    carrier: string;
    type: 'mobile' | 'unknown';
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
    polymarketYes: number | null;
    kalshiYes: number | null;
  }>;
}

export interface SentimentResponse {
  type: 'sentiment';
  topic: string;
  country: string;
  timestamp: string;
  sentiment: {
    twitter: TwitterSentiment;
    reddit: RedditSentiment;
    tiktok: TikTokSentiment;
  };
}

export interface TrendingResponse {
  type: 'trending';
  timestamp: string;
  markets: Array<{
    market: string;
    polymarketYes: number | null;
    kalshiYes: number | null;
    spread: number;
    divergenceDetected: boolean;
    volume24h: number;
  }>;
}

interface PolymarketMarket {
  question?: string;
  slug?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  volume24hr?: number;
  volume24hrClob?: number;
  liquidityNum?: number;
}

interface KalshiEvent {
  event_ticker?: string;
  title?: string;
  sub_title?: string;
}

interface KalshiMarket {
  ticker?: string;
  title?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume_24h?: number;
  liquidity?: number;
}

const DEFAULT_MARKET = 'bitcoin-etf-approval';
const DEFAULT_TOPIC = 'bitcoin etf';
const DEFAULT_COUNTRY = 'US';

const POSITIVE_WORDS = [
  'bullish', 'surge', 'gain', 'rise', 'up', 'buy', 'long', 'inflow', 'approval', 'rally',
  'adoption', 'beat', 'green', 'record high', 'strong', 'optimistic', 'outperform',
];

const NEGATIVE_WORDS = [
  'bearish', 'drop', 'fall', 'down', 'sell', 'short', 'outflow', 'rejected', 'dump', 'red',
  'fear', 'crash', 'weak', 'concern', 'risk-off', 'decline', 'liquidation',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseJsonArray<T>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((x) => x.length > 2);
}

function overlapScore(target: string, query: string): number {
  const targetTokens = new Set(tokenize(target));
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  let score = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) score += 1;
  }
  return score / queryTokens.length;
}

function normalizeProb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value > 1) return clamp(value / 100, 0, 1);
  return clamp(value, 0, 1);
}

function inferSentimentLabel(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score > 0.12) return 'bullish';
  if (score < -0.12) return 'bearish';
  return 'neutral';
}

function relativeToIso(relative: string): string {
  const now = Date.now();
  const lower = relative.toLowerCase();

  const min = lower.match(/(\d+)\s+minute/);
  if (min) return new Date(now - toNumber(min[1]) * 60_000).toISOString();

  const hour = lower.match(/(\d+)\s+hour/);
  if (hour) return new Date(now - toNumber(hour[1]) * 3_600_000).toISOString();

  const day = lower.match(/(\d+)\s+day/);
  if (day) return new Date(now - toNumber(day[1]) * 86_400_000).toISOString();

  return new Date().toISOString();
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function parseCountFromBlock(block: string, icon: string): number {
  const pattern = new RegExp(`${icon}<\\/i>\\s*<span><ins><\\/ins>\\s*([0-9,]+)`, 'i');
  const found = block.match(pattern);
  return found ? toNumber(found[1], 0) : 0;
}

function scoreTextSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const w of POSITIVE_WORDS) {
    if (lower.includes(w)) score += 1;
  }
  for (const w of NEGATIVE_WORDS) {
    if (lower.includes(w)) score -= 1;
  }
  return score;
}

function aggregateSentiment(texts: string[]): { positive: number; negative: number; neutral: number; rawScore: number } {
  if (texts.length === 0) {
    return { positive: 0, negative: 0, neutral: 1, rawScore: 0 };
  }

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let totalScore = 0;

  for (const text of texts) {
    const score = scoreTextSentiment(text);
    totalScore += score;
    if (score > 0) positive += 1;
    else if (score < 0) negative += 1;
    else neutral += 1;
  }

  const n = texts.length;
  return {
    positive: positive / n,
    negative: negative / n,
    neutral: neutral / n,
    rawScore: n ? totalScore / n : 0,
  };
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

async function fetchWithSocialProxy(url: string, init: RequestInit = {}): Promise<string> {
  const allowDirectFallback = (process.env.ALLOW_DIRECT_SOCIAL_FALLBACK || 'true').toLowerCase() === 'true';
  const browserHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const viaProxy = await proxyFetch(url, {
      ...init,
      maxRetries: 1,
      timeoutMs: 20_000,
      headers: {
        ...browserHeaders,
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (!viaProxy.ok) {
      throw new Error(`Proxy request failed with status ${viaProxy.status}`);
    }

    return await viaProxy.text();
  } catch (error) {
    if (!allowDirectFallback) throw error;

    const direct = await fetch(url, {
      ...init,
      headers: {
        ...browserHeaders,
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (!direct.ok) {
      throw new Error(`Direct request failed with status ${direct.status}`);
    }

    return await direct.text();
  }
}

function chooseBestByQuery<T>(items: T[], query: string, extractText: (item: T) => string): T | null {
  if (items.length === 0) return null;

  let best = items[0];
  let bestScore = overlapScore(extractText(items[0]), query);

  for (let i = 1; i < items.length; i += 1) {
    const score = overlapScore(extractText(items[i]), query);
    if (score > bestScore) {
      best = items[i];
      bestScore = score;
    }
  }

  return best;
}

async function fetchPolymarket(query: string): Promise<OddsSnapshot> {
  const res = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200');
  if (!res.ok) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const markets = (await res.json()) as PolymarketMarket[];
  if (!Array.isArray(markets) || markets.length === 0) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const best = chooseBestByQuery(markets, query, (m) => `${m.question || ''} ${m.slug || ''}`) || markets[0];

  const outcomes = parseJsonArray<string>(best.outcomes);
  const prices = parseJsonArray<string>(best.outcomePrices).map((x) => toNumber(x, NaN));

  let yes: number | null = null;
  let no: number | null = null;

  const yesIndex = outcomes.findIndex((x) => x.toLowerCase() === 'yes');
  const noIndex = outcomes.findIndex((x) => x.toLowerCase() === 'no');

  if (yesIndex >= 0 && Number.isFinite(prices[yesIndex])) yes = normalizeProb(prices[yesIndex]);
  if (noIndex >= 0 && Number.isFinite(prices[noIndex])) no = normalizeProb(prices[noIndex]);

  if (yes === null && no !== null) yes = round(1 - no, 4);
  if (no === null && yes !== null) no = round(1 - yes, 4);

  return {
    yes,
    no,
    volume24h: toNumber(best.volume24hr ?? best.volume24hrClob, 0),
    liquidity: toNumber(best.liquidityNum, 0),
  };
}

async function fetchKalshi(query: string): Promise<OddsSnapshot> {
  const eventsRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/events?limit=200');
  if (!eventsRes.ok) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const eventsPayload = (await eventsRes.json()) as { events?: KalshiEvent[] };
  const events = Array.isArray(eventsPayload.events) ? eventsPayload.events : [];
  if (events.length === 0) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const chosenEvent = chooseBestByQuery(events, query, (e) => `${e.title || ''} ${e.sub_title || ''}`) || events[0];
  if (!chosenEvent.event_ticker) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const marketsRes = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${encodeURIComponent(chosenEvent.event_ticker)}&limit=20`);
  if (!marketsRes.ok) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const marketsPayload = (await marketsRes.json()) as { markets?: KalshiMarket[] };
  const markets = Array.isArray(marketsPayload.markets) ? marketsPayload.markets : [];
  if (markets.length === 0) {
    return { yes: null, no: null, volume24h: 0, liquidity: 0 };
  }

  const chosen = chooseBestByQuery(markets, query, (m) => `${m.title || ''} ${m.ticker || ''}`) || markets[0];

  const yesBid = normalizeProb(toNumber(chosen.yes_bid, NaN));
  const yesAsk = normalizeProb(toNumber(chosen.yes_ask, NaN));
  const noBid = normalizeProb(toNumber(chosen.no_bid, NaN));
  const noAsk = normalizeProb(toNumber(chosen.no_ask, NaN));
  const lastPrice = normalizeProb(toNumber(chosen.last_price, NaN));

  let yes: number | null = null;
  let no: number | null = null;

  if (yesBid !== null && yesAsk !== null && yesBid > 0 && yesAsk > 0) {
    yes = round((yesBid + yesAsk) / 2, 4);
  } else if (lastPrice !== null && lastPrice > 0) {
    yes = round(lastPrice, 4);
  }

  if (noBid !== null && noAsk !== null && noBid > 0 && noAsk > 0) {
    no = round((noBid + noAsk) / 2, 4);
  } else if (yes !== null) {
    no = round(1 - yes, 4);
  }

  return {
    yes,
    no,
    volume24h: toNumber(chosen.volume_24h, 0),
    liquidity: toNumber(chosen.liquidity, 0),
  };
}

async function fetchMetaculus(query: string): Promise<MetaculusSnapshot> {
  const res = await fetch('https://www.metaculus.com/api2/questions/?limit=200');
  if (!res.ok) {
    return { median: null, forecasters: 0 };
  }

  const payload = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length === 0) {
    return { median: null, forecasters: 0 };
  }

  const best = chooseBestByQuery(results, query, (r) => String(r.title || '')) || results[0];

  const possibleMedians = [
    (best.community_prediction as Record<string, unknown> | null)?.q2,
    ((best.community_prediction as Record<string, unknown> | null)?.full as Record<string, unknown> | undefined)?.q2,
    (((best.aggregations as Record<string, unknown> | null)?.recency_weighted as Record<string, unknown> | undefined)?.latest as Record<string, unknown> | undefined)?.centers,
  ];

  let median: number | null = null;
  for (const value of possibleMedians) {
    if (value && typeof value === 'object' && 'full_q2' in value) {
      const candidate = normalizeProb(toNumber((value as Record<string, unknown>).full_q2, NaN));
      if (candidate !== null) {
        median = round(candidate, 4);
        break;
      }
    }
    if (typeof value === 'number') {
      const candidate = normalizeProb(value);
      if (candidate !== null) {
        median = round(candidate, 4);
        break;
      }
    }
  }

  const forecasters = toNumber(best.number_of_forecasters ?? best.prediction_count, 0);
  return { median, forecasters };
}

function parseTwstalkerTweets(html: string, limit: number): TweetSignal[] {
  const blocks = html.split('<div class="activity-posts">').slice(1);
  const tweets: TweetSignal[] = [];

  for (const block of blocks) {
    const textMatch = block.match(/<div class="activity-descp">\s*<p>([\s\S]*?)<\/p>/i);
    const authorMatch = block.match(/<span>\s*@([^<\s]+)\s*<\/span>/i);
    const relativeTimeMatch = block.match(/status\/\d+">([^<]+)<\/a>/i);

    const text = textMatch ? htmlToText(textMatch[1]) : '';
    const author = authorMatch ? `@${authorMatch[1].trim()}` : '@unknown';
    const relative = relativeTimeMatch ? relativeTimeMatch[1].trim() : 'now';

    if (!text) continue;

    tweets.push({
      text,
      likes: parseCountFromBlock(block, 'fa-heart'),
      retweets: parseCountFromBlock(block, 'fa-retweet'),
      author,
      timestamp: relativeToIso(relative),
    });

    if (tweets.length >= limit) break;
  }

  return tweets;
}

function parseTwstalkerMarkdown(markdown: string, limit: number): TweetSignal[] {
  const tweets: TweetSignal[] = [];
  const seen = new Set<string>();
  const pattern = /\[@([^\]]+)\]\(https:\/\/twstalker\.com\/[^)]+\)\s+([^\n]+)/g;

  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(markdown)) !== null) {
    const author = `@${match[1].trim().replace(/^@+/, '')}`;
    const text = htmlToText(match[2]).replace(/\s+/g, ' ').trim();

    if (!text || seen.has(text)) continue;
    seen.add(text);

    tweets.push({
      text,
      likes: 0,
      retweets: 0,
      author,
      timestamp: new Date().toISOString(),
    });

    if (tweets.length >= limit) break;
  }

  return tweets;
}

async function fetchTwitterSentiment(topic: string): Promise<TwitterSentiment> {
  const url = `https://twstalker.com/search/${encodeURIComponent(topic)}`;
  let tweets: TweetSignal[] = [];

  try {
    const html = await fetchWithSocialProxy(url, { method: 'GET' });
    tweets = parseTwstalkerTweets(html, 20);
  } catch {
    // Fallback when direct HTML is blocked by anti-bot middleware.
    try {
      const jinaRes = await fetch(`https://r.jina.ai/http://twstalker.com/search/${encodeURIComponent(topic)}`);
      if (jinaRes.ok) {
        const markdown = await jinaRes.text();
        tweets = parseTwstalkerMarkdown(markdown, 20);
      }
    } catch {
      tweets = [];
    }
  }

  const scores = aggregateSentiment(tweets.map((t) => t.text));

  return {
    positive: round(scores.positive, 4),
    negative: round(scores.negative, 4),
    neutral: round(scores.neutral, 4),
    volume: tweets.length,
    trending: tweets.length >= 10,
    topTweets: tweets.slice(0, 10),
  };
}

async function fetchRedditSentiment(topic: string): Promise<RedditSentiment> {
  const url = `https://old.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=new&limit=30`;
  let raw = '';

  try {
    raw = await fetchWithSocialProxy(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  } catch {
    try {
      const jina = await fetch(`https://r.jina.ai/http://old.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=new&limit=30`);
      if (jina.ok) raw = await jina.text();
    } catch {
      raw = '';
    }
  }

  let parsed: { data?: { children?: Array<{ data?: Record<string, unknown> }> } } | null = null;
  try {
    parsed = JSON.parse(raw) as { data?: { children?: Array<{ data?: Record<string, unknown> }> } };
  } catch {
    parsed = null;
  }

  const children = parsed?.data?.children || [];
  const texts: string[] = [];
  const subredditCounts = new Map<string, number>();

  for (const child of children) {
    const data = child.data || {};
    const title = String(data.title || '');
    const body = String(data.selftext || '');
    const subreddit = String(data.subreddit || '').trim();

    if (title || body) texts.push(`${title} ${body}`.trim());
    if (subreddit) subredditCounts.set(subreddit, (subredditCounts.get(subreddit) || 0) + 1);
  }

  const scores = aggregateSentiment(texts);
  const topSubreddits = [...subredditCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  return {
    positive: round(scores.positive, 4),
    negative: round(scores.negative, 4),
    neutral: round(scores.neutral, 4),
    volume: texts.length,
    topSubreddits,
  };
}

async function fetchTikTokSentiment(topic: string): Promise<TikTokSentiment> {
  const compactTopic = topic.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  if (!compactTopic) return { relatedVideos: 0, totalViews: 0, sentiment: 'unknown' };

  const url = `https://www.tiktok.com/tag/${encodeURIComponent(compactTopic)}`;

  try {
    const html = await fetchWithSocialProxy(url, { method: 'GET' });

    const viewMatches = [...html.matchAll(/"playCount"\s*:\s*"?(\d+)"?/g)]
      .map((m) => toNumber(m[1], 0))
      .filter((n) => n > 0);

    const totalViews = viewMatches.reduce((sum, n) => sum + n, 0);
    const relatedVideos = viewMatches.length;

    const textSignal = scoreTextSentiment(htmlToText(html).slice(0, 10_000));

    return {
      relatedVideos,
      totalViews,
      sentiment: relatedVideos === 0 ? 'unknown' : inferSentimentLabel(textSignal),
    };
  } catch {
    return {
      relatedVideos: 0,
      totalViews: 0,
      sentiment: 'unknown',
    };
  }
}

function getProxyMeta(): { country: string; carrier: string; type: 'mobile' | 'unknown' } {
  try {
    const proxy = getProxy();
    return {
      country: proxy.country || DEFAULT_COUNTRY,
      carrier: process.env.PROXY_CARRIER || 'unknown',
      type: 'mobile',
    };
  } catch {
    return {
      country: DEFAULT_COUNTRY,
      carrier: 'unknown',
      type: 'unknown',
    };
  }
}

function buildSignals(
  polymarketYes: number | null,
  kalshiYes: number | null,
  sentiment: { twitter: TwitterSentiment; reddit: RedditSentiment; tiktok: TikTokSentiment },
  volume24h: number,
): SignalBundle {
  let spread = 0;
  let arbitrageDetected = false;
  let direction = 'No clear cross-market spread';

  if (polymarketYes !== null && kalshiYes !== null) {
    spread = round(Math.abs(polymarketYes - kalshiYes), 4);
    arbitrageDetected = spread >= 0.02;

    if (arbitrageDetected) {
      direction = polymarketYes > kalshiYes
        ? 'Polymarket YES overpriced vs Kalshi'
        : 'Kalshi YES overpriced vs Polymarket';
    }
  }

  const socialBullish = round(
    (sentiment.twitter.positive + sentiment.reddit.positive + (sentiment.tiktok.sentiment === 'bullish' ? 1 : 0)) / 3,
    4,
  );

  const marketAnchor = polymarketYes ?? kalshiYes ?? 0.5;
  const divergence = round(socialBullish - marketAnchor, 4);
  const divergenceMagnitude = Math.abs(divergence);
  const divergenceDetected = divergenceMagnitude >= 0.08;

  const magnitude: 'low' | 'moderate' | 'high' = divergenceMagnitude >= 0.2
    ? 'high'
    : divergenceMagnitude >= 0.12
      ? 'moderate'
      : 'low';

  const divergenceDescription = divergenceDetected
    ? `Social sentiment ${(socialBullish * 100).toFixed(0)}% bullish vs market ${(marketAnchor * 100).toFixed(0)}% — potential ${divergence > 0 ? 'underpricing' : 'overpricing'}`
    : 'Social sentiment broadly aligned with market odds';

  const confidenceBase = arbitrageDetected ? 0.58 + spread * 3.5 : 0.45 + divergenceMagnitude * 2.2;
  const confidence = round(clamp(confidenceBase, 0.35, 0.95), 4);

  return {
    arbitrage: {
      detected: arbitrageDetected,
      spread,
      direction,
      confidence,
    },
    sentimentDivergence: {
      detected: divergenceDetected,
      description: divergenceDescription,
      magnitude,
    },
    volumeSpike: {
      detected: volume24h >= 1_000_000,
    },
  };
}

export async function buildSignalPayload(input: { market?: string; topic?: string; country?: string }): Promise<FullSignalResponse> {
  const market = (input.market || DEFAULT_MARKET).trim();
  const topic = (input.topic || market || DEFAULT_TOPIC).replace(/[-_]+/g, ' ').trim();
  const country = (input.country || DEFAULT_COUNTRY).trim().toUpperCase();

  const [polymarket, kalshi, metaculus, twitter, reddit, tiktok] = await Promise.all([
    fetchPolymarket(topic),
    fetchKalshi(topic),
    fetchMetaculus(topic),
    fetchTwitterSentiment(topic),
    fetchRedditSentiment(topic),
    fetchTikTokSentiment(topic),
  ]);

  const totalVolume = round(polymarket.volume24h + kalshi.volume24h, 4);
  const signals = buildSignals(polymarket.yes, kalshi.yes, { twitter, reddit, tiktok }, totalVolume);

  return {
    type: 'signal',
    market,
    timestamp: new Date().toISOString(),
    odds: {
      polymarket,
      kalshi,
      metaculus,
    },
    sentiment: {
      twitter,
      reddit,
      tiktok,
    },
    signals,
    proxy: {
      ...getProxyMeta(),
      country,
    },
  };
}

export async function buildArbitragePayload(input: { topic?: string; country?: string }): Promise<ArbitrageResponse> {
  const signal = await buildSignalPayload({
    market: input.topic || DEFAULT_MARKET,
    topic: input.topic || DEFAULT_TOPIC,
    country: input.country || DEFAULT_COUNTRY,
  });

  return {
    type: 'arbitrage',
    timestamp: signal.timestamp,
    opportunities: [
      {
        market: signal.market,
        spread: signal.signals.arbitrage.spread,
        direction: signal.signals.arbitrage.direction,
        confidence: signal.signals.arbitrage.confidence,
        polymarketYes: signal.odds.polymarket.yes,
        kalshiYes: signal.odds.kalshi.yes,
      },
    ],
  };
}

export async function buildSentimentPayload(input: { topic?: string; country?: string }): Promise<SentimentResponse> {
  const topic = (input.topic || DEFAULT_TOPIC).trim();
  const country = (input.country || DEFAULT_COUNTRY).trim().toUpperCase();

  const [twitter, reddit, tiktok] = await Promise.all([
    fetchTwitterSentiment(topic),
    fetchRedditSentiment(topic),
    fetchTikTokSentiment(topic),
  ]);

  return {
    type: 'sentiment',
    topic,
    country,
    timestamp: new Date().toISOString(),
    sentiment: {
      twitter,
      reddit,
      tiktok,
    },
  };
}

export async function buildTrendingPayload(input: { country?: string }): Promise<TrendingResponse> {
  const country = (input.country || DEFAULT_COUNTRY).trim().toUpperCase();

  const res = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=25');
  if (!res.ok) {
    return {
      type: 'trending',
      timestamp: new Date().toISOString(),
      markets: [],
    };
  }

  const markets = (await res.json()) as PolymarketMarket[];
  const ranked = [...markets]
    .sort((a, b) => toNumber(b.volume24hr, 0) - toNumber(a.volume24hr, 0))
    .slice(0, 3);

  const outputs: TrendingResponse['markets'] = [];

  for (const m of ranked) {
    const query = (m.question || m.slug || DEFAULT_TOPIC).replace(/[-_]+/g, ' ');
    const signal = await buildSignalPayload({
      market: m.slug || m.question || DEFAULT_MARKET,
      topic: query,
      country,
    });

    outputs.push({
      market: signal.market,
      polymarketYes: signal.odds.polymarket.yes,
      kalshiYes: signal.odds.kalshi.yes,
      spread: signal.signals.arbitrage.spread,
      divergenceDetected: signal.signals.sentimentDivergence.detected,
      volume24h: round(signal.odds.polymarket.volume24h + signal.odds.kalshi.volume24h, 4),
    });
  }

  return {
    type: 'trending',
    timestamp: new Date().toISOString(),
    markets: outputs,
  };
}
