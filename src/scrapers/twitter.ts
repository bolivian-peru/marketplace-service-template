/**
 * X/Twitter Scraper — Mobile Proxy Intelligence
 * Searches tweets, tracks trends, extracts profiles and threads
 * via Proxies.sx mobile proxies (bypasses X's anti-scraping)
 */

import { proxyFetch, getProxy } from '../proxy';

export interface TweetAuthor {
  handle: string;
  name: string;
  followers: number;
  following: number;
  verified: boolean;
  profile_image_url: string | null;
}

export interface Tweet {
  id: string;
  author: TweetAuthor;
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  url: string;
  media: string[];
  hashtags: string[];
  is_reply: boolean;
  is_retweet: boolean;
  conversation_id: string | null;
}

export interface XUserProfile {
  handle: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  tweet_count: number;
  verified: boolean;
  created_at: string;
  profile_image_url: string;
  banner_url: string | null;
  location: string | null;
  website: string | null;
  pinned_tweet_id: string | null;
}

export interface TrendingTopic {
  name: string;
  tweet_volume: number | null;
  rank: number;
  category: string | null;
  url: string;
}

const X_BASE = 'https://x.com';
const X_API = 'https://api.x.com';

// Guest token + bearer for unauthenticated API access
const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

let guestToken: string | null = null;
let guestTokenExpiry = 0;

const X_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Authorization': `Bearer ${BEARER}`,
  'Content-Type': 'application/json',
  'X-Twitter-Active-User': 'yes',
  'X-Twitter-Client-Language': 'en',
};

async function getGuestToken(): Promise<string> {
  const now = Date.now();
  if (guestToken && now < guestTokenExpiry) return guestToken;

  const response = await proxyFetch(`${X_API}/1.1/guest/activate.json`, {
    method: 'POST',
    headers: X_HEADERS,
    maxRetries: 3,
    timeoutMs: 15000,
  });

  if (!response.ok) {
    throw new Error(`Guest token activation failed: ${response.status}`);
  }

  const data: any = await response.json();
  guestToken = data.guest_token;
  guestTokenExpiry = now + 3600_000; // 1 hour
  return guestToken!;
}

function getAuthHeaders(gt: string): Record<string, string> {
  return {
    ...X_HEADERS,
    'X-Guest-Token': gt,
  };
}

function parseTweet(tweet: any, users: Map<string, any>): Tweet {
  const userId = tweet.user_id_str || tweet.user?.id_str;
  const user = users.get(userId) || tweet.user || {};
  const entities = tweet.entities || {};
  const extMedia = tweet.extended_entities?.media || entities.media || [];

  return {
    id: tweet.id_str || String(tweet.id || ''),
    author: {
      handle: user.screen_name || '',
      name: user.name || '',
      followers: user.followers_count ?? 0,
      following: user.friends_count ?? 0,
      verified: user.verified ?? user.is_blue_verified ?? false,
      profile_image_url: user.profile_image_url_https || null,
    },
    text: tweet.full_text || tweet.text || '',
    created_at: tweet.created_at || '',
    likes: tweet.favorite_count ?? 0,
    retweets: tweet.retweet_count ?? 0,
    replies: tweet.reply_count ?? 0,
    views: tweet.ext_views?.count ?? tweet.view_count ?? 0,
    url: user.screen_name ? `https://x.com/${user.screen_name}/status/${tweet.id_str}` : '',
    media: extMedia.map((m: any) => m.media_url_https || m.url || '').filter(Boolean),
    hashtags: (entities.hashtags || []).map((h: any) => h.text),
    is_reply: !!tweet.in_reply_to_status_id_str,
    is_retweet: !!tweet.retweeted_status_id_str || (tweet.full_text || '').startsWith('RT @'),
    conversation_id: tweet.conversation_id_str || null,
  };
}

function buildUsersMap(globalobjects: any): Map<string, any> {
  const map = new Map<string, any>();
  const users = globalobjects?.users || {};
  for (const [id, user] of Object.entries(users)) {
    map.set(id, user);
  }
  return map;
}

/**
 * Search tweets by keyword/hashtag
 */
export async function searchTweets(
  query: string,
  sort: 'latest' | 'top' | 'people' | 'media' = 'latest',
  limit = 20,
): Promise<{ results: Tweet[]; total_results: number }> {
  const gt = await getGuestToken();

  // Use the v1.1 search endpoint (more reliable with guest tokens)
  const params = new URLSearchParams({
    q: query,
    result_type: sort === 'latest' ? 'recent' : sort === 'top' ? 'popular' : 'mixed',
    count: String(Math.min(limit, 100)),
    tweet_mode: 'extended',
    include_entities: 'true',
  });

  const response = await proxyFetch(
    `${X_API}/1.1/search/tweets.json?${params.toString()}`,
    {
      headers: getAuthHeaders(gt),
      maxRetries: 3,
      timeoutMs: 30000,
    }
  );

  if (!response.ok) {
    // Fallback: try adaptive search endpoint
    const adaptiveParams = new URLSearchParams({
      q: query,
      count: String(Math.min(limit, 20)),
      query_source: 'typed_query',
      pc: '1',
      spelling_corrections: '1',
    });

    const fallback = await proxyFetch(
      `${X_API}/2/search/adaptive.json?${adaptiveParams.toString()}`,
      {
        headers: getAuthHeaders(gt),
        maxRetries: 2,
        timeoutMs: 30000,
      }
    );

    if (!fallback.ok) {
      throw new Error(`X search failed: ${response.status} / fallback: ${fallback.status}`);
    }

    const fbData: any = await fallback.json();
    const users = buildUsersMap(fbData.globalObjects);
    const tweets = Object.values(fbData.globalObjects?.tweets || {}).map((t: any) => parseTweet(t, users));

    return { results: tweets.slice(0, limit), total_results: tweets.length };
  }

  const data: any = await response.json();
  const statuses = data.statuses || [];
  const users = new Map<string, any>();
  statuses.forEach((s: any) => { if (s.user) users.set(s.user.id_str, s.user); });

  const results = statuses.map((s: any) => parseTweet(s, users));
  return { results: results.slice(0, limit), total_results: results.length };
}

/**
 * Get trending topics by country
 */
export async function getTrending(woeid: number = 1): Promise<TrendingTopic[]> {
  const gt = await getGuestToken();

  const response = await proxyFetch(
    `${X_API}/1.1/trends/place.json?id=${woeid}`,
    {
      headers: getAuthHeaders(gt),
      maxRetries: 3,
      timeoutMs: 20000,
    }
  );

  if (!response.ok) {
    throw new Error(`X trending failed: ${response.status}`);
  }

  const data: any = await response.json();
  const trends = data[0]?.trends || [];

  return trends.map((t: any, i: number) => ({
    name: t.name || '',
    tweet_volume: t.tweet_volume ?? null,
    rank: i + 1,
    category: t.promoted_content ? 'promoted' : null,
    url: t.url || `https://x.com/search?q=${encodeURIComponent(t.name || '')}`,
  }));
}

// Country to WOEID mapping (Yahoo Where On Earth ID)
export const COUNTRY_WOEIDS: Record<string, number> = {
  US: 23424977, UK: 23424975, CA: 23424775, AU: 23424748,
  IN: 23424848, BR: 23424768, JP: 23424856, DE: 23424829,
  FR: 23424819, MX: 23424900, WORLDWIDE: 1,
};

/**
 * Get user profile
 */
export async function getUserProfile(handle: string): Promise<XUserProfile> {
  const gt = await getGuestToken();
  const cleanHandle = handle.replace('@', '');

  const response = await proxyFetch(
    `${X_API}/1.1/users/show.json?screen_name=${encodeURIComponent(cleanHandle)}`,
    {
      headers: getAuthHeaders(gt),
      maxRetries: 3,
      timeoutMs: 20000,
    }
  );

  if (!response.ok) {
    throw new Error(`X user profile failed for @${cleanHandle}: ${response.status}`);
  }

  const u: any = await response.json();

  return {
    handle: u.screen_name || cleanHandle,
    name: u.name || '',
    bio: u.description || '',
    followers: u.followers_count ?? 0,
    following: u.friends_count ?? 0,
    tweet_count: u.statuses_count ?? 0,
    verified: u.verified ?? u.is_blue_verified ?? false,
    created_at: u.created_at || '',
    profile_image_url: (u.profile_image_url_https || '').replace('_normal', '_400x400'),
    banner_url: u.profile_banner_url || null,
    location: u.location || null,
    website: u.entities?.url?.urls?.[0]?.expanded_url || u.url || null,
    pinned_tweet_id: u.pinned_tweet_ids_str?.[0] || null,
  };
}

/**
 * Get user's recent tweets
 */
export async function getUserTweets(
  handle: string,
  limit = 20,
): Promise<Tweet[]> {
  const gt = await getGuestToken();
  const cleanHandle = handle.replace('@', '');

  const params = new URLSearchParams({
    screen_name: cleanHandle,
    count: String(Math.min(limit, 200)),
    tweet_mode: 'extended',
    include_entities: 'true',
    exclude_replies: 'false',
  });

  const response = await proxyFetch(
    `${X_API}/1.1/statuses/user_timeline.json?${params.toString()}`,
    {
      headers: getAuthHeaders(gt),
      maxRetries: 3,
      timeoutMs: 30000,
    }
  );

  if (!response.ok) {
    throw new Error(`X user tweets failed for @${cleanHandle}: ${response.status}`);
  }

  const statuses: any[] = await response.json();
  const users = new Map<string, any>();
  statuses.forEach((s: any) => { if (s.user) users.set(s.user.id_str, s.user); });

  return statuses.map((s: any) => parseTweet(s, users)).slice(0, limit);
}

/**
 * Get full thread (conversation) from a tweet ID
 */
export async function getThread(tweetId: string): Promise<{
  root: Tweet;
  conversation: Tweet[];
  total: number;
}> {
  const gt = await getGuestToken();

  // Get the original tweet first
  const tweetResponse = await proxyFetch(
    `${X_API}/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended&include_entities=true`,
    {
      headers: getAuthHeaders(gt),
      maxRetries: 3,
      timeoutMs: 20000,
    }
  );

  if (!tweetResponse.ok) {
    throw new Error(`X thread fetch failed for ${tweetId}: ${tweetResponse.status}`);
  }

  const tweetData: any = await tweetResponse.json();
  const rootUsers = new Map<string, any>();
  if (tweetData.user) rootUsers.set(tweetData.user.id_str, tweetData.user);
  const root = parseTweet(tweetData, rootUsers);

  // Search for replies in the conversation
  const conversationQuery = `conversation_id:${tweetData.conversation_id_str || tweetId}`;
  const searchParams = new URLSearchParams({
    q: conversationQuery,
    count: '100',
    tweet_mode: 'extended',
    result_type: 'recent',
    include_entities: 'true',
  });

  const searchResponse = await proxyFetch(
    `${X_API}/1.1/search/tweets.json?${searchParams.toString()}`,
    {
      headers: getAuthHeaders(gt),
      maxRetries: 2,
      timeoutMs: 30000,
    }
  );

  let conversation: Tweet[] = [];
  if (searchResponse.ok) {
    const searchData: any = await searchResponse.json();
    const convoUsers = new Map<string, any>();
    (searchData.statuses || []).forEach((s: any) => { if (s.user) convoUsers.set(s.user.id_str, s.user); });
    conversation = (searchData.statuses || []).map((s: any) => parseTweet(s, convoUsers));
  }

  return {
    root,
    conversation,
    total: conversation.length + 1,
  };
}
