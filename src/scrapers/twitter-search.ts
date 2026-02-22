/**
 * Twitter/X Real-Time Search API Scraper (Bounty #73)
 *
 * Multi-fallback strategy for Twitter data:
 *   1. Guest token API (twitter.com/i/api/2/search/adaptive.json)
 *   2. Nitter HTML parsing (nitter.net/search)
 *   3. Twitter syndication embeds (syndication.twitter.com)
 *
 * Exports:
 *   searchTweets(query, limit?, searchType?)
 *   getTrending(woeid?)
 *   getUserProfile(handle)
 *   getUserTweets(handle, limit?)
 *   searchHashtag(hashtag, limit?)
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ───────────────────────────────────

export interface Tweet {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorVerified: boolean;
  authorFollowers: number;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  url: string;
  mediaUrls: string[];
  hashtags: string[];
  language: string;
  isReply: boolean;
  isRetweet: boolean;
}

export interface TweetSearchResult {
  tweets: Tweet[];
  query: string;
  resultCount: number;
  searchType: string; // 'live' | 'top' | 'media'
}

export interface UserProfile {
  id: string;
  name: string;
  handle: string;
  bio: string;
  followers: number;
  following: number;
  tweetCount: number;
  verified: boolean;
  joinedAt: string;
  profileImageUrl: string;
  bannerUrl: string;
  url: string;
  location: string;
}

export interface TrendingResult {
  trends: Array<{
    name: string;
    tweetCount: number;
    url: string;
    category: string;
  }>;
  location: string;
  resultCount: number;
}

// ─── CONSTANTS ───────────────────────────────

const TWITTER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Public bearer token from twitter.com JS — loaded from env for best practice
const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.1d4.us',
];

const TIMEOUT_MS = 20_000;

// ─── GUEST TOKEN CACHE ──────────────────────

let cachedGuestToken: string | null = null;
let guestTokenExpiresAt = 0;
const GUEST_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── FETCH HELPERS ──────────────────────────

interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Fetch with proxy fallback to direct fetch.
 */
async function twitterFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = TIMEOUT_MS, headers = {} } = opts;

  try {
    return await proxyFetch(url, {
      headers: { 'User-Agent': TWITTER_UA, ...headers },
      timeoutMs,
      maxRetries: 1,
    });
  } catch {
    // Fallback to direct fetch
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const response = await fetch(url, {
      headers: { 'User-Agent': TWITTER_UA, ...headers },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return response;
  }
}

// ─── GUEST TOKEN ────────────────────────────

/**
 * Activate a guest token via Twitter's public endpoint.
 * Token is cached for 30 minutes.
 */
async function getGuestToken(): Promise<string> {
  const now = Date.now();
  if (cachedGuestToken && now < guestTokenExpiresAt) {
    return cachedGuestToken;
  }

  const response = await twitterFetch('https://api.twitter.com/1.1/guest/activate.json', {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  // POST method via proxyFetch doesn't work — use direct fetch for POST
  let token: string | null = null;

  if (response.ok) {
    const data = await response.json() as any;
    token = data?.guest_token;
  }

  if (!token) {
    // Try direct POST
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch('https://api.twitter.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        'User-Agent': TWITTER_UA,
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) throw new Error(`Guest token activation failed: ${res.status}`);

    const data = await res.json() as any;
    token = data?.guest_token;
    if (!token) throw new Error('No guest_token in response');
  }

  cachedGuestToken = token;
  guestTokenExpiresAt = now + GUEST_TOKEN_TTL_MS;
  return token!;
}

/**
 * Make an authenticated API call with the guest token.
 */
async function guestApiFetch(url: string): Promise<any> {
  const guestToken = await getGuestToken();

  const response = await twitterFetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'x-guest-token': guestToken,
      Accept: 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    },
  });

  if (response.status === 401 || response.status === 403) {
    // Token expired, invalidate cache and retry once
    cachedGuestToken = null;
    guestTokenExpiresAt = 0;

    const newToken = await getGuestToken();
    const retryRes = await twitterFetch(url, {
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        'x-guest-token': newToken,
        Accept: 'application/json',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
      },
    });

    if (!retryRes.ok) throw new Error(`Twitter API ${retryRes.status}: ${retryRes.statusText}`);
    return retryRes.json();
  }

  if (!response.ok) throw new Error(`Twitter API ${response.status}: ${response.statusText}`);
  return response.json();
}

// ─── GUEST API MAPPERS ──────────────────────

function extractTweetsFromAdaptive(data: any): Tweet[] {
  const tweets: Tweet[] = [];
  const globalTweets = data?.globalObjects?.tweets || {};
  const globalUsers = data?.globalObjects?.users || {};

  for (const [tweetId, raw] of Object.entries(globalTweets) as [string, any][]) {
    const userId = raw?.user_id_str || raw?.user_id || '';
    const user = globalUsers[userId] || {};

    const tweet = mapGuestTweet(tweetId, raw, user);
    if (tweet) tweets.push(tweet);
  }

  // Sort by created_at descending (newest first)
  tweets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return tweets;
}

function mapGuestTweet(tweetId: string, raw: any, user: any): Tweet | null {
  if (!raw || !tweetId) return null;

  const text = String(raw.full_text || raw.text || '').slice(0, 2000);
  if (!text) return null;

  const mediaEntities = raw.extended_entities?.media || raw.entities?.media || [];
  const mediaUrls = mediaEntities
    .map((m: any) => String(m.media_url_https || m.media_url || ''))
    .filter(Boolean)
    .slice(0, 10);

  const hashtagEntities = raw.entities?.hashtags || [];
  const hashtags = hashtagEntities
    .map((h: any) => String(h.text || ''))
    .filter(Boolean)
    .slice(0, 20);

  const handle = String(user.screen_name || '');

  return {
    id: tweetId,
    text,
    authorId: String(raw.user_id_str || raw.user_id || ''),
    authorName: String(user.name || '').slice(0, 100),
    authorHandle: handle,
    authorVerified: Boolean(user.verified || user.is_blue_verified),
    authorFollowers: Math.max(0, Number(user.followers_count) || 0),
    createdAt: raw.created_at ? new Date(raw.created_at).toISOString() : '',
    likes: Math.max(0, Number(raw.favorite_count) || 0),
    retweets: Math.max(0, Number(raw.retweet_count) || 0),
    replies: Math.max(0, Number(raw.reply_count) || 0),
    views: Math.max(0, Number(raw.ext_views?.count || raw.views?.count) || 0),
    url: handle ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`,
    mediaUrls,
    hashtags,
    language: String(raw.lang || 'und'),
    isReply: Boolean(raw.in_reply_to_status_id_str || raw.in_reply_to_user_id_str),
    isRetweet: Boolean(raw.retweeted_status_id_str || text.startsWith('RT @')),
  };
}

function mapGuestUserProfile(raw: any): UserProfile | null {
  if (!raw || !raw.id_str) return null;

  return {
    id: String(raw.id_str),
    name: String(raw.name || '').slice(0, 100),
    handle: String(raw.screen_name || ''),
    bio: String(raw.description || '').slice(0, 500),
    followers: Math.max(0, Number(raw.followers_count) || 0),
    following: Math.max(0, Number(raw.friends_count) || 0),
    tweetCount: Math.max(0, Number(raw.statuses_count) || 0),
    verified: Boolean(raw.verified || raw.is_blue_verified),
    joinedAt: raw.created_at ? new Date(raw.created_at).toISOString() : '',
    profileImageUrl: String(raw.profile_image_url_https || '').replace('_normal', '_400x400'),
    bannerUrl: String(raw.profile_banner_url || ''),
    url: `https://x.com/${raw.screen_name || ''}`,
    location: String(raw.location || '').slice(0, 200),
  };
}

// ─── NITTER FALLBACK ────────────────────────

/**
 * Parse tweet data from Nitter HTML using regex extraction.
 * Nitter renders server-side HTML — no JS required.
 */
function parseNitterTweets(html: string, query: string): Tweet[] {
  const tweets: Tweet[] = [];

  // Match tweet containers: <div class="timeline-item">
  const tweetBlocks = html.split(/class="timeline-item[^"]*"/);

  for (let i = 1; i < tweetBlocks.length; i++) {
    const block = tweetBlocks[i];

    // Extract author handle
    const handleMatch = block.match(/class="username"[^>]*>@?([^<]+)</);
    const handle = handleMatch ? handleMatch[1].trim() : '';

    // Extract author name
    const nameMatch = block.match(/class="fullname"[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : handle;

    // Extract tweet text
    const textMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    let text = '';
    if (textMatch) {
      // Strip HTML tags
      text = textMatch[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ').trim().slice(0, 2000);
    }
    if (!text) continue;

    // Extract tweet link / ID
    const linkMatch = block.match(/class="tweet-link"[^>]*href="([^"]+)"/);
    const tweetPath = linkMatch ? linkMatch[1].trim() : '';
    const idMatch = tweetPath.match(/\/status\/(\d+)/);
    const tweetId = idMatch ? idMatch[1] : `nitter_${i}_${Date.now()}`;

    // Extract stats
    const likesMatch = block.match(/class="icon-heart[^"]*"[^>]*><\/span>\s*([0-9,KkMm.]+)/);
    const retweetsMatch = block.match(/class="icon-retweet[^"]*"[^>]*><\/span>\s*([0-9,KkMm.]+)/);
    const repliesMatch = block.match(/class="icon-comment[^"]*"[^>]*><\/span>\s*([0-9,KkMm.]+)/);

    // Extract date
    const dateMatch = block.match(/title="([^"]*\d{4}[^"]*)"/);
    let createdAt = '';
    if (dateMatch) {
      try { createdAt = new Date(dateMatch[1]).toISOString(); } catch { createdAt = dateMatch[1]; }
    }

    // Extract hashtags from text
    const hashtags: string[] = [];
    const hashtagRegex = /#(\w+)/g;
    let hm;
    while ((hm = hashtagRegex.exec(text)) !== null) {
      hashtags.push(hm[1]);
    }

    tweets.push({
      id: tweetId,
      text,
      authorId: '',
      authorName: name,
      authorHandle: handle,
      authorVerified: false,
      authorFollowers: 0,
      createdAt,
      likes: parseNitterStat(likesMatch?.[1]),
      retweets: parseNitterStat(retweetsMatch?.[1]),
      replies: parseNitterStat(repliesMatch?.[1]),
      views: 0,
      url: handle ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`,
      mediaUrls: [],
      hashtags,
      language: 'und',
      isReply: text.startsWith('Replying to') || block.includes('replying-to'),
      isRetweet: block.includes('retweet-header') || text.startsWith('RT @'),
    });
  }

  return tweets;
}

/**
 * Parse stat string like "1.2K", "3M", "456" into a number.
 */
function parseNitterStat(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.trim().replace(/,/g, '').toLowerCase();
  if (!cleaned) return 0;

  if (cleaned.endsWith('k')) return Math.round(parseFloat(cleaned) * 1000);
  if (cleaned.endsWith('m')) return Math.round(parseFloat(cleaned) * 1_000_000);
  return Math.max(0, parseInt(cleaned) || 0);
}

/**
 * Parse user profile from Nitter HTML.
 */
function parseNitterProfile(html: string): UserProfile | null {
  // Extract profile data from profile header
  const nameMatch = html.match(/class="profile-card-fullname"[^>]*>([^<]+)</);
  const handleMatch = html.match(/class="profile-card-username"[^>]*>@?([^<]+)</);
  const bioMatch = html.match(/class="profile-bio"[^>]*>([\s\S]*?)<\/p>/);
  const followersMatch = html.match(/class="followers"[^>]*>.*?<span class="profile-stat-num"[^>]*>([^<]+)/s);
  const followingMatch = html.match(/class="following"[^>]*>.*?<span class="profile-stat-num"[^>]*>([^<]+)/s);
  const tweetsMatch = html.match(/class="posts"[^>]*>.*?<span class="profile-stat-num"[^>]*>([^<]+)/s);
  const avatarMatch = html.match(/class="profile-card-avatar"[^>]*src="([^"]+)"/);
  const bannerMatch = html.match(/class="profile-banner"[^>]*>.*?src="([^"]+)"/s);
  const joinedMatch = html.match(/class="profile-joindate"[^>]*>.*?title="([^"]+)"/s);
  const locationMatch = html.match(/class="profile-location"[^>]*>([^<]+)</);

  const handle = handleMatch ? handleMatch[1].trim() : '';
  if (!handle) return null;

  let bio = '';
  if (bioMatch) {
    bio = bioMatch[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  let joinedAt = '';
  if (joinedMatch) {
    try { joinedAt = new Date(joinedMatch[1]).toISOString(); } catch { joinedAt = joinedMatch[1]; }
  }

  return {
    id: '',
    name: nameMatch ? nameMatch[1].trim().slice(0, 100) : handle,
    handle,
    bio,
    followers: parseNitterStat(followersMatch?.[1]),
    following: parseNitterStat(followingMatch?.[1]),
    tweetCount: parseNitterStat(tweetsMatch?.[1]),
    verified: html.includes('class="verified-icon"') || html.includes('icon-ok'),
    joinedAt,
    profileImageUrl: avatarMatch ? avatarMatch[1] : '',
    bannerUrl: bannerMatch ? bannerMatch[1] : '',
    url: `https://x.com/${handle}`,
    location: locationMatch ? locationMatch[1].trim().slice(0, 200) : '',
  };
}

/**
 * Try fetching from Nitter instances with fallback.
 */
async function nitterFetch(path: string): Promise<string | null> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const response = await twitterFetch(`${instance}${path}`, {
        headers: { Accept: 'text/html' },
        timeoutMs: 15_000,
      });

      if (response.ok) {
        return await response.text();
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── SYNDICATION FALLBACK ───────────────────

/**
 * Fetch user timeline from Twitter's syndication API (public embed endpoint).
 * Returns basic tweet data without full stats.
 */
async function syndicationFetch(handle: string): Promise<Tweet[]> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`;

  const response = await twitterFetch(url, {
    headers: { Accept: 'text/html' },
    timeoutMs: 15_000,
  });

  if (!response.ok) return [];

  const html = await response.text();
  return parseSyndicationTimeline(html, handle);
}

/**
 * Parse tweets from syndication HTML.
 * The syndication endpoint returns embedded tweet cards.
 */
function parseSyndicationTimeline(html: string, handle: string): Tweet[] {
  const tweets: Tweet[] = [];

  // Syndication may return JSON in a script tag or HTML tweet blocks
  // Try to find embedded tweet data
  const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    try {
      const nextData = JSON.parse(jsonMatch[1]);
      const entries = nextData?.props?.pageProps?.timeline?.entries || [];
      for (const entry of entries) {
        const content = entry?.content || {};
        const tweet = mapSyndicationEntry(content, handle);
        if (tweet) tweets.push(tweet);
      }
      if (tweets.length > 0) return tweets;
    } catch {
      // Fall through to HTML parsing
    }
  }

  // HTML parsing fallback: extract tweet blocks from embedded timeline
  const tweetBlocks = html.split(/data-tweet-id="(\d+)"/);

  for (let i = 1; i < tweetBlocks.length; i += 2) {
    const tweetId = tweetBlocks[i];
    const block = tweetBlocks[i + 1] || '';

    // Extract text
    const textMatch = block.match(/class="[^"]*tweet-text[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    let text = '';
    if (textMatch) {
      text = textMatch[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim().slice(0, 2000);
    }
    if (!text) continue;

    // Extract name
    const nameMatch = block.match(/class="[^"]*name[^"]*"[^>]*>([^<]+)</);

    // Extract date
    const dateMatch = block.match(/datetime="([^"]+)"/);
    let createdAt = '';
    if (dateMatch) {
      try { createdAt = new Date(dateMatch[1]).toISOString(); } catch { createdAt = ''; }
    }

    // Extract hashtags
    const hashtags: string[] = [];
    const hashtagRegex = /#(\w+)/g;
    let hm;
    while ((hm = hashtagRegex.exec(text)) !== null) {
      hashtags.push(hm[1]);
    }

    tweets.push({
      id: tweetId,
      text,
      authorId: '',
      authorName: nameMatch ? nameMatch[1].trim() : handle,
      authorHandle: handle,
      authorVerified: false,
      authorFollowers: 0,
      createdAt,
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      url: `https://x.com/${handle}/status/${tweetId}`,
      mediaUrls: [],
      hashtags,
      language: 'und',
      isReply: false,
      isRetweet: text.startsWith('RT @'),
    });
  }

  return tweets;
}

function mapSyndicationEntry(content: any, handle: string): Tweet | null {
  if (!content?.id_str && !content?.id) return null;

  const tweetId = String(content.id_str || content.id || '');
  const text = String(content.full_text || content.text || '').slice(0, 2000);
  if (!text) return null;

  const user = content.user || {};
  const hashtags = (content.entities?.hashtags || [])
    .map((h: any) => String(h.text || '')).filter(Boolean);

  return {
    id: tweetId,
    text,
    authorId: String(user.id_str || ''),
    authorName: String(user.name || handle).slice(0, 100),
    authorHandle: String(user.screen_name || handle),
    authorVerified: Boolean(user.verified),
    authorFollowers: Math.max(0, Number(user.followers_count) || 0),
    createdAt: content.created_at ? new Date(content.created_at).toISOString() : '',
    likes: Math.max(0, Number(content.favorite_count) || 0),
    retweets: Math.max(0, Number(content.retweet_count) || 0),
    replies: Math.max(0, Number(content.reply_count) || 0),
    views: 0,
    url: `https://x.com/${user.screen_name || handle}/status/${tweetId}`,
    mediaUrls: [],
    hashtags,
    language: String(content.lang || 'und'),
    isReply: Boolean(content.in_reply_to_status_id_str),
    isRetweet: text.startsWith('RT @'),
  };
}

// ─── PUBLIC API: SEARCH TWEETS ──────────────

/**
 * Real-time tweet search with multi-fallback.
 *
 * Strategy:
 *   1. Twitter guest token API (adaptive search)
 *   2. Nitter HTML search
 *   3. Return partial results if any source succeeds
 */
export async function searchTweets(
  query: string,
  limit: number = 25,
  searchType: 'live' | 'top' = 'live',
): Promise<TweetSearchResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeQuery = query.trim().slice(0, 500);
  if (!safeQuery) return { tweets: [], query, resultCount: 0, searchType };

  // Strategy 1: Guest token API
  try {
    const tweetMode = searchType === 'top' ? 'top' : 'live';
    const params = new URLSearchParams({
      q: safeQuery,
      tweet_search_mode: tweetMode,
      count: String(safeLimit),
      result_filter: '',
      query_source: 'typed_query',
      pc: '1',
      spelling_corrections: '1',
    });

    const url = `https://twitter.com/i/api/2/search/adaptive.json?${params}`;
    const data = await guestApiFetch(url);
    const tweets = extractTweetsFromAdaptive(data).slice(0, safeLimit);

    if (tweets.length > 0) {
      return { tweets, query: safeQuery, resultCount: tweets.length, searchType };
    }
  } catch (e) {
    console.warn('[twitter-search] Guest API search failed:', (e as Error).message);
  }

  // Strategy 2: Nitter HTML parsing
  try {
    const nitterPath = `/search?f=tweets&q=${encodeURIComponent(safeQuery)}`;
    const html = await nitterFetch(nitterPath);

    if (html) {
      const tweets = parseNitterTweets(html, safeQuery).slice(0, safeLimit);
      if (tweets.length > 0) {
        return { tweets, query: safeQuery, resultCount: tweets.length, searchType };
      }
    }
  } catch (e) {
    console.warn('[twitter-search] Nitter search failed:', (e as Error).message);
  }

  // All strategies exhausted
  return { tweets: [], query: safeQuery, resultCount: 0, searchType };
}

// ─── PUBLIC API: TRENDING ───────────────────

/**
 * Get trending topics.
 *
 * @param woeid  Where On Earth ID (1 = worldwide, 23424977 = US, 23424975 = UK)
 */
export async function getTrending(woeid: number = 1): Promise<TrendingResult> {
  const safeWoeid = Math.max(1, Math.floor(woeid) || 1);

  // Strategy 1: Guest token API — trends/place
  try {
    const url = `https://api.twitter.com/1.1/trends/place.json?id=${safeWoeid}`;
    const data = await guestApiFetch(url);

    if (Array.isArray(data) && data.length > 0) {
      const trendData = data[0];
      const location = trendData?.locations?.[0]?.name || 'Worldwide';

      const trends = (trendData?.trends || []).map((t: any) => ({
        name: String(t.name || '').slice(0, 200),
        tweetCount: Math.max(0, Number(t.tweet_volume) || 0),
        url: String(t.url || ''),
        category: categorizetrend(String(t.name || '')),
      }));

      return { trends, location, resultCount: trends.length };
    }
  } catch (e) {
    console.warn('[twitter-search] Guest API trending failed:', (e as Error).message);
  }

  // Strategy 2: Nitter explore/trending
  try {
    const html = await nitterFetch('/explore/trending');
    if (html) {
      const trends = parseNitterTrending(html);
      if (trends.length > 0) {
        return {
          trends,
          location: safeWoeid === 1 ? 'Worldwide' : `WOEID:${safeWoeid}`,
          resultCount: trends.length,
        };
      }
    }
  } catch (e) {
    console.warn('[twitter-search] Nitter trending failed:', (e as Error).message);
  }

  return { trends: [], location: 'Worldwide', resultCount: 0 };
}

function categorizetrend(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('#')) return 'hashtag';
  if (/politic|election|vote|president|congress|senate/i.test(lower)) return 'politics';
  if (/sport|game|team|nba|nfl|soccer|football|match/i.test(lower)) return 'sports';
  if (/tech|ai|crypto|bitcoin|eth|software|app/i.test(lower)) return 'technology';
  if (/movie|tv|show|film|music|celeb|award/i.test(lower)) return 'entertainment';
  if (/break|news|alert|report|update/i.test(lower)) return 'news';
  return 'general';
}

function parseNitterTrending(html: string): Array<{ name: string; tweetCount: number; url: string; category: string }> {
  const trends: Array<{ name: string; tweetCount: number; url: string; category: string }> = [];

  // Nitter trending page lists items in trend-links or similar elements
  const trendRegex = /class="[^"]*trend-link[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]+)/g;
  let match;
  while ((match = trendRegex.exec(html)) !== null) {
    const name = match[2].trim();
    if (!name) continue;
    trends.push({
      name,
      tweetCount: 0,
      url: `https://x.com/search?q=${encodeURIComponent(name)}`,
      category: categorizetrend(name),
    });
  }

  // Fallback: look for any links to /search in trending page
  if (trends.length === 0) {
    const linkRegex = /href="\/search\?q=([^"&]+)"[^>]*>([^<]+)/g;
    while ((match = linkRegex.exec(html)) !== null) {
      const name = decodeURIComponent(match[1]).trim();
      if (!name || name.length < 2) continue;
      trends.push({
        name,
        tweetCount: 0,
        url: `https://x.com/search?q=${encodeURIComponent(name)}`,
        category: categorizetrend(name),
      });
    }
  }

  return trends;
}

// ─── PUBLIC API: USER PROFILE ───────────────

/**
 * Get a user's profile information.
 * Uses guest API first, falls back to Nitter.
 */
export async function getUserProfile(handle: string): Promise<UserProfile | null> {
  const safeHandle = handle.replace(/^@/, '').trim().slice(0, 50);
  if (!safeHandle || !/^[A-Za-z0-9_]{1,15}$/.test(safeHandle)) return null;

  // Strategy 1: Guest token API — user show
  try {
    const url = `https://api.twitter.com/1.1/users/show.json?screen_name=${encodeURIComponent(safeHandle)}`;
    const data = await guestApiFetch(url);

    const profile = mapGuestUserProfile(data);
    if (profile) return profile;
  } catch (e) {
    console.warn('[twitter-search] Guest API profile failed:', (e as Error).message);
  }

  // Strategy 2: Nitter HTML profile
  try {
    const html = await nitterFetch(`/${safeHandle}`);
    if (html) {
      const profile = parseNitterProfile(html);
      if (profile) return profile;
    }
  } catch (e) {
    console.warn('[twitter-search] Nitter profile failed:', (e as Error).message);
  }

  return null;
}

// ─── PUBLIC API: USER TWEETS ────────────────

/**
 * Get a user's recent tweets.
 * Multi-fallback: guest API → Nitter → syndication.
 */
export async function getUserTweets(
  handle: string,
  limit: number = 25,
): Promise<TweetSearchResult> {
  const safeHandle = handle.replace(/^@/, '').trim().slice(0, 50);
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  if (!safeHandle || !/^[A-Za-z0-9_]{1,15}$/.test(safeHandle)) {
    return { tweets: [], query: `from:${handle}`, resultCount: 0, searchType: 'live' };
  }

  // Strategy 1: Guest token API — user timeline via search
  try {
    const params = new URLSearchParams({
      q: `from:${safeHandle}`,
      tweet_search_mode: 'live',
      count: String(safeLimit),
      result_filter: '',
      query_source: 'typed_query',
    });

    const url = `https://twitter.com/i/api/2/search/adaptive.json?${params}`;
    const data = await guestApiFetch(url);
    const tweets = extractTweetsFromAdaptive(data).slice(0, safeLimit);

    if (tweets.length > 0) {
      return { tweets, query: `from:${safeHandle}`, resultCount: tweets.length, searchType: 'live' };
    }
  } catch (e) {
    console.warn('[twitter-search] Guest API user tweets failed:', (e as Error).message);
  }

  // Strategy 2: Nitter user timeline
  try {
    const html = await nitterFetch(`/${safeHandle}`);
    if (html) {
      const tweets = parseNitterTweets(html, `from:${safeHandle}`).slice(0, safeLimit);
      if (tweets.length > 0) {
        return { tweets, query: `from:${safeHandle}`, resultCount: tweets.length, searchType: 'live' };
      }
    }
  } catch (e) {
    console.warn('[twitter-search] Nitter user tweets failed:', (e as Error).message);
  }

  // Strategy 3: Syndication API
  try {
    const tweets = await syndicationFetch(safeHandle);
    if (tweets.length > 0) {
      return {
        tweets: tweets.slice(0, safeLimit),
        query: `from:${safeHandle}`,
        resultCount: Math.min(tweets.length, safeLimit),
        searchType: 'live',
      };
    }
  } catch (e) {
    console.warn('[twitter-search] Syndication user tweets failed:', (e as Error).message);
  }

  return { tweets: [], query: `from:${safeHandle}`, resultCount: 0, searchType: 'live' };
}

// ─── PUBLIC API: HASHTAG SEARCH ─────────────

/**
 * Search tweets by hashtag.
 * Delegates to searchTweets with '#' prefix.
 */
export async function searchHashtag(
  hashtag: string,
  limit: number = 25,
): Promise<TweetSearchResult> {
  const safeHashtag = hashtag.replace(/^#+/, '').trim().slice(0, 200);
  if (!safeHashtag) return { tweets: [], query: `#${hashtag}`, resultCount: 0, searchType: 'live' };

  return searchTweets(`#${safeHashtag}`, limit, 'live');
}
