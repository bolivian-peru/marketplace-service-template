/**
 * Twitter/X Scraper
 *
 * Uses self-hosted OpenSERP (http://100.91.53.54:7000) with DuckDuckGo engine
 * to surface indexed X/Twitter content without any Twitter API key.
 *
 * Strategy:
 *   searchTwitter  - queries OpenSERP with "site:x.com {topic}"
 *   getTwitterTrending - queries SearXNG Bing/Brave engines for Twitter trending signals
 *
 * Direct fetch() is used intentionally - these are our own self-hosted endpoints.
 */

export interface TwitterResult {
  tweetId: string | null;
  author: string | null;
  text: string;
  url: string;
  likes: number | null;
  retweets: number | null;
  engagementScore: number;
  publishedAt: string | null;
  platform: 'twitter';
}

// OpenSERP response shape
interface OpenSERPResult {
  rank?: unknown;
  url?: unknown;
  title?: unknown;
  description?: unknown;
  ad?: unknown;
  engine?: unknown;
}

// SearXNG general result (for Twitter trending via web engines)
interface SearXNGWebResult {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  score?: unknown;
  publishedDate?: unknown;
  engine?: unknown;
  engines?: unknown;
}

interface SearXNGResponse {
  results?: SearXNGWebResult[];
}

const OPENSERP_BASE = 'http://100.91.53.54:7000';
const SEARXNG_BASE = 'http://100.91.53.54:8890';
const BOT_UA = 'TrendBot/1.0 (Bolivian-Peru Trend Intelligence)';

const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 64;
const MAX_LIMIT = 50;
const MAX_TOPIC_LENGTH = 200;
const TIMEOUT_MS = 15_000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

/**
 * Check whether a URL belongs to x.com or twitter.com.
 */
function isTwitterUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'x.com' || hostname === 'twitter.com'
      || hostname === 'www.x.com' || hostname === 'www.twitter.com';
  } catch {
    return false;
  }
}

/**
 * Extract tweet ID from a /status/ URL.
 *   https://x.com/username/status/1234567890
 *   https://twitter.com/username/status/1234567890
 */
function extractTweetId(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract a username from a Twitter/X URL path.
 *   /username/status/... => username
 */
function extractAuthor(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    // pathname is /username/status/... or /username
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      const handle = parts[0];
      // Skip known non-user paths
      if (['i', 'search', 'explore', 'home', 'settings', 'help'].includes(handle.toLowerCase())) {
        return null;
      }
      return sanitizeText(`@${handle}`, MAX_AUTHOR_LENGTH) || null;
    }
  } catch {
    // not a valid URL
  }
  return null;
}

/**
 * Build the best available text from a search result's title + description.
 * The title often repeats the username/handle; description has the tweet text.
 */
function buildTweetText(title: unknown, description: unknown): string {
  const titleStr = sanitizeText(title, MAX_TITLE_LENGTH);
  const descStr = sanitizeText(description, MAX_TEXT_LENGTH);
  // Prefer description (usually the actual tweet content) over the generic title
  const best = descStr || titleStr;
  return best.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Map a raw OpenSERP result to a TwitterResult.
 * Returns null if the URL is not from x.com/twitter.com.
 */
function mapOpenSERPResult(raw: OpenSERPResult): TwitterResult | null {
  const url = normalizeHttpUrl(raw.url);
  if (!url) return null;
  if (!isTwitterUrl(url)) return null;

  const text = buildTweetText(raw.title, raw.description);
  if (!text) return null;

  const tweetId = extractTweetId(url);
  const author = tweetId ? extractAuthor(url) : null;

  // Rank-based engagement score: rank 1 => score 1.0, rank N => 1/N, normalised to 0-100
  const rank = typeof raw.rank === 'number' && raw.rank > 0 ? raw.rank : 10;
  const engagementScore = Math.round((1 / rank) * 100 * 100) / 100;

  return {
    tweetId,
    author,
    text,
    url,
    likes: null,
    retweets: null,
    engagementScore,
    publishedAt: null,
    platform: 'twitter',
  };
}

/**
 * Map a SearXNG web result (Bing/Brave engine) to a TwitterResult.
 * Used for trending fallback.
 */
function mapSearXNGResult(raw: SearXNGWebResult): TwitterResult | null {
  const url = normalizeHttpUrl(raw.url);
  if (!url) return null;
  if (!isTwitterUrl(url)) return null;

  const text = buildTweetText(raw.title, raw.content);
  if (!text) return null;

  const tweetId = extractTweetId(url);
  const author = tweetId ? extractAuthor(url) : null;

  const rawScore = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0;
  const engagementScore = Math.round(Math.min(rawScore * 100, 100) * 100) / 100;

  let publishedAt: string | null = null;
  if (typeof raw.publishedDate === 'string' && raw.publishedDate.trim()) {
    publishedAt = raw.publishedDate.trim().slice(0, 64);
  }

  return {
    tweetId,
    author,
    text,
    url,
    likes: null,
    retweets: null,
    engagementScore,
    publishedAt,
    platform: 'twitter',
  };
}

function deduplicateByUrl(results: TwitterResult[]): TwitterResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/**
 * Search Twitter/X content for a topic via OpenSERP (DDG engine).
 *
 * @param topic  - keyword or phrase to search
 * @param days   - included as a query hint (DDG has no native date filter)
 * @param limit  - max results (capped at 50)
 */
export async function searchTwitter(
  topic: string,
  days: number = 30,
  limit: number = 20,
): Promise<TwitterResult[]> {
  const safeTopic = sanitizeText(topic, MAX_TOPIC_LENGTH);
  if (!safeTopic) return [];

  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  // Multiple query variants because engines index X content inconsistently.
  const queries = [
    `site:x.com ${safeTopic}`,
    `${safeTopic} x.com`,
    `${safeTopic} from:twitter`,
  ];

  const engines = ['google,bing,duckduckgo', 'google,bing', 'google'];
  const timeRange = days > 30 ? 'year' : days > 7 ? 'month' : 'week';

  const collected: TwitterResult[] = [];

  for (const q of queries) {
    for (const engineSet of engines) {
      if (collected.length >= safeLimit) break;

      const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=${engineSet}&time_range=${timeRange}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
        });

        if (!res.ok) continue;

        const payload = await res.json() as { results?: unknown[] };
        const results = Array.isArray(payload?.results) ? payload.results : [];

        for (const item of results) {
          if (collected.length >= safeLimit) break;
          if (!item || typeof item !== 'object') continue;
          const mapped = mapSearXNGResult(item as SearXNGWebResult);
          if (mapped) collected.push(mapped);
        }
      } catch {
        continue;
      }
    }
    if (collected.length >= safeLimit) break;
  }

  return deduplicateByUrl(collected).slice(0, safeLimit);
}

/**
 * Fetch Twitter trending signals for a country.
 *
 * Strategy: query SearXNG with Bing and Brave engines for Twitter trending pages,
 * then fall back to OpenSERP if SearXNG returns no Twitter URLs.
 *
 * @param country - ISO-3166-1 alpha-2 country code used as query hint
 * @param limit   - max results (capped at 50)
 */
export async function getTwitterTrending(
  country: string = 'US',
  limit: number = 20,
): Promise<TwitterResult[]> {
  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  const safeCountry = typeof country === 'string'
    ? country.trim().toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '')
    : 'US';
  const countryLabel = safeCountry || 'US';

  const year = new Date().getFullYear();
  const results: TwitterResult[] = [];

  // ---- Attempt 1: SearXNG with Bing + Brave engines ----
  // These engines index Twitter content and often surface trending threads.
  const searxQuery = `site:x.com trending ${countryLabel} ${year}`;
  const searxUrl = `${SEARXNG_BASE}/search?q=${encodeURIComponent(searxQuery)}&format=json&engines=bing,brave`;

  try {
    const res = await fetch(searxUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });

    if (res.ok) {
      const payload = await res.json() as SearXNGResponse;
      if (Array.isArray(payload?.results)) {
        for (const item of payload.results) {
          if (results.length >= safeLimit) break;
          if (!item || typeof item !== 'object') continue;
          try {
            const mapped = mapSearXNGResult(item as SearXNGWebResult);
            if (mapped) results.push(mapped);
          } catch {
            continue;
          }
        }
      }
    } else if (res.status !== 429) {
      console.error(`[twitter] SearXNG error ${res.status} for trending`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[twitter] SearXNG trending fetch failed, will try OpenSERP fallback:', msg);
  }

  // ---- Attempt 2: OpenSERP fallback if we have fewer results than requested ----
  if (results.length < safeLimit) {
    const openSerpQuery = `site:x.com trending ${countryLabel} ${year}`;
    const openSerpUrl = `${OPENSERP_BASE}/mega/search?text=${encodeURIComponent(openSerpQuery)}`;

    try {
      const res = await fetch(openSerpUrl, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (res.ok) {
        const rawResults = await res.json();
        if (Array.isArray(rawResults)) {
          for (const item of rawResults) {
            if (results.length >= safeLimit) break;
            if (!item || typeof item !== 'object') continue;
            try {
              const mapped = mapOpenSERPResult(item as OpenSERPResult);
              if (mapped) results.push(mapped);
            } catch {
              continue;
            }
          }
        }
      } else if (res.status === 429) {
        console.warn('[twitter] OpenSERP rate-limited (429) for trending');
      } else {
        console.error(`[twitter] OpenSERP error ${res.status} for trending`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[twitter] OpenSERP trending fetch failed:', msg);
    }
  }

  return deduplicateByUrl(results).slice(0, safeLimit);
}
