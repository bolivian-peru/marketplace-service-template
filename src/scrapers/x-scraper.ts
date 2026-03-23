/**
 * X/Twitter Real-Time Search Scraper
 * ───────────────────────────────────
 * Scrapes X/Twitter data via public/guest endpoints through mobile proxies.
 *
 * Strategies (ordered by reliability):
 *   1. Guest token → X API v1.1/v2 adaptive search
 *   2. Syndication endpoints (profile timelines, single tweets)
 *   3. Nitter instances as fallback
 *
 * All external requests route through proxyFetch() for mobile IP rotation.
 */

import { proxyFetch, getProxy, getProxyExitIp } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface TweetAuthor {
  handle: string;
  name: string;
  followers: number | null;
  verified: boolean;
  avatar: string | null;
}

export interface TweetResult {
  id: string;
  author: TweetAuthor;
  text: string;
  created_at: string | null;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  url: string;
  media: MediaItem[];
  hashtags: string[];
  language: string | null;
  conversation_id: string | null;
  in_reply_to: string | null;
}

export interface MediaItem {
  type: 'photo' | 'video' | 'gif';
  url: string;
  preview: string | null;
}

export interface SearchResponse {
  query: string;
  sort: string;
  results: TweetResult[];
  meta: {
    total_results: number;
    cursor: string | null;
    proxy: { ip: string; country: string; carrier: string };
    scraped_at: string;
    response_time_ms: number;
  };
}

export interface TrendingTopic {
  name: string;
  tweet_volume: number | null;
  url: string;
  category: string | null;
  rank: number;
}

export interface TrendingResponse {
  country: string;
  topics: TrendingTopic[];
  meta: {
    proxy: { ip: string; country: string; carrier: string };
    scraped_at: string;
  };
}

export interface ProfileResponse {
  handle: string;
  name: string;
  bio: string | null;
  followers: number;
  following: number;
  tweet_count: number;
  verified: boolean;
  avatar: string | null;
  banner: string | null;
  joined: string | null;
  location: string | null;
  website: string | null;
  pinned_tweet: TweetResult | null;
  meta: {
    proxy: { ip: string; country: string; carrier: string };
    scraped_at: string;
  };
}

export interface UserTweetsResponse {
  handle: string;
  tweets: TweetResult[];
  meta: {
    total_results: number;
    cursor: string | null;
    proxy: { ip: string; country: string; carrier: string };
    scraped_at: string;
  };
}

export interface ThreadResponse {
  root_tweet: TweetResult;
  replies: TweetResult[];
  meta: {
    total_replies: number;
    proxy: { ip: string; country: string; carrier: string };
    scraped_at: string;
  };
}

// ─── CONSTANTS ──────────────────────────────────────

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const MAX_LIMIT = 50;
const TIMEOUT_MS = 25_000;

const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.woodland.cafe',
];

// ─── GUEST TOKEN MANAGEMENT ─────────────────────────

let cachedGuestToken: { token: string; expiresAt: number } | null = null;

async function getGuestToken(): Promise<string> {
  // Reuse token if valid (tokens last ~3 hours, we refresh at 2)
  if (cachedGuestToken && Date.now() < cachedGuestToken.expiresAt) {
    return cachedGuestToken.token;
  }

  const response = await proxyFetch('https://api.x.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRetries: 2,
    timeoutMs: 15_000,
  });

  if (!response.ok) {
    throw new Error(`Failed to activate guest token: ${response.status}`);
  }

  const data = await response.json() as any;
  const token = data?.guest_token;

  if (!token || typeof token !== 'string') {
    throw new Error('Guest token activation returned no token');
  }

  cachedGuestToken = {
    token,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
  };

  return token;
}

function guestHeaders(guestToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${BEARER_TOKEN}`,
    'X-Guest-Token': guestToken,
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Client-Language': 'en',
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Referer': 'https://x.com/',
    'Origin': 'https://x.com',
  };
}

// ─── HELPERS ────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function sanitize(value: unknown, maxLen: number = 500): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u0080-\uFFFF]+/g);
  return matches ? Array.from(new Set(matches.map(h => h.slice(1)))) : [];
}

function parseTweetFromGraphQL(tweet: any, user?: any): TweetResult | null {
  if (!tweet) return null;

  const legacy = tweet.legacy || tweet;
  const userLegacy = user?.legacy || tweet.core?.user_results?.result?.legacy || {};
  const tweetId = tweet.rest_id || legacy.id_str || legacy.id;

  if (!tweetId) return null;

  const handle = userLegacy.screen_name || '';
  const fullText = legacy.full_text || legacy.text || '';

  // Extract entities
  const entities = legacy.entities || {};
  const hashtags = (entities.hashtags || []).map((h: any) => h.text).filter(Boolean);
  const mediaEntities = legacy.extended_entities?.media || entities.media || [];

  const media: MediaItem[] = mediaEntities.map((m: any) => ({
    type: m.type === 'video' || m.type === 'animated_gif' ? (m.type === 'animated_gif' ? 'gif' : 'video') : 'photo',
    url: m.video_info?.variants?.find((v: any) => v.content_type === 'video/mp4')?.url || m.media_url_https || m.media_url || '',
    preview: m.media_url_https || null,
  })).filter((m: MediaItem) => m.url);

  // View count
  const viewCount = tweet.views?.count ? parseInt(tweet.views.count) : null;

  return {
    id: tweetId,
    author: {
      handle,
      name: userLegacy.name || handle,
      followers: userLegacy.followers_count ?? null,
      verified: userLegacy.verified || tweet.is_blue_verified || false,
      avatar: userLegacy.profile_image_url_https || null,
    },
    text: fullText,
    created_at: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    replies: legacy.reply_count || 0,
    views: viewCount,
    url: handle ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`,
    media,
    hashtags: hashtags.length > 0 ? hashtags : extractHashtags(fullText),
    language: legacy.lang || null,
    conversation_id: legacy.conversation_id_str || null,
    in_reply_to: legacy.in_reply_to_status_id_str || null,
  };
}

function parseTweetFromSyndication(data: any): TweetResult | null {
  if (!data) return null;

  const id = data.id_str || String(data.id || '');
  if (!id) return null;

  const user = data.user || {};
  const handle = user.screen_name || '';

  const entities = data.entities || {};
  const hashtags = (entities.hashtags || []).map((h: any) => h.text).filter(Boolean);
  const mediaEntities = data.mediaDetails || data.extended_entities?.media || entities.media || [];

  const media: MediaItem[] = mediaEntities.map((m: any) => ({
    type: m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'gif' : 'photo',
    url: m.video_info?.variants?.find((v: any) => v.content_type === 'video/mp4')?.url || m.media_url_https || m.media_url || '',
    preview: m.media_url_https || null,
  })).filter((m: MediaItem) => m.url);

  return {
    id,
    author: {
      handle,
      name: user.name || handle,
      followers: user.followers_count ?? null,
      verified: user.verified || user.is_blue_verified || false,
      avatar: user.profile_image_url_https || null,
    },
    text: data.full_text || data.text || '',
    created_at: data.created_at ? new Date(data.created_at).toISOString() : null,
    likes: data.favorite_count || 0,
    retweets: data.retweet_count || 0,
    replies: data.reply_count || 0,
    views: data.view_count ? parseInt(data.view_count) : null,
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
    media,
    hashtags: hashtags.length > 0 ? hashtags : extractHashtags(data.full_text || data.text || ''),
    language: data.lang || null,
    conversation_id: data.conversation_id_str || null,
    in_reply_to: data.in_reply_to_status_id_str || null,
  };
}

async function getProxyMeta(): Promise<{ ip: string; country: string; carrier: string }> {
  const proxy = getProxy();
  const ip = await getProxyExitIp();
  return {
    ip: ip || 'unknown',
    country: proxy.country || 'US',
    carrier: `mobile-${proxy.country?.toLowerCase() || 'us'}`,
  };
}

// ─── SEARCH TWEETS ──────────────────────────────────

/**
 * Search tweets via X's guest API (adaptive search).
 *
 * @param query  - Search keywords (supports X search operators: from:, to:, filter:, etc.)
 * @param sort   - "latest" | "top" | "people" | "media"
 * @param limit  - Max results (1-50)
 */
export async function searchTweets(
  query: string,
  sort: string = 'latest',
  limit: number = 20,
): Promise<SearchResponse> {
  const startTime = Date.now();
  const safeQuery = sanitize(query, 500);
  if (!safeQuery) throw new Error('Query parameter is required');

  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const safeSort = ['latest', 'top', 'people', 'media'].includes(sort) ? sort : 'latest';

  // Map sort to tweet_search_mode
  const tweetSearchMode = safeSort === 'latest' ? 'live' : 'top';

  // Strategy 1: Guest API adaptive search
  try {
    const results = await searchViaGuestAPI(safeQuery, tweetSearchMode, safeLimit);
    if (results.length > 0) {
      const proxyMeta = await getProxyMeta();
      return {
        query: safeQuery,
        sort: safeSort,
        results,
        meta: {
          total_results: results.length,
          cursor: null,
          proxy: proxyMeta,
          scraped_at: new Date().toISOString(),
          response_time_ms: Date.now() - startTime,
        },
      };
    }
  } catch (err) {
    console.warn('[x-scraper] Guest API search failed, trying syndication fallback:', (err as Error).message);
  }

  // Strategy 2: Syndication search timeline
  try {
    const results = await searchViaSyndication(safeQuery, safeLimit);
    if (results.length > 0) {
      const proxyMeta = await getProxyMeta();
      return {
        query: safeQuery,
        sort: safeSort,
        results,
        meta: {
          total_results: results.length,
          cursor: null,
          proxy: proxyMeta,
          scraped_at: new Date().toISOString(),
          response_time_ms: Date.now() - startTime,
        },
      };
    }
  } catch (err) {
    console.warn('[x-scraper] Syndication search failed, trying Nitter:', (err as Error).message);
  }

  // Strategy 3: Nitter fallback
  try {
    const results = await searchViaNitter(safeQuery, safeLimit);
    const proxyMeta = await getProxyMeta();
    return {
      query: safeQuery,
      sort: safeSort,
      results,
      meta: {
        total_results: results.length,
        cursor: null,
        proxy: proxyMeta,
        scraped_at: new Date().toISOString(),
        response_time_ms: Date.now() - startTime,
      },
    };
  } catch (err) {
    console.warn('[x-scraper] Nitter search also failed:', (err as Error).message);
  }

  // All strategies failed
  throw new Error('All search strategies exhausted — X may be blocking or rate-limiting');
}

async function searchViaGuestAPI(query: string, mode: string, limit: number): Promise<TweetResult[]> {
  const guestToken = await getGuestToken();

  const variables = {
    rawQuery: query,
    count: limit,
    querySource: 'typed_query',
    product: mode === 'live' ? 'Latest' : 'Top',
  };

  const features = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });

  const url = `https://x.com/i/api/graphql/MJpyQGqgklrVl_0X9gNy3A/SearchTimeline?${params}`;

  const response = await proxyFetch(url, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (response.status === 429) {
    // Invalidate guest token on rate limit
    cachedGuestToken = null;
    throw new Error('Rate limited by X API');
  }

  if (response.status === 403 || response.status === 401) {
    cachedGuestToken = null;
    throw new Error(`X API auth error: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`X API returned ${response.status}`);
  }

  const data = await response.json() as any;

  // Navigate the GraphQL response structure
  const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
  const tweets: TweetResult[] = [];

  for (const instruction of instructions) {
    const entries = instruction.entries || [];
    for (const entry of entries) {
      const result = entry?.content?.itemContent?.tweet_results?.result;
      if (!result) continue;

      // Handle tweet with tombstone or __typename variations
      const tweetData = result.__typename === 'TweetWithVisibilityResults'
        ? result.tweet
        : result;

      if (!tweetData || tweetData.__typename === 'TweetTombstone') continue;

      const parsed = parseTweetFromGraphQL(tweetData);
      if (parsed) tweets.push(parsed);
    }
  }

  return tweets.slice(0, limit);
}

async function searchViaSyndication(query: string, limit: number): Promise<TweetResult[]> {
  // Use the syndication search timeline endpoint
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
  });

  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/search?${params}`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://x.com/',
    },
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Syndication search returned ${response.status}`);
  }

  const html = await response.text();

  // Extract embedded JSON from the syndication HTML response
  const tweets = extractTweetsFromHTML(html);
  return tweets.slice(0, limit);
}

async function searchViaNitter(query: string, limit: number): Promise<TweetResult[]> {
  const tweets: TweetResult[] = [];

  for (const instance of NITTER_INSTANCES) {
    if (tweets.length >= limit) break;

    try {
      const url = `${instance}/search?f=tweets&q=${encodeURIComponent(query)}`;
      const response = await proxyFetch(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
        },
        maxRetries: 0,
        timeoutMs: 15_000,
      });

      if (!response.ok) continue;

      const html = await response.text();
      const parsed = parseNitterResults(html);
      tweets.push(...parsed);
    } catch {
      continue;
    }
  }

  return tweets.slice(0, limit);
}

function extractTweetsFromHTML(html: string): TweetResult[] {
  const tweets: TweetResult[] = [];

  // Look for __NEXT_DATA__ or embedded tweet JSON
  const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const tweetList = data?.props?.pageProps?.timeline?.entries || [];
      for (const entry of tweetList) {
        const tweet = entry?.content?.tweet;
        if (tweet) {
          const parsed = parseTweetFromSyndication(tweet);
          if (parsed) tweets.push(parsed);
        }
      }
    } catch { /* parsing failed */ }
  }

  // Fallback: extract individual tweet data from data-* attributes
  const tweetBlocks = html.match(/data-tweet-id="(\d+)"/g);
  if (tweetBlocks && tweets.length === 0) {
    for (const block of tweetBlocks) {
      const idMatch = block.match(/data-tweet-id="(\d+)"/);
      if (idMatch) {
        const tweetId = idMatch[1];
        tweets.push({
          id: tweetId,
          author: { handle: '', name: '', followers: null, verified: false, avatar: null },
          text: '',
          created_at: null,
          likes: 0, retweets: 0, replies: 0, views: null,
          url: `https://x.com/i/status/${tweetId}`,
          media: [], hashtags: [],
          language: null, conversation_id: null, in_reply_to: null,
        });
      }
    }
  }

  return tweets;
}

function parseNitterResults(html: string): TweetResult[] {
  const tweets: TweetResult[] = [];

  // Parse Nitter timeline items
  const tweetRegex = /<div class="timeline-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let match;

  while ((match = tweetRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract handle
    const handleMatch = block.match(/href="\/@?([^"\/]+)/);
    const handle = handleMatch ? handleMatch[1] : '';

    // Extract name
    const nameMatch = block.match(/class="fullname"[^>]*>([^<]+)/);
    const name = nameMatch ? nameMatch[1].trim() : handle;

    // Extract tweet text
    const textMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = textMatch
      ? textMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
      : '';

    // Extract tweet link / ID
    const linkMatch = block.match(/href="\/[^\/]+\/status\/(\d+)/);
    const tweetId = linkMatch ? linkMatch[1] : '';

    // Extract stats
    const likesMatch = block.match(/icon-heart[^>]*><\/span>\s*(\d[\d,]*)/);
    const retweetsMatch = block.match(/icon-retweet[^>]*><\/span>\s*(\d[\d,]*)/);
    const repliesMatch = block.match(/icon-comment[^>]*><\/span>\s*(\d[\d,]*)/);

    // Extract timestamp
    const timeMatch = block.match(/title="([^"]+)"/);

    if (tweetId && (text || handle)) {
      tweets.push({
        id: tweetId,
        author: {
          handle,
          name,
          followers: null,
          verified: false,
          avatar: null,
        },
        text,
        created_at: timeMatch ? tryParseDate(timeMatch[1]) : null,
        likes: parseStatNumber(likesMatch?.[1]),
        retweets: parseStatNumber(retweetsMatch?.[1]),
        replies: parseStatNumber(repliesMatch?.[1]),
        views: null,
        url: `https://x.com/${handle}/status/${tweetId}`,
        media: [],
        hashtags: extractHashtags(text),
        language: null,
        conversation_id: null,
        in_reply_to: null,
      });
    }
  }

  return tweets;
}

function parseStatNumber(val: string | undefined): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, '')) || 0;
}

function tryParseDate(str: string): string | null {
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// ─── TRENDING TOPICS ────────────────────────────────

/**
 * Get trending topics on X.
 *
 * @param country - ISO country code (default: "US")
 */
export async function getTrendingTopics(
  country: string = 'US',
): Promise<TrendingResponse> {
  const safeCountry = typeof country === 'string'
    ? country.trim().toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '') || 'US'
    : 'US';

  // Strategy 1: Guest API for trending
  try {
    const topics = await trendingViaGuestAPI(safeCountry);
    if (topics.length > 0) {
      const proxyMeta = await getProxyMeta();
      return {
        country: safeCountry,
        topics,
        meta: {
          proxy: proxyMeta,
          scraped_at: new Date().toISOString(),
        },
      };
    }
  } catch (err) {
    console.warn('[x-scraper] Guest API trending failed:', (err as Error).message);
  }

  // Strategy 2: Explore page scraping
  try {
    const topics = await trendingViaExplore(safeCountry);
    if (topics.length > 0) {
      const proxyMeta = await getProxyMeta();
      return {
        country: safeCountry,
        topics,
        meta: {
          proxy: proxyMeta,
          scraped_at: new Date().toISOString(),
        },
      };
    }
  } catch (err) {
    console.warn('[x-scraper] Explore trending failed:', (err as Error).message);
  }

  // Strategy 3: Nitter trending
  try {
    const topics = await trendingViaNitter();
    const proxyMeta = await getProxyMeta();
    return {
      country: safeCountry,
      topics,
      meta: {
        proxy: proxyMeta,
        scraped_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[x-scraper] Nitter trending failed:', (err as Error).message);
  }

  throw new Error('All trending strategies exhausted');
}

async function trendingViaGuestAPI(country: string): Promise<TrendingTopic[]> {
  const guestToken = await getGuestToken();

  // WOEID mapping for popular countries
  const woeidMap: Record<string, number> = {
    'US': 23424977, 'UK': 23424975, 'GB': 23424975, 'CA': 23424775,
    'AU': 23424748, 'IN': 23424848, 'BR': 23424768, 'JP': 23424856,
    'DE': 23424829, 'FR': 23424819, 'MX': 23424900, 'ES': 23424950,
    'IT': 23424853, 'KR': 23424868, 'NG': 23424908, 'ZA': 23424942,
    'TR': 23424969, 'SA': 23424938, 'AE': 23424738, 'PH': 23424934,
    'ID': 23424846, 'TH': 23424960, 'PK': 23424922, 'EG': 23424802,
    'AR': 23424747, 'CO': 23424787, 'KE': 23424863, 'SG': 23424948,
  };

  const woeid = woeidMap[country] || 1; // 1 = worldwide

  const url = `https://api.x.com/1.1/trends/place.json?id=${woeid}`;

  const response = await proxyFetch(url, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Trends API returned ${response.status}`);
  }

  const data = await response.json() as any;
  const trends = data?.[0]?.trends || [];

  return trends.map((t: any, i: number) => ({
    name: t.name || '',
    tweet_volume: t.tweet_volume || null,
    url: t.url || `https://x.com/search?q=${encodeURIComponent(t.name || '')}`,
    category: t.promoted_content ? 'promoted' : null,
    rank: i + 1,
  })).filter((t: TrendingTopic) => t.name);
}

async function trendingViaExplore(country: string): Promise<TrendingTopic[]> {
  const guestToken = await getGuestToken();

  const variables = {
    rawQuery: 'trending',
    count: 40,
    querySource: 'trend_click',
    product: 'Top',
  };

  const features = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });

  const url = `https://x.com/i/api/graphql/vMkJyzx1wdmvOeeNG0n6Wg/ExplorePage?${params}`;

  const response = await proxyFetch(url, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Explore API returned ${response.status}`);
  }

  const data = await response.json() as any;
  const topics: TrendingTopic[] = [];

  const instructions = data?.data?.explore_page?.body?.timeline?.instructions || [];
  for (const instruction of instructions) {
    const entries = instruction.entries || [];
    for (const entry of entries) {
      const trend = entry?.content?.itemContent?.trend;
      if (trend) {
        topics.push({
          name: trend.name || '',
          tweet_volume: trend.trendMetadata?.metaDescription
            ? parseInt(trend.trendMetadata.metaDescription.replace(/[^\d]/g, '')) || null
            : null,
          url: `https://x.com/search?q=${encodeURIComponent(trend.name || '')}`,
          category: trend.trendMetadata?.domainContext || null,
          rank: topics.length + 1,
        });
      }
    }
  }

  return topics;
}

async function trendingViaNitter(): Promise<TrendingTopic[]> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const response = await proxyFetch(instance, {
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        maxRetries: 0,
        timeoutMs: 15_000,
      });

      if (!response.ok) continue;

      const html = await response.text();
      const topics: TrendingTopic[] = [];

      // Parse trending from Nitter sidebar
      const trendRegex = /class="trend-link"[^>]*href="([^"]*)"[^>]*>([^<]+)/g;
      let match;
      while ((match = trendRegex.exec(html)) !== null) {
        const name = match[2].trim();
        if (name) {
          topics.push({
            name,
            tweet_volume: null,
            url: `https://x.com/search?q=${encodeURIComponent(name)}`,
            category: null,
            rank: topics.length + 1,
          });
        }
      }

      if (topics.length > 0) return topics;
    } catch {
      continue;
    }
  }

  return [];
}

// ─── USER PROFILE ───────────────────────────────────

/**
 * Get X user profile data.
 *
 * @param handle - Twitter/X username (without @)
 */
export async function getUserProfile(
  handle: string,
): Promise<ProfileResponse> {
  const safeHandle = sanitize(handle, 50).replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeHandle) throw new Error('Invalid handle');

  // Strategy 1: Guest API UserByScreenName
  try {
    const profile = await profileViaGuestAPI(safeHandle);
    if (profile) return profile;
  } catch (err) {
    console.warn('[x-scraper] Guest API profile failed:', (err as Error).message);
  }

  // Strategy 2: Syndication timeline-profile
  try {
    const profile = await profileViaSyndication(safeHandle);
    if (profile) return profile;
  } catch (err) {
    console.warn('[x-scraper] Syndication profile failed:', (err as Error).message);
  }

  throw new Error(`Could not fetch profile for @${safeHandle} — account may not exist or X is blocking`);
}

async function profileViaGuestAPI(handle: string): Promise<ProfileResponse | null> {
  const guestToken = await getGuestToken();

  const variables = {
    screen_name: handle,
    withSafetyModeUserFields: true,
  };

  const features = {
    hidden_profile_subscriptions_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  };

  const fieldToggles = {
    withAuxiliaryUserLabels: false,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
    fieldToggles: JSON.stringify(fieldToggles),
  });

  const url = `https://x.com/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName?${params}`;

  const response = await proxyFetch(url, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    if (response.status === 429) cachedGuestToken = null;
    throw new Error(`UserByScreenName returned ${response.status}`);
  }

  const data = await response.json() as any;
  const user = data?.data?.user?.result;

  if (!user || user.__typename === 'UserUnavailable') {
    return null;
  }

  const legacy = user.legacy || {};
  const proxyMeta = await getProxyMeta();

  return {
    handle: legacy.screen_name || handle,
    name: legacy.name || handle,
    bio: legacy.description || null,
    followers: legacy.followers_count || 0,
    following: legacy.friends_count || 0,
    tweet_count: legacy.statuses_count || 0,
    verified: legacy.verified || user.is_blue_verified || false,
    avatar: legacy.profile_image_url_https?.replace('_normal', '_400x400') || null,
    banner: legacy.profile_banner_url || null,
    joined: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    location: legacy.location || null,
    website: legacy.entities?.url?.urls?.[0]?.expanded_url || null,
    pinned_tweet: null, // Would need another request
    meta: {
      proxy: proxyMeta,
      scraped_at: new Date().toISOString(),
    },
  };
}

async function profileViaSyndication(handle: string): Promise<ProfileResponse | null> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://x.com/',
    },
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Syndication profile returned ${response.status}`);
  }

  const html = await response.text();

  // Extract embedded JSON data
  const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (!jsonMatch) {
    throw new Error('No embedded data found in syndication response');
  }

  try {
    const data = JSON.parse(jsonMatch[1]);
    const user = data?.props?.pageProps?.user || data?.props?.pageProps?.timeline?.entries?.[0]?.content?.tweet?.user;

    if (!user) return null;

    const proxyMeta = await getProxyMeta();

    return {
      handle: user.screen_name || handle,
      name: user.name || handle,
      bio: user.description || null,
      followers: user.followers_count || 0,
      following: user.friends_count || 0,
      tweet_count: user.statuses_count || 0,
      verified: user.verified || user.is_blue_verified || false,
      avatar: user.profile_image_url_https?.replace('_normal', '_400x400') || null,
      banner: user.profile_banner_url || null,
      joined: user.created_at ? new Date(user.created_at).toISOString() : null,
      location: user.location || null,
      website: user.entities?.url?.urls?.[0]?.expanded_url || null,
      pinned_tweet: null,
      meta: {
        proxy: proxyMeta,
        scraped_at: new Date().toISOString(),
      },
    };
  } catch {
    throw new Error('Failed to parse syndication profile data');
  }
}

// ─── USER TWEETS ────────────────────────────────────

/**
 * Get recent tweets from a user.
 *
 * @param handle - Twitter/X username
 * @param limit  - Max tweets (1-50)
 */
export async function getUserTweets(
  handle: string,
  limit: number = 20,
): Promise<UserTweetsResponse> {
  const safeHandle = sanitize(handle, 50).replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeHandle) throw new Error('Invalid handle');
  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  // Strategy 1: Guest API UserTweets
  try {
    const tweets = await userTweetsViaGuestAPI(safeHandle, safeLimit);
    if (tweets.length > 0) {
      const proxyMeta = await getProxyMeta();
      return {
        handle: safeHandle,
        tweets,
        meta: {
          total_results: tweets.length,
          cursor: null,
          proxy: proxyMeta,
          scraped_at: new Date().toISOString(),
        },
      };
    }
  } catch (err) {
    console.warn('[x-scraper] Guest API user tweets failed:', (err as Error).message);
  }

  // Strategy 2: Syndication timeline
  try {
    const tweets = await userTweetsViaSyndication(safeHandle, safeLimit);
    const proxyMeta = await getProxyMeta();
    return {
      handle: safeHandle,
      tweets,
      meta: {
        total_results: tweets.length,
        cursor: null,
        proxy: proxyMeta,
        scraped_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[x-scraper] Syndication user tweets failed:', (err as Error).message);
  }

  throw new Error(`Could not fetch tweets for @${safeHandle}`);
}

async function userTweetsViaGuestAPI(handle: string, limit: number): Promise<TweetResult[]> {
  // First we need the user's REST ID
  const profile = await profileViaGuestAPI(handle);
  if (!profile) throw new Error('Could not resolve user');

  const guestToken = await getGuestToken();

  // Get user ID from a separate lightweight call
  const userVars = { screen_name: handle, withSafetyModeUserFields: true };
  const userFeatures = {
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  };

  const userParams = new URLSearchParams({
    variables: JSON.stringify(userVars),
    features: JSON.stringify(userFeatures),
  });

  const userUrl = `https://x.com/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName?${userParams}`;

  const userResp = await proxyFetch(userUrl, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!userResp.ok) throw new Error(`UserByScreenName returned ${userResp.status}`);

  const userData = await userResp.json() as any;
  const userId = userData?.data?.user?.result?.rest_id;
  if (!userId) throw new Error('Could not get user ID');

  // Now fetch their tweets
  const variables = {
    userId,
    count: limit,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  };

  const features = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });

  const url = `https://x.com/i/api/graphql/E3opETHurmVJflFsUBVuUQ/UserTweets?${params}`;

  const response = await proxyFetch(url, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    if (response.status === 429) cachedGuestToken = null;
    throw new Error(`UserTweets returned ${response.status}`);
  }

  const data = await response.json() as any;
  const tweets: TweetResult[] = [];

  const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];
  for (const instruction of instructions) {
    const entries = instruction.entries || [];
    for (const entry of entries) {
      const result = entry?.content?.itemContent?.tweet_results?.result;
      if (!result) continue;

      const tweetData = result.__typename === 'TweetWithVisibilityResults'
        ? result.tweet
        : result;

      if (!tweetData || tweetData.__typename === 'TweetTombstone') continue;

      const parsed = parseTweetFromGraphQL(tweetData);
      if (parsed) tweets.push(parsed);
    }
  }

  return tweets.slice(0, limit);
}

async function userTweetsViaSyndication(handle: string, limit: number): Promise<TweetResult[]> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://x.com/',
    },
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Syndication user tweets returned ${response.status}`);
  }

  const html = await response.text();
  const tweets = extractTweetsFromHTML(html);
  return tweets.slice(0, limit);
}

// ─── THREAD / CONVERSATION ──────────────────────────

/**
 * Get full thread/conversation for a tweet.
 *
 * @param tweetId - Tweet ID
 */
export async function getThread(
  tweetId: string,
): Promise<ThreadResponse> {
  const safeId = tweetId.replace(/[^\d]/g, '');
  if (!safeId) throw new Error('Invalid tweet ID');

  // Strategy 1: Guest API TweetDetail
  try {
    const thread = await threadViaGuestAPI(safeId);
    if (thread) return thread;
  } catch (err) {
    console.warn('[x-scraper] Guest API thread failed:', (err as Error).message);
  }

  // Strategy 2: Syndication single tweet
  try {
    const thread = await threadViaSyndication(safeId);
    if (thread) return thread;
  } catch (err) {
    console.warn('[x-scraper] Syndication thread failed:', (err as Error).message);
  }

  throw new Error(`Could not fetch thread for tweet ${safeId}`);
}

async function threadViaGuestAPI(tweetId: string): Promise<ThreadResponse | null> {
  const guestToken = await getGuestToken();

  const variables = {
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: 'Relevance',
    includePromotedContent: false,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: false,
    withBirdwatchNotes: false,
    withVoice: true,
  };

  const features = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });

  const url = `https://x.com/i/api/graphql/nBS-WpgA6ZG0CyNHD517JQ/TweetDetail?${params}`;

  const response = await proxyFetch(url, {
    headers: guestHeaders(guestToken),
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    if (response.status === 429) cachedGuestToken = null;
    throw new Error(`TweetDetail returned ${response.status}`);
  }

  const data = await response.json() as any;

  const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
  let rootTweet: TweetResult | null = null;
  const replies: TweetResult[] = [];

  for (const instruction of instructions) {
    const entries = instruction.entries || [];
    for (const entry of entries) {
      // Single tweet entry
      const singleResult = entry?.content?.itemContent?.tweet_results?.result;
      if (singleResult) {
        const tweetData = singleResult.__typename === 'TweetWithVisibilityResults'
          ? singleResult.tweet
          : singleResult;
        if (tweetData && tweetData.__typename !== 'TweetTombstone') {
          const parsed = parseTweetFromGraphQL(tweetData);
          if (parsed) {
            if (parsed.id === tweetId) {
              rootTweet = parsed;
            } else {
              replies.push(parsed);
            }
          }
        }
      }

      // Conversation thread module (multiple items)
      const items = entry?.content?.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          const result = item?.item?.itemContent?.tweet_results?.result;
          if (!result) continue;
          const tweetData = result.__typename === 'TweetWithVisibilityResults'
            ? result.tweet
            : result;
          if (!tweetData || tweetData.__typename === 'TweetTombstone') continue;
          const parsed = parseTweetFromGraphQL(tweetData);
          if (parsed) {
            if (parsed.id === tweetId) {
              rootTweet = parsed;
            } else {
              replies.push(parsed);
            }
          }
        }
      }
    }
  }

  if (!rootTweet) return null;

  const proxyMeta = await getProxyMeta();

  return {
    root_tweet: rootTweet,
    replies,
    meta: {
      total_replies: replies.length,
      proxy: proxyMeta,
      scraped_at: new Date().toISOString(),
    },
  };
}

async function threadViaSyndication(tweetId: string): Promise<ThreadResponse | null> {
  // Syndication embed endpoint gives us single tweet data
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=0`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://platform.twitter.com/',
    },
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Syndication tweet returned ${response.status}`);
  }

  const data = await response.json() as any;
  const rootTweet = parseTweetFromSyndication(data);

  if (!rootTweet) return null;

  const proxyMeta = await getProxyMeta();

  // Syndication doesn't give us replies, but we return what we have
  const replies: TweetResult[] = [];

  // If there's a parent tweet, include it
  if (data.parent) {
    const parent = parseTweetFromSyndication(data.parent);
    if (parent) replies.unshift(parent);
  }

  return {
    root_tweet: rootTweet,
    replies,
    meta: {
      total_replies: replies.length,
      proxy: proxyMeta,
      scraped_at: new Date().toISOString(),
    },
  };
}
