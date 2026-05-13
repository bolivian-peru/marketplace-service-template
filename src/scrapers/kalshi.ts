/**
 * Kalshi API Scraper
 * ─────────────────────
 * Fetches prediction market data from Kalshi's public API.
 * Uses proxyFetch for mobile proxy rotation.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ────────────────────────────────────────────

export interface KalshiMarket {
  id: string;
  ticker: string;
  title: string;
  subtitle: string | null;
  category: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
  openInterest: number;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  closed: boolean;
  url: string;
}

// ─── KALSHI API ───────────────────────────────────────

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const MAX_RETRIES = 2;
const TIMEOUT_MS = 20_000;

/**
 * Search Kalshi markets by keyword.
 */
export async function searchKalshiMarkets(
  query: string,
  limit: number = 20,
): Promise<KalshiMarket[]> {
  try {
    const params = new URLSearchParams({
      status: 'open',
      limit: String(Math.min(limit, 50)),
      cursor: '0',
    });

    // Kalshi doesn't have a text search endpoint; filter by category/title
    const url = `${KALSHI_API_BASE}/markets?${params}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[kalshi] Search failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const markets = data?.markets ?? data ?? [];

    if (!Array.isArray(markets)) return [];

    // Filter by query in title
    const queryLower = query.toLowerCase();
    return markets
      .filter((m: any) => {
        const title = (m.title ?? m.question ?? '').toLowerCase();
        const category = (m.category ?? '').toLowerCase();
        return title.includes(queryLower) || category.includes(queryLower);
      })
      .map(parseKalshiMarket)
      .filter((m): m is KalshiMarket => m !== null)
      .slice(0, limit);
  } catch (err: any) {
    console.error(`[kalshi] Search error: ${err.message}`);
    return [];
  }
}

/**
 * Get trending Kalshi markets (by volume).
 */
export async function getTrendingKalshiMarkets(
  limit: number = 20,
  category?: string,
): Promise<KalshiMarket[]> {
  try {
    const params = new URLSearchParams({
      status: 'open',
      limit: String(Math.min(limit, 50)),
      cursor: '0',
    });

    if (category) {
      params.set('group', category);
    }

    const url = `${KALSHI_API_BASE}/markets?${params}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[kalshi] Trending failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const markets = data?.markets ?? data ?? [];

    if (!Array.isArray(markets)) return [];

    // Sort by volume descending
    return markets
      .map(parseKalshiMarket)
      .filter((m): m is KalshiMarket => m !== null)
      .sort((a: KalshiMarket, b: KalshiMarket) => b.volume - a.volume)
      .slice(0, limit);
  } catch (err: any) {
    console.error(`[kalshi] Trending error: ${err.message}`);
    return [];
  }
}

/**
 * Get a specific Kalshi market by ticker.
 */
export async function getKalshiMarketDetail(
  ticker: string,
): Promise<KalshiMarket | null> {
  try {
    const url = `${KALSHI_API_BASE}/markets/${ticker}`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(`[kalshi] Detail failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const market = data?.market ?? data;
    return parseKalshiMarket(market);
  } catch (err: any) {
    console.error(`[kalshi] Detail error: ${err.message}`);
    return null;
  }
}

/**
 * Get Kalshi market categories/series.
 */
export async function getKalshiCategories(): Promise<string[]> {
  try {
    const url = `${KALSHI_API_BASE}/groups`;
    const response = await proxyFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      maxRetries: MAX_RETRIES,
      timeoutMs: TIMEOUT_MS,
    });

    if (!response.ok) return [];

    const data = await response.json() as any;
    const groups = data?.groups ?? data ?? [];
    if (!Array.isArray(groups)) return [];
    return groups
      .map((g: any) => g.title ?? g.name ?? g.id ?? '')
      .filter((s: string) => s.length > 0)
      .slice(0, 30);
  } catch {
    return [];
  }
}

// ─── HELPERS ─────────────────────────────────────────────

function parseKalshiMarket(m: any): KalshiMarket | null {
  if (!m) return null;

  const title = m.title ?? m.question ?? '';
  if (!title) return null;

  const yesPrice = typeof m.yes_price === 'number'
    ? m.yes_price / 100
    : typeof m.last_price === 'number'
      ? m.last_price / 100
      : 0.5;

  const noPrice = typeof m.no_price === 'number'
    ? m.no_price / 100
    : 1 - yesPrice;

  return {
    id: m.id ?? '',
    ticker: m.ticker ?? m.condition_token ?? '',
    title,
    subtitle: m.subtitle ?? m.description_short ?? null,
    category: m.category ?? m.group ?? '',
    yesPrice,
    noPrice,
    volume: typeof m.volume === 'number' ? m.volume : parseInt(m.volume ?? '0') || 0,
    liquidity: typeof m.liquidity === 'number' ? m.liquidity : parseInt(m.liquidity ?? '0') || 0,
    openInterest: typeof m.open_interest === 'number' ? m.open_interest : 0,
    startDate: m.start_date ?? m.open_time ?? null,
    endDate: m.end_date ?? m.close_time ?? null,
    active: m.active ?? m.status === 'open',
    closed: m.closed ?? m.status === 'closed',
    url: `https://kalshi.com/markets/${m.ticker ?? m.id ?? ''}`,
  };
}