/**
 * Reddit Intelligence Scraper (Bounty #68)
 * ─────────────────────────────────────────
 * Scrapes Reddit posts, subreddit feeds, trending topics, and comment
 * threads using Reddit's public JSON endpoints via mobile proxy.
 *
 * Reddit killed free API access in 2023. This provides the same data
 * through authenticated mobile carrier IPs that Reddit trusts.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface RedditPost {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
  url: string;
  isSelf: boolean;
  flair: string | null;
  awards: number;
  over18: boolean;
}

export interface RedditComment {
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  depth: number;
  replies: RedditComment[];
}

export interface SearchResult {
  posts: RedditPost[];
  after: string | null;
}

export interface CommentResult {
  post: RedditPost;
  comments: RedditComment[];
}

// ─── HELPERS ────────────────────────────────────────

const REDDIT_BASE = 'https://www.reddit.com';

function parsePost(data: any): RedditPost {
  return {
    title: data.title || '',
    selftext: (data.selftext || '').slice(0, 5000),
    author: data.author || '[deleted]',
    subreddit: data.subreddit || '',
    score: data.score ?? 0,
    upvoteRatio: data.upvote_ratio ?? 0,
    numComments: data.num_comments ?? 0,
    createdUtc: data.created_utc ?? 0,
    permalink: data.permalink || '',
    url: data.url || '',
    isSelf: data.is_self ?? false,
    flair: data.link_flair_text || null,
    awards: data.total_awards_received ?? 0,
    over18: data.over_18 ?? false,
  };
}

function parseComment(data: any, depth: number = 0): RedditComment | null {
  if (!data || data.kind !== 't1') return null;
  const d = data.data;
  if (!d || d.author === '[deleted]' && d.body === '[removed]') return null;

  const replies: RedditComment[] = [];
  if (d.replies && d.replies.data?.children) {
    for (const child of d.replies.data.children) {
      const parsed = parseComment(child, depth + 1);
      if (parsed) replies.push(parsed);
    }
  }

  return {
    author: d.author || '[deleted]',
    body: (d.body || '').slice(0, 3000),
    score: d.score ?? 0,
    createdUtc: d.created_utc ?? 0,
    depth,
    replies,
  };
}

async function redditFetch(path: string): Promise<any> {
  const url = `${REDDIT_BASE}${path}`;
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'application/json, text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (response.status === 429) {
    throw new Error('Reddit rate limit hit — try again shortly');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // Check if we got an HTML page instead of JSON (rate limit page)
    if (text.includes('<html') || text.includes('<!DOCTYPE')) {
      throw new Error(`Reddit returned HTML instead of JSON (status ${response.status}) — likely rate-limited`);
    }
    throw new Error(`Reddit returned ${response.status}: ${text.slice(0, 200)}`);
  }

  const text = await response.text();
  // Reddit sometimes returns HTML even on .json URLs when rate-limited
  if (text.startsWith('<') || text.startsWith('<!')) {
    throw new Error('Reddit returned HTML instead of JSON — rate-limited by IP');
  }

  return JSON.parse(text);
}

// ─── PUBLIC API ─────────────────────────────────────

/**
 * Search Reddit posts by keyword.
 */
export async function searchReddit(
  query: string,
  sort: string = 'relevance',
  time: string = 'all',
  limit: number = 25,
  after?: string,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: query,
    sort,
    t: time,
    limit: String(Math.min(limit, 100)),
    restrict_sr: '',
    type: 'link',
  });
  if (after) params.set('after', after);

  const data = await redditFetch(`/search.json?${params}`);
  const children = data?.data?.children || [];

  return {
    posts: children.map((c: any) => parsePost(c.data)),
    after: data?.data?.after || null,
  };
}

/**
 * Get posts from a specific subreddit.
 */
export async function getSubreddit(
  subreddit: string,
  sort: string = 'hot',
  time: string = 'all',
  limit: number = 25,
  after?: string,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    limit: String(Math.min(limit, 100)),
    t: time,
  });
  if (after) params.set('after', after);

  const sub = subreddit.replace(/^\/?(r\/)?/, '');
  const data = await redditFetch(`/r/${sub}/${sort}.json?${params}`);
  const children = data?.data?.children || [];

  return {
    posts: children.map((c: any) => parsePost(c.data)),
    after: data?.data?.after || null,
  };
}

/**
 * Get trending/popular posts across Reddit.
 */
export async function getTrending(
  limit: number = 25,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    limit: String(Math.min(limit, 100)),
  });

  const data = await redditFetch(`/r/popular/hot.json?${params}`);
  const children = data?.data?.children || [];

  return {
    posts: children.map((c: any) => parsePost(c.data)),
    after: data?.data?.after || null,
  };
}

/**
 * Fetch comments for a specific post.
 */
export async function getComments(
  permalink: string,
  sort: string = 'best',
  limit: number = 50,
): Promise<CommentResult> {
  // Normalize permalink
  let path = permalink;
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.endsWith('/')) path += '/';

  const params = new URLSearchParams({
    sort,
    limit: String(Math.min(limit, 200)),
  });

  const data = await redditFetch(`${path}.json?${params}`);

  // Reddit returns an array: [post_listing, comments_listing]
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error('Unexpected response format for comments');
  }

  const postData = data[0]?.data?.children?.[0]?.data;
  const commentChildren = data[1]?.data?.children || [];

  const comments: RedditComment[] = [];
  for (const child of commentChildren) {
    const parsed = parseComment(child);
    if (parsed) comments.push(parsed);
  }

  return {
    post: parsePost(postData || {}),
    comments,
  };
}