/**
 * Prediction Market Signal Aggregator — Scraper (Bounty #55)
 * ──────────────────────────────────────────────────────────
 * Aggregates odds from Polymarket, Kalshi, Metaculus (public APIs)
 * + sentiment from Twitter/X, Reddit via Proxies.sx mobile proxies.
 */

import { proxyFetch, getProxy, getProxyExitIp } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface MarketOdds {
  polymarket?: {
    yes: number;
    no: number;
    volume24h: number;
    liquidity: number;
    slug: string;
    title: string;
  };
  kalshi?: {
    yes: number;
    no: number;
    volume24h: number;
    ticker: string;
    title: string;
  };
  metaculus?: {
    median: number;
    forecasters: number;
    id: number;
    title: string;
  };
}

export interface SentimentData {
  twitter?: {
    positive: number;
    negative: number;
    neutral: number;
    volume: number;
    trending: boolean;
    topTweets: Array<{
      text: string;
      likes: number;
      retweets: number;
      author: string;
      timestamp: string;
    }>;
  };
  reddit?: {
    positive: number;
    negative: number;
    neutral: number;
    volume: number;
    topSubreddits: string[];
    topPosts: Array<{
      title: string;
      score: number;
      comments: number;
      subreddit: string;
      url: string;
    }>;
  };
}

export interface Signal {
  arbitrage: {
    detected: boolean;
    spread?: number;
    direction?: string;
    confidence?: number;
  };
  sentimentDivergence: {
    detected: boolean;
    description?: string;
    magnitude?: string;
  };
  volumeSpike: {
    detected: boolean;
    description?: string;
  };
}

export interface PredictionMarketResult {
  type: string;
  market?: string;
  topic?: string;
  timestamp: string;
  odds?: MarketOdds;
  sentiment?: SentimentData;
  signals?: Signal;
  arbitrageOpportunities?: ArbitrageOpportunity[];
  trendingMarkets?: TrendingMarket[];
  proxy: { country: string; carrier: string; type: string; ip?: string };
}

export interface ArbitrageOpportunity {
  event: string;
  polymarketYes: number;
  kalshiYes: number;
  spread: number;
  direction: string;
  confidence: number;
}

export interface TrendingMarket {
  title: string;
  platform: string;
  volume24h: number;
  currentOdds: number;
  sentimentScore?: number;
  category: string;
}

// ─── POLYMARKET ─────────────────────────────────────

const POLYMARKET_API = 'https://clob.polymarket.com';
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';

export async function fetchPolymarketMarkets(query: string): Promise<any[]> {
  try {
    const url = `${POLYMARKET_GAMMA}/markets?closed=false&limit=20&order=volume24hr&ascending=false`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    // Filter by query keyword
    const q = query.toLowerCase();
    return data.filter((m: any) =>
      m.question?.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.slug?.toLowerCase().includes(q)
    ).slice(0, 5);
  } catch (e) {
    console.error('[POLYMARKET] Error:', e);
    return [];
  }
}

export async function fetchPolymarketBySlug(slug: string): Promise<any | null> {
  try {
    const url = `${POLYMARKET_GAMMA}/markets?slug=${encodeURIComponent(slug)}&limit=1`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any[];
    return data[0] || null;
  } catch {
    return null;
  }
}

export async function fetchPolymarketActive(): Promise<any[]> {
  try {
    const url = `${POLYMARKET_GAMMA}/markets?closed=false&limit=50&order=volume24hr&ascending=false`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return await res.json() as any[];
  } catch {
    return [];
  }
}

function parsePolymarketOdds(market: any): MarketOdds['polymarket'] | undefined {
  if (!market) return undefined;
  const outcomePrices = market.outcomePrices ? JSON.parse(market.outcomePrices) : [];
  const yes = parseFloat(outcomePrices[0] || '0');
  const no = parseFloat(outcomePrices[1] || '0');
  return {
    yes,
    no,
    volume24h: parseFloat(market.volume24hr || '0'),
    liquidity: parseFloat(market.liquidityClob || '0'),
    slug: market.slug || '',
    title: market.question || market.title || '',
  };
}

// ─── KALSHI ─────────────────────────────────────────

const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

export async function fetchKalshiMarkets(query: string): Promise<any[]> {
  try {
    const url = `${KALSHI_API}/markets?status=open&limit=20`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const markets = data.markets || [];
    const q = query.toLowerCase();
    return markets.filter((m: any) =>
      m.title?.toLowerCase().includes(q) ||
      m.subtitle?.toLowerCase().includes(q) ||
      m.ticker?.toLowerCase().includes(q)
    ).slice(0, 5);
  } catch {
    return [];
  }
}

export async function fetchKalshiActive(): Promise<any[]> {
  try {
    const url = `${KALSHI_API}/markets?status=open&limit=50`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.markets || [];
  } catch {
    return [];
  }
}

function parseKalshiOdds(market: any): MarketOdds['kalshi'] | undefined {
  if (!market) return undefined;
  const yes = (market.last_price || market.yes_bid || 0) / 100;
  const no = 1 - yes;
  return {
    yes,
    no,
    volume24h: market.volume_24h || market.volume || 0,
    ticker: market.ticker || '',
    title: market.title || '',
  };
}

// ─── METACULUS ───────────────────────────────────────

const METACULUS_API = 'https://www.metaculus.com/api2';

export async function fetchMetaculusQuestions(query: string): Promise<any[]> {
  try {
    const url = `${METACULUS_API}/questions/?search=${encodeURIComponent(query)}&status=open&limit=10&type=forecast&order_by=-activity`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.results || [];
  } catch {
    return [];
  }
}

function parseMetaculusOdds(question: any): MarketOdds['metaculus'] | undefined {
  if (!question) return undefined;
  const community = question.community_prediction?.full;
  const median = community?.q2 || community?.median || 0;
  return {
    median,
    forecasters: question.number_of_forecasters || 0,
    id: question.id || 0,
    title: question.title || '',
  };
}

// ─── TWITTER SENTIMENT (via mobile proxy) ───────────

export async function scrapeTwitterSentiment(topic: string, country: string = 'US'): Promise<SentimentData['twitter']> {
  try {
    const query = encodeURIComponent(topic);
    // Use mobile Twitter search (nitter instances or Twitter mobile web)
    const url = `https://x.com/search?q=${query}&f=top`;

    const res = await proxyFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': country === 'DE' ? 'de-DE,de;q=0.9,en;q=0.5' : 'en-US,en;q=0.9',
      },
      timeoutMs: 20_000,
    });

    const html = await res.text();

    // Parse tweets from HTML/JSON embedded data
    const tweets = extractTweetsFromHtml(html, topic);
    const sentimentScores = analyzeSentiment(tweets.map(t => t.text));

    return {
      positive: sentimentScores.positive,
      negative: sentimentScores.negative,
      neutral: sentimentScores.neutral,
      volume: tweets.length,
      trending: html.includes('trending') || tweets.length > 10,
      topTweets: tweets.slice(0, 5),
    };
  } catch (e) {
    console.error('[TWITTER] Scrape error:', e);
    // Return empty sentiment on failure
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

function extractTweetsFromHtml(html: string, topic: string): Array<{ text: string; likes: number; retweets: number; author: string; timestamp: string }> {
  const tweets: Array<{ text: string; likes: number; retweets: number; author: string; timestamp: string }> = [];

  // Try to find JSON data embedded in Twitter's page
  // Twitter embeds initial data in __NEXT_DATA__ or window.__INITIAL_STATE__
  const jsonMatches = html.match(/"full_text":"([^"]+)"/g) || [];
  for (const match of jsonMatches.slice(0, 20)) {
    const text = match.replace('"full_text":"', '').replace('"', '');
    if (text.length > 10) {
      tweets.push({
        text: decodeUnicode(text),
        likes: 0,
        retweets: 0,
        author: '@unknown',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Also try to extract from data-testid tweet elements or aria labels
  const tweetTexts = html.match(/data-testid="tweetText"[^>]*>([^<]+)</g) || [];
  for (const t of tweetTexts.slice(0, 20)) {
    const text = t.replace(/data-testid="tweetText"[^>]*>/, '');
    if (text.length > 10 && !tweets.find(tw => tw.text === text)) {
      tweets.push({
        text,
        likes: 0,
        retweets: 0,
        author: '@unknown',
        timestamp: new Date().toISOString(),
      });
    }
  }

  return tweets;
}

function decodeUnicode(str: string): string {
  return str.replace(/\\u[\dA-Fa-f]{4}/g, (m) =>
    String.fromCharCode(parseInt(m.slice(2), 16))
  );
}

// ─── REDDIT SENTIMENT (via mobile proxy) ────────────

export async function scrapeRedditSentiment(topic: string, country: string = 'US'): Promise<SentimentData['reddit']> {
  try {
    const query = encodeURIComponent(topic);
    const url = `https://www.reddit.com/search.json?q=${query}&sort=relevance&t=week&limit=25`;

    const res = await proxyFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
      },
      timeoutMs: 20_000,
    });

    const data = await res.json() as any;
    const posts = data?.data?.children || [];

    const topPosts = posts.slice(0, 10).map((p: any) => ({
      title: p.data?.title || '',
      score: p.data?.score || 0,
      comments: p.data?.num_comments || 0,
      subreddit: p.data?.subreddit || '',
      url: `https://reddit.com${p.data?.permalink || ''}`,
    }));

    // Aggregate subreddits
    const subredditCounts = new Map<string, number>();
    for (const p of posts) {
      const sub = p.data?.subreddit;
      if (sub) subredditCounts.set(sub, (subredditCounts.get(sub) || 0) + 1);
    }
    const topSubreddits = [...subredditCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    // Sentiment from titles + selftext
    const texts = posts.map((p: any) => `${p.data?.title || ''} ${p.data?.selftext || ''}`);
    const sentimentScores = analyzeSentiment(texts);

    return {
      positive: sentimentScores.positive,
      negative: sentimentScores.negative,
      neutral: sentimentScores.neutral,
      volume: posts.length,
      topSubreddits,
      topPosts,
    };
  } catch (e) {
    console.error('[REDDIT] Scrape error:', e);
    return {
      positive: 0,
      negative: 0,
      neutral: 1,
      volume: 0,
      topSubreddits: [],
      topPosts: [],
    };
  }
}

// ─── SENTIMENT ANALYSIS (keyword-based) ─────────────

const POSITIVE_WORDS = new Set([
  'bullish', 'up', 'moon', 'pump', 'gain', 'profit', 'win', 'yes', 'likely',
  'positive', 'great', 'amazing', 'surge', 'rally', 'soar', 'boost', 'strong',
  'confident', 'optimistic', 'support', 'buy', 'long', 'agree', 'absolutely',
  'definitely', 'certain', 'guaranteed', 'inevitable', 'obvious', 'clearly',
  'love', 'excellent', 'fantastic', 'boom', 'rocket', 'ath', 'high',
]);

const NEGATIVE_WORDS = new Set([
  'bearish', 'down', 'crash', 'dump', 'loss', 'fail', 'no', 'unlikely',
  'negative', 'terrible', 'awful', 'plunge', 'drop', 'fall', 'weak',
  'worried', 'pessimistic', 'sell', 'short', 'disagree', 'never',
  'impossible', 'doubt', 'scam', 'fraud', 'overpriced', 'bubble',
  'hate', 'worst', 'disaster', 'collapse', 'fear', 'panic', 'risk',
]);

function analyzeSentiment(texts: string[]): { positive: number; negative: number; neutral: number } {
  if (texts.length === 0) return { positive: 0, negative: 0, neutral: 1 };

  let positive = 0;
  let negative = 0;
  let neutral = 0;

  for (const text of texts) {
    const words = text.toLowerCase().split(/\s+/);
    let pos = 0, neg = 0;
    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (POSITIVE_WORDS.has(clean)) pos++;
      if (NEGATIVE_WORDS.has(clean)) neg++;
    }
    if (pos > neg) positive++;
    else if (neg > pos) negative++;
    else neutral++;
  }

  const total = positive + negative + neutral;
  return {
    positive: Math.round((positive / total) * 100) / 100,
    negative: Math.round((negative / total) * 100) / 100,
    neutral: Math.round((neutral / total) * 100) / 100,
  };
}

// ─── SIGNAL GENERATION ──────────────────────────────

function generateSignals(odds: MarketOdds, sentiment: SentimentData): Signal {
  const signals: Signal = {
    arbitrage: { detected: false },
    sentimentDivergence: { detected: false },
    volumeSpike: { detected: false },
  };

  // Arbitrage detection: compare Polymarket vs Kalshi
  if (odds.polymarket && odds.kalshi) {
    const spread = Math.abs(odds.polymarket.yes - odds.kalshi.yes);
    if (spread > 0.03) {
      const higher = odds.polymarket.yes > odds.kalshi.yes ? 'Polymarket' : 'Kalshi';
      const lower = higher === 'Polymarket' ? 'Kalshi' : 'Polymarket';
      signals.arbitrage = {
        detected: true,
        spread: Math.round(spread * 1000) / 1000,
        direction: `${higher} YES overpriced vs ${lower}`,
        confidence: Math.min(0.95, 0.5 + spread * 5),
      };
    }
  }

  // Sentiment divergence: compare social sentiment vs market odds
  const avgOdds = calculateAverageOdds(odds);
  if (avgOdds !== null && sentiment.twitter) {
    const socialBullish = sentiment.twitter.positive;
    if (Math.abs(socialBullish - avgOdds) > 0.1) {
      const overUnder = socialBullish > avgOdds ? 'underpriced' : 'overpriced';
      const magnitude = Math.abs(socialBullish - avgOdds) > 0.2 ? 'strong' : 'moderate';
      signals.sentimentDivergence = {
        detected: true,
        description: `Social sentiment ${Math.round(socialBullish * 100)}% bullish but market at ${Math.round(avgOdds * 100)}% — potential ${overUnder}`,
        magnitude,
      };
    }
  }

  // Volume spike: check if 24h volume is unusually high
  if (odds.polymarket && odds.polymarket.volume24h > 500_000) {
    signals.volumeSpike = {
      detected: true,
      description: `Polymarket 24h volume $${(odds.polymarket.volume24h / 1_000_000).toFixed(1)}M — elevated activity`,
    };
  }

  return signals;
}

function calculateAverageOdds(odds: MarketOdds): number | null {
  const values: number[] = [];
  if (odds.polymarket) values.push(odds.polymarket.yes);
  if (odds.kalshi) values.push(odds.kalshi.yes);
  if (odds.metaculus) values.push(odds.metaculus.median);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── MAIN FUNCTIONS ─────────────────────────────────

export async function getSignal(market: string, country: string = 'US'): Promise<PredictionMarketResult> {
  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch odds from all platforms in parallel
  const [polyMarkets, kalshiMarkets, metaculusQuestions] = await Promise.all([
    fetchPolymarketMarkets(market),
    fetchKalshiMarkets(market),
    fetchMetaculusQuestions(market),
  ]);

  const odds: MarketOdds = {};
  if (polyMarkets[0]) odds.polymarket = parsePolymarketOdds(polyMarkets[0]);
  if (kalshiMarkets[0]) odds.kalshi = parseKalshiOdds(kalshiMarkets[0]);
  if (metaculusQuestions[0]) odds.metaculus = parseMetaculusOdds(metaculusQuestions[0]);

  // Fetch sentiment via mobile proxy
  const [twitterSentiment, redditSentiment] = await Promise.all([
    scrapeTwitterSentiment(market, country),
    scrapeRedditSentiment(market, country),
  ]);

  const sentiment: SentimentData = {
    twitter: twitterSentiment,
    reddit: redditSentiment,
  };

  const signals = generateSignals(odds, sentiment);

  return {
    type: 'signal',
    market,
    timestamp: new Date().toISOString(),
    odds,
    sentiment,
    signals,
    proxy: {
      country: proxyConfig.country,
      carrier: 'Mobile',
      type: 'mobile',
      ip: proxyIp,
    },
  };
}

export async function getArbitrage(): Promise<PredictionMarketResult> {
  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  // Fetch top markets from both platforms
  const [polyMarkets, kalshiMarkets] = await Promise.all([
    fetchPolymarketActive(),
    fetchKalshiActive(),
  ]);

  const opportunities: ArbitrageOpportunity[] = [];

  // Try to match markets by keyword similarity
  for (const pm of polyMarkets.slice(0, 30)) {
    const pmTitle = (pm.question || pm.title || '').toLowerCase();
    const pmOdds = parsePolymarketOdds(pm);
    if (!pmOdds) continue;

    for (const km of kalshiMarkets.slice(0, 30)) {
      const kmTitle = (km.title || '').toLowerCase();
      const kmOdds = parseKalshiOdds(km);
      if (!kmOdds) continue;

      // Simple keyword matching (share 3+ words)
      const pmWords: Set<string> = new Set(pmTitle.split(/\s+/).filter((w: string) => w.length > 3));
      const kmWords: Set<string> = new Set(kmTitle.split(/\s+/).filter((w: string) => w.length > 3));
      const shared = Array.from(pmWords).filter((w: string) => kmWords.has(w)).length;

      if (shared >= 3) {
        const spread = Math.abs(pmOdds.yes - kmOdds.yes);
        if (spread > 0.02) {
          const higher = pmOdds.yes > kmOdds.yes ? 'Polymarket' : 'Kalshi';
          opportunities.push({
            event: pmOdds.title || kmOdds.title || pmTitle,
            polymarketYes: pmOdds.yes,
            kalshiYes: kmOdds.yes,
            spread: Math.round(spread * 1000) / 1000,
            direction: `${higher} YES higher`,
            confidence: Math.min(0.9, 0.4 + spread * 5 + shared * 0.05),
          });
        }
      }
    }
  }

  // Sort by spread descending
  opportunities.sort((a, b) => b.spread - a.spread);

  return {
    type: 'arbitrage',
    timestamp: new Date().toISOString(),
    arbitrageOpportunities: opportunities.slice(0, 20),
    proxy: {
      country: proxyConfig.country,
      carrier: 'Mobile',
      type: 'mobile',
      ip: proxyIp,
    },
  };
}

export async function getSentiment(topic: string, country: string = 'US'): Promise<PredictionMarketResult> {
  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  const [twitterSentiment, redditSentiment] = await Promise.all([
    scrapeTwitterSentiment(topic, country),
    scrapeRedditSentiment(topic, country),
  ]);

  return {
    type: 'sentiment',
    topic,
    timestamp: new Date().toISOString(),
    sentiment: {
      twitter: twitterSentiment,
      reddit: redditSentiment,
    },
    proxy: {
      country,
      carrier: 'Mobile',
      type: 'mobile',
      ip: proxyIp,
    },
  };
}

export async function getTrending(): Promise<PredictionMarketResult> {
  const proxyConfig = getProxy();
  const proxyIp = await getProxyExitIp();

  const polyMarkets = await fetchPolymarketActive();
  const trending: TrendingMarket[] = polyMarkets.slice(0, 20).map((m: any) => {
    const odds = parsePolymarketOdds(m);
    return {
      title: m.question || m.title || 'Unknown',
      platform: 'polymarket',
      volume24h: parseFloat(m.volume24hr || '0'),
      currentOdds: odds?.yes || 0,
      category: m.groupSlug || 'other',
    };
  });

  // Sort by volume
  trending.sort((a, b) => b.volume24h - a.volume24h);

  return {
    type: 'trending',
    timestamp: new Date().toISOString(),
    trendingMarkets: trending,
    proxy: {
      country: proxyConfig.country,
      carrier: 'Mobile',
      type: 'mobile',
      ip: proxyIp,
    },
  };
}
