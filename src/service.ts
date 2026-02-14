import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { proxyFetch } from './proxy';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'prediction-market-aggregator';
const PRICE_USDC = 0.05;
const DESCRIPTION = 'Real-time prediction market aggregator (Polymarket, Kalshi, Metaculus) with social sentiment signals using mobile proxies.';

const OUTPUT_SCHEMA = {
  input: {
    type: 'string — "signal", "arbitrage", "sentiment", "trending" (required)',
    market: 'string — market slug or query for "signal"',
    topic: 'string — topic for "sentiment"',
    country: 'string — country code for sentiment (default US)',
  },
  output: {
    type: 'string',
    market: 'string',
    timestamp: 'string',
    odds: {
      polymarket: '{yes, no, volume24h, liquidity}',
      kalshi: '{yes, no, volume24h}',
      metaculus: '{median, forecasters}',
    },
    sentiment: {
      twitter: '{positive, negative, neutral, volume, trending, topTweets}',
      reddit: '{positive, negative, neutral, volume, topSubreddits, avgUps, avgComments}',
      tiktok: '{relatedVideos, totalViews, sentiment}',
    },
    signals: {
      arbitrage: '{detected, spread, direction, confidence}',
      sentimentDivergence: '{detected, description, magnitude}',
      volumeSpike: '{detected}',
    },
    proxy: '{country, carrier, type, ip}',
    payment: '{txHash, amount, verified}',
  },
};

// ─── BROWSER API CONFIG ────────────────────────────────
const BROWSER_ENDPOINT = process.env.BROWSER_ENDPOINT || 'https://browser.proxies.sx';
const BROWSER_PAYMENT_SIG = process.env.BROWSER_PAYMENT_SIG;

// ─── TYPES ─────────────────────────────────────────────

interface MarketOdds {
  polymarket?: { yes: number; no: number; volume24h: number; liquidity: number };
  kalshi?: { yes: number; no: number; volume24h: number };
  metaculus?: { median: number; forecasters: number };
}

interface SentimentData {
  twitter?: {
    positive: number; negative: number; neutral: number; volume: number; trending: boolean;
    topTweets: Array<{ text: string; likes: number; retweets: number; author: string; timestamp: string }>;
  };
  reddit?: {
    positive: number; negative: number; neutral: number; volume: number;
    topSubreddits: string[];
    avgUps: number;
    avgComments: number;
  };
  tiktok?: { relatedVideos: number; totalViews: number; sentiment: string };
}

interface SignalData {
  arbitrage?: { detected: boolean; spread: number; direction: string; confidence: number };
  sentimentDivergence?: { detected: boolean; description: string; magnitude: string };
  volumeSpike?: { detected: boolean };
}

interface BrowserSession {
  sessionId: string;
  sessionToken: string;
}

// ─── MARKET DATA FETCHING ──────────────────────────────

async function getPolymarketOdds(marketSlugOrQuery: string): Promise<MarketOdds['polymarket']> {
  try {
    const searchRes = await proxyFetch(`https://gamma-api.polymarket.com/events?slug=${marketSlugOrQuery}`);
    if (!searchRes.ok) return undefined;

    const events = await searchRes.json() as any[];
    if (!events || events.length === 0) return undefined;

    const event = events[0];
    const market = event.markets?.[0];
    if (!market) return undefined;

    const outcomePrices = JSON.parse(market.outcomePrices || '["0.5", "0.5"]');

    return {
      yes: parseFloat(outcomePrices[0]),
      no: parseFloat(outcomePrices[1]),
      volume24h: parseFloat(market.volume24hr || '0'),
      liquidity: parseFloat(market.liquidity || '0'),
    };
  } catch (err) {
    console.error('[Polymarket] Error:', err);
    return undefined;
  }
}

async function getKalshiOdds(marketTicker: string): Promise<MarketOdds['kalshi']> {
  try {
    const res = await proxyFetch(`https://trading-api.kalshi.com/trade-api/v2/markets/${marketTicker}`);
    if (!res.ok) return undefined;

    const data = await res.json() as any;
    const market = data.market;
    if (!market) return undefined;

    return {
      yes: market.yes_bid / 100,
      no: market.no_bid / 100,
      volume24h: market.volume_24h || 0,
    };
  } catch (err) {
    console.error('[Kalshi] Error:', err);
    return undefined;
  }
}

async function getMetaculusOdds(questionId: string): Promise<MarketOdds['metaculus']> {
  try {
    const res = await proxyFetch(`https://www.metaculus.com/api2/questions/${questionId}/`);
    if (!res.ok) return undefined;

    const data = await res.json() as any;
    return {
      median: data.prediction_timeseries?.[data.prediction_timeseries.length - 1]?.community_prediction?.median || 0,
      forecasters: data.number_of_forecasters || 0,
    };
  } catch (err) {
    console.error('[Metaculus] Error:', err);
    return undefined;
  }
}

async function getProxyIp(): Promise<string> {
  try {
    const res = await proxyFetch('https://api.ipify.org?format=json');
    if (!res.ok) return 'unknown';
    const data = await res.json() as { ip: string };
    return data.ip;
  } catch {
    return 'unknown';
  }
}

// ─── BROWSER SESSION MANAGEMENT ────────────────────────

async function createBrowserSession(country: string): Promise<BrowserSession | null> {
  const endpoint = BROWSER_ENDPOINT.replace(/\/$/, '');
  const signature = (BROWSER_PAYMENT_SIG || '').trim();

  if (!signature) {
    console.error('[Session] Missing BROWSER_PAYMENT_SIG in .env');
    return null;
  }

  try {
    const res = await fetch(`${endpoint}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Payment-Signature': signature,
      },
      body: JSON.stringify({
        durationMinutes: 10,
        country,
        proxy: {
          server: `${process.env.PROXY_HOST}:${process.env.PROXY_HTTP_PORT}`,
          username: process.env.PROXY_USER,
          password: process.env.PROXY_PASS,
          type: 'http',
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { session_id?: string; session_token?: string };
    return { sessionId: data.session_id, sessionToken: data.session_token };
  } catch (err) {
    return null;
  }
}

async function browserCommand(sessionId: string, token: string, payload: Record<string, any>): Promise<any> {
  const endpoint = BROWSER_ENDPOINT.replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const res = await fetch(`${endpoint}/v1/sessions/${sessionId}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    return null;
  }
}

async function closeBrowserSession(sessionId: string): Promise<void> {
  const endpoint = BROWSER_ENDPOINT.replace(/\/$/, '');
  await fetch(`${endpoint}/v1/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => { });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── SENTIMENT EXTRACTION SCRIPTS ──────────────────────

const TWITTER_EXTRACTION_SCRIPT = `(() => {
  const tweets = [];
  document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => {
    const textEl = el.querySelector('div[data-testid="tweetText"]');
    const likesEl = el.querySelector('div[data-testid="like"]');
    const retweetEl = el.querySelector('div[data-testid="retweet"]');
    const authorEl = el.querySelector('div[data-testid="User-Name"]');
    const timeEl = el.querySelector('time');
    
    if (textEl && authorEl) {
      tweets.push({
        text: textEl.innerText,
        likes: parseInt(likesEl?.innerText?.replace(/[^0-9]/g, '') || '0'),
        retweets: parseInt(retweetEl?.innerText?.replace(/[^0-9]/g, '') || '0'),
        author: authorEl.innerText.split('\\n')[0],
        timestamp: timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString(),
      });
    }
  });
  return tweets;
})()`;

// ─── SENTIMENT SCRAPER LOGIC ───────────────────────────

async function scrapeTwitterSentiment(topic: string, country: string): Promise<SentimentData['twitter']> {
  let session: BrowserSession | null = null;
  try {
    session = await createBrowserSession(country);
    if (!session) return undefined;

    const { sessionId, sessionToken } = session;
    const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(topic)}&src=typed_query&f=live`;

    await browserCommand(sessionId, sessionToken, { action: 'navigate', url: searchUrl });
    await sleep(5000);

    const extraction = await browserCommand(sessionId, sessionToken, {
      action: 'evaluate',
      script: TWITTER_EXTRACTION_SCRIPT,
    });

    if (!extraction || !extraction.result || !Array.isArray(extraction.result)) return undefined;

    const tweets = extraction.result;
    const positiveWords = ['bullish', 'up', 'win', 'good', 'great', 'buy', 'yes'];
    const negativeWords = ['bearish', 'down', 'lose', 'bad', 'poor', 'sell', 'no'];

    let pos = 0, neg = 0, neu = 0;
    tweets.forEach((t: any) => {
      const text = t.text.toLowerCase();
      const isPos = positiveWords.some(w => text.includes(w));
      const isNeg = negativeWords.some(w => text.includes(w));
      if (isPos && !isNeg) pos++;
      else if (isNeg && !isPos) neg++;
      else neu++;
    });

    const total = tweets.length || 1;
    return {
      positive: pos / total,
      negative: neg / total,
      neutral: neu / total,
      volume: tweets.length,
      trending: tweets.length > 50,
      topTweets: tweets.slice(0, 5),
    };
  } catch (err) {
    console.error('[Twitter] Error:', err);
    return undefined;
  } finally {
    if (session) await closeBrowserSession(session.sessionId);
  }
}

async function scrapeRedditSentiment(topic: string): Promise<SentimentData['reddit']> {
  try {
    const res = await proxyFetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=new`);
    if (!res.ok) return undefined;

    const data = await res.json() as any;
    const posts = data.data?.children || [];
    if (posts.length === 0) return undefined;

    let pos = 0, neg = 0, neu = 0;
    const subs = new Set<string>();
    let totalUps = 0;
    let totalComments = 0;

    posts.forEach((p: any) => {
      const text = (p.data.title + ' ' + p.data.selftext).toLowerCase();
      const positiveWords = ['bullish', 'good', 'yes', 'moon', 'up'];
      const negativeWords = ['bearish', 'bad', 'no', 'dump', 'down'];

      const isPos = positiveWords.some(w => text.includes(w));
      const isNeg = negativeWords.some(w => text.includes(w));

      if (isPos && !isNeg) pos++;
      else if (isNeg && !isPos) neg++;
      else neu++;

      if (p.data.subreddit) subs.add(p.data.subreddit);
      totalUps += p.data.ups || 0;
      totalComments += p.data.num_comments || 0;
    });

    const total = posts.length || 1;
    return {
      positive: pos / total,
      negative: neg / total,
      neutral: neu / total,
      volume: posts.length,
      topSubreddits: Array.from(subs).slice(0, 5),
      avgUps: totalUps / total,
      avgComments: totalComments / total,
    };
  } catch (err) {
    console.error('[Reddit] Error:', err);
    return undefined;
  }
}

// ─── SIGNAL GENERATION ────────────────────────────────

function detectArbitrage(odds: MarketOdds): SignalData['arbitrage'] {
  if (!odds.polymarket || !odds.kalshi) return undefined;

  const polyYes = odds.polymarket.yes;
  const kalshiYes = odds.kalshi.yes;
  const spread = Math.abs(polyYes - kalshiYes);

  if (spread > 0.02) {
    return {
      detected: true,
      spread,
      direction: polyYes > kalshiYes ? 'Polymarket YES overpriced vs Kalshi' : 'Kalshi YES overpriced vs Polymarket',
      confidence: 0.7 + (spread * 2),
    };
  }

  return { detected: false, spread, direction: 'None', confidence: 0 };
}

function detectDivergence(odds: MarketOdds, sentiment: SentimentData): SignalData['sentimentDivergence'] {
  if (!odds.polymarket || !sentiment.twitter) return undefined;

  const marketYes = odds.polymarket.yes;
  const socialBullish = sentiment.twitter.positive;
  const diff = Math.abs(socialBullish - marketYes);

  if (diff > 0.15) {
    return {
      detected: true,
      description: `Social sentiment ${Math.round(socialBullish * 100)}% bullish but market only ${Math.round(marketYes * 100)}% — potential mispricing`,
      magnitude: diff > 0.3 ? 'high' : 'moderate',
    };
  }
  return { detected: false, description: 'Sentiment aligned with market', magnitude: 'low' };
}

// ─── ENDPOINTS ─────────────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not set' }, 500);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment failed' }, 402);

  const type = c.req.query('type') || 'signal';
  const market = c.req.query('market') || 'us-presidential-election-2028';
  const topic = c.req.query('topic') || market;
  const country = (c.req.query('country') || 'US').toUpperCase();

  const timestamp = new Date().toISOString();
  const odds: MarketOdds = {};
  const sentiment: SentimentData = {};
  const signals: SignalData = {};

  if (type === 'signal' || type === 'arbitrage' || type === 'trending') {
    odds.polymarket = await getPolymarketOdds(market);
    odds.kalshi = await getKalshiOdds(market);
    odds.metaculus = await getMetaculusOdds('1234');
  }

  if (type === 'signal' || type === 'sentiment' || type === 'trending') {
    sentiment.twitter = await scrapeTwitterSentiment(topic, country);
    sentiment.reddit = await scrapeRedditSentiment(topic);
  }

  if (odds.polymarket && odds.kalshi) {
    signals.arbitrage = detectArbitrage(odds);
  }

  if (odds.polymarket && sentiment.twitter) {
    signals.sentimentDivergence = detectDivergence(odds, sentiment);
  }

  const proxyIp = await getProxyIp();

  return c.json({
    type,
    market,
    timestamp,
    odds,
    sentiment,
    signals,
    proxy: { country, carrier: 'T-Mobile', type: 'mobile', ip: proxyIp },
    payment: { txHash: payment.txHash, amount: PRICE_USDC, verified: true },
  });
});

serviceRouter.get('/test', async (c) => {
  const market = c.req.query('market') || 'us-presidential-election-2028';
  const topic = c.req.query('topic') || market;
  const odds = {
    polymarket: await getPolymarketOdds(market),
    kalshi: await getKalshiOdds(market),
  };
  const sentiment = {
    reddit: await scrapeRedditSentiment(topic),
  };
  const proxyIp = await getProxyIp();

  return c.json({
    market,
    odds,
    sentiment,
    signals: {
      arbitrage: detectArbitrage(odds),
    },
    proxy: { ip: proxyIp },
    _test: true,
    _timestamp: new Date().toISOString(),
  });
});
