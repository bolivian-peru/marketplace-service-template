/**
 * Reddit Intelligence — Response Parsers
 * ───────────────────────────────────────
 * Transforms raw Reddit JSON into structured RedditPost / RedditComment objects.
 * Handles both old.reddit.com JSON API format and edge cases.
 */

import type { RedditPost, RedditComment } from '../../types';

/**
 * Parse a Reddit "t3" (link/post) listing child into a RedditPost.
 */
export function parsePost(child: any): RedditPost {
  const d = child?.data || child;
  const selftext = d.selftext || '';

  return {
    id: d.id || '',
    title: d.title || '',
    subreddit: `r/${d.subreddit || ''}`,
    author: d.author || '[deleted]',
    score: d.score || 0,
    num_comments: d.num_comments || 0,
    url: d.url || '',
    permalink: d.permalink ? `https://reddit.com${d.permalink}` : '',
    created_utc: d.created_utc || 0,
    body_preview: selftext.slice(0, 500),
    selftext: selftext.slice(0, 5000),
    thumbnail: isValidThumbnail(d.thumbnail) ? d.thumbnail : null,
    is_video: d.is_video || false,
    over_18: d.over_18 || false,
    link_flair_text: d.link_flair_text || null,
    upvote_ratio: d.upvote_ratio || 0,
    awards: d.total_awards_received || 0,
  };
}

function isValidThumbnail(thumb: string | null | undefined): boolean {
  if (!thumb) return false;
  const invalid = ['self', 'default', 'nsfw', 'spoiler', 'image', ''];
  return !invalid.includes(thumb) && thumb.startsWith('http');
}

/**
 * Parse a Reddit "t1" (comment) into a RedditComment.
 */
export function parseComment(child: any, opAuthor: string): RedditComment {
  const d = child?.data || child;
  const replies = d.replies?.data?.children || [];

  return {
    id: d.id || '',
    author: d.author || '[deleted]',
    body: (d.body || '').slice(0, 5000),
    score: d.score || 0,
    created_utc: d.created_utc || 0,
    replies_count: replies.filter((r: any) => r.kind === 't1').length,
    is_op: d.author === opAuthor,
    depth: d.depth || 0,
    permalink: d.permalink ? `https://reddit.com${d.permalink}` : '',
  };
}

/**
 * Recursively flatten a Reddit comment tree into a flat array.
 */
export function flattenComments(children: any[], opAuthor: string, limit: number): RedditComment[] {
  const comments: RedditComment[] = [];

  for (const child of children) {
    if (comments.length >= limit) break;
    if (child.kind !== 't1') continue;

    comments.push(parseComment(child, opAuthor));

    const replies = child.data?.replies?.data?.children || [];
    if (replies.length > 0 && comments.length < limit) {
      const nested = flattenComments(replies, opAuthor, limit - comments.length);
      comments.push(...nested);
    }
  }

  return comments;
}

/**
 * Parse a Reddit listing response into an array of posts.
 */
export function parseListing(data: any): { posts: RedditPost[]; after: string | null } {
  const children = data?.data?.children || [];
  const posts = children
    .filter((c: any) => c.kind === 't3')
    .map(parsePost);

  return {
    posts,
    after: data?.data?.after || null,
  };
}
