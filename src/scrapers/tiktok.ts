/**
 * TikTok Trend Scraper
 *
 * Uses SearXNG to discover TikTok content without requiring TikTok API keys.
 * Queries SearXNG web engines with site:tiktok.com to surface indexed content.
 */

export interface TikTokResult {
  videoId: string | null;
  author: string | null;
  description: string;
  url: string;
  likes: number | null;
  views: number | null;
  engagementScore: number;
  publishedAt: string | null;
  platform: 'tiktok';
}

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

const SEARXNG_BASE = 'http://100.91.53.54:8890';
const BOT_UA = 'TrendBot/1.0 (Bolivian-Peru Trend Intelligence)';

const MAX_DESC_LENGTH = 500;
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

function isTikTokUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'tiktok.com' || hostname === 'www.tiktok.com'
      || hostname === 'm.tiktok.com';
  } catch {
    return false;
  }
}

function extractVideoId(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/video\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractAuthor(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1 && parts[0].startsWith('@')) {
      return sanitizeText(parts[0], MAX_AUTHOR_LENGTH) || null;
    }
  } catch {
    // not a valid URL
  }
  return null;
}

function mapSearXNGResult(raw: SearXNGWebResult): TikTokResult | null {
  const url = normalizeHttpUrl(raw.url);
  if (!url) return null;
  if (!isTikTokUrl(url)) return null;

  const titleStr = sanitizeText(raw.title, MAX_DESC_LENGTH);
  const contentStr = sanitizeText(raw.content, MAX_DESC_LENGTH);
  const description = contentStr || titleStr;
  if (!description) return null;

  const videoId = extractVideoId(url);
  const author = extractAuthor(url);

  const rawScore = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0;
  const engagementScore = Math.round(Math.min(rawScore * 100, 100) * 100) / 100;

  let publishedAt: string | null = null;
  if (typeof raw.publishedDate === 'string' && raw.publishedDate.trim()) {
    publishedAt = raw.publishedDate.trim().slice(0, 64);
  }

  return {
    videoId,
    author,
    description,
    url,
    likes: null,
    views: null,
    engagementScore,
    publishedAt,
    platform: 'tiktok',
  };
}

function deduplicateByUrl(results: TikTokResult[]): TikTokResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/**
 * Search TikTok content for a topic via SearXNG web engines.
 */
export async function searchTikTok(
  topic: string,
  days: number = 30,
  limit: number = 20,
): Promise<TikTokResult[]> {
  const safeTopic = sanitizeText(topic, MAX_TOPIC_LENGTH);
  if (!safeTopic) return [];

  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const timeRange = days > 30 ? 'year' : days > 7 ? 'month' : 'week';

  const queries = [
    `site:tiktok.com ${safeTopic}`,
    `${safeTopic} tiktok`,
  ];

  const collected: TikTokResult[] = [];

  for (const q of queries) {
    if (collected.length >= safeLimit) break;

    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=google,bing,brave&time_range=${timeRange}`;

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (!res.ok) continue;

      const payload = await res.json() as SearXNGResponse;
      if (!Array.isArray(payload?.results)) continue;

      for (const item of payload.results) {
        if (collected.length >= safeLimit) break;
        if (!item || typeof item !== 'object') continue;
        const mapped = mapSearXNGResult(item as SearXNGWebResult);
        if (mapped) collected.push(mapped);
      }
    } catch {
      continue;
    }
  }

  return deduplicateByUrl(collected).slice(0, safeLimit);
}

/**
 * Fetch trending TikTok content for a country via SearXNG.
 */
export async function getTikTokTrending(
  country: string = 'US',
  limit: number = 20,
): Promise<TikTokResult[]> {
  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const safeCountry = typeof country === 'string'
    ? country.trim().toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '')
    : 'US';
  const countryLabel = safeCountry || 'US';

  const year = new Date().getFullYear();
  const results: TikTokResult[] = [];

  const queries = [
    `site:tiktok.com trending viral ${countryLabel} ${year}`,
    `tiktok trending ${countryLabel} ${year}`,
  ];

  for (const q of queries) {
    if (results.length >= safeLimit) break;

    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=google,bing,brave`;

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (!res.ok) continue;

      const payload = await res.json() as SearXNGResponse;
      if (!Array.isArray(payload?.results)) continue;

      for (const item of payload.results) {
        if (results.length >= safeLimit) break;
        if (!item || typeof item !== 'object') continue;
        const mapped = mapSearXNGResult(item as SearXNGWebResult);
        if (mapped) results.push(mapped);
      }
    } catch {
      continue;
    }
  }

  return deduplicateByUrl(results).slice(0, safeLimit);
}
