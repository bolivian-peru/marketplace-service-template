/**
 * Prediction Market Scraper
 *
 * Fetches real-time odds from:
 * - Polymarket (https://gamma-api.polymarket.com)
 * - Kalshi (https://trading-api.kalshi.com)
 * - Metaculus (https://www.metaculus.com/api2)
 *
 * All requests use direct fetch — these are public APIs that don't require auth.
 */

const TIMEOUT_MS = 20_000;
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export interface MarketOdds {
  platform: 'polymarket' | 'kalshi' | 'metaculus';
  marketId: string;
  question: string;
  probability: number; // 0-100 percent
  volume24h: number | null;
  totalVolume: number | null;
  endDate: string | null;
  url: string;
  outcomes: Array<{ name: string; probability: number }>;
  lastUpdated: string;
}

export interface ArbitrageOpportunity {
  question: string;
  markets: Array<{
    platform: string;
    probability: number;
    marketId: string;
    url: string;
  }>;
  spread: number; // max - min probability in percentage points
  signal: 'buy_low' | 'sell_high' | 'neutral';
  confidence: 'high' | 'medium' | 'low';
}

async function apiFetch(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function toFloat(value: unknown, fallback = 0): number {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

// ─── Polymarket ─────────────────────────────────────────────────────────────

interface PolymarketMarket {
  conditionId?: string;
  id?: string;
  question?: string;
  outcomePrices?: string | string[];
  outcomes?: string | string[];
  volume?: string | number;
  volume24hr?: string | number;
  endDateIso?: string;
  active?: boolean;
  closed?: boolean;
}

function parsePolymarketMarket(raw: PolymarketMarket): MarketOdds | null {
  const question = sanitizeText(raw.question, 300);
  if (!question) return null;

  const marketId = sanitizeText(raw.conditionId || raw.id, 128);
  if (!marketId) return null;

  // outcomePrices is a JSON string like "[\"0.65\",\"0.35\"]"
  let prices: number[] = [];
  try {
    const priceArr = typeof raw.outcomePrices === 'string'
      ? JSON.parse(raw.outcomePrices)
      : (Array.isArray(raw.outcomePrices) ? raw.outcomePrices : []);
    prices = priceArr.map((p: unknown) => toFloat(p) * 100);
  } catch {
    prices = [];
  }

  let outcomeNames: string[] = [];
  try {
    const namesArr = typeof raw.outcomes === 'string'
      ? JSON.parse(raw.outcomes)
      : (Array.isArray(raw.outcomes) ? raw.outcomes : []);
    outcomeNames = namesArr.map((n: unknown) => String(n).slice(0, 64));
  } catch {
    outcomeNames = ['Yes', 'No'];
  }

  const outcomes = prices.map((prob, i) => ({
    name: outcomeNames[i] || `Outcome ${i + 1}`,
    probability: Math.round(prob * 100) / 100,
  }));

  // Primary probability = "Yes" (first outcome)
  const probability = outcomes.length > 0 ? outcomes[0].probability : 50;

  const totalVolume = toFloat(raw.volume, 0);
  const volume24h = toFloat(raw.volume24hr, 0);

  return {
    platform: 'polymarket',
    marketId,
    question,
    probability,
    volume24h: volume24h || null,
    totalVolume: totalVolume || null,
    endDate: typeof raw.endDateIso === 'string' ? raw.endDateIso.slice(0, 32) : null,
    url: `https://polymarket.com/event/${encodeURIComponent(marketId)}`,
    outcomes,
    lastUpdated: new Date().toISOString(),
  };
}

export async function fetchPolymarketMarkets(topic?: string, limit = 20): Promise<MarketOdds[]> {
  try {
    const params = new URLSearchParams({
      limit: String(Math.min(limit * 3, 100)),
      active: 'true',
      closed: 'false',
      order: 'volume24hr',
      ascending: 'false',
    });
    if (topic) params.set('q', topic);

    const data = await apiFetch(`https://gamma-api.polymarket.com/markets?${params}`);
    const markets = Array.isArray(data) ? data : [];

    const results: MarketOdds[] = [];
    for (const raw of markets) {
      if (results.length >= limit) break;
      if (!raw || typeof raw !== 'object') continue;
      const parsed = parsePolymarketMarket(raw as PolymarketMarket);
      if (parsed) results.push(parsed);
    }
    return results;
  } catch (err) {
    console.warn('[prediction-markets] Polymarket fetch failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ─── Kalshi ─────────────────────────────────────────────────────────────────

interface KalshiMarket {
  ticker?: string;
  title?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  volume?: number;
  volume_24h?: number;
  close_time?: string;
  status?: string;
}

function parseKalshiMarket(raw: KalshiMarket): MarketOdds | null {
  const question = sanitizeText(raw.title, 300);
  if (!question) return null;

  const marketId = sanitizeText(raw.ticker, 64);
  if (!marketId) return null;

  // Kalshi prices are in cents (0-100)
  const yesBid = typeof raw.yes_bid === 'number' ? raw.yes_bid : 50;
  const yesAsk = typeof raw.yes_ask === 'number' ? raw.yes_ask : 50;
  const midpoint = (yesBid + yesAsk) / 2;
  const probability = Math.round(midpoint * 100) / 100;

  return {
    platform: 'kalshi',
    marketId,
    question,
    probability,
    volume24h: typeof raw.volume_24h === 'number' ? raw.volume_24h : null,
    totalVolume: typeof raw.volume === 'number' ? raw.volume : null,
    endDate: typeof raw.close_time === 'string' ? raw.close_time.slice(0, 32) : null,
    url: `https://kalshi.com/markets/${encodeURIComponent(marketId)}`,
    outcomes: [
      { name: 'Yes', probability },
      { name: 'No', probability: Math.round((100 - probability) * 100) / 100 },
    ],
    lastUpdated: new Date().toISOString(),
  };
}

export async function fetchKalshiMarkets(topic?: string, limit = 20): Promise<MarketOdds[]> {
  try {
    const params = new URLSearchParams({
      limit: String(Math.min(limit * 3, 200)),
      status: 'open',
      order_by: 'volume',
    });
    if (topic) params.set('search', topic);

    const data = await apiFetch(`https://trading-api.kalshi.com/trade-api/v2/markets?${params}`);
    const markets = (data as { markets?: KalshiMarket[] })?.markets;
    if (!Array.isArray(markets)) return [];

    const results: MarketOdds[] = [];
    for (const raw of markets) {
      if (results.length >= limit) break;
      if (!raw || typeof raw !== 'object') continue;
      const parsed = parseKalshiMarket(raw);
      if (parsed) results.push(parsed);
    }
    return results;
  } catch (err) {
    console.warn('[prediction-markets] Kalshi fetch failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ─── Metaculus ───────────────────────────────────────────────────────────────

interface MetaculusQuestion {
  id?: number;
  title?: string;
  community_prediction?: { full?: { q2?: number } };
  effected_close_time?: string;
  page_url?: string;
  number_of_predictions?: number;
}

function parseMetaculusQuestion(raw: MetaculusQuestion): MarketOdds | null {
  const question = sanitizeText(raw.title, 300);
  if (!question) return null;

  const marketId = String(raw.id || '');
  if (!marketId) return null;

  // q2 is the median community forecast (0-1)
  const rawProb = raw.community_prediction?.full?.q2;
  const probability = typeof rawProb === 'number' && Number.isFinite(rawProb)
    ? Math.round(rawProb * 10000) / 100  // convert 0-1 to 0-100
    : 50;

  const url = typeof raw.page_url === 'string' && raw.page_url.startsWith('/')
    ? `https://www.metaculus.com${raw.page_url}`
    : `https://www.metaculus.com/questions/${marketId}/`;

  return {
    platform: 'metaculus',
    marketId,
    question,
    probability,
    volume24h: null,
    totalVolume: typeof raw.number_of_predictions === 'number' ? raw.number_of_predictions : null,
    endDate: typeof raw.effected_close_time === 'string' ? raw.effected_close_time.slice(0, 32) : null,
    url,
    outcomes: [
      { name: 'Yes', probability },
      { name: 'No', probability: Math.round((100 - probability) * 100) / 100 },
    ],
    lastUpdated: new Date().toISOString(),
  };
}

export async function fetchMetaculusMarkets(topic?: string, limit = 20): Promise<MarketOdds[]> {
  try {
    const params = new URLSearchParams({
      status: 'open',
      limit: String(Math.min(limit * 2, 50)),
      format: 'json',
      order_by: '-activity',
    });
    if (topic) params.set('search', topic);

    const data = await apiFetch(`https://www.metaculus.com/api2/questions/?${params}`);
    const results_arr = (data as { results?: MetaculusQuestion[] })?.results;
    if (!Array.isArray(results_arr)) return [];

    const results: MarketOdds[] = [];
    for (const raw of results_arr) {
      if (results.length >= limit) break;
      if (!raw || typeof raw !== 'object') continue;
      const parsed = parseMetaculusQuestion(raw);
      if (parsed) results.push(parsed);
    }
    return results;
  } catch (err) {
    console.warn('[prediction-markets] Metaculus fetch failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ─── Cross-platform aggregation ──────────────────────────────────────────────

/**
 * Fetch markets from all platforms in parallel and combine results.
 */
export async function fetchAllMarkets(topic?: string, limitPerPlatform = 10): Promise<MarketOdds[]> {
  const [poly, kalshi, meta] = await Promise.allSettled([
    fetchPolymarketMarkets(topic, limitPerPlatform),
    fetchKalshiMarkets(topic, limitPerPlatform),
    fetchMetaculusMarkets(topic, limitPerPlatform),
  ]);

  const results: MarketOdds[] = [];
  if (poly.status === 'fulfilled') results.push(...poly.value);
  if (kalshi.status === 'fulfilled') results.push(...kalshi.value);
  if (meta.status === 'fulfilled') results.push(...meta.value);
  return results;
}

/**
 * Detect arbitrage opportunities by fuzzy-matching questions across platforms.
 * Returns pairs/groups with the largest probability spread.
 */
export function detectArbitrage(markets: MarketOdds[], minSpread = 5): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  // Group by similar questions using simple keyword overlap
  const groups: MarketOdds[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < markets.length; i++) {
    if (assigned.has(i)) continue;
    const group: MarketOdds[] = [markets[i]];
    assigned.add(i);

    const wordsI = new Set(
      markets[i].question.toLowerCase().split(/\W+/).filter((w) => w.length > 4),
    );

    for (let j = i + 1; j < markets.length; j++) {
      if (assigned.has(j)) continue;
      if (markets[j].platform === markets[i].platform) continue;

      const wordsJ = markets[j].question.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
      const overlap = wordsJ.filter((w) => wordsI.has(w)).length;
      const similarity = overlap / Math.max(wordsI.size, wordsJ.length, 1);

      if (similarity >= 0.4) {
        group.push(markets[j]);
        assigned.add(j);
      }
    }

    if (group.length >= 2) groups.push(group);
  }

  for (const group of groups) {
    const probs = group.map((m) => m.probability);
    const maxProb = Math.max(...probs);
    const minProb = Math.min(...probs);
    const spread = Math.round((maxProb - minProb) * 100) / 100;

    if (spread < minSpread) continue;

    const confidence: 'high' | 'medium' | 'low' =
      spread >= 15 ? 'high' : spread >= 8 ? 'medium' : 'low';
    const signal: 'buy_low' | 'sell_high' | 'neutral' =
      spread >= 10 ? 'buy_low' : spread >= 5 ? 'sell_high' : 'neutral';

    opportunities.push({
      question: group[0].question,
      markets: group.map((m) => ({
        platform: m.platform,
        probability: m.probability,
        marketId: m.marketId,
        url: m.url,
      })),
      spread,
      signal,
      confidence,
    });
  }

  // Sort by spread descending
  return opportunities.sort((a, b) => b.spread - a.spread);
}
