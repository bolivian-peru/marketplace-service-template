/**
 * Reddit Scraper
 * ──────────────
 * Uses the public Reddit JSON API. No auth required.
 * All requests route through the mobile proxy for reliability.
 *
 * Reddit requires a non-empty User-Agent and rate-limits aggressively
 * on datacenter IPs. Mobile proxy + descriptive UA resolves both.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  url: string;
  permalink: string;
  created: number; // Unix timestamp
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

// ─── CONSTANTS ──────────────────────────────────────

const REDDIT_UA = 'TrendIntelligenceBot/1.0 (https://github.com/bolivian-peru/marketplace-service-template)';
const BASE_URL = 'https://www.reddit.com';
const MAX_AGE_DAYS = 30;

// ─── HELPERS ────────────────────────────────────────

function isRecent(createdUtc: number, days: number): boolean {
  const cutoff = Date.now() / 1000 - days * 86400;
  return createdUtc >= cutoff;
}

function mapPost(raw: RedditApiPost['data']): RedditPost {
  return {
    id: raw.id,
    title: raw.title,
    subreddit: raw.subreddit,
    score: raw.score,
    numComments: raw.num_comments,
    url: raw.url,
    permalink: `${BASE_URL}${raw.permalink}`,
    created: raw.created_utc,
    selftext: raw.selftext?.slice(0, 500) ?? '',
    author: raw.author,
    upvoteRatio: raw.upvote_ratio,
    isVideo: raw.is_video,
    flair: raw.link_flair_text,
    platform: 'reddit',
  };
}

// ─── PUBLIC API ─────────────────────────────────────

/**
 * Search Reddit for posts matching a topic.
 * Returns posts sorted by top, filtered to the requested time window.
 */
export async function searchReddit(
  topic: string,
  days: number = MAX_AGE_DAYS,
  limit: number = 50,
): Promise<RedditPost[]> {
  const timeFilter = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'year';
  const url = `${BASE_URL}/search.json?q=${encodeURIComponent(topic)}&sort=top&t=${timeFilter}&limit=${Math.min(limit, 100)}&include_over_18=false`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      'Accept': 'application/json',
    },
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    throw new Error(`Reddit search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as RedditApiResponse;
  const posts = data?.data?.children ?? [];

  return posts
    .map((p) => mapPost(p.data))
    .filter((p) => isRecent(p.created, days))
    .slice(0, limit);
}

/**
 * Fetch currently trending/hot posts from r/all.
 * Used for the GET /api/trending endpoint.
 */
export async function getRedditTrending(
  limit: number = 25,
): Promise<RedditPost[]> {
  const url = `${BASE_URL}/r/all/hot.json?limit=${Math.min(limit, 100)}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      'Accept': 'application/json',
    },
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    throw new Error(`Reddit trending failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as RedditApiResponse;
  const posts = data?.data?.children ?? [];

  return posts.map((p) => mapPost(p.data)).slice(0, limit);
}

/**
 * Fetch top posts from a specific subreddit - useful for targeted research.
 */
export async function getSubredditTop(
  subreddit: string,
  days: number = 7,
  limit: number = 25,
): Promise<RedditPost[]> {
  const timeFilter = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'year';
  const url = `${BASE_URL}/r/${encodeURIComponent(subreddit)}/top.json?t=${timeFilter}&limit=${Math.min(limit, 100)}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      'Accept': 'application/json',
    },
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    // Subreddit may be private/banned - not fatal
    return [];
  }

  const data = await response.json() as RedditApiResponse;
  const posts = data?.data?.children ?? [];

  return posts
    .map((p) => mapPost(p.data))
    .filter((p) => isRecent(p.created, days))
    .slice(0, limit);
}
