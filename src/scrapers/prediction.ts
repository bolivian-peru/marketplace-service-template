import { proxyFetch } from './proxy';

// ─── Prediction Market Signal Aggregator ───
// Combines Polymarket + Kalshi odds with social sentiment

interface MarketOdds {
  platform: string;
  yes: number;
  no: number;
  volume24h?: number;
  liquidity?: number;
}

interface SocialSentiment {
  platform: string;
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  topPosts: Array<{ text: string; url: string; engagement: number }>;
}

interface TradingSignal {
  type: 'arbitrage' | 'sentiment_divergence' | 'volume_spike';
  detected: boolean;
  description: string;
  confidence: number;
  direction?: string;
  spread?: number;
}

interface PredictionSignal {
  market: string;
  timestamp: string;
  odds: Record<string, MarketOdds>;
  sentiment: Record<string, SocialSentiment>;
  signals: TradingSignal[];
}

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';

// Polymarket uses public CLOB API
async function getPolymarketOdds(query: string): Promise<MarketOdds | null> {
  try {
    const resp = await proxyFetch(`https://gamma-api.polymarket.com/markets?closed=false&limit=5&_q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': MOBILE_UA }
    });
    const markets = await resp.json() as any[];
    if (!markets || !markets.length) return null;
    const market = markets[0];
    const yes = parseFloat(market.outcomePrices?.[0] || market.bestAsk || '0.5');
    return {
      platform: 'polymarket',
      yes: Math.round(yes * 100) / 100,
      no: Math.round((1 - yes) * 100) / 100,
      volume24h: parseFloat(market.volume24hr || '0'),
      liquidity: parseFloat(market.liquidityNum || '0')
    };
  } catch { return null; }
}

// Kalshi has a public API
async function getKalshiOdds(query: string): Promise<MarketOdds | null> {
  try {
    const resp = await proxyFetch(`https://api.elections.kalshi.com/v1/events?status=open&limit=5`, {
      headers: { 'User-Agent': MOBILE_UA }
    });
    const data = await resp.json() as any;
    const events = data?.events || [];
    // Find matching event
    const match = events.find((e: any) => e.title?.toLowerCase().includes(query.toLowerCase().split(' ')[0]));
    if (!match) return null;
    const yes = (match.yes_ask + match.yes_bid) / 2 / 100 || 0.5;
    return {
      platform: 'kalshi',
      yes: Math.round(yes * 100) / 100,
      no: Math.round((1 - yes) * 100) / 100,
      volume24h: match.volume_24h || 0
    };
  } catch { return null; }
}

// Metaculus is public
async function getMetaculusOdds(query: string): Promise<{ median: number; forecasters: number } | null> {
  try {
    const resp = await proxyFetch(`https://www.metaculus.com/api2/questions/?search=${encodeURIComponent(query)}&status=open&limit=5`, {
      headers: { 'User-Agent': MOBILE_UA }
    });
    const data = await resp.json() as any;
    const q = data?.results?.[0];
    if (!q) return null;
    return {
      median: q.community_prediction?.full?.q2 || 0.5,
      forecasters: q.number_of_forecasters || 0
    };
  } catch { return null; }
}

// Social sentiment via mobile proxy
async function getRedditSentiment(topic: string): Promise<SocialSentiment> {
  try {
    const resp = await proxyFetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=hot&t=week&limit=20`, {
      headers: { 'User-Agent': MOBILE_UA }
    });
    const data = await resp.json() as any;
    const posts = data?.data?.children || [];
    let pos = 0, neg = 0, neu = 0;
    const topPosts: SocialSentiment['topPosts'] = [];

    for (const p of posts) {
      const text = `${p.data?.title} ${p.data?.selftext || ''}`.toLowerCase();
      const posWords = ['bullish', 'moon', 'win', 'yes', 'likely', 'confident', 'strong', 'up'];
      const negWords = ['bearish', 'crash', 'no', 'unlikely', 'weak', 'down', 'sell', 'dump'];
      const pCount = posWords.filter(w => text.includes(w)).length;
      const nCount = negWords.filter(w => text.includes(w)).length;
      if (pCount > nCount) pos++; else if (nCount > pCount) neg++; else neu++;

      if (topPosts.length < 5) topPosts.push({ text: p.data?.title?.substring(0, 100), url: `https://reddit.com${p.data?.permalink}`, engagement: p.data?.score + p.data?.num_comments });
    }

    const total = pos + neg + neu || 1;
    return { platform: 'reddit', positive: Math.round(pos/total*100), negative: Math.round(neg/total*100), neutral: Math.round(neu/total*100), volume: posts.length, topPosts };
  } catch { return { platform: 'reddit', positive: 33, negative: 33, neutral: 34, volume: 0, topPosts: [] }; }
}

async function getTwitterSentiment(topic: string): Promise<SocialSentiment> {
  try {
    const tokenResp = await proxyFetch('https://api.twitter.com/1.1/guest/activate.json', { method: 'POST', headers: { 'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA' } });
    const tokenData = await tokenResp.json() as any;
    const gt = tokenData?.guest_token;
    if (!gt) return { platform: 'twitter', positive: 0, negative: 0, neutral: 0, volume: 0, topPosts: [] };

    const resp = await proxyFetch(`https://api.twitter.com/1.1/search/tweets.json?q=${encodeURIComponent(topic)}&result_type=popular&count=20`, {
      headers: { 'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA', 'X-Guest-Token': gt, 'User-Agent': MOBILE_UA }
    });
    const data = await resp.json() as any;
    const tweets = data?.statuses || [];
    let pos = 0, neg = 0, neu = 0;
    const topPosts: SocialSentiment['topPosts'] = [];

    for (const t of tweets) {
      const text = (t.text || '').toLowerCase();
      const pWords = ['bullish', 'moon', 'win', 'yes', 'likely', 'confident', 'up', 'buy'];
      const nWords = ['bearish', 'crash', 'no', 'unlikely', 'down', 'sell', 'dump', 'fail'];
      const pCount = pWords.filter(w => text.includes(w)).length;
      const nCount = nWords.filter(w => text.includes(w)).length;
      if (pCount > nCount) pos++; else if (nCount > pCount) neg++; else neu++;
      if (topPosts.length < 5) topPosts.push({ text: t.text?.substring(0, 100), url: `https://twitter.com/${t.user?.screen_name}/status/${t.id_str}`, engagement: (t.favorite_count || 0) + (t.retweet_count || 0) });
    }

    const total = pos + neg + neu || 1;
    return { platform: 'twitter', positive: Math.round(pos/total*100), negative: Math.round(neg/total*100), neutral: Math.round(neu/total*100), volume: tweets.length, topPosts };
  } catch { return { platform: 'twitter', positive: 0, negative: 0, neutral: 0, volume: 0, topPosts: [] }; }
}

function generateSignals(odds: Record<string, MarketOdds>, sentiment: Record<string, SocialSentiment>): TradingSignal[] {
  const signals: TradingSignal[] = [];

  // Arbitrage detection
  const platforms = Object.values(odds);
  if (platforms.length >= 2) {
    const maxYes = Math.max(...platforms.map(p => p.yes));
    const minYes = Math.min(...platforms.map(p => p.yes));
    const spread = Math.round((maxYes - minYes) * 100) / 100;
    const highP = platforms.find(p => p.yes === maxYes);
    const lowP = platforms.find(p => p.yes === minYes);
    signals.push({
      type: 'arbitrage', detected: spread > 0.03, confidence: Math.min(spread * 10, 1),
      description: spread > 0.03 ? `${highP?.platform} YES overpriced vs ${lowP?.platform} by ${(spread*100).toFixed(0)}%` : 'No significant arbitrage detected',
      direction: spread > 0.03 ? `Sell YES on ${highP?.platform}, Buy YES on ${lowP?.platform}` : undefined, spread
    });
  }

  // Sentiment divergence
  const allSentiment = Object.values(sentiment);
  if (allSentiment.length > 0 && platforms.length > 0) {
    const avgSentimentBullish = allSentiment.reduce((s, v) => s + v.positive, 0) / allSentiment.length;
    const avgMarketYes = platforms.reduce((s, p) => s + p.yes * 100, 0) / platforms.length;
    const divergence = Math.abs(avgSentimentBullish - avgMarketYes);
    signals.push({
      type: 'sentiment_divergence', detected: divergence > 10, confidence: Math.min(divergence / 30, 1),
      description: divergence > 10 ? `Social sentiment ${avgSentimentBullish.toFixed(0)}% bullish but markets at ${avgMarketYes.toFixed(0)}% — potential ${avgSentimentBullish > avgMarketYes ? 'underpricing' : 'overpricing'}` : 'Sentiment aligns with market pricing'
    });
  }

  // Volume spike
  const totalSentimentVolume = allSentiment.reduce((s, v) => s + v.volume, 0);
  signals.push({
    type: 'volume_spike', detected: totalSentimentVolume > 30,
    description: totalSentimentVolume > 30 ? `High social volume: ${totalSentimentVolume} posts detected` : 'Normal social volume',
    confidence: Math.min(totalSentimentVolume / 50, 1)
  });

  return signals;
}

export async function getPredictionSignal(market: string): Promise<PredictionSignal> {
  // Fetch odds and sentiment in parallel
  const [polymarket, kalshi, metaculus, redditSent, twitterSent] = await Promise.all([
    getPolymarketOdds(market),
    getKalshiOdds(market),
    getMetaculusOdds(market),
    getRedditSentiment(market),
    getTwitterSentiment(market)
  ]);

  const odds: Record<string, MarketOdds> = {};
  if (polymarket) odds.polymarket = polymarket;
  if (kalshi) odds.kalshi = kalshi;
  if (metaculus) odds.metaculus = { platform: 'metaculus', yes: metaculus.median, no: 1 - metaculus.median };

  const sentiment: Record<string, SocialSentiment> = {};
  if (redditSent.volume > 0) sentiment.reddit = redditSent;
  if (twitterSent.volume > 0) sentiment.twitter = twitterSent;

  return { market, timestamp: new Date().toISOString(), odds, sentiment, signals: generateSignals(odds, sentiment) };
}

export async function getArbitrage(): Promise<any> {
  // Check popular markets for arbitrage
  const topics = ['bitcoin', 'presidential election', 'AI regulation', 'interest rates', 'recession'];
  const opportunities: any[] = [];

  for (const topic of topics) {
    const [poly, kalshi] = await Promise.all([getPolymarketOdds(topic), getKalshiOdds(topic)]);
    if (poly && kalshi) {
      const spread = Math.abs(poly.yes - kalshi.yes);
      if (spread > 0.03) {
        opportunities.push({ topic, polymarket_yes: poly.yes, kalshi_yes: kalshi.yes, spread: Math.round(spread * 100) / 100 });
      }
    }
  }

  return { opportunities, timestamp: new Date().toISOString(), markets_checked: topics.length };
}
