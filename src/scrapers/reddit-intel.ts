/**
 * Reddit Intelligence API Scraper (Bounty #68)
 *
 * Endpoints:
 *   GET /api/reddit/search?query=keyword&subreddit=all&sort=relevance&time=week
 *   GET /api/reddit/trending?country=US
 *   GET /api/reddit/subreddit/:name/top?time=day
 *   GET /api/reddit/thread/:id/comments
 */

import { proxyFetch } from '../proxy';

// ─── SCRAPER ERROR ──────────────────────────

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

const BASE_URL = 'https://www.reddit.com';
const REDDIT_UA = 'RedditIntelligenceBot/1.0 (marketplace-service)';

interface FetchOpts {
  timeoutMs?: number;
  maxRetries?: number;
}

async function redditFetch(url: string, opts: FetchOpts = {}): Promise<any> {
  const { maxRetries = 2, timeoutMs = 20_000 } = opts;
  let lastErr: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      let response: Response;
      try {
        response = await proxyFetch(url, {
          headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
          timeoutMs,
          maxRetries: 0,
        });
      } catch {
        // Fallback to direct fetch if proxy not configured
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), timeoutMs);
          response = await fetch(url, {
            headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
            signal: ctrl.signal,
          });
          clearTimeout(t);
        } catch {
          throw new ScraperError('Proxy connection failed and direct fallback also failed', 502, true);
        }
      }

      if (response.status === 429) {
        if (i === maxRetries) throw new ScraperError('Reddit rate limited', 429, true);
        const retryAfter = parseInt(response.headers.get('retry-after') || '5');
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (response.status === 403) {
        throw new ScraperError('Reddit blocked access (403 Forbidden)', 403, false);
      }

      if (!response.ok) {
        throw new ScraperError(`Reddit API ${response.status}: ${response.statusText}`, response.status, true);
      }

      const text = await response.text();
      if (text.includes('captcha') || text.includes('challenge')) {
        throw new ScraperError('CAPTCHA challenge detected', 503, true);
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new ScraperError('Invalid JSON response from Reddit', 502, true);
      }
    } catch (e: any) {
      lastErr = e;
      if (e instanceof ScraperError) throw e; // Don't retry typed errors
      if (i < maxRetries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr ?? new ScraperError('Reddit fetch failed after retries', 502, true);
}

export interface RedditSearchResult {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  url: string;
  permalink: string;
  selftext: string;
  created: string;
  isNsfw: boolean;
  flair: string | null;
  awards: number;
  crosspostCount: number;
  mediaType: 'text' | 'image' | 'video' | 'link';
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created: string;
  isOp: boolean;
  depth: number;
  awards: number;
  replies: number;
}

export interface RedditThreadData {
  post: RedditSearchResult;
  comments: RedditComment[];
  totalComments: number;
}

function detectMediaType(post: any): 'text' | 'image' | 'video' | 'link' {
  if (post.is_video || post.media?.reddit_video) return 'video';
  if (post.post_hint === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(post.url || '')) return 'image';
  if (post.is_self) return 'text';
  return 'link';
}

function mapPost(raw: any): RedditSearchResult {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || '').slice(0, 300),
    subreddit: String(raw.subreddit || ''),
    author: String(raw.author || '[deleted]'),
    score: Math.max(0, Math.round(Number(raw.score) || 0)),
    upvoteRatio: Number(raw.upvote_ratio) || 0,
    numComments: Math.max(0, Math.round(Number(raw.num_comments) || 0)),
    url: String(raw.url || '').slice(0, 2048),
    permalink: `https://www.reddit.com${raw.permalink || ''}`,
    selftext: String(raw.selftext || '').slice(0, 1000),
    created: new Date((raw.created_utc || 0) * 1000).toISOString(),
    isNsfw: Boolean(raw.over_18),
    flair: raw.link_flair_text ? String(raw.link_flair_text).slice(0, 80) : null,
    awards: Math.max(0, Math.round(Number(raw.total_awards_received) || 0)),
    crosspostCount: Math.max(0, Math.round(Number(raw.num_crossposts) || 0)),
    mediaType: detectMediaType(raw),
  };
}

function parseListingPosts(data: any, limit: number): RedditSearchResult[] {
  const children = data?.data?.children;
  if (!Array.isArray(children)) return [];

  return children
    .filter((c: any) => c?.data?.id && c?.data?.title)
    .slice(0, limit)
    .map((c: any) => mapPost(c.data));
}

// ─── SEARCH ──────────────────────────────────

export async function searchRedditIntel(
  query: string,
  subreddit: string = 'all',
  sort: string = 'relevance',
  time: string = 'week',
  limit: number = 25,
): Promise<{ results: RedditSearchResult[]; query: string; subreddit: string; sort: string; time: string }> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const validSorts = ['relevance', 'hot', 'top', 'new', 'comments'];
  const validTimes = ['hour', 'day', 'week', 'month', 'year', 'all'];
  const safSort = validSorts.includes(sort) ? sort : 'relevance';
  const safTime = validTimes.includes(time) ? time : 'week';

  let url: string;
  if (subreddit && subreddit !== 'all') {
    url = `${BASE_URL}/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(query)}&sort=${safSort}&t=${safTime}&limit=${safeLimit}&restrict_sr=1`;
  } else {
    url = `${BASE_URL}/search.json?q=${encodeURIComponent(query)}&sort=${safSort}&t=${safTime}&limit=${safeLimit}`;
  }

  const data = await redditFetch(url);
  return {
    results: parseListingPosts(data, safeLimit),
    query,
    subreddit: subreddit || 'all',
    sort: safSort,
    time: safTime,
  };
}

// ─── TRENDING ────────────────────────────────

export async function getRedditTrending(
  limit: number = 25,
): Promise<{ results: RedditSearchResult[]; source: string }> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const url = `${BASE_URL}/r/all/hot.json?limit=${safeLimit}&geo_filter=US`;
  const data = await redditFetch(url);

  return {
    results: parseListingPosts(data, safeLimit),
    source: 'r/all/hot',
  };
}

// ─── SUBREDDIT TOP ───────────────────────────

export async function getSubredditTopIntel(
  subreddit: string,
  time: string = 'day',
  limit: number = 25,
): Promise<{ results: RedditSearchResult[]; subreddit: string; time: string }> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const validTimes = ['hour', 'day', 'week', 'month', 'year', 'all'];
  const safTime = validTimes.includes(time) ? time : 'day';

  const url = `${BASE_URL}/r/${encodeURIComponent(subreddit)}/top.json?t=${safTime}&limit=${safeLimit}`;
  const data = await redditFetch(url);

  return {
    results: parseListingPosts(data, safeLimit),
    subreddit,
    time: safTime,
  };
}

// ─── THREAD COMMENTS ─────────────────────────

function parseComments(children: any[], postAuthor: string, depth: number = 0, limit: number = 50): RedditComment[] {
  const comments: RedditComment[] = [];

  for (const child of children) {
    if (comments.length >= limit) break;
    if (child.kind !== 't1' || !child.data) continue;

    const d = child.data;
    comments.push({
      id: String(d.id || ''),
      author: String(d.author || '[deleted]'),
      body: String(d.body || '').slice(0, 2000),
      score: Math.round(Number(d.score) || 0),
      created: new Date((d.created_utc || 0) * 1000).toISOString(),
      isOp: d.author === postAuthor,
      depth,
      awards: Math.max(0, Math.round(Number(d.total_awards_received) || 0)),
      replies: Array.isArray(d.replies?.data?.children) ? d.replies.data.children.filter((c: any) => c.kind === 't1').length : 0,
    });

    // Recurse into replies (max depth 3)
    if (depth < 3 && d.replies?.data?.children) {
      const nested = parseComments(d.replies.data.children, postAuthor, depth + 1, limit - comments.length);
      comments.push(...nested);
    }
  }

  return comments;
}

export async function getThreadComments(
  threadId: string,
  sort: string = 'best',
  limit: number = 50,
): Promise<RedditThreadData> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const validSorts = ['best', 'top', 'new', 'controversial', 'old', 'qa'];
  const safSort = validSorts.includes(sort) ? sort : 'best';

  const url = `${BASE_URL}/comments/${encodeURIComponent(threadId)}.json?sort=${safSort}&limit=${safeLimit}`;
  const data = await redditFetch(url);

  if (!Array.isArray(data) || data.length < 2) {
    throw new Error('Invalid thread response from Reddit');
  }

  // data[0] = post listing, data[1] = comments listing
  const postChildren = data[0]?.data?.children;
  if (!postChildren?.length) throw new Error('Thread not found');

  const post = mapPost(postChildren[0].data);
  const commentChildren = data[1]?.data?.children || [];
  const comments = parseComments(commentChildren, postChildren[0].data.author, 0, safeLimit);

  return {
    post,
    comments,
    totalComments: post.numComments,
  };
}
