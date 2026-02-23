// src/marketData.ts
// Aggregates live market data from Polymarket, Kalshi, and Metaculus.

import { resolveMarketConfig } from '../config/markets';

export interface PolymarketOdds {
  yes: number | null;
  no: number | null;
  volume24h?: number | null;
  liquidity?: number | null;
  question?: string | null;
  marketSlug?: string | null;
}

export interface KalshiOdds {
  yes: number | null;
  no: number | null;
  volume24h?: number | null;
  marketTicker?: string | null;
  eventTicker?: string | null;
}

export interface MetaculusOdds {
  median: number | null;
  communityPrediction?: number | null;
  forecasters?: number | null;
  questionId?: number | null;
  title?: string | null;
}

export interface AggregatedMarketData {
  type: 'market-data';
  market: string;
  timestamp: string;
  odds: {
    polymarket?: PolymarketOdds | null;
    kalshi?: KalshiOdds | null;
    metaculus?: MetaculusOdds | null;
  };
  raw?: {
    polymarket?: unknown;
    kalshi?: unknown;
    metaculus?: unknown;
  };
}

const POLYMARKET_BASE = 'https://clob.polymarket.com';
const METACULUS_BASE = 'https://www.metaculus.com/api2';
const KALSHI_BASE = 'https://api.elections.kalshi.com';

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number = 15_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    }
    return await res.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────
// Polymarket
// ─────────────────────────────────────────────────────

interface PolymarketToken {
  token_id: string;
  outcome: string;
  price: number | null;
  winner?: boolean;
}

interface PolymarketMarketRecord {
  question_id: string;
  question: string;
  market_slug: string;
  tokens: PolymarketToken[];
  volume24h?: number | null;
  liquidity?: number | null;
}

interface PolymarketMarketsResponse {
  data: PolymarketMarketRecord[];
}

async function fetchPolymarketForMarket(slug: string): Promise<PolymarketOdds | null> {
  const cfg = resolveMarketConfig(slug);
  if (!cfg?.polymarket) return null;

  const url = `${POLYMARKET_BASE}/markets?limit=500&active=true`;
  let payload: PolymarketMarketsResponse;
  try {
    payload = await fetchJsonWithTimeout<PolymarketMarketsResponse>(url, 10_000);
  } catch (err) {
    console.error('[marketData] Polymarket fetch error:', err);
    return null;
  }

  const markets = Array.isArray(payload?.data) ? payload.data : [];

  const needleQuestion = cfg.polymarket.questionSearch?.toLowerCase();
  const needleSlug = cfg.polymarket.marketSlug?.toLowerCase();

  const match = markets.find((m) => {
    const q = (m.question || '').toLowerCase();
    const s = (m.market_slug || '').toLowerCase();
    if (needleSlug && s === needleSlug) return true;
    if (needleQuestion && q.includes(needleQuestion)) return true;
    return false;
  }) ?? markets[0];

  if (!match) return null;

  const tokens = Array.isArray(match.tokens) ? match.tokens : [];
  if (tokens.length === 0) {
    return {
      yes: null,
      no: null,
      volume24h: match.volume24h ?? null,
      liquidity: match.liquidity ?? null,
      question: match.question ?? null,
      marketSlug: match.market_slug ?? null,
    };
  }

  // Heuristic: treat the highest-priced outcome as "yes" and the lowest as "no"
  const sorted = tokens
    .filter((t) => typeof t.price === 'number' && Number.isFinite(t.price))
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));

  const yesToken = sorted[0];
  const noToken = sorted[sorted.length - 1] ?? sorted[0];

  const yes = typeof yesToken?.price === 'number' ? clampProbability(yesToken.price) : null;
  const no = typeof noToken?.price === 'number' ? clampProbability(noToken.price) : yes !== null ? clampProbability(1 - yes) : null;

  return {
    yes,
    no,
    volume24h: match.volume24h ?? null,
    liquidity: match.liquidity ?? null,
    question: match.question ?? null,
    marketSlug: match.market_slug ?? null,
  };
}

// ─────────────────────────────────────────────────────
// Kalshi (Elections API)
// ─────────────────────────────────────────────────────

interface KalshiMarketRecord {
  ticker: string;
  event_ticker: string;
  yes_ask?: string | null;
  no_ask?: string | null;
  volume?: string | null;
}

interface KalshiMarketsResponse {
  markets: KalshiMarketRecord[];
}

async function fetchKalshiForMarket(slug: string): Promise<KalshiOdds | null> {
  const cfg = resolveMarketConfig(slug);
  if (!cfg?.kalshi) return null;

  const eventTicker = cfg.kalshi.eventTicker;

  // The public elections API exposes markets grouped by event. If this
  // request shape ever changes, the function will simply return null and
  // the aggregator will continue with the remaining data sources.
  const url = `${KALSHI_BASE}/v1/events/${encodeURIComponent(eventTicker)}/markets`;

  let payload: KalshiMarketsResponse;
  try {
    payload = await fetchJsonWithTimeout<KalshiMarketsResponse>(url, 10_000);
  } catch (err) {
    console.error('[marketData] Kalshi fetch error:', err);
    return null;
  }

  const markets = Array.isArray((payload as any)?.markets) ? (payload as any).markets as KalshiMarketRecord[] : [];
  if (markets.length === 0) return null;

  const primary = markets[0];
  const yesPrice = primary.yes_ask ? parseFloat(primary.yes_ask) : NaN;
  const noPrice = primary.no_ask ? parseFloat(primary.no_ask) : NaN;

  const yes = Number.isFinite(yesPrice) ? clampProbability(yesPrice) : null;
  const no = Number.isFinite(noPrice) ? clampProbability(noPrice) : yes !== null ? clampProbability(1 - yes) : null;

  const vol = primary.volume ? parseFloat(primary.volume) : NaN;

  return {
    yes,
    no,
    volume24h: Number.isFinite(vol) ? vol : null,
    marketTicker: primary.ticker,
    eventTicker,
  };
}

// ─────────────────────────────────────────────────────
// Metaculus
// ─────────────────────────────────────────────────────

interface MetaculusQuestionResponse {
  id: number;
  title: string;
  median?: number | null;
  community_prediction?: {
    full?: {
      q2?: number | null; // median
    } | null;
    q2?: number | null;
    community_prediction?: number | null;
  } | null;
  num_forecasters?: number | null;
}

async function fetchMetaculusForMarket(slug: string): Promise<MetaculusOdds | null> {
  const cfg = resolveMarketConfig(slug);
  if (!cfg?.metaculus) return null;

  const id = cfg.metaculus.questionId;
  const url = `${METACULUS_BASE}/questions/${id}/`;

  let payload: MetaculusQuestionResponse;
  try {
    payload = await fetchJsonWithTimeout<MetaculusQuestionResponse>(url, 10_000);
  } catch (err) {
    console.error('[marketData] Metaculus fetch error:', err);
    return null;
  }

  const cp = payload.community_prediction ?? (payload as any).prediction ?? null;
  const full = cp && 'full' in cp ? (cp.full as any) : null;

  const medianFromFull = typeof full?.q2 === 'number' ? full.q2 : null;
  const medianDirect = typeof (cp as any)?.q2 === 'number' ? (cp as any).q2 : null;
  const medianPrediction = typeof (cp as any)?.community_prediction === 'number' ? (cp as any).community_prediction : null;

  const median = [medianFromFull, medianDirect, medianPrediction].find((v) => typeof v === 'number' && Number.isFinite(v)) as number | null | undefined ?? null;

  return {
    median: median !== null ? clampProbability(median) : null,
    communityPrediction: medianPrediction ?? null,
    forecasters: typeof payload.num_forecasters === 'number' ? payload.num_forecasters : null,
    questionId: payload.id,
    title: payload.title ?? null,
  };
}

// ─────────────────────────────────────────────────────
// Helpers & orchestrator
// ─────────────────────────────────────────────────────

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value > 1 && value <= 100) {
    return Math.max(0, Math.min(1, value / 100));
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export async function getAggregatedMarketData(marketSlug: string): Promise<AggregatedMarketData> {
  const now = new Date().toISOString();

  const [poly, kalshi, meta] = await Promise.all([
    fetchPolymarketForMarket(marketSlug).catch(() => null),
    fetchKalshiForMarket(marketSlug).catch(() => null),
    fetchMetaculusForMarket(marketSlug).catch(() => null),
  ]);

  return {
    type: 'market-data',
    market: marketSlug,
    timestamp: now,
    odds: {
      polymarket: poly,
      kalshi,
      metaculus: meta,
    },
  };
}
