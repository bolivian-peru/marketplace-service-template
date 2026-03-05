import { proxyFetch } from '../proxy';
import { getTwitterTrending, searchTwitter, type TwitterResult } from './twitter';

export type XSortMode = 'latest' | 'top';

export interface XSearchResult {
  id: string | null;
  author: {
    handle: string | null;
    name: string | null;
    followers: number | null;
    verified: boolean | null;
  };
  text: string;
  created_at: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  url: string;
  media: string[];
  hashtags: string[];
}

export interface XUserProfile {
  handle: string;
  name: string | null;
  description: string | null;
  followers: number | null;
  following: number | null;
  verified: boolean | null;
  profile_image_url: string | null;
}

export interface XThreadResult {
  id: string;
  root_tweet: XSearchResult | null;
  conversation: XSearchResult[];
}

interface FollowButtonUser {
  screen_name?: unknown;
  name?: unknown;
  description?: unknown;
  followers_count?: unknown;
  friends_count?: unknown;
  verified?: unknown;
  profile_image_url_https?: unknown;
}

interface SyndicationTweet {
  id_str?: unknown;
  text?: unknown;
  favorite_count?: unknown;
  retweet_count?: unknown;
  conversation_count?: unknown;
  created_at?: unknown;
  user?: {
    screen_name?: unknown;
    name?: unknown;
    followers_count?: unknown;
    verified?: unknown;
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v : null;
}

function extractHashtags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(/#([A-Za-z0-9_]{1,50})/g)) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags);
}

function mapTwitterResult(result: TwitterResult): XSearchResult {
  return {
    id: result.tweetId,
    author: {
      handle: result.author,
      name: null,
      followers: null,
      verified: null,
    },
    text: result.text,
    created_at: result.publishedAt,
    likes: result.likes,
    retweets: result.retweets,
    replies: null,
    views: null,
    url: result.url,
    media: [],
    hashtags: extractHashtags(result.text),
  };
}

function daysFromSort(sort: XSortMode): number {
  return sort === 'latest' ? 7 : 30;
}

export async function searchX(query: string, sort: XSortMode, limit: number): Promise<XSearchResult[]> {
  const rows = await searchTwitter(query, daysFromSort(sort), limit);
  return rows.map(mapTwitterResult);
}

export async function getXTrending(country: string, limit: number): Promise<XSearchResult[]> {
  const rows = await getTwitterTrending(country, limit);
  return rows.map(mapTwitterResult);
}

export async function getXUser(handle: string): Promise<XUserProfile | null> {
  const cleanHandle = handle.replace(/^@/, '').trim();
  if (!cleanHandle) return null;

  const url = `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${encodeURIComponent(cleanHandle)}`;
  const res = await proxyFetch(url, {
    headers: { Accept: 'application/json' },
    timeoutMs: 15_000,
    maxRetries: 1,
  });

  if (!res.ok) return null;

  const payload = await res.json() as unknown;
  if (!Array.isArray(payload) || payload.length === 0 || typeof payload[0] !== 'object' || payload[0] === null) {
    return null;
  }

  const user = payload[0] as FollowButtonUser;
  const screenName = toStringOrNull(user.screen_name);
  if (!screenName) return null;

  return {
    handle: `@${screenName}`,
    name: toStringOrNull(user.name),
    description: toStringOrNull(user.description),
    followers: toNumber(user.followers_count),
    following: toNumber(user.friends_count),
    verified: typeof user.verified === 'boolean' ? user.verified : null,
    profile_image_url: toStringOrNull(user.profile_image_url_https),
  };
}

export async function getXUserTweets(handle: string, limit: number): Promise<XSearchResult[]> {
  const cleanHandle = handle.replace(/^@/, '').trim();
  if (!cleanHandle) return [];

  const rows = await searchTwitter(`from:${cleanHandle}`, 7, limit);
  return rows.map((row) => {
    const mapped = mapTwitterResult(row);
    if (!mapped.author.handle) {
      mapped.author.handle = `@${cleanHandle}`;
    }
    return mapped;
  });
}

function mapSyndicationTweet(tweet: SyndicationTweet): XSearchResult | null {
  const id = toStringOrNull(tweet.id_str);
  const text = toStringOrNull(tweet.text);
  if (!id || !text) return null;

  const handle = toStringOrNull(tweet.user?.screen_name);
  const profileName = toStringOrNull(tweet.user?.name);

  return {
    id,
    author: {
      handle: handle ? `@${handle}` : null,
      name: profileName,
      followers: toNumber(tweet.user?.followers_count),
      verified: typeof tweet.user?.verified === 'boolean' ? tweet.user.verified : null,
    },
    text,
    created_at: toStringOrNull(tweet.created_at),
    likes: toNumber(tweet.favorite_count),
    retweets: toNumber(tweet.retweet_count),
    replies: toNumber(tweet.conversation_count),
    views: null,
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`,
    media: [],
    hashtags: extractHashtags(text),
  };
}

export async function getXThread(tweetId: string, limit: number): Promise<XThreadResult> {
  const cleanTweetId = tweetId.replace(/\D/g, '');
  const fallback: XThreadResult = { id: cleanTweetId || tweetId, root_tweet: null, conversation: [] };
  if (!cleanTweetId) return fallback;

  let rootTweet: XSearchResult | null = null;
  try {
    const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(cleanTweetId)}&lang=en`;
    const res = await proxyFetch(syndicationUrl, {
      headers: { Accept: 'application/json' },
      timeoutMs: 15_000,
      maxRetries: 1,
    });

    if (res.ok) {
      const payload = await res.json() as SyndicationTweet;
      rootTweet = mapSyndicationTweet(payload);
    }
  } catch {
    rootTweet = null;
  }

  const related = await searchTwitter(cleanTweetId, 7, Math.max(limit, 5));
  const mappedRelated = related
    .map(mapTwitterResult)
    .filter((row) => row.id !== cleanTweetId)
    .slice(0, limit);

  return {
    id: cleanTweetId,
    root_tweet: rootTweet,
    conversation: mappedRelated,
  };
}
