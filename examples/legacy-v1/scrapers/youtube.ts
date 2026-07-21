/**
 * YouTube Scraper
 *
 * Uses self-hosted SearXNG (http://100.91.53.54:8890) with the YouTube engine.
 * No YouTube API key required.
 *
 * Direct fetch() is used intentionally - these are our own self-hosted endpoints,
 * not external sites, so proxyFetch is not needed or appropriate here.
 */

export interface YouTubeResult {
  videoId: string;
  title: string;
  url: string;
  channelName: string | null;
  viewCount: number | null;
  description: string;
  publishedAt: string | null;
  engagementScore: number;
  platform: 'youtube';
}

// SearXNG response shape (youtube engine returns video template fields)
interface SearXNGVideoResult {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  author?: unknown;
  publishedDate?: unknown;
  score?: unknown;
  engine?: unknown;
  engines?: unknown;
  iframe_src?: unknown;
  thumbnail?: unknown;
}

interface SearXNGResponse {
  results?: SearXNGVideoResult[];
  query?: string;
}

const SEARXNG_BASE = 'http://100.91.53.54:8890';
const BOT_UA = 'TrendBot/1.0 (Bolivian-Peru Trend Intelligence)';

const MAX_TITLE_LENGTH = 300;
const MAX_DESC_LENGTH = 500;
const MAX_CHANNEL_LENGTH = 100;
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
 * Extract a YouTube video ID from a watch URL.
 * Handles:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 */
function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('?')[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = parsed.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  } catch {
    // not a valid URL
  }
  return null;
}

/**
 * Map a raw SearXNG result to a YouTubeResult.
 * Returns null if the result is not a valid YouTube video entry.
 */
function mapResult(raw: SearXNGVideoResult): YouTubeResult | null {
  const url = normalizeHttpUrl(raw.url);
  if (!url) return null;

  const videoId = extractVideoId(url);
  if (!videoId) return null;

  const title = sanitizeText(raw.title, MAX_TITLE_LENGTH);
  if (!title) return null;

  const description = sanitizeText(raw.content, MAX_DESC_LENGTH);
  const channelName = raw.author ? sanitizeText(raw.author, MAX_CHANNEL_LENGTH) : null;

  // publishedDate comes back as ISO string or null from SearXNG youtube engine
  let publishedAt: string | null = null;
  if (typeof raw.publishedDate === 'string' && raw.publishedDate.trim()) {
    publishedAt = raw.publishedDate.trim().slice(0, 64);
  }

  // SearXNG score is position-weighted (1/rank). Normalise to 0-100.
  const rawScore = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0;
  const engagementScore = Math.round(Math.min(rawScore * 100, 100) * 100) / 100;

  return {
    videoId,
    title,
    url,
    channelName: channelName || null,
    viewCount: null, // not available from SearXNG without scraping the video page
    description,
    publishedAt,
    engagementScore,
    platform: 'youtube',
  };
}

/**
 * Parse and deduplicate a SearXNG JSON response into YouTubeResult[].
 */
function parseResults(payload: unknown, limit: number): YouTubeResult[] {
  const results: YouTubeResult[] = [];
  const seen = new Set<string>();

  const raw = payload as SearXNGResponse | undefined;
  if (!Array.isArray(raw?.results)) return results;

  for (const item of raw.results) {
    if (results.length >= limit) break;
    if (!item || typeof item !== 'object') continue;
    try {
      const mapped = mapResult(item as SearXNGVideoResult);
      if (!mapped) continue;
      if (seen.has(mapped.videoId)) continue;
      seen.add(mapped.videoId);
      results.push(mapped);
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * Search YouTube for videos matching a topic via SearXNG.
 *
 * @param topic  - keyword or phrase to search
 * @param days   - recency hint appended to query (SearXNG does not support date filtering natively)
 * @param limit  - max results to return (capped at 50)
 */
export async function searchYouTube(
  topic: string,
  days: number = 30,
  limit: number = 20,
): Promise<YouTubeResult[]> {
  const safeTopic = sanitizeText(topic, MAX_TOPIC_LENGTH);
  if (!safeTopic) return [];

  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  // Append a year hint when the window is short to bias toward fresh content.
  // SearXNG youtube engine has no native date filter, so we embed it in the query.
  const yearHint = days <= 90 ? ` ${new Date().getFullYear()}` : '';
  const query = `${safeTopic}${yearHint}`;

  const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(query)}&format=json&engines=youtube`;

  let payload: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });

    if (res.status === 429) {
      console.warn('[youtube] SearXNG rate-limited (429) for topic:', safeTopic);
      return [];
    }
    if (!res.ok) {
      console.error(`[youtube] SearXNG error ${res.status} for topic: ${safeTopic}`);
      return [];
    }

    payload = await res.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[youtube] SearXNG fetch failed:', msg);
    return [];
  }

  return parseResults(payload, safeLimit);
}

/**
 * Fetch YouTube trending videos for a country via SearXNG.
 * SearXNG does not expose a dedicated trending endpoint, so we approximate
 * by querying for "trending" filtered to the YouTube engine.
 *
 * @param country - ISO-3166-1 alpha-2 country code (used as query hint)
 * @param limit   - max results (capped at 50)
 */
export async function getYouTubeTrending(
  country: string = 'US',
  limit: number = 20,
): Promise<YouTubeResult[]> {
  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  // Normalise country to uppercase 2-letter code
  const safeCountry = typeof country === 'string'
    ? country.trim().toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '')
    : 'US';
  const countryLabel = safeCountry || 'US';

  const year = new Date().getFullYear();
  // Build a query that biases SearXNG toward trending/popular recent content
  const query = `trending viral popular ${year} ${countryLabel}`;

  const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(query)}&format=json&engines=youtube`;

  let payload: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });

    if (res.status === 429) {
      console.warn('[youtube] SearXNG rate-limited (429) for trending, country:', countryLabel);
      return [];
    }
    if (!res.ok) {
      console.error(`[youtube] SearXNG error ${res.status} for trending`);
      return [];
    }

    payload = await res.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[youtube] SearXNG trending fetch failed:', msg);
    return [];
  }

  return parseResults(payload, safeLimit);
}
