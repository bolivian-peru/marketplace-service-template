/**
 * Twitter/X Real-Time Search API (Bounty #73)
 * ────────────────────────────────────────────
 * Provides real-time tweet search, user profile lookup, trend detection,
 * and sentiment analysis for X/Twitter content.
 *
 * Uses self-hosted SearXNG + OpenSERP meta-search engines to surface
 * indexed X/Twitter content without any Twitter API key.
 *
 * Endpoints powered by this module:
 *   /api/twitter/search          — keyword/hashtag tweet search
 *   /api/twitter/user/:username  — user profile lookup
 *   /api/twitter/trends          — trending topics detection
 *   /api/twitter/sentiment       — sentiment analysis on search results
 */

import { scoreSentiment, aggregateSentiment } from '../analysis/sentiment';
import type { SentimentScore, PlatformSentiment } from '../analysis/sentiment';

// ─── TYPES ──────────────────────────────────────────

export interface Tweet {
  tweetId: string | null;
  author: string | null;
  handle: string | null;
  text: string;
  url: string;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  engagementScore: number;
  publishedAt: string | null;
  hashtags: string[];
  isRetweet: boolean;
  isReply: boolean;
  platform: 'twitter';
}

export interface TwitterUserProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  url: string;
  followers: number | null;
  following: number | null;
  tweetCount: number | null;
  verified: boolean;
  joinedAt: string | null;
  profileImageUrl: string | null;
  bannerUrl: string | null;
  location: string | null;
  website: string | null;
  recentTweets: Tweet[];
}

export interface TrendingTopic {
  topic: string;
  tweetVolume: number | null;
  url: string | null;
  category: string | null;
  engagementScore: number;
  sampleTweets: Tweet[];
}

export interface TweetSentimentResult {
  query: string;
  totalAnalyzed: number;
  sentiment: PlatformSentiment;
  breakdown: {
    positive: Tweet[];
    neutral: Tweet[];
    negative: Tweet[];
  };
  wordCloud: { word: string; count: number }[];
  timeline: { period: string; sentiment: string; count: number }[];
}

export interface SearchResponse {
  query: string;
  tweets: Tweet[];
  totalResults: number;
  hasMore: boolean;
}

// ─── CONSTANTS ──────────────────────────────────────

const SEARXNG_BASE = 'http://100.91.53.54:8890';
const OPENSERP_BASE = 'http://100.91.53.54:7000';
const BOT_UA = 'TwitterSearchAPI/1.0 (Bolivian-Peru Marketplace)';

const MAX_TEXT_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 64;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 200;
const TIMEOUT_MS = 15_000;

// ─── HELPERS ────────────────────────────────────────

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

function isTwitterUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'x.com' || hostname === 'twitter.com'
      || hostname === 'www.x.com' || hostname === 'www.twitter.com';
  } catch {
    return false;
  }
}

function extractTweetId(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractHandle(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      const handle = parts[0];
      const reserved = ['i', 'search', 'explore', 'home', 'settings', 'help', 'hashtag', 'notifications', 'messages'];
      if (reserved.includes(handle.toLowerCase())) return null;
      return handle;
    }
  } catch {
    // not valid
  }
  return null;
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u0080-\uFFFF]+/g);
  if (!matches) return [];
  return [...new Set(matches.map(h => h.toLowerCase()))].slice(0, 20);
}

function deduplicateByUrl(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
}

// ─── SEARCH ENGINE INTERFACES ───────────────────────

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
  number_of_results?: number;
}

function mapSearXNGToTweet(raw: SearXNGWebResult): Tweet | null {
  const url = normalizeHttpUrl(raw.url);
  if (!url) return null;
  if (!isTwitterUrl(url)) return null;

  const titleStr = sanitizeText(raw.title, 300);
  const descStr = sanitizeText(raw.content, MAX_TEXT_LENGTH);
  const text = descStr || titleStr;
  if (!text) return null;

  const tweetId = extractTweetId(url);
  const handle = tweetId ? extractHandle(url) : null;

  const rawScore = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0;
  const engagementScore = Math.round(Math.min(rawScore * 100, 100) * 100) / 100;

  let publishedAt: string | null = null;
  if (typeof raw.publishedDate === 'string' && raw.publishedDate.trim()) {
    publishedAt = raw.publishedDate.trim().slice(0, 64);
  }

  return {
    tweetId,
    author: handle ? sanitizeText(`@${handle}`, MAX_AUTHOR_LENGTH) : null,
    handle: handle || null,
    text,
    url,
    likes: null,
    retweets: null,
    replies: null,
    engagementScore,
    publishedAt,
    hashtags: extractHashtags(text),
    isRetweet: text.toLowerCase().startsWith('rt @'),
    isReply: text.startsWith('@'),
    platform: 'twitter',
  };
}

// ─── CORE FUNCTIONS ─────────────────────────────────

/**
 * Search tweets by keyword, hashtag, or phrase.
 */
export async function searchTweets(
  query: string,
  options: {
    days?: number;
    limit?: number;
    sort?: 'relevance' | 'date';
    language?: string;
  } = {},
): Promise<SearchResponse> {
  const safeQuery = sanitizeText(query, MAX_QUERY_LENGTH);
  if (!safeQuery) return { query, tweets: [], totalResults: 0, hasMore: false };

  const limit = clamp(options.limit || 20, 1, MAX_LIMIT);
  const days = clamp(options.days || 30, 1, 365);
  const timeRange = days > 30 ? 'year' : days > 7 ? 'month' : 'week';

  const isHashtag = safeQuery.startsWith('#');
  const searchTerm = isHashtag ? safeQuery.slice(1) : safeQuery;

  const queries = [
    `site:x.com ${searchTerm}`,
    `site:twitter.com ${searchTerm}`,
    `"${searchTerm}" site:x.com`,
  ];

  const engineSets = ['google,bing,duckduckgo', 'google,bing', 'bing,brave'];
  const collected: Tweet[] = [];
  let totalResults = 0;

  for (const q of queries) {
    for (const engines of engineSets) {
      if (collected.length >= limit) break;

      const langParam = options.language ? `&language=${encodeURIComponent(options.language)}` : '';
      const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=${engines}&time_range=${timeRange}${langParam}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
        });

        if (!res.ok) continue;

        const payload = await res.json() as SearXNGResponse;
        if (typeof payload?.number_of_results === 'number') {
          totalResults = Math.max(totalResults, payload.number_of_results);
        }

        const results = Array.isArray(payload?.results) ? payload.results : [];
        for (const item of results) {
          if (collected.length >= limit) break;
          if (!item || typeof item !== 'object') continue;
          const mapped = mapSearXNGToTweet(item);
          if (mapped) collected.push(mapped);
        }
      } catch {
        continue;
      }
    }
    if (collected.length >= limit) break;
  }

  // Fallback to OpenSERP if we have few results
  if (collected.length < limit) {
    const openSerpUrl = `${OPENSERP_BASE}/mega/search?text=${encodeURIComponent(`site:x.com ${searchTerm}`)}`;
    try {
      const res = await fetch(openSerpUrl, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (res.ok) {
        const rawResults = await res.json();
        if (Array.isArray(rawResults)) {
          for (const item of rawResults) {
            if (collected.length >= limit) break;
            if (!item || typeof item !== 'object') continue;
            const url = normalizeHttpUrl(item.url);
            if (!url || !isTwitterUrl(url)) continue;
            const text = sanitizeText(item.description || item.title, MAX_TEXT_LENGTH);
            if (!text) continue;
            const tweetId = extractTweetId(url);
            const handle = tweetId ? extractHandle(url) : null;
            const rank = typeof item.rank === 'number' && item.rank > 0 ? item.rank : 10;
            collected.push({
              tweetId,
              author: handle ? `@${handle}` : null,
              handle,
              text,
              url,
              likes: null,
              retweets: null,
              replies: null,
              engagementScore: Math.round((1 / rank) * 100 * 100) / 100,
              publishedAt: null,
              hashtags: extractHashtags(text),
              isRetweet: text.toLowerCase().startsWith('rt @'),
              isReply: text.startsWith('@'),
              platform: 'twitter',
            });
          }
        }
      }
    } catch {
      // fallback failed silently
    }
  }

  const deduplicated = deduplicateByUrl(collected).slice(0, limit);

  // Sort by engagement if relevance, by date if date
  if (options.sort === 'date') {
    deduplicated.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  } else {
    deduplicated.sort((a, b) => b.engagementScore - a.engagementScore);
  }

  return {
    query: safeQuery,
    tweets: deduplicated,
    totalResults: Math.max(totalResults, deduplicated.length),
    hasMore: totalResults > deduplicated.length,
  };
}

/**
 * Look up a Twitter/X user profile by username.
 */
export async function lookupUser(username: string): Promise<TwitterUserProfile> {
  const safeUsername = sanitizeText(username, 64).replace(/^@/, '');
  if (!safeUsername) throw new Error('Invalid username');

  const profileUrl = `https://x.com/${safeUsername}`;

  // Fetch profile signals from search engines
  const queries = [
    `site:x.com/${safeUsername}`,
    `"${safeUsername}" site:x.com`,
    `from:${safeUsername} site:x.com`,
  ];

  const profile: TwitterUserProfile = {
    username: safeUsername,
    displayName: null,
    bio: null,
    url: profileUrl,
    followers: null,
    following: null,
    tweetCount: null,
    verified: false,
    joinedAt: null,
    profileImageUrl: null,
    bannerUrl: null,
    location: null,
    website: null,
    recentTweets: [],
  };

  const recentTweets: Tweet[] = [];

  for (const q of queries) {
    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=google,bing,duckduckgo&time_range=month`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });

      if (!res.ok) continue;

      const payload = await res.json() as SearXNGResponse;
      const results = Array.isArray(payload?.results) ? payload.results : [];

      for (const item of results) {
        if (!item || typeof item !== 'object') continue;
        const itemUrl = normalizeHttpUrl(item.url);
        if (!itemUrl || !isTwitterUrl(itemUrl)) continue;

        const titleStr = sanitizeText(item.title, 300);
        const contentStr = sanitizeText(item.content, MAX_TEXT_LENGTH);

        // Try to extract profile info from search result snippets
        if (itemUrl.toLowerCase() === profileUrl.toLowerCase() || itemUrl.toLowerCase() === `${profileUrl}/`.toLowerCase()) {
          if (titleStr && !profile.displayName) {
            // Title often formatted as "Display Name (@handle) / X"
            const nameMatch = titleStr.match(/^(.+?)\s*\(@/);
            if (nameMatch) profile.displayName = nameMatch[1].trim();
          }
          if (contentStr && !profile.bio) {
            profile.bio = contentStr;
          }
          // Extract follower counts from snippets
          const followerMatch = contentStr.match(/([\d,.]+[KMB]?)\s*Followers/i);
          if (followerMatch && !profile.followers) {
            profile.followers = parseCompactNumber(followerMatch[1]);
          }
          const followingMatch = contentStr.match(/([\d,.]+[KMB]?)\s*Following/i);
          if (followingMatch && !profile.following) {
            profile.following = parseCompactNumber(followingMatch[1]);
          }
        }

        // Collect recent tweets
        const mapped = mapSearXNGToTweet(item as SearXNGWebResult);
        if (mapped && mapped.handle?.toLowerCase() === safeUsername.toLowerCase()) {
          recentTweets.push(mapped);
        }
      }
    } catch {
      continue;
    }
  }

  profile.recentTweets = deduplicateByUrl(recentTweets).slice(0, 10);

  return profile;
}

/**
 * Parse compact numbers like "1.2K", "3.5M", "100".
 */
function parseCompactNumber(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/,/g, '').trim();
  const match = cleaned.match(/^([\d.]+)\s*([KMBkmb])?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;
  const suffix = (match[2] || '').toUpperCase();
  const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  return Math.round(num * (multipliers[suffix] || 1));
}

/**
 * Detect trending topics on Twitter/X.
 */
export async function detectTrends(
  country: string = 'US',
  limit: number = 20,
): Promise<TrendingTopic[]> {
  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const safeCountry = typeof country === 'string'
    ? country.trim().toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '')
    : 'US';
  const countryLabel = safeCountry || 'US';
  const year = new Date().getFullYear();

  const trendQueries = [
    `site:x.com trending ${countryLabel} ${year}`,
    `twitter trending topics ${countryLabel} today`,
    `x.com viral tweets ${countryLabel} ${year}`,
    `what's trending on twitter ${countryLabel}`,
  ];

  const allTweets: Tweet[] = [];
  const topicMap = new Map<string, { tweets: Tweet[]; totalEngagement: number }>();

  for (const q of trendQueries) {
    if (allTweets.length >= safeLimit * 3) break;

    for (const engines of ['google,bing,brave', 'google,bing', 'bing,duckduckgo']) {
      if (allTweets.length >= safeLimit * 3) break;

      const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=${engines}&time_range=week`;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
        });

        if (!res.ok) continue;

        const payload = await res.json() as SearXNGResponse;
        const results = Array.isArray(payload?.results) ? payload.results : [];

        for (const item of results) {
          if (!item || typeof item !== 'object') continue;
          const mapped = mapSearXNGToTweet(item as SearXNGWebResult);
          if (mapped) allTweets.push(mapped);
        }
      } catch {
        continue;
      }
    }
  }

  // Also try OpenSERP fallback
  const openSerpUrl = `${OPENSERP_BASE}/mega/search?text=${encodeURIComponent(`site:x.com trending ${countryLabel} ${year}`)}`;
  try {
    const res = await fetch(openSerpUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });

    if (res.ok) {
      const rawResults = await res.json();
      if (Array.isArray(rawResults)) {
        for (const item of rawResults) {
          if (!item || typeof item !== 'object') continue;
          const url = normalizeHttpUrl(item.url);
          if (!url || !isTwitterUrl(url)) continue;
          const text = sanitizeText(item.description || item.title, MAX_TEXT_LENGTH);
          if (!text) continue;
          const tweetId = extractTweetId(url);
          const handle = tweetId ? extractHandle(url) : null;
          const rank = typeof item.rank === 'number' && item.rank > 0 ? item.rank : 10;
          allTweets.push({
            tweetId,
            author: handle ? `@${handle}` : null,
            handle,
            text,
            url,
            likes: null,
            retweets: null,
            replies: null,
            engagementScore: Math.round((1 / rank) * 100 * 100) / 100,
            publishedAt: null,
            hashtags: extractHashtags(text),
            isRetweet: text.toLowerCase().startsWith('rt @'),
            isReply: text.startsWith('@'),
            platform: 'twitter',
          });
        }
      }
    }
  } catch {
    // silent
  }

  const deduplicated = deduplicateByUrl(allTweets);

  // Extract topics from hashtags and common words
  for (const tweet of deduplicated) {
    const topics = tweet.hashtags.length > 0
      ? tweet.hashtags
      : extractKeyTopics(tweet.text);

    for (const topic of topics) {
      const existing = topicMap.get(topic);
      if (existing) {
        existing.tweets.push(tweet);
        existing.totalEngagement += tweet.engagementScore;
      } else {
        topicMap.set(topic, { tweets: [tweet], totalEngagement: tweet.engagementScore });
      }
    }
  }

  const trending: TrendingTopic[] = [];
  for (const [topic, data] of topicMap) {
    trending.push({
      topic,
      tweetVolume: data.tweets.length,
      url: `https://x.com/search?q=${encodeURIComponent(topic)}`,
      category: categorize(topic),
      engagementScore: Math.round(data.totalEngagement * 100) / 100,
      sampleTweets: data.tweets.slice(0, 3),
    });
  }

  // Sort by engagement score descending
  trending.sort((a, b) => b.engagementScore - a.engagementScore);

  return trending.slice(0, safeLimit);
}

/**
 * Run sentiment analysis on search results for a query.
 */
export async function analyzeSentiment(
  query: string,
  options: { days?: number; limit?: number } = {},
): Promise<TweetSentimentResult> {
  const limit = clamp(options.limit || 30, 5, MAX_LIMIT);

  const searchResults = await searchTweets(query, {
    days: options.days || 7,
    limit,
    sort: 'relevance',
  });

  const positive: Tweet[] = [];
  const neutral: Tweet[] = [];
  const negative: Tweet[] = [];
  const wordFreq = new Map<string, number>();

  for (const tweet of searchResults.tweets) {
    const score = scoreSentiment(tweet.text);

    if (score.overall === 'positive') positive.push(tweet);
    else if (score.overall === 'negative') negative.push(tweet);
    else neutral.push(tweet);

    // Build word cloud from meaningful words
    const words = tweet.text
      .toLowerCase()
      .replace(/[^\w\s#@]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  const texts = searchResults.tweets.map(t => t.text);
  const overallSentiment = aggregateSentiment(texts);

  const wordCloud = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word, count]) => ({ word, count }));

  return {
    query,
    totalAnalyzed: searchResults.tweets.length,
    sentiment: overallSentiment,
    breakdown: { positive, neutral, negative },
    wordCloud,
    timeline: [], // Would require temporal bucketing with real timestamps
  };
}

// ─── TOPIC EXTRACTION ───────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from',
  'this', 'that', 'they', 'with', 'will', 'each', 'make', 'like',
  'just', 'over', 'such', 'take', 'than', 'them', 'very', 'some',
  'what', 'know', 'when', 'come', 'could', 'more', 'about', 'which',
  'their', 'other', 'would', 'there', 'these', 'into', 'also', 'back',
  'http', 'https', 'twitter', 'tweet', 'site', 'x.com',
]);

function extractKeyTopics(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s#]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  // Return the first 2-3 significant words as pseudo-topics
  return [...new Set(words)].slice(0, 3);
}

function categorize(topic: string): string | null {
  const lower = topic.toLowerCase();
  const categories: Record<string, string[]> = {
    'politics': ['election', 'vote', 'democrat', 'republican', 'congress', 'senate', 'president', 'policy', 'government'],
    'technology': ['ai', 'crypto', 'bitcoin', 'blockchain', 'tech', 'app', 'software', 'startup', 'code', 'developer'],
    'sports': ['game', 'nba', 'nfl', 'soccer', 'football', 'basketball', 'baseball', 'tennis', 'match', 'championship'],
    'entertainment': ['movie', 'music', 'concert', 'album', 'oscar', 'grammy', 'celebrity', 'netflix', 'show', 'series'],
    'finance': ['stock', 'market', 'trading', 'investment', 'economy', 'inflation', 'fed', 'bank', 'price', 'dollar'],
    'health': ['covid', 'vaccine', 'health', 'medical', 'doctor', 'hospital', 'mental', 'fitness', 'diet', 'wellness'],
    'science': ['climate', 'space', 'nasa', 'research', 'study', 'scientist', 'discovery', 'environment', 'planet'],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(k => lower.includes(k))) return category;
  }
  return null;
}
