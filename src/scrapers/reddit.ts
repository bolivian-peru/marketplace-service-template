/**
 * Reddit Scraper
 * Uses Reddit public JSON endpoints through the mobile proxy.
 */

// Direct fetch with mobile UA — Reddit public JSON works without proxy from clean IPs
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function directFetch(url: string, options: RequestInit & { timeoutMs?: number; maxRetries?: number } = {}): Promise<Response> {
  const { maxRetries = 2, timeoutMs = 20_000, headers = {}, ...rest } = options;
  let lastErr: Error | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        ...rest,
        headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json', ...headers as Record<string,string> },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      return res;
    } catch(e: any) {
      lastErr = e;
      if (i < maxRetries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr ?? new Error('fetch failed');
}

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  url: string;
  permalink: string;
  created: number;
  selftext: string;
  author: string;
  upvoteRatio: number;
  isVideo: boolean;
  flair: string | null;
  platform: 'reddit';
}

interface RedditApiPost {
  kind: string;
  data: {
    id: string;
    title: string;
    subreddit: string;
    score: number;
    num_comments: number;
    url: string;
    permalink: string;
    created_utc: number;
    selftext: string;
    author: string;
    upvote_ratio: number;
    is_video: boolean;
    link_flair_text: string | null;
  };
}

interface RedditApiResponse {
  data: {
    children: RedditApiPost[];
    after: string | null;
  };
}

const REDDIT_UA = 'TrendIntelligenceBot/1.0 (https://github.com/bolivian-peru/marketplace-service-template)';
const BASE_URL = 'https://www.reddit.com';
const DEFAULT_MAX_AGE_DAYS = 30;
const MAX_LIMIT = 100;
const MAX_TOPIC_LENGTH = 200;
const MAX_SUBREDDIT_LENGTH = 21;
const MAX_TITLE_LENGTH = 300;
const MAX_SELFTEXT_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 64;
const MAX_URL_LENGTH = 2048;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function isRecent(createdUtc: number, days: number): boolean {
  const cutoff = Date.now() / 1000 - days * 86400;
  return createdUtc >= cutoff;
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function normalizeHttpUrl(url: unknown, fallback = ''): string {
  if (typeof url !== 'string' || !url.trim()) return fallback;
  try {
    const parsed = new URL(url, BASE_URL);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback;
    }
    return parsed.toString().slice(0, MAX_URL_LENGTH);
  } catch {
    return fallback;
  }
}

function mapPost(raw: RedditApiPost['data']): RedditPost {
  return {
    id: sanitizeText(raw.id, 32),
    title: sanitizeText(raw.title, MAX_TITLE_LENGTH),
    subreddit: sanitizeText(raw.subreddit, MAX_SUBREDDIT_LENGTH),
    score: Number.isFinite(raw.score) ? Math.max(0, Math.round(raw.score)) : 0,
    numComments: Number.isFinite(raw.num_comments) ? Math.max(0, Math.round(raw.num_comments)) : 0,
    url: normalizeHttpUrl(raw.url, ''),
    permalink: normalizeHttpUrl(raw.permalink, `${BASE_URL}/`),
    created: Number.isFinite(raw.created_utc) ? raw.created_utc : 0,
    selftext: sanitizeText(raw.selftext, MAX_SELFTEXT_LENGTH),
    author: sanitizeText(raw.author, MAX_AUTHOR_LENGTH),
    upvoteRatio: Number.isFinite(raw.upvote_ratio) ? Math.min(Math.max(raw.upvote_ratio, 0), 1) : 0,
    isVideo: Boolean(raw.is_video),
    flair: raw.link_flair_text ? sanitizeText(raw.link_flair_text, 80) : null,
    platform: 'reddit',
  };
}

function parsePosts(payload: unknown, limit: number): RedditPost[] {
  const posts: RedditPost[] = [];

  const children = (payload as RedditApiResponse | undefined)?.data?.children;
  if (!Array.isArray(children)) return posts;

  for (const child of children) {
    if (posts.length >= limit) break;
    if (!child || typeof child !== 'object' || !('data' in child) || !child.data) continue;
    try {
      const mapped = mapPost(child.data);
      if (!mapped.id || !mapped.title) continue;
      posts.push(mapped);
    } catch {
      continue;
    }
  }

  return posts;
}

function getTimeFilter(days: number): 'day' | 'week' | 'month' | 'year' {
  if (days <= 1) return 'day';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'year';
}

function sanitizeTopic(topic: string): string {
  return sanitizeText(topic, MAX_TOPIC_LENGTH);
}

function sanitizeSubreddit(subreddit: string): string | null {
  const normalized = sanitizeText(subreddit, MAX_SUBREDDIT_LENGTH);
  if (!/^[A-Za-z0-9_]{2,21}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export async function searchReddit(
  topic: string,
  days: number = DEFAULT_MAX_AGE_DAYS,
  limit: number = 50,
): Promise<RedditPost[]> {
  const safeTopic = sanitizeTopic(topic);
  if (!safeTopic) return [];

  const safeDays = clamp(days, 1, 365);
  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const timeFilter = getTimeFilter(safeDays);

  const url = `${BASE_URL}/search.json?q=${encodeURIComponent(safeTopic)}&sort=top&t=${timeFilter}&limit=${safeLimit}&include_over_18=false`;

  const response = await directFetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      Accept: 'application/json',
    },
    timeoutMs: 20_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Reddit search failed: ${response.status} ${response.statusText}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Reddit search returned invalid JSON');
  }

  return parsePosts(data, safeLimit)
    .filter((p) => isRecent(p.created, safeDays))
    .slice(0, safeLimit);
}

export async function getRedditTrending(
  limit: number = 25,
): Promise<RedditPost[]> {
  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const url = `${BASE_URL}/r/all/hot.json?limit=${safeLimit}`;

  const response = await directFetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      Accept: 'application/json',
    },
    timeoutMs: 20_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Reddit trending failed: ${response.status} ${response.statusText}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Reddit trending returned invalid JSON');
  }

  return parsePosts(data, safeLimit).slice(0, safeLimit);
}

export async function getSubredditTop(
  subreddit: string,
  days: number = 7,
  limit: number = 25,
): Promise<RedditPost[]> {
  const safeSubreddit = sanitizeSubreddit(subreddit);
  if (!safeSubreddit) return [];

  const safeDays = clamp(days, 1, 365);
  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const timeFilter = getTimeFilter(safeDays);
  const url = `${BASE_URL}/r/${encodeURIComponent(safeSubreddit)}/top.json?t=${timeFilter}&limit=${safeLimit}`;

  const response = await directFetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      Accept: 'application/json',
    },
    timeoutMs: 20_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    return [];
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  return parsePosts(data, safeLimit)
    .filter((p) => isRecent(p.created, safeDays))
    .slice(0, safeLimit);
}
