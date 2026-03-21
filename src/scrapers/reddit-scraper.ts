/**
 * Reddit Scraper — uses Reddit's public JSON API via mobile proxy
 * Endpoint: https://www.reddit.com/search.json
 */

import { proxyFetch } from '../proxy';
import type { RedditPost } from '../types';

const REDDIT_BASE = 'https://www.reddit.com';

function calcEngagement(post: any): number {
  // Reddit: score + log(comments) weighted
  const score = Number(post.score || 0);
  const comments = Number(post.num_comments || 0);
  return score + Math.log1p(comments) * 10;
}

function mapPost(data: any): RedditPost {
  return {
    platform: 'reddit',
    id: data.id,
    title: data.title,
    subreddit: data.subreddit_name_prefixed || `r/${data.subreddit}`,
    author: data.author,
    score: Number(data.score || 0),
    upvoteRatio: Number(data.upvote_ratio || 0),
    numComments: Number(data.num_comments || 0),
    createdUtc: Number(data.created_utc || 0),
    permalink: `https://reddit.com${data.permalink}`,
    url: data.url,
    selftext: data.selftext?.slice(0, 500) || undefined,
    flair: data.link_flair_text || null,
    engagementScore: calcEngagement(data),
  };
}

/**
 * Search Reddit for posts matching a query within a time window.
 */
export async function searchReddit(
  query: string,
  days: number = 30,
  limit: number = 25,
  sort: string = 'relevance',
): Promise<RedditPost[]> {
  const timeParam = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'year';
  const url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${timeParam}&limit=${Math.min(limit, 100)}&type=link`;

  const res = await proxyFetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
    timeoutMs: 25_000,
  });

  if (!res.ok) {
    throw new Error(`Reddit search failed: HTTP ${res.status}`);
  }

  const data = await res.json() as any;
  const posts: RedditPost[] = [];

  for (const child of data?.data?.children || []) {
    if (child.kind === 't3' && child.data) {
      posts.push(mapPost(child.data));
    }
  }

  return posts;
}

/**
 * Get top posts from a specific subreddit.
 */
export async function getSubredditPosts(
  subreddit: string,
  sort: string = 'top',
  days: number = 30,
  limit: number = 25,
): Promise<RedditPost[]> {
  const timeParam = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'year';
  const url = `${REDDIT_BASE}/r/${subreddit}/${sort}.json?t=${timeParam}&limit=${Math.min(limit, 100)}`;

  const res = await proxyFetch(url, {
    headers: { 'Accept': 'application/json' },
    timeoutMs: 25_000,
  });

  if (!res.ok) throw new Error(`Reddit subreddit fetch failed: HTTP ${res.status}`);

  const data = await res.json() as any;
  const posts: RedditPost[] = [];

  for (const child of data?.data?.children || []) {
    if (child.kind === 't3' && child.data) {
      posts.push(mapPost(child.data));
    }
  }

  return posts;
}

/**
 * Search multiple relevant subreddits for a topic.
 */
export async function searchRedditBroad(
  topic: string,
  days: number = 30,
  limit: number = 50,
): Promise<RedditPost[]> {
  // Search broadly + also check top posts
  const [searchResults, hotResults] = await Promise.allSettled([
    searchReddit(topic, days, limit, 'relevance'),
    searchReddit(topic, days, Math.floor(limit / 2), 'top'),
  ]);

  const all: RedditPost[] = [];
  const seen = new Set<string>();

  const addPosts = (posts: RedditPost[]) => {
    for (const p of posts) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        all.push(p);
      }
    }
  };

  if (searchResults.status === 'fulfilled') addPosts(searchResults.value);
  if (hotResults.status === 'fulfilled') addPosts(hotResults.value);

  return all.sort((a, b) => b.engagementScore - a.engagementScore);
}
