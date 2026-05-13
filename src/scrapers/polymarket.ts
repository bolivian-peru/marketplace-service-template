/**
 * Polymarket API Scraper
 * ─────────────────────────
 * Fetches prediction market data from Polymarket's public Gamma API.
 * Uses proxyFetch for mobile proxy rotation.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ────────────────────────────────────────────

export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  closed: boolean;
  category: string;
  image: string | null;
  description: string | null;
}

export interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  markets: PolymarketMarket[];
  tags: string[];
  image: string | null;
}

export interface MarketOdds {
  platform: 'polymarket';
  question: string;
  slug: string;
  outcomes: {
    name: string;
    probability: number;
    price: number;
  }[];
  volume24h: number;
  liquidity: number;
  url: string;
  endDate: string | null;
  category: string;
}

export interface ArbitrageOpportunity {
  question: string;
  markets: {
    platform: string;
    yes: number;
    no: number;
    url: string;
  }[];
  spread: number;
  direction: string;
}

// ─── POLYMARKET GAMMA API ─────────────────────────────

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const CLOB_API_BASE = 'https://clob.polymarket.com';

const MAX_RETRIES = 2;
const TIMEOUT_MS = 20_000;

/**
 * Search Polymarket markets by keyword query.
 */
export async function searchPolymarketMarkets(
  query: string,
  limit: number = 20,
): Promise<MarketOdds[]> {
  try {
    const params = new URLSearchParams({
      tag: query,
      active: 'true',
      closed: 'false',
      limit: String(Math.min(limit, 50)),
      order: 'volume',
      ascending: 'false',
    });

    const url = `${GAMMA_API_BASE}/markets?${params}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[polymarket] Search failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as any[];
    return parseMarkets(data);
  } catch (err: any) {
    console.error(`[polymarket] Search error: ${err.message}`);
    return [];
  }
}

/**
 * Get trending Polymarket markets by volume.
 */
export async function getTrendingMarkets(
  limit: number = 20,
  category?: string,
): Promise<MarketOdds[]> {
  try {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(Math.min(limit, 50)),
      order: 'volume',
      ascending: 'false',
    });

    if (category) {
      params.set('tag', category);
    }

    const url = `${GAMMA_API_BASE}/markets?${params}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[polymarket] Trending failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as any[];
    return parseMarkets(data);
  } catch (err: any) {
    console.error(`[polymarket] Trending error: ${err.message}`);
    return [];
  }
}

/**
 * Get a specific Polymarket event by condition ID or slug.
 */
export async function getMarketDetail(
  conditionId: string,
): Promise<MarketOdds | null> {
  try {
    const url = `${GAMMA_API_BASE}/markets/${conditionId}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[polymarket] Detail failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const markets = parseMarkets(Array.isArray(data) ? data : [data]);
    return markets[0] ?? null;
  } catch (err: any) {
    console.error(`[polymarket] Detail error: ${err.message}`);
    return null;
  }
}

/**
 * Get Polymarket events (grouped markets) by tag/category.
 */
export async function getPolymarketEvents(
  tag: string,
  limit: number = 10,
): Promise<PolymarketEvent[]> {
  try {
    const params = new URLSearchParams({
      tag: tag,
      active: 'true',
      closed: 'false',
      limit: String(Math.min(limit, 20)),
      order: 'volume',
      ascending: 'false',
    });

    const url = `${GAMMA_API_BASE}/events?${params}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[polymarket] Events failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as any[];
    return data.slice(0, limit).map((event: any) => ({
      id: event.id ?? '',
      slug: event.slug ?? '',
      title: event.title ?? 'Unknown',
      description: event.description ?? null,
      startDate: event.startDate ?? null,
      endDate: event.endDate ?? null,
      volume: event.volume ?? '0',
      liquidity: event.liquidity ?? '0',
      active: event.active ?? false,
      closed: event.closed ?? false,
      markets: Array.isArray(event.markets) ? event.markets : [],
      tags: Array.isArray(event.tags) ? event.tags : [],
      image: event.image ?? null,
    }));
  } catch (err: any) {
    console.error(`[polymarket] Events error: ${err.message}`);
    return [];
  }
}

/**
 * Search Polymarket markets by text query (broader than tag-based search).
 */
export async function searchMarketsByQuery(
  query: string,
  limit: number = 20,
): Promise<MarketOdds[]> {
  try {
    // Polymarket Gamma API supports text search
    const params = new URLSearchParams({
      text_query: query,
      active: 'true',
      closed: 'false',
      limit: String(Math.min(limit, 50)),
      order: 'volume',
      ascending: 'false',
    });

    const url = `${GAMMA_API_BASE}/markets?${params}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      // Fallback to tag-based search
      return searchPolymarketMarkets(query, limit);
    }

    const data = await response.json() as any[];
    if (!Array.isArray(data) || data.length === 0) {
      return searchPolymarketMarkets(query, limit);
    }

    return parseMarkets(data);
  } catch (err: any) {
    console.error(`[polymarket] Query search error: ${err.message}`);
    return searchPolymarketMarkets(query, limit);
  }
}

// ─── HELPERS ─────────────────────────────────────────────

function parseMarkets(markets: any[]): MarketOdds[] {
  if (!Array.isArray(markets)) return [];

  return markets
    .filter((m: any) => m && m.question)
    .map((m: any) => {
      const outcomePrices = Array.isArray(m.outcomePrices)
        ? m.outcomePrices
        : typeof m.outcomePrices === 'string'
          ? JSON.parse(m.outcomePrices || '[]')
          : [];
      const outcomes = Array.isArray(m.outcomes)
        ? m.outcomes
        : typeof m.outcomes === 'string'
          ? JSON.parse(m.outcomes || '[]')
          : ['Yes', 'No'];

      const parsed: MarketOdds = {
        platform: 'polymarket',
        question: m.question ?? '',
        slug: m.slug ?? m.conditionId ?? '',
        outcomes: outcomes.map((name: string, i: number) => ({
          name,
          probability: parseFloat(outcomePrices[i] ?? '0.5'),
          price: parseFloat(outcomePrices[i] ?? '0.5'),
        })),
        volume24h: parseFloat(m.volume ?? m.volume24hr ?? '0') || 0,
        liquidity: parseFloat(m.liquidity ?? '0') || 0,
        url: `https://polymarket.com/event/${m.slug ?? m.conditionId ?? ''}`,
        endDate: m.endDate ?? m.end_date_iso ?? null,
        category: m.category ?? '',
      };

      return parsed;
    })
    .filter((m: MarketOdds) => m.question.length > 0);
}

/**
 * Calculate sentiment divergence between social sentiment and market odds.
 * A positive divergence means social is more bullish than the market.
 */
export function calculateSentimentDivergence(
  socialSentiment: { positive: number; neutral: number; negative: number },
  marketOdds: number,
): number {
  // Convert social sentiment to a 0-1 score (bullish ratio)
  const socialScore = socialSentiment.positive / 100;
  // Market odds are already 0-1
  return socialScore - marketOdds;
}

/**
 * Generate a trading signal based on sentiment divergence.
 */
export function generateSignal(
  market: MarketOdds,
  sentiment: { positive: number; neutral: number; negative: number } | null,
  divergence: number | null,
): 'bullish' | 'bearish' | 'neutral' {
  if (!sentiment || divergence === null) return 'neutral';

  const absDivergence = Math.abs(divergence);
  if (absDivergence < 0.05) return 'neutral';
  return divergence > 0 ? 'bullish' : 'bearish';
}