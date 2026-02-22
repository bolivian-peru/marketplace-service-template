/**
 * Service Router — Multi-Service Aggregator
 * 
 * Exposes:
 *   GET /api/run       (Google Maps Lead Generator)
 *   GET /api/details   (Google Maps Place details)
 *   GET /api/jobs      (Job Market Intelligence)
 *   GET /api/reviews/* (Google Reviews & Business Data)
 *   GET /api/predictions (Prediction Market Aggregator)
 *   GET /api/research  (Trend Intelligence Research)
 *   GET /api/trending  (Cross-platform trending topics)
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { proxyFetch, getProxy } from './proxy';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';

export const serviceRouter = new Hono();

// ─── TREND INTELLIGENCE ROUTES (Bounty #70) ─────────
serviceRouter.route('/research', researchRouter);
serviceRouter.route('/trending', trendingRouter);

// ─── CONFIGURATION ─────────────────────────────────────

const JOB_DESCRIPTION = 'Job Market Intelligence API (Indeed/LinkedIn): title, company, location, salary, date, link, remote + proxy exit metadata.';
const PREDICTION_DESCRIPTION = 'Real-time prediction market aggregator (Polymarket, Kalshi, Metaculus) with social sentiment signals using mobile proxies.';
const MAPS_PRICE_USDC = 0.005;
const MAPS_DESCRIPTION = 'Extract structured business data from Google Maps: name, address, phone, website, email, hours, ratings, reviews, categories, and geocoordinates. Search by category + location with full pagination.';

const MAPS_OUTPUT_SCHEMA = {
  input: {
    query: 'string — Search query/category (required)',
    location: 'string — Location to search (required)',
    limit: 'number — Max results to return (default: 20, max: 100)',
    pageToken: 'string — Pagination token for next page (optional)',
  },
  output: {
    businesses: [{
      name: 'string',
      address: 'string | null',
      phone: 'string | null',
      website: 'string | null',
      email: 'string | null',
      hours: 'object | null',
      rating: 'number | null',
      reviewCount: 'number | null',
      categories: 'string[]',
      coordinates: '{ latitude, longitude } | null',
      placeId: 'string | null',
      priceLevel: 'string | null',
      permanentlyClosed: 'boolean',
    }],
    totalFound: 'number',
    nextPageToken: 'string | null',
    searchQuery: 'string',
    location: 'string',
    proxy: '{ country: string, type: "mobile" }',
    payment: '{ txHash, network, amount, settled }',
  },
};

const PREDICTION_OUTPUT_SCHEMA = {
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
    proxy: '{country, ip, type:"mobile"}',
    payment: '{txHash, amount, verified}',
  },
};

// ─── TYPES ─────────────────────────────────────────────

interface MarketOdds {
  polymarket?: { yes: number | null; no: number | null; volume24h: number | null; liquidity: number | null } | null;
  kalshi?: { yes: number | null; no: number | null; volume24h: number | null } | null;
  metaculus?: { median: number | null; forecasters: number | null } | null;
}

interface SentimentData {
  twitter?: {
    positive: number | null; negative: number | null; neutral: number | null; volume: number | null; trending: boolean | null;
    topTweets: Array<{ text: string; likes: number; retweets: number; author: string; timestamp: string }> | null;
  } | null;
  reddit?: {
    positive: number | null; negative: number | null; neutral: number | null; volume: number | null;
    topSubreddits: string[] | null;
    avgUps: number | null;
    avgComments: number | null;
  } | null;
  tiktok?: { relatedVideos: number | null; totalViews: number | null; sentiment: string | null } | null;
}

interface SignalData {
  arbitrage?: { detected: boolean; spread: number | null; direction: string | null; confidence: number | null } | null;
  sentimentDivergence?: { detected: boolean; description: string | null; magnitude: string | null } | null;
  volumeSpike?: { detected: boolean } | null;
}

// ─── UTILS ──────────────────────────────────────────────

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── PROXY RATE LIMITING ──────────────────────────────
const proxyUsage = new Map<string, { count: number; resetAt: number }>();
const PROXY_RATE_LIMIT = 20;

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = proxyUsage.get(ip);
  if (!entry || now > entry.resetAt) {
    proxyUsage.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= PROXY_RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of proxyUsage) {
    if (now > entry.resetAt) proxyUsage.delete(ip);
  }
}, 300_000);

// ─── GOOGLE MAPS LEADS API ────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', MAPS_DESCRIPTION, MAPS_PRICE_USDC, walletAddress, MAPS_OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, MAPS_PRICE_USDC);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  const location = c.req.query('location');
  const limitParam = c.req.query('limit');
  const pageToken = c.req.query('pageToken');

  if (!query || !location) {
    return c.json({ error: 'Missing required parameters: query and location' }, 400);
  }

  const limit = Math.min(parseInt(limitParam || '20') || 20, 100);
  const startIndex = pageToken ? parseInt(pageToken) || 0 : 0;

  try {
    const proxy = getProxy();
    const result = await scrapeGoogleMaps(query, location, limit, startIndex);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      ...result,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Maps scrape failed', message: err.message }, 502);
  }
});

serviceRouter.get('/details', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/details', 'Get detailed business info by Place ID', MAPS_PRICE_USDC, walletAddress, {
        input: { placeId: 'string — Google Place ID (required)' },
        output: { business: 'BusinessData — Full business details' },
      }),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, MAPS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed' }, 402);

  const placeId = c.req.query('placeId');
  if (!placeId) return c.json({ error: 'Missing required parameter: placeId' }, 400);

  try {
    const proxy = getProxy();
    const url = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
    const response = await proxyFetch(url, { timeoutMs: 45_000 });
    if (!response.ok) throw new Error(`Failed to fetch place details: ${response.status}`);

    const html = await response.text();
    const business = extractDetailedBusiness(html, placeId);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      business,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch business details', message: err.message }, 502);
  }
});

// ─── JOB SCRAPER LOGIC ─────────────────────────────────

serviceRouter.get('/jobs', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  const price = 0.005;

  if (!payment) {
    return c.json(
      build402Response(
        '/api/jobs',
        JOB_DESCRIPTION,
        price,
        walletAddress,
        {
          input: {
            query: 'string (required) — job title / keywords (e.g., "Software Engineer")',
            location: 'string (optional, default: "Remote")',
            platform: '"indeed" | "linkedin" | "both" (optional, default: "indeed")',
            limit: 'number (optional, default: 20, max: 50)'
          },
          output: {
            results: 'JobListing[]',
            meta: {
              proxy: '{ ip, country, host, type:"mobile" }',
              platform: 'indeed|linkedin|both',
              limit: 'number'
            },
          },
        },
      ),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, price);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query') || 'Software Engineer';
  const location = c.req.query('location') || 'Remote';
  const platform = (c.req.query('platform') || 'indeed').toLowerCase();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const proxy = getProxy();
    const ip = await getProxyIp();

    let results: JobListing[] = [];
    if (platform === 'both') {
      const [a, b] = await Promise.all([
        scrapeIndeed(query, location, limit),
        scrapeLinkedIn(query, location, limit),
      ]);
      results = [...a, ...b];
    } else if (platform === 'linkedin') {
      results = await scrapeLinkedIn(query, location, limit);
    } else {
      results = await scrapeIndeed(query, location, limit);
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      results,
      meta: {
        platform,
        limit,
        proxy: {
          ip,
          country: proxy.country,
          host: proxy.host,
          type: 'mobile',
        },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Scrape failed', message: err?.message || String(err) }, 502);
  }
});

// ─── GOOGLE REVIEWS & BUSINESS DATA API ─────────────

const REVIEWS_PRICE_USDC = 0.02;
const BUSINESS_PRICE_USDC = 0.01;
const SUMMARY_PRICE_USDC = 0.005;

serviceRouter.get('/reviews/search', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reviews/search', 'Search businesses by query + location', BUSINESS_PRICE_USDC, walletAddress, {
      input: { query: 'string (required)', location: 'string (required)', limit: 'number (optional, default: 10)' },
      output: { query: 'string', location: 'string', businesses: 'BusinessInfo[]', totalFound: 'number' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, BUSINESS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const query = c.req.query('query');
  const location = c.req.query('location');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10') || 10, 1), 20);

  if (!query || !location) return c.json({ error: 'Missing required parameters' }, 400);

  try {
    const proxy = getProxy();
    const result = await searchBusinesses(query, location, limit);
    return c.json({
      ...result,
      meta: { proxy: { country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, settled: true },
    });
  } catch (err: any) {
    return c.json({ error: 'Search failed', message: err?.message || String(err) }, 502);
  }
});

serviceRouter.get('/reviews/summary/:place_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reviews/summary/:place_id', 'Get review summary stats', SUMMARY_PRICE_USDC, walletAddress, {
      input: { place_id: 'string (required)' },
      output: { business: 'BusinessInfo', summary: 'ReviewSummary' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, SUMMARY_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed' }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const placeId = c.req.param('place_id');
  try {
    const result = await fetchReviewSummary(placeId);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Summary fetch failed' }, 502);
  }
});

serviceRouter.get('/reviews/:place_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/reviews/:place_id', 'Fetch Google reviews by Place ID', REVIEWS_PRICE_USDC, walletAddress, {
      input: { place_id: 'string', sort: 'string', limit: 'number' },
      output: { business: 'BusinessInfo', reviews: 'ReviewData[]' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, REVIEWS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment failed' }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const placeId = c.req.param('place_id');
  const sort = c.req.query('sort') || 'newest';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 50);

  try {
    const result = await fetchReviews(placeId, sort, limit);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Reviews fetch failed' }, 502);
  }
});

serviceRouter.get('/business/:place_id', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response('/api/business/:place_id', 'Get detailed business info', BUSINESS_PRICE_USDC, walletAddress, {
      input: { place_id: 'string' },
      output: { business: 'BusinessInfo', summary: 'ReviewSummary' },
    }), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, BUSINESS_PRICE_USDC);
  if (!verification.valid) return c.json({ error: 'Payment verification failed' }, 402);

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Proxy rate limit exceeded', retryAfter: 60 }, 429);
  }

  const placeId = c.req.param('place_id');
  try {
    const result = await fetchBusinessDetails(placeId);
    return c.json({ ...result, payment: { txHash: payment.txHash, amount: verification.amount, settled: true } });
  } catch (err: any) {
    return c.json({ error: 'Business details fetch failed' }, 502);
  }
});

// ─── PREDICTION MARKET LOGIC ─────────────────────────────

export async function getPolymarketOdds(marketSlugOrQuery: string): Promise<MarketOdds['polymarket']> {
  try {
    const searchRes = await proxyFetch(`https://gamma-api.polymarket.com/events/slug/${marketSlugOrQuery}`);
    if (!searchRes.ok) throw new Error(`Polymarket API error: ${searchRes.status} ${searchRes.statusText}`);
    const event = await searchRes.json() as any;
    if (!event || !event.markets || event.markets.length === 0) return null;
    const market = event.markets?.[0];
    if (!market) return null;
    const outcomePrices = JSON.parse(market.outcomePrices || '["0.5", "0.5"]');
    return {
      yes: parseFloat(outcomePrices[0]) || 0,
      no: parseFloat(outcomePrices[1]) || 0,
      volume24h: parseFloat(market.volume24hr || '0'),
      liquidity: parseFloat(market.liquidity || '0'),
    };
  } catch (err) {
    return null;
  }
}

export async function getKalshiOdds(marketTicker: string): Promise<MarketOdds['kalshi']> {
  try {
    const headers: Record<string, string> = {};
    if (process.env.KALSHI_API_KEY) {
      // Placeholder for actual kalshi auth format
      headers['Authorization'] = `Bearer ${process.env.KALSHI_API_KEY}`;
    }

    const res = await proxyFetch(`https://trading-api.kalshi.com/trade-api/v2/markets/${marketTicker}`, {
      headers
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.error(`Kalshi API auth error: ${res.status}. Missing or invalid KALSHI_API_KEY.`);
        return null;
      }
      throw new Error(`Kalshi API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json() as any;
    const market = data.market;
    if (!market) return null;
    return {
      yes: (market.yes_bid / 100) || 0,
      no: (market.no_bid / 100) || 0,
      volume24h: market.volume_24h || 0,
    };
  } catch (err) {
    return null;
  }
}

export async function getMetaculusOdds(questionId: string): Promise<MarketOdds['metaculus']> {
  try {
    const res = await proxyFetch(`https://www.metaculus.com/api2/questions/${questionId}/`);
    if (!res.ok) throw new Error(`Metaculus API error: ${res.status} ${res.statusText}`);
    const data = await res.json() as any;
    return {
      median: data.prediction_timeseries?.[data.prediction_timeseries.length - 1]?.community_prediction?.median || 0,
      forecasters: data.number_of_forecasters || 0,
    };
  } catch (err) {
    return null;
  }
}

export async function scrapeTwitterSentiment(topic: string, country: string): Promise<SentimentData['twitter']> {
  const BROWSER_ENDPOINT = process.env.BROWSER_ENDPOINT || 'https://browser.proxies.sx';
  const BROWSER_PAYMENT_SIG = process.env.BROWSER_PAYMENT_SIG;
  if (!BROWSER_PAYMENT_SIG) return null;

  let sessionId: string | null = null;
  try {
    const endpoint = BROWSER_ENDPOINT.replace(/\/$/, '');
    const res = await fetch(`${endpoint}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Payment-Signature': BROWSER_PAYMENT_SIG },
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
    const sessionData = await res.json() as { session_id: string; session_token: string };
    sessionId = sessionData.session_id;

    const navigate = await fetch(`${endpoint}/v1/sessions/${sessionId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionData.session_token}` },
      body: JSON.stringify({ action: 'navigate', url: `https://twitter.com/search?q=${encodeURIComponent(topic)}&f=live` }),
    });
    if (!navigate.ok) return null;

    await sleep(5000);

    const evaluate = await fetch(`${endpoint}/v1/sessions/${sessionId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionData.session_token}` },
      body: JSON.stringify({
        action: 'evaluate',
        script: `(() => {
          const tweets = [];
          document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => {
            const textEl = el.querySelector('div[data-testid="tweetText"]');
            if (textEl) tweets.push({ text: textEl.innerText });
          });
          return tweets;
        })()`
      }),
    });

    if (!evaluate.ok) return null;
    const tweets = (await evaluate.json()).result as any[];

    if (!tweets || !Array.isArray(tweets)) return null;

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
      topTweets: [],
    };
  } catch (err) {
    return null;
  } finally {
    if (sessionId) {
      await fetch(`${BROWSER_ENDPOINT.replace(/\/$/, '')}/v1/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => { });
    }
  }
}

export async function scrapeRedditSentiment(topic: string): Promise<SentimentData['reddit']> {
  try {
    const res = await proxyFetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=new`);
    if (!res.ok) throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
    const data = await res.json() as any;
    const posts = data.data?.children || [];
    if (posts.length === 0) return null;

    let pos = 0, neg = 0, neu = 0;
    const subs = new Set<string>();
    let totalUps = 0;
    let totalComments = 0;

    posts.forEach((p: any) => {
      const text = (p.data.title + ' ' + (p.data.selftext || '')).toLowerCase();
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
    return null;
  }
}

function detectArbitrage(odds: MarketOdds): SignalData['arbitrage'] {
  if (!odds || !odds.polymarket || !odds.kalshi) return null;
  const polyYes = odds.polymarket.yes || 0;
  const kalshiYes = odds.kalshi.yes || 0;
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
  if (!odds || !odds.polymarket || !sentiment || !sentiment.reddit) return null;
  const marketYes = odds.polymarket.yes || 0;
  const socialBullish = sentiment.reddit.positive || 0;
  const diff = Math.abs(socialBullish - marketYes);
  if (diff > 0.15) {
    return {
      detected: true,
      description: `Reddit sentiment ${Math.round(socialBullish * 100)}% bullish but market only ${Math.round(marketYes * 100)}% — potential mispricing`,
      magnitude: diff > 0.3 ? 'high' : 'moderate',
    };
  }
  return { detected: false, description: 'Sentiment aligned with market', magnitude: 'low' };
}

// ─── PREDICTION ENDPOINTS ─────────────────────────────

serviceRouter.get('/predictions', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

  const payment = extractPayment(c);
  const price = 0.05;

  if (!payment) {
    return c.json(build402Response('/api/predictions', PREDICTION_DESCRIPTION, price, walletAddress, PREDICTION_OUTPUT_SCHEMA), 402);
  }

  const verification = await verifyPayment(payment, walletAddress, price);
  if (!verification.valid) return c.json({ error: 'Payment failed' }, 402);

  const type = c.req.query('type') || 'signal';
  const market = c.req.query('market') || 'will-jesus-christ-return-before-2027';
  const topic = c.req.query('topic') || market;
  const country = (c.req.query('country') || 'US').toUpperCase();

  const odds: MarketOdds = {};
  const sentiment: SentimentData = {};
  const signals: SignalData = {};

  const fetchPromises: Promise<void>[] = [];
  let ip = 'unknown';

  if (type === 'signal' || type === 'arbitrage' || type === 'trending') {
    fetchPromises.push((async () => { odds.polymarket = await getPolymarketOdds(market); })());
    fetchPromises.push((async () => { odds.kalshi = await getKalshiOdds(market); })());

    let questionId = c.req.query('metaculusId');
    if (!questionId) {
      // Fallback: strictly extract numbers if they exist, but don't crash if they don't
      const matches = market.match(/\d+/g);
      questionId = matches ? matches[matches.length - 1] : '40281';
    }
    fetchPromises.push((async () => { odds.metaculus = await getMetaculusOdds(questionId); })());
  }

  if (type === 'signal' || type === 'sentiment' || type === 'trending') {
    fetchPromises.push((async () => { sentiment.reddit = await scrapeRedditSentiment(topic); })());
    fetchPromises.push((async () => { sentiment.twitter = await scrapeTwitterSentiment(topic, country); })());
  }

  fetchPromises.push((async () => { ip = await getProxyIp(); })());

  await Promise.all(fetchPromises);

  if (odds.polymarket && odds.kalshi) signals.arbitrage = detectArbitrage(odds);
  if (odds.polymarket && sentiment.reddit) signals.sentimentDivergence = detectDivergence(odds, sentiment);

  const proxy = getProxy();

  return c.json({
    type,
    market,
    timestamp: new Date().toISOString(),
    odds,
    sentiment,
    signals,
    meta: {
      proxy: {
        ip,
        country: proxy.country,
        type: 'mobile',
      },
    },
    payment: {
      txHash: payment.txHash,
      network: payment.network,
      amount: verification.amount,
      settled: true,
    },
  });
});
