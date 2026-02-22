/**
 * Prediction Market Signal Aggregator (Bounty #55)
 *
 * Scrapes Polymarket and Metaculus for prediction market data.
 * Polymarket has a public API at gamma-api.polymarket.com.
 * Metaculus has a public API at metaculus.com/api2/.
 */

import { proxyFetch } from '../proxy';

export class ScraperError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

interface FetchOpts {
  timeoutMs?: number;
}

async function apiFetch(url: string, opts: FetchOpts = {}): Promise<any> {
  const { timeoutMs = 20_000 } = opts;

  let response: Response;
  try {
    response = await proxyFetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'PredictionMarketAggregator/1.0' },
      timeoutMs,
      maxRetries: 2,
    });
  } catch {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'PredictionMarketAggregator/1.0' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch {
      throw new ScraperError('Proxy and direct fetch both failed', 502, true);
    }
  }

  if (response.status === 429) throw new ScraperError('Rate limited', 429, true);
  if (response.status === 403) throw new ScraperError('Access blocked', 403, false);
  if (!response.ok) throw new ScraperError(`API ${response.status}: ${response.statusText}`, response.status, true);

  const text = await response.text();
  if (text.includes('captcha') || text.includes('challenge')) {
    throw new ScraperError('CAPTCHA challenge detected', 503, true);
  }
  try { return JSON.parse(text); }
  catch { throw new ScraperError('Invalid JSON response', 502, true); }
}

// ─── TYPES ───────────────────────────────────

export interface PredictionMarket {
  id: string;
  title: string;
  description: string;
  probability: number;
  volume: number;
  liquidity: number;
  endDate: string;
  category: string;
  url: string;
  source: 'polymarket' | 'metaculus';
  createdAt: string;
  commentCount: number;
  active: boolean;
}

export interface MarketSearchResult {
  markets: PredictionMarket[];
  query: string;
  source: string;
  resultCount: number;
}

export interface TrendingMarketsResult {
  markets: PredictionMarket[];
  source: string;
  resultCount: number;
}

// ─── POLYMARKET ──────────────────────────────

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

function mapPolymarket(raw: any): PredictionMarket {
  const outcomes = raw.outcomePrices ? JSON.parse(raw.outcomePrices) : [];
  const yesPrice = outcomes.length > 0 ? parseFloat(outcomes[0]) : 0;

  return {
    id: String(raw.id || raw.condition_id || ''),
    title: String(raw.question || raw.title || '').slice(0, 500),
    description: String(raw.description || '').slice(0, 2000),
    probability: Math.round(yesPrice * 10000) / 100,
    volume: Number(raw.volume) || 0,
    liquidity: Number(raw.liquidity) || 0,
    endDate: String(raw.end_date_iso || raw.endDate || ''),
    category: String(raw.category || 'Other'),
    url: `https://polymarket.com/event/${raw.slug || raw.id}`,
    source: 'polymarket',
    createdAt: String(raw.startDate || raw.created_at || ''),
    commentCount: Number(raw.commentCount) || 0,
    active: Boolean(raw.active),
  };
}

export async function searchPolymarket(
  query: string,
  limit: number = 25,
): Promise<PredictionMarket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const url = `${POLYMARKET_API}/markets?limit=${safeLimit}&active=true&closed=false&_q=${encodeURIComponent(query)}&order=volume&ascending=false`;
  const data = await apiFetch(url);

  if (!Array.isArray(data)) return [];
  return data.slice(0, safeLimit).map(mapPolymarket);
}

export async function getPolymarketTrending(
  limit: number = 25,
): Promise<PredictionMarket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const url = `${POLYMARKET_API}/markets?limit=${safeLimit}&active=true&closed=false&order=volume&ascending=false`;
  const data = await apiFetch(url);

  if (!Array.isArray(data)) return [];
  return data.slice(0, safeLimit).map(mapPolymarket);
}

export async function getPolymarketByCategory(
  category: string,
  limit: number = 25,
): Promise<PredictionMarket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const url = `${POLYMARKET_API}/markets?limit=${safeLimit}&active=true&closed=false&tag=${encodeURIComponent(category)}&order=volume&ascending=false`;
  const data = await apiFetch(url);

  if (!Array.isArray(data)) return [];
  return data.slice(0, safeLimit).map(mapPolymarket);
}

// ─── METACULUS ───────────────────────────────

const METACULUS_API = 'https://www.metaculus.com/api2';

function mapMetaculus(raw: any): PredictionMarket {
  const communityPrediction = raw.community_prediction?.full?.q2;

  return {
    id: String(raw.id || ''),
    title: String(raw.title || '').slice(0, 500),
    description: String(raw.description || '').slice(0, 2000),
    probability: communityPrediction ? Math.round(communityPrediction * 10000) / 100 : 0,
    volume: Number(raw.number_of_predictions) || 0,
    liquidity: 0,
    endDate: String(raw.resolve_time || ''),
    category: String(raw.group?.name || raw.type || 'General'),
    url: `https://www.metaculus.com/questions/${raw.id}/`,
    source: 'metaculus',
    createdAt: String(raw.created_time || ''),
    commentCount: Number(raw.comment_count) || 0,
    active: raw.active_state === 'OPEN',
  };
}

export async function searchMetaculus(
  query: string,
  limit: number = 25,
): Promise<PredictionMarket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const url = `${METACULUS_API}/questions/?search=${encodeURIComponent(query)}&limit=${safeLimit}&status=open&order_by=-activity`;
  const data = await apiFetch(url);

  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, safeLimit).map(mapMetaculus);
}

export async function getMetaculusTrending(
  limit: number = 25,
): Promise<PredictionMarket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const url = `${METACULUS_API}/questions/?limit=${safeLimit}&status=open&order_by=-activity&type=forecast`;
  const data = await apiFetch(url);

  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, safeLimit).map(mapMetaculus);
}

// ─── AGGREGATED ──────────────────────────────

export async function searchAllMarkets(
  query: string,
  limit: number = 25,
): Promise<MarketSearchResult> {
  const perSource = Math.ceil(limit / 2);

  const [poly, meta] = await Promise.allSettled([
    searchPolymarket(query, perSource),
    searchMetaculus(query, perSource),
  ]);

  const markets: PredictionMarket[] = [];
  if (poly.status === 'fulfilled') markets.push(...poly.value);
  if (meta.status === 'fulfilled') markets.push(...meta.value);

  // Sort by volume descending
  markets.sort((a, b) => b.volume - a.volume);

  return {
    markets: markets.slice(0, limit),
    query,
    source: 'polymarket+metaculus',
    resultCount: markets.length,
  };
}

export async function getTrendingMarkets(
  limit: number = 25,
): Promise<TrendingMarketsResult> {
  const perSource = Math.ceil(limit / 2);

  const [poly, meta] = await Promise.allSettled([
    getPolymarketTrending(perSource),
    getMetaculusTrending(perSource),
  ]);

  const markets: PredictionMarket[] = [];
  if (poly.status === 'fulfilled') markets.push(...poly.value);
  if (meta.status === 'fulfilled') markets.push(...meta.value);

  markets.sort((a, b) => b.volume - a.volume);

  return {
    markets: markets.slice(0, limit),
    source: 'polymarket+metaculus',
    resultCount: markets.length,
  };
}
