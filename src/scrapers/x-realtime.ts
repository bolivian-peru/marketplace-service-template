/**
 * X/Twitter Real-Time Search API — Bounty #73
 *
 * Direct scraping of x.com with mobile proxy rotation.
 * No official API key needed. Micropayment pricing.
 *
 * Endpoints:
 *   GET /api/x/search?query=keyword&sort=latest&limit=20
 *   GET /api/x/trending?country=US
 *   GET /api/x/user/:handle
 *   GET /api/x/user/:handle/tweets?limit=20
 *   GET /api/x/thread/:tweet_id
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ───────────────────────────────────────

export interface XAuthor {
  handle: string;
  name: string;
  followers: number | null;
  verified: boolean;
  profile_image: string | null;
}

export interface XTweet {
  id: string;
  author: XAuthor;
  text: string;
  created_at: string | null;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  url: string;
  media: string[];
  hashtags: string[];
}

export interface XUserProfile {
  handle: string;
  name: string;
  bio: string | null;
  followers: number;
  following: number;
  tweets_count: number;
  verified: boolean;
  created_at: string | null;
  profile_image: string | null;
  banner_image: string | null;
  location: string | null;
  website: string | null;
}

// ─── CONSTANTS ───────────────────────────────────

const X_BASE = 'https://x.com';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 200;
const TIMEOUT_MS = 20_000;
const MAX_TEXT_LENGTH = 1000;

// ─── HELPERS ─────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(Math.floor(v), min), max);
}

function sanitize(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractNum(text: string): number {
  const m = text.match(/([\d,.]+)\s*([KMB])?/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) {
    const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
    n *= mult[m[2].toUpperCase()] || 1;
  }
  return Math.round(n);
}

function extractHashtags(text: string): string[] {
  return (text.match(/#\w+/g) || []).map(t => t.slice(1)).slice(0, 20);
}

// ─── GUEST TOKEN ─────────────────────────────────

let guestToken: string | null = null;
let guestTokenExpiry = 0;

async function getGuestToken(): Promise<string | null> {
  if (guestToken && Date.now() < guestTokenExpiry) return guestToken;

  try {
    const resp = await proxyFetch('https://api.x.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'User-Agent': MOBILE_UA,
      },
      timeoutMs: TIMEOUT_MS,
    });

    if (resp.ok) {
      const data = await resp.json() as { guest_token?: string };
      if (data.guest_token) {
        guestToken = data.guest_token;
        guestTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 min
        return guestToken;
      }
    }
  } catch { /* fall through */ }

  return null;
}

// ─── SEARCH ──────────────────────────────────────

export async function searchX(
  query: string,
  sort: 'latest' | 'top' = 'latest',
  limit: number = 20
): Promise<{ results: XTweet[]; meta: Record<string, unknown> }> {
  query = sanitize(query, MAX_QUERY_LENGTH);
  limit = clamp(limit, 1, MAX_LIMIT);

  const token = await getGuestToken();
  const proxy = getProxy();

  // Strategy 1: Twitter API v2 via guest token
  if (token) {
    try {
      const params = new URLSearchParams({
        q: query,
        result_filter: sort === 'latest' ? 'Latest' : 'Top',
        count: String(limit),
        tweet_mode: 'extended',
      });

      const resp = await proxyFetch(
        `https://api.x.com/1.1/search/tweets.json?${params}`,
        {
          headers: {
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Guest-Token': token,
            'User-Agent': MOBILE_UA,
          },
          timeoutMs: TIMEOUT_MS,
        }
      );

      if (resp.ok) {
        const data = await resp.json() as { statuses?: Array<Record<string, unknown>> };
        const tweets = (data.statuses || []).slice(0, limit).map(parseTweet);
        return {
          results: tweets,
          meta: { source: 'api', proxy: { ip: proxy?.host, country: proxy?.country }, total_results: tweets.length },
        };
      }
    } catch { /* fall through to scraping */ }
  }

  // Strategy 2: HTML scraping via mobile proxy
  try {
    const url = `${X_BASE}/search?q=${encodeURIComponent(query)}&f=${sort === 'latest' ? 'live' : 'top'}`;
    const resp = await proxyFetch(url, {
      headers: { 'User-Agent': MOBILE_UA, 'Accept': 'text/html' },
      timeoutMs: TIMEOUT_MS,
    });

    const html = await resp.text();
    const tweets = parseSearchHTML(html, limit);
    return {
      results: tweets,
      meta: { source: 'scrape', proxy: { ip: proxy?.host, country: proxy?.country }, total_results: tweets.length },
    };
  } catch (e) {
    return { results: [], meta: { error: String(e).slice(0, 200), source: 'failed' } };
  }
}

// ─── TRENDING ────────────────────────────────────

export async function getTrending(country: string = 'US'): Promise<{
  trends: Array<{ name: string; tweet_count: number | null; url: string }>;
  meta: Record<string, unknown>;
}> {
  country = sanitize(country, 10).toUpperCase();
  const token = await getGuestToken();
  const proxy = getProxy();

  // WOEID mapping for top countries
  const woeids: Record<string, number> = {
    US: 23424977, UK: 23424975, JP: 23424856, DE: 23424829,
    FR: 23424819, IN: 23424848, BR: 23424768, CA: 23424775,
  };
  const woeid = woeids[country] || 1; // 1 = worldwide

  if (token) {
    try {
      const resp = await proxyFetch(
        `https://api.x.com/1.1/trends/place.json?id=${woeid}`,
        {
          headers: {
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Guest-Token': token,
            'User-Agent': MOBILE_UA,
          },
          timeoutMs: TIMEOUT_MS,
        }
      );

      if (resp.ok) {
        const data = await resp.json() as Array<{ trends?: Array<{ name: string; tweet_volume: number | null; url: string }> }>;
        const trends = (data[0]?.trends || []).map(t => ({
          name: t.name,
          tweet_count: t.tweet_volume,
          url: t.url,
        }));
        return { trends, meta: { source: 'api', country, woeid, proxy: { ip: proxy?.host } } };
      }
    } catch { /* fall through */ }
  }

  return { trends: [], meta: { source: 'failed', country } };
}

// ─── USER PROFILE ────────────────────────────────

export async function getUserProfile(handle: string): Promise<XUserProfile | null> {
  handle = sanitize(handle, 64).replace(/^@/, '');
  const token = await getGuestToken();

  if (token) {
    try {
      const resp = await proxyFetch(
        `https://api.x.com/1.1/users/show.json?screen_name=${encodeURIComponent(handle)}`,
        {
          headers: {
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Guest-Token': token,
            'User-Agent': MOBILE_UA,
          },
          timeoutMs: TIMEOUT_MS,
        }
      );

      if (resp.ok) {
        const u = await resp.json() as Record<string, unknown>;
        return {
          handle: String(u.screen_name || handle),
          name: sanitize(u.name, 100),
          bio: sanitize(u.description, 500),
          followers: Number(u.followers_count) || 0,
          following: Number(u.friends_count) || 0,
          tweets_count: Number(u.statuses_count) || 0,
          verified: Boolean(u.verified),
          created_at: String(u.created_at || ''),
          profile_image: String(u.profile_image_url_https || '').replace('_normal', ''),
          banner_image: String(u.profile_banner_url || '') || null,
          location: sanitize(u.location, 200) || null,
          website: String((u.entities as Record<string, unknown>)?.url || '') || null,
        };
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ─── USER TWEETS ─────────────────────────────────

export async function getUserTweets(handle: string, limit: number = 20): Promise<XTweet[]> {
  handle = sanitize(handle, 64).replace(/^@/, '');
  limit = clamp(limit, 1, MAX_LIMIT);
  const token = await getGuestToken();

  if (token) {
    try {
      const resp = await proxyFetch(
        `https://api.x.com/1.1/statuses/user_timeline.json?screen_name=${encodeURIComponent(handle)}&count=${limit}&tweet_mode=extended`,
        {
          headers: {
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Guest-Token': token,
            'User-Agent': MOBILE_UA,
          },
          timeoutMs: TIMEOUT_MS,
        }
      );

      if (resp.ok) {
        const data = await resp.json() as Array<Record<string, unknown>>;
        return data.slice(0, limit).map(parseTweet);
      }
    } catch { /* fall through */ }
  }

  return [];
}

// ─── THREAD ──────────────────────────────────────

export async function getThread(tweetId: string): Promise<XTweet[]> {
  tweetId = sanitize(tweetId, 30);
  const token = await getGuestToken();

  if (token) {
    try {
      const resp = await proxyFetch(
        `https://api.x.com/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
        {
          headers: {
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Guest-Token': token,
            'User-Agent': MOBILE_UA,
          },
          timeoutMs: TIMEOUT_MS,
        }
      );

      if (resp.ok) {
        const tweet = await resp.json() as Record<string, unknown>;
        return [parseTweet(tweet)];
      }
    } catch { /* fall through */ }
  }

  return [];
}

// ─── PARSERS ─────────────────────────────────────

function parseTweet(raw: Record<string, unknown>): XTweet {
  const user = (raw.user || {}) as Record<string, unknown>;
  const text = sanitize(raw.full_text || raw.text, MAX_TEXT_LENGTH);
  const id = String(raw.id_str || raw.id || '');

  return {
    id,
    author: {
      handle: String(user.screen_name || ''),
      name: sanitize(user.name, 100),
      followers: Number(user.followers_count) || null,
      verified: Boolean(user.verified),
      profile_image: String(user.profile_image_url_https || '') || null,
    },
    text,
    created_at: String(raw.created_at || '') || null,
    likes: Number(raw.favorite_count) || 0,
    retweets: Number(raw.retweet_count) || 0,
    replies: Number(raw.reply_count) || 0,
    views: null, // Not available in v1.1
    url: `https://x.com/${user.screen_name}/status/${id}`,
    media: extractMedia(raw),
    hashtags: extractHashtags(text),
  };
}

function extractMedia(raw: Record<string, unknown>): string[] {
  const entities = (raw.entities || {}) as Record<string, unknown>;
  const media = (entities.media || []) as Array<Record<string, unknown>>;
  return media.map(m => String(m.media_url_https || '')).filter(Boolean).slice(0, 10);
}

function parseSearchHTML(html: string, limit: number): XTweet[] {
  // Fallback HTML parser for when API fails
  // Extracts basic tweet data from rendered HTML
  const tweets: XTweet[] = [];
  const tweetBlocks = html.split('data-testid="tweet"').slice(1, limit + 1);

  for (const block of tweetBlocks) {
    const idMatch = block.match(/status\/(\d+)/);
    const textMatch = block.match(/data-testid="tweetText"[^>]*>([^<]+)/);
    const handleMatch = block.match(/@(\w+)/);

    if (idMatch) {
      tweets.push({
        id: idMatch[1],
        author: {
          handle: handleMatch?.[1] || '',
          name: '',
          followers: null,
          verified: false,
          profile_image: null,
        },
        text: sanitize(textMatch?.[1], MAX_TEXT_LENGTH),
        created_at: null,
        likes: 0,
        retweets: 0,
        replies: 0,
        views: null,
        url: `https://x.com/${handleMatch?.[1] || 'i'}/status/${idMatch[1]}`,
        media: [],
        hashtags: extractHashtags(textMatch?.[1] || ''),
      });
    }
  }

  return tweets;
}
