/**
 * Prediction Market Scrapers
 * ───────────────────────────
 * Fetches market odds from Polymarket, Kalshi, and Metaculus.
 * All three expose public JSON APIs requiring no authentication.
 *
 * Bounty #55 — Prediction Market Signal Aggregator
 */

const BOT_UA = 'PredictionSignalBot/1.0 (https://github.com/bolivian-peru/marketplace-service-template)';
const TIMEOUT_MS = 20_000;
const MAX_SLUG_LENGTH = 200;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;

// ─── SHARED TYPES ────────────────────────────────────

export interface MarketOdds {
  platform: 'polymarket' | 'kalshi' | 'metaculus';
  marketId: string;
  title: string;
  url: string;
  /** Probability YES 0-100 */
  yesOdds: number | null;
  /** Probability NO 0-100 */
  noOdds: number | null;
  /** Total volume in USD (when available) */
  volume: number | null;
  /** Liquidity in USD (when available) */
  liquidity: number | null;
  /** Number of traders/forecasters (when available) */
  forecasters: number | null;
  /** ISO timestamp */
  resolvesAt: string | null;
  /** Raw category tags */
  categories: string[];
  fetchedAt: string;
}

export interface ArbitrageOpportunity {
  market: string;
  platforms: string[];
  yesOdds: Record<string, number>;
  noOdds: Record<string, number>;
  /** Spread in percentage points — higher = more profitable */
  spread: number;
  description: string;
}

// ─── HELPERS ─────────────────────────────────────────

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().slice(0, MAX_URL_LENGTH);
  } catch {
    return null;
  }
}

function safeNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

async function safeFetch(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── POLYMARKET ──────────────────────────────────────
// Public Gamma API — no auth required
// https://gamma-api.polymarket.com/markets?slug=<slug>&limit=5

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

interface PolymarketMarket {
  id?: unknown;
  question?: unknown;
  conditionId?: unknown;
  slug?: unknown;
  endDate?: unknown;
  outcomePrices?: unknown;
  volume?: unknown;
  liquidity?: unknown;
  tags?: unknown;
  active?: unknown;
  closed?: unknown;
  groupItemTitle?: unknown;
}

function parsePolymarketMarket(raw: PolymarketMarket, fetchedAt: string): MarketOdds | null {
  const title = sanitizeText(raw.question || raw.groupItemTitle, MAX_TITLE_LENGTH);
  if (!title) return null;

  const slug = sanitizeText(raw.slug, MAX_SLUG_LENGTH);
  const marketId = sanitizeText(raw.id ?? raw.conditionId, 64);
  if (!marketId && !slug) return null;

  const url = slug
    ? `https://polymarket.com/event/${slug}`
    : `https://polymarket.com`;

  // outcomePrices is a JSON-encoded array like '["0.72", "0.28"]'
  let yesOdds: number | null = null;
  let noOdds: number | null = null;
  try {
    const prices = typeof raw.outcomePrices === 'string'
      ? JSON.parse(raw.outcomePrices)
      : raw.outcomePrices;
    if (Array.isArray(prices) && prices.length >= 2) {
      const y = parseFloat(prices[0]);
      const n = parseFloat(prices[1]);
      if (Number.isFinite(y)) yesOdds = Math.round(y * 100 * 100) / 100;
      if (Number.isFinite(n)) noOdds = Math.round(n * 100 * 100) / 100;
    }
  } catch { /* ignore */ }

  const volume = safeNumber(raw.volume);
  const liquidity = safeNumber(raw.liquidity);

  const rawTags = raw.tags;
  let categories: string[] = [];
  if (Array.isArray(rawTags)) {
    categories = rawTags
      .map((t: unknown) => {
        if (typeof t === 'string') return sanitizeText(t, 64);
        if (t && typeof t === 'object' && 'label' in t) return sanitizeText((t as { label: unknown }).label, 64);
        return '';
      })
      .filter(Boolean);
  }

  let resolvesAt: string | null = null;
  if (typeof raw.endDate === 'string' && raw.endDate.trim()) {
    resolvesAt = raw.endDate.trim().slice(0, 64);
  }

  return {
    platform: 'polymarket',
    marketId: marketId || slug || 'unknown',
    title,
    url,
    yesOdds,
    noOdds,
    volume: volume !== null ? Math.round(volume * 100) / 100 : null,
    liquidity: liquidity !== null ? Math.round(liquidity * 100) / 100 : null,
    forecasters: null,
    resolvesAt,
    categories,
    fetchedAt,
  };
}

export async function fetchPolymarketOdds(slug?: string): Promise<MarketOdds[]> {
  const fetchedAt = new Date().toISOString();
  let url: string;

  if (slug) {
    const safeSlug = sanitizeText(slug, MAX_SLUG_LENGTH);
    url = `${POLYMARKET_API}/markets?slug=${encodeURIComponent(safeSlug)}&limit=5`;
  } else {
    url = `${POLYMARKET_API}/markets?active=true&closed=false&limit=20&order=volumeNum&ascending=false`;
  }

  try {
    const data = await safeFetch(url);
    const markets: PolymarketMarket[] = Array.isArray(data) ? data : [];
    return markets
      .map((m) => parsePolymarketMarket(m, fetchedAt))
      .filter((m): m is MarketOdds => m !== null)
      .slice(0, 20);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[polymarket] fetch failed: ${msg}`);
    return [];
  }
}

// ─── KALSHI ──────────────────────────────────────────
// Public trading API v2 — no auth for market listing
// https://trading-api.kalshi.com/trade-api/v2/markets

const KALSHI_API = 'https://trading-api.kalshi.com/trade-api/v2';

interface KalshiMarket {
  ticker?: unknown;
  title?: unknown;
  yes_bid?: unknown;
  yes_ask?: unknown;
  no_bid?: unknown;
  no_ask?: unknown;
  volume?: unknown;
  liquidity?: unknown;
  close_time?: unknown;
  tags?: unknown;
  category?: unknown;
  status?: unknown;
  result?: unknown;
  subtitle?: unknown;
}

function parseKalshiMarket(raw: KalshiMarket, fetchedAt: string): MarketOdds | null {
  const title = sanitizeText(raw.title ?? raw.subtitle, MAX_TITLE_LENGTH);
  if (!title) return null;

  const ticker = sanitizeText(raw.ticker, 64);
  if (!ticker) return null;

  // yes_bid / yes_ask are in cents (0–100), mid = (bid + ask) / 2
  let yesOdds: number | null = null;
  let noOdds: number | null = null;

  const yesBid = safeNumber(raw.yes_bid);
  const yesAsk = safeNumber(raw.yes_ask);
  if (yesBid !== null && yesAsk !== null) {
    yesOdds = Math.round((yesBid + yesAsk) / 2 * 100) / 100;
    noOdds = Math.round((100 - yesOdds) * 100) / 100;
  } else if (yesBid !== null) {
    yesOdds = yesBid;
    noOdds = Math.round((100 - yesBid) * 100) / 100;
  }

  const volume = safeNumber(raw.volume);
  const liquidity = safeNumber(raw.liquidity);

  const rawTags = raw.tags;
  let categories: string[] = [];
  if (Array.isArray(rawTags)) {
    categories = rawTags.map((t: unknown) => sanitizeText(t, 64)).filter(Boolean);
  } else if (typeof raw.category === 'string') {
    categories = [sanitizeText(raw.category, 64)].filter(Boolean);
  }

  let resolvesAt: string | null = null;
  if (typeof raw.close_time === 'string' && raw.close_time.trim()) {
    resolvesAt = raw.close_time.trim().slice(0, 64);
  }

  return {
    platform: 'kalshi',
    marketId: ticker,
    title,
    url: `https://kalshi.com/markets/${ticker.toLowerCase()}`,
    yesOdds,
    noOdds,
    volume: volume !== null ? Math.round(volume * 100) / 100 : null,
    liquidity: liquidity !== null ? Math.round(liquidity * 100) / 100 : null,
    forecasters: null,
    resolvesAt,
    categories,
    fetchedAt,
  };
}

export async function fetchKalshiOdds(ticker?: string): Promise<MarketOdds[]> {
  const fetchedAt = new Date().toISOString();
  let url: string;

  if (ticker) {
    const safeTicker = sanitizeText(ticker, 64).toUpperCase();
    url = `${KALSHI_API}/markets/${encodeURIComponent(safeTicker)}`;
  } else {
    url = `${KALSHI_API}/markets?limit=20&status=open`;
  }

  try {
    const data = await safeFetch(url);

    let markets: KalshiMarket[] = [];
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.markets)) {
        markets = d.markets as KalshiMarket[];
      } else if ('market' in d) {
        markets = [d.market as KalshiMarket];
      } else if (Array.isArray(data)) {
        markets = data as KalshiMarket[];
      }
    }

    return markets
      .map((m) => parseKalshiMarket(m, fetchedAt))
      .filter((m): m is MarketOdds => m !== null)
      .slice(0, 20);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[kalshi] fetch failed: ${msg}`);
    return [];
  }
}

// ─── METACULUS ───────────────────────────────────────
// Public API — no auth required
// https://www.metaculus.com/api2/questions/?search=<term>&order_by=-activity

const METACULUS_API = 'https://www.metaculus.com/api2';

interface MetaculusQuestion {
  id?: unknown;
  title?: unknown;
  page_url?: unknown;
  community_prediction?: {
    full?: {
      q2?: number;  // median probability
      avg?: number;
    };
  };
  resolution?: unknown;
  resolve_time?: unknown;
  created_time?: unknown;
  prediction_count?: unknown;
  possibilities?: {
    type?: string;
  };
  tags?: Array<{ name?: unknown; slug?: unknown }>;
}

function parseMetaculusQuestion(raw: MetaculusQuestion, fetchedAt: string): MarketOdds | null {
  const title = sanitizeText(raw.title, MAX_TITLE_LENGTH);
  if (!title) return null;

  const id = String(raw.id ?? '').trim().slice(0, 32);
  if (!id || id === 'undefined') return null;

  const urlPath = sanitizeText(raw.page_url, 200);
  const url = urlPath
    ? (urlPath.startsWith('http') ? urlPath : `https://www.metaculus.com${urlPath}`)
    : `https://www.metaculus.com/questions/${id}/`;

  const safeUrl = sanitizeUrl(url) ?? `https://www.metaculus.com/questions/${id}/`;

  // community_prediction.full.q2 = community median (0-1 scale)
  let yesOdds: number | null = null;
  let noOdds: number | null = null;
  const cp = raw.community_prediction?.full;
  if (cp) {
    const raw_val = cp.q2 ?? cp.avg;
    if (typeof raw_val === 'number' && Number.isFinite(raw_val)) {
      yesOdds = Math.round(raw_val * 100 * 100) / 100;
      noOdds = Math.round((100 - yesOdds) * 100) / 100;
    }
  }

  const forecasters = safeNumber(raw.prediction_count);

  let resolvesAt: string | null = null;
  if (typeof raw.resolve_time === 'string' && raw.resolve_time.trim()) {
    resolvesAt = raw.resolve_time.trim().slice(0, 64);
  }

  const rawTags = raw.tags ?? [];
  const categories = Array.isArray(rawTags)
    ? rawTags.map((t: unknown) => {
        if (t && typeof t === 'object') {
          const tag = t as { name?: unknown; slug?: unknown };
          return sanitizeText(tag.name ?? tag.slug, 64);
        }
        return '';
      }).filter(Boolean)
    : [];

  return {
    platform: 'metaculus',
    marketId: id,
    title,
    url: safeUrl,
    yesOdds,
    noOdds,
    volume: null,
    liquidity: null,
    forecasters: forecasters !== null ? Math.round(forecasters) : null,
    resolvesAt,
    categories,
    fetchedAt,
  };
}

export async function fetchMetaculusOdds(search?: string): Promise<MarketOdds[]> {
  const fetchedAt = new Date().toISOString();
  let url: string;

  if (search) {
    const safeSearch = sanitizeText(search, MAX_SLUG_LENGTH);
    url = `${METACULUS_API}/questions/?search=${encodeURIComponent(safeSearch)}&order_by=-activity&limit=20&type=forecast`;
  } else {
    url = `${METACULUS_API}/questions/?order_by=-activity&limit=20&type=forecast`;
  }

  try {
    const data = await safeFetch(url);
    const results: MetaculusQuestion[] = [];

    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.results)) {
        results.push(...(d.results as MetaculusQuestion[]));
      } else if (Array.isArray(data)) {
        results.push(...(data as MetaculusQuestion[]));
      }
    }

    return results
      .map((q) => parseMetaculusQuestion(q, fetchedAt))
      .filter((m): m is MarketOdds => m !== null)
      .slice(0, 20);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[metaculus] fetch failed: ${msg}`);
    return [];
  }
}

// ─── ALL PLATFORMS ────────────────────────────────────

/**
 * Fetch odds from all three platforms in parallel.
 * Returns combined array sorted by platform.
 */
export async function fetchAllMarketOdds(query?: string): Promise<MarketOdds[]> {
  const [poly, kalshi, meta] = await Promise.allSettled([
    fetchPolymarketOdds(query),
    fetchKalshiOdds(undefined),
    fetchMetaculusOdds(query),
  ]);

  const results: MarketOdds[] = [];
  if (poly.status === 'fulfilled') results.push(...poly.value);
  if (kalshi.status === 'fulfilled') results.push(...kalshi.value);
  if (meta.status === 'fulfilled') results.push(...meta.value);
  return results;
}

// ─── ARBITRAGE DETECTION ─────────────────────────────

/**
 * Detect arbitrage opportunities across platforms for the same event.
 * Uses fuzzy title matching (shared keywords) to find equivalent markets.
 */
export function detectArbitrageOpportunities(markets: MarketOdds[]): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  // Group markets by keyword similarity
  const groups: MarketOdds[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < markets.length; i++) {
    if (assigned.has(i)) continue;
    const group: MarketOdds[] = [markets[i]];
    assigned.add(i);

    const keysA = extractKeywords(markets[i].title);

    for (let j = i + 1; j < markets.length; j++) {
      if (assigned.has(j)) continue;
      const keysB = extractKeywords(markets[j].title);
      const overlap = keysA.filter((k) => keysB.includes(k)).length;
      const similarity = overlap / Math.max(keysA.length, keysB.length, 1);

      if (similarity >= 0.4) {
        group.push(markets[j]);
        assigned.add(j);
      }
    }

    if (group.length >= 2) groups.push(group);
  }

  // For each group, check for odds divergence
  for (const group of groups) {
    const withOdds = group.filter((m) => m.yesOdds !== null);
    if (withOdds.length < 2) continue;

    const yesOddsMap: Record<string, number> = {};
    const noOddsMap: Record<string, number> = {};
    for (const m of withOdds) {
      yesOddsMap[m.platform] = m.yesOdds!;
      noOddsMap[m.platform] = m.noOdds ?? (100 - m.yesOdds!);
    }

    const yesValues = Object.values(yesOddsMap);
    const spread = Math.max(...yesValues) - Math.min(...yesValues);

    if (spread >= 3) {
      // Title for arbitrage is the most common/prominent market title
      const marketTitle = group.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0].title;

      opportunities.push({
        market: marketTitle,
        platforms: withOdds.map((m) => m.platform),
        yesOdds: yesOddsMap,
        noOdds: noOddsMap,
        spread: Math.round(spread * 100) / 100,
        description: `${spread.toFixed(1)}pp spread detected across ${withOdds.map((m) => m.platform).join(', ')}`,
      });
    }
  }

  return opportunities.sort((a, b) => b.spread - a.spread);
}

function extractKeywords(title: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'will', 'be', 'in', 'of', 'to', 'by', 'for', 'on',
    'at', 'or', 'and', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
    'it', 'its', 'that', 'this', 'with', 'as', 'from', 'than', 'not',
    'do', 'does', 'did', 'get', 'got', 'who', 'what', 'when', 'where',
    'how', 'which', 'into', 'up', 'out', 'about', 'over', 'after', 'before',
  ]);
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopwords.has(w))
    .slice(0, 15);
}
