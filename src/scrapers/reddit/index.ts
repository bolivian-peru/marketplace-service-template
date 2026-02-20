/**
 * Reddit Intelligence — Public API
 * ─────────────────────────────────
 * Exports the 4 main functions consumed by service.ts:
 *   - searchReddit
 *   - getTrending
 *   - getSubredditTop
 *   - getThreadComments
 */

import { fetchReddit, getProxyExitIp, buildProxyMeta } from './fetch';
import { parseListing, parsePost, flattenComments } from './parse';
import type {
  RedditSearchResponse,
  RedditTrendingResponse,
  RedditSubredditResponse,
  RedditThreadResponse,
} from '../../types';

// Re-export error class for use in service.ts
export { RedditError } from './fetch';

/**
 * Search Reddit posts by keyword, optionally within a specific subreddit.
 */
export async function searchReddit(
  query: string,
  subreddit: string = 'all',
  sort: string = 'relevance',
  timeFilter: string = 'week',
  limit: number = 25,
): Promise<RedditSearchResponse> {
  const startTime = Date.now();

  let url: string;
  if (subreddit && subreddit !== 'all') {
    url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=${sort}&t=${timeFilter}&limit=${limit}&raw_json=1`;
  } else {
    url = `https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${timeFilter}&limit=${limit}&raw_json=1`;
  }

  const data = await fetchReddit(url);
  const { posts, after } = parseListing(data);
  const ip = await getProxyExitIp();

  console.log(`[REDDIT] Search "${query}" in ${subreddit} — ${posts.length} results`);

  return {
    results: posts,
    meta: {
      query,
      subreddit: subreddit || 'all',
      sort,
      time_filter: timeFilter,
      total_results: posts.length,
      proxy: buildProxyMeta(ip),
      scraped_at: new Date().toISOString(),
      response_time_ms: Date.now() - startTime,
    },
    pagination: {
      after,
      has_more: !!after,
    },
  };
}

/**
 * Get trending/popular posts (front page of Reddit or r/popular).
 */
export async function getTrending(
  country: string = 'US',
  limit: number = 25,
): Promise<RedditTrendingResponse> {
  const startTime = Date.now();

  const url = `https://old.reddit.com/r/popular.json?limit=${limit}&raw_json=1&geo_filter=${encodeURIComponent(country)}`;
  const data = await fetchReddit(url);
  const { posts } = parseListing(data);
  const ip = await getProxyExitIp();

  console.log(`[REDDIT] Trending (${country}) — ${posts.length} results`);

  return {
    results: posts,
    meta: {
      country,
      total_results: posts.length,
      proxy: buildProxyMeta(ip),
      scraped_at: new Date().toISOString(),
      response_time_ms: Date.now() - startTime,
    },
  };
}

/**
 * Get top posts from a specific subreddit.
 */
export async function getSubredditTop(
  subreddit: string,
  timeFilter: string = 'day',
  limit: number = 25,
): Promise<RedditSubredditResponse> {
  const startTime = Date.now();

  const url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?t=${timeFilter}&limit=${limit}&raw_json=1`;
  const data = await fetchReddit(url);
  const { posts, after } = parseListing(data);
  const ip = await getProxyExitIp();

  console.log(`[REDDIT] r/${subreddit}/top (${timeFilter}) — ${posts.length} results`);

  return {
    subreddit: `r/${subreddit}`,
    results: posts,
    meta: {
      time_filter: timeFilter,
      total_results: posts.length,
      proxy: buildProxyMeta(ip),
      scraped_at: new Date().toISOString(),
      response_time_ms: Date.now() - startTime,
    },
    pagination: {
      after,
      has_more: !!after,
    },
  };
}

/**
 * Get a Reddit thread (post + comments).
 */
export async function getThreadComments(
  threadId: string,
  limit: number = 200,
): Promise<RedditThreadResponse> {
  const startTime = Date.now();

  const url = `https://old.reddit.com/comments/${encodeURIComponent(threadId)}.json?limit=${Math.min(limit, 500)}&depth=5&raw_json=1`;
  const data = await fetchReddit(url);

  if (!Array.isArray(data) || data.length < 2) {
    throw new Error('Unexpected Reddit thread response format');
  }

  const postChild = data[0]?.data?.children?.[0];
  if (!postChild) {
    throw new Error('Thread post not found in Reddit response');
  }

  const post = parsePost(postChild);
  const commentChildren = data[1]?.data?.children || [];
  const comments = flattenComments(commentChildren, post.author, limit);
  const ip = await getProxyExitIp();

  console.log(`[REDDIT] Thread ${threadId} — ${comments.length} comments for "${post.title}"`);

  return {
    post,
    comments,
    meta: {
      thread_id: threadId,
      total_comments: post.num_comments,
      proxy: buildProxyMeta(ip),
      scraped_at: new Date().toISOString(),
      response_time_ms: Date.now() - startTime,
    },
  };
}
