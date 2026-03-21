/**
 * X/Twitter Scraper — uses Nitter instances via mobile proxy
 * Falls back gracefully if blocked.
 * Scrapes: search results, trending topics.
 */

import { proxyFetch } from '../proxy';
import type { XPost, XTrend } from '../types';

// Nitter public instances (tried in order)
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.cz',
  'https://nitter.1d4.us',
  'https://nitter.kavin.rocks',
];

// Twitter's syndication API (no auth required for basic search)
const TWITTER_SYNDICATION = 'https://syndication.twitter.com';

function parseNitterPost(html: string, baseUrl: string): XPost[] {
  const posts: XPost[] = [];

  // Extract tweet containers
  const tweetBlocks = html.split('<div class="timeline-item"').slice(1);

  for (const block of tweetBlocks) {
    try {
      // Extract tweet ID
      const idMatch = block.match(/href="\/[^/]+\/status\/(\d+)/);
      const id = idMatch?.[1] || `x_${Date.now()}_${Math.random()}`;

      // Extract author
      const authorMatch = block.match(/<a class="username"[^>]*>@?([^<]+)<\/a>/);
      const author = authorMatch?.[1]?.trim() || 'unknown';

      // Extract text
      const textMatch = block.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      const rawText = textMatch?.[1] || '';
      const text = rawText.replace(/<[^>]+>/g, '').trim().slice(0, 280);

      if (!text) continue;

      // Extract stats
      const likesMatch = block.match(/icon-heart[^>]*>[\s\S]*?<\/span>\s*(\d[\d,]*)/);
      const rtMatch = block.match(/icon-retweet[^>]*>[\s\S]*?<\/span>\s*(\d[\d,]*)/);
      const replyMatch = block.match(/icon-comment[^>]*>[\s\S]*?<\/span>\s*(\d[\d,]*)/);

      const likes = parseInt((likesMatch?.[1] || '0').replace(/,/g, '')) || 0;
      const retweets = parseInt((rtMatch?.[1] || '0').replace(/,/g, '')) || 0;
      const replies = parseInt((replyMatch?.[1] || '0').replace(/,/g, '')) || 0;

      // Extract date
      const dateMatch = block.match(/title="([^"]+)"[^>]*class="tweet-date"/);
      const createdAt = dateMatch?.[1] || new Date().toISOString();

      const engagementScore = likes + retweets * 2 + replies * 0.5;

      posts.push({
        platform: 'x',
        id,
        author: `@${author}`,
        text,
        likes,
        retweets,
        replies,
        createdAt,
        url: `https://twitter.com/${author}/status/${id}`,
        engagementScore,
      });
    } catch {
      // Skip malformed tweet
    }
  }

  return posts;
}

async function tryNitterSearch(query: string, days: number, limit: number): Promise<XPost[]> {
  const timeFilter = days <= 1 ? 'h' : days <= 7 ? 'w' : 'm';
  const since = new Date(Date.now() - days * 86400_000).toISOString().split('T')[0];
  const searchQuery = `${query} since:${since}`;

  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/search?f=tweets&q=${encodeURIComponent(searchQuery)}&src=typed_query`;
      const res = await proxyFetch(url, { timeoutMs: 20_000, maxRetries: 1 });

      if (!res.ok) continue;

      const html = await res.text();
      const posts = parseNitterPost(html, instance);

      if (posts.length > 0) {
        return posts.slice(0, limit);
      }
    } catch {
      // Try next instance
    }
  }

  return [];
}

async function tryTwitterSyndication(query: string): Promise<XPost[]> {
  // Twitter's public syndication API for search
  try {
    const url = `${TWITTER_SYNDICATION}/search/universal.json?q=${encodeURIComponent(query)}&count=20&f=realtime`;
    const res = await proxyFetch(url, {
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://twitter.com/',
      },
      timeoutMs: 20_000,
      maxRetries: 1,
    });

    if (!res.ok) return [];

    const data = await res.json() as any;
    const posts: XPost[] = [];

    for (const item of data?.modules || []) {
      const tweet = item?.status?.data;
      if (!tweet) continue;

      const likes = tweet.favorite_count || 0;
      const retweets = tweet.retweet_count || 0;
      const replies = tweet.reply_count || 0;

      posts.push({
        platform: 'x',
        id: tweet.id_str || tweet.id,
        author: `@${tweet.user?.screen_name || 'unknown'}`,
        text: tweet.full_text || tweet.text || '',
        likes,
        retweets,
        replies,
        createdAt: tweet.created_at || new Date().toISOString(),
        url: `https://twitter.com/${tweet.user?.screen_name}/status/${tweet.id_str}`,
        engagementScore: likes + retweets * 2 + replies * 0.5,
      });
    }

    return posts;
  } catch {
    return [];
  }
}

/**
 * Search X/Twitter for posts about a topic.
 */
export async function searchX(
  topic: string,
  days: number = 30,
  limit: number = 20,
): Promise<XPost[]> {
  const [nitterPosts, syndPosts] = await Promise.allSettled([
    tryNitterSearch(topic, days, limit),
    tryTwitterSyndication(topic),
  ]);

  const all: XPost[] = [];
  const seen = new Set<string>();

  const addPosts = (posts: XPost[]) => {
    for (const p of posts) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        all.push(p);
      }
    }
  };

  if (nitterPosts.status === 'fulfilled') addPosts(nitterPosts.value);
  if (syndPosts.status === 'fulfilled') addPosts(syndPosts.value);

  return all
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, limit);
}

/**
 * Get trending topics from X/Twitter.
 */
export async function getXTrends(country: string = 'US'): Promise<XTrend[]> {
  // Try Nitter trending
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/explore`;
      const res = await proxyFetch(url, { timeoutMs: 15_000, maxRetries: 1 });

      if (!res.ok) continue;

      const html = await res.text();
      const trends: XTrend[] = [];

      // Extract trending topics from Nitter explore page
      const trendMatches = html.matchAll(/<a[^>]+href="\/search\?q=([^"]+)"[^>]*>([^<]+)<\/a>/g);
      for (const match of trendMatches) {
        const name = decodeURIComponent(match[1]).replace(/\+/g, ' ');
        if (name.startsWith('#') || name.length > 3) {
          trends.push({ name, tweetVolume: null, url: `https://twitter.com/search?q=${encodeURIComponent(name)}` });
        }
        if (trends.length >= 20) break;
      }

      if (trends.length > 0) return trends;
    } catch {
      // Try next
    }
  }

  return [];
}
