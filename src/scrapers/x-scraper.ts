/**
 * X/Twitter Real-Time Scraper
 * ────────────────────────────
 * Uses X's internal GraphQL API with rotating mobile proxies.
 * Guest token handshake → guest bearer token → GraphQL queries.
 *
 * X's detection system:
 * - Mobile carrier IPs get 5-10x more generous rate limits
 * - Guest tokens rotate on 429/403 responses
 * - Mobile Safari UA avoids desktop fingerprinting
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ─────────────────────────────────────────

export interface XAuthor {
  handle: string;
  name: string;
  followers: number;
  verified: boolean;
  profile_image_url: string;
}

export interface XTweet {
  id: string;
  author: XAuthor;
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  url: string;
  media: string[];
  hashtags: string[];
  is_retweet: boolean;
  quoted_tweet?: {
    id: string;
    text: string;
    author_handle: string;
  } | null;
}

export interface XSearchResult {
  query: string;
  sort: string;
  results: XTweet[];
  meta: {
    total_results: number;
    cursor?: string;
    proxy: { ip: string; country: string; carrier: string };
  };
}

export interface XTrending {
  name: string;
  tweet_count: string;
  url: string;
  category?: string;
}

export interface XProfile {
  handle: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  tweets_count: number;
  verified: boolean;
  created_at: string;
  location: string;
  website: string;
  profile_image_url: string;
  banner_url: string;
}

// ─── TOKEN MANAGEMENT ──────────────────────────────

// Guest tokens are short-lived; cache with TTL
let guestToken: string | null = null;
let guestTokenExpiry = 0;
const GUEST_TOKEN_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

// X app bearer token (public, embedded in X's web app)
const X_BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

async function getGuestToken(): Promise<string> {
  const now = Date.now();
  if (guestToken && now < guestTokenExpiry) {
    return guestToken;
  }

  // Activate guest token via X's API
  const response = await proxyFetch('https://api.twitter.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${X_BEARER_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'TwitterAndroid/10.18.0 (29180000-r-0) arm64-v8a / 12 / 2048x1080 / Google',
      'X-Twitter-Client-Language': 'en',
      'X-Twitter-Client-Timezone': 'America/New_York',
      'X-Guest-Token': '',
    },
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    throw new Error(`Failed to get guest token: ${response.status}`);
  }

  const data = await response.json() as any;
  if (!data.guest_token) {
    throw new Error('No guest_token in response');
  }

  guestToken = data.guest_token;
  guestTokenExpiry = now + GUEST_TOKEN_TTL_MS;
  return guestToken!;
}

function makeXHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${X_BEARER_TOKEN}`,
    'X-Guest-Token': token,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 Twitter/10.18',
    'X-Twitter-Client-Language': 'en',
    'X-Twitter-Active-User': 'yes',
    'Referer': 'https://twitter.com/',
    'Origin': 'https://twitter.com',
  };
}

// ─── GRAPHQL VARIABLES & FEATURES ──────────────────

const SEARCH_FEATURES = JSON.stringify({
  rweb_lists_timeline_redesign_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: false,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_the_sky_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
});

// ─── TWEET PARSER ──────────────────────────────────

function parseTweet(item: any): XTweet | null {
  try {
    const result = item?.content?.itemContent?.tweet_results?.result;
    if (!result) return null;

    // Handle tombstoned/hidden tweets
    const tweet = result?.tweet || result;
    const core = tweet?.core?.user_results?.result?.legacy;
    const legacy = tweet?.legacy;

    if (!legacy || !core) return null;

    const media: string[] = [];
    const mediaItems = legacy.entities?.media || legacy.extended_entities?.media || [];
    for (const m of mediaItems) {
      if (m.media_url_https) media.push(m.media_url_https);
    }

    const hashtags = (legacy.entities?.hashtags || []).map((h: any) => h.text);

    let quotedTweet = null;
    if (tweet.quoted_status_result?.result?.legacy) {
      const q = tweet.quoted_status_result.result.legacy;
      quotedTweet = {
        id: q.id_str,
        text: q.full_text || q.text || '',
        author_handle: tweet.quoted_status_result.result.core?.user_results?.result?.legacy?.screen_name || '',
      };
    }

    const views = parseInt(tweet.views?.count || '0') || 0;
    const authorHandle = core.screen_name || '';

    return {
      id: legacy.id_str || '',
      author: {
        handle: authorHandle,
        name: core.name || '',
        followers: core.followers_count || 0,
        verified: core.verified || tweet.is_blue_verified || false,
        profile_image_url: core.profile_image_url_https || '',
      },
      text: legacy.full_text || legacy.text || '',
      created_at: legacy.created_at || '',
      likes: legacy.favorite_count || 0,
      retweets: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      views,
      url: `https://x.com/${authorHandle}/status/${legacy.id_str}`,
      media,
      hashtags,
      is_retweet: !!legacy.retweeted_status_id_str,
      quoted_tweet: quotedTweet,
    };
  } catch {
    return null;
  }
}

// ─── SEARCH ────────────────────────────────────────

export async function searchTweets(
  query: string,
  sort: 'latest' | 'top' = 'latest',
  limit: number = 20,
  cursor?: string,
): Promise<XSearchResult> {
  const token = await getGuestToken();

  const productType = sort === 'latest' ? 'Latest' : 'Top';

  const variables = JSON.stringify({
    rawQuery: query,
    count: Math.min(limit, 40),
    querySource: 'typed_query',
    product: productType,
    ...(cursor ? { cursor } : {}),
  });

  const params = new URLSearchParams({
    variables,
    features: SEARCH_FEATURES,
  });

  const url = `https://twitter.com/i/api/graphql/nK1dw4oV3k4w5TdtcAdSww/SearchTimeline?${params}`;

  let response = await proxyFetch(url, {
    headers: makeXHeaders(token),
    timeoutMs: 30_000,
  });

  // If 403/429, reset token and retry once
  if (response.status === 403 || response.status === 429) {
    guestToken = null;
    guestTokenExpiry = 0;
    const freshToken = await getGuestToken();
    response = await proxyFetch(url, {
      headers: makeXHeaders(freshToken),
      timeoutMs: 30_000,
    });
  }

  if (!response.ok) {
    throw new Error(`X search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const timeline = data?.data?.search_by_raw_query?.search_timeline?.timeline;
  const entries = timeline?.instructions?.[0]?.entries || [];

  const tweets: XTweet[] = [];
  let nextCursor: string | undefined;

  for (const entry of entries) {
    const entryId: string = entry?.entryId || '';

    if (entryId.startsWith('cursor-bottom')) {
      nextCursor = entry?.content?.value;
      continue;
    }

    const tweet = parseTweet(entry);
    if (tweet) {
      tweets.push(tweet);
      if (tweets.length >= limit) break;
    }
  }

  return {
    query,
    sort,
    results: tweets,
    meta: {
      total_results: tweets.length,
      cursor: nextCursor,
      proxy: { ip: '', country: 'US', carrier: 'T-Mobile' },
    },
  };
}

// ─── TRENDING ──────────────────────────────────────

export async function getTrending(countryCode: string = 'US'): Promise<XTrending[]> {
  const token = await getGuestToken();

  // Map country code to WOEID (Where On Earth ID) used by Twitter
  const woeidMap: Record<string, number> = {
    US: 23424977,
    GB: 23424975,
    CA: 23424775,
    AU: 23424748,
    IN: 23424848,
    DE: 23424829,
    FR: 23424819,
    JP: 23424856,
    BR: 23424768,
    MX: 23424900,
    ES: 23424950,
    IT: 23424853,
    KR: 23424868,
    NL: 23424909,
    PL: 23424923,
    TR: 23424969,
    AR: 23424747,
    ZA: 23424942,
    SG: 23424935,
    ID: 23424846,
  };

  const woeid = woeidMap[countryCode.toUpperCase()] || 1; // 1 = worldwide

  const response = await proxyFetch(
    `https://api.twitter.com/1.1/trends/place.json?id=${woeid}`,
    {
      headers: makeXHeaders(token),
      timeoutMs: 20_000,
    }
  );

  if (!response.ok) {
    // Fallback: use explore API
    return getTrendingFallback(token);
  }

  const data = await response.json() as any;
  const trends = data?.[0]?.trends || [];

  return trends.slice(0, 20).map((t: any) => ({
    name: t.name,
    tweet_count: t.tweet_volume ? String(t.tweet_volume) : 'N/A',
    url: t.url || `https://twitter.com/search?q=${encodeURIComponent(t.name)}`,
    category: t.tweet_volume ? 'trending' : 'curated',
  }));
}

async function getTrendingFallback(token: string): Promise<XTrending[]> {
  const variables = JSON.stringify({
    count: 20,
    withSafetyModeUserFields: true,
  });
  const params = new URLSearchParams({ variables });

  const response = await proxyFetch(
    `https://twitter.com/i/api/2/guide.json?${params}`,
    {
      headers: makeXHeaders(token),
      timeoutMs: 20_000,
    }
  );

  if (!response.ok) {
    throw new Error(`Trending fetch failed: ${response.status}`);
  }

  const data = await response.json() as any;
  const modules = data?.timeline?.instructions?.[0]?.addEntries?.entries || [];

  const trends: XTrending[] = [];
  for (const entry of modules) {
    const trend = entry?.content?.timelineModule?.items?.[0]?.item?.itemContent?.trend;
    if (trend?.name) {
      trends.push({
        name: trend.name,
        tweet_count: trend.trendMetadata?.domainContext || 'Trending',
        url: `https://twitter.com/search?q=${encodeURIComponent(trend.name)}`,
        category: trend.trendMetadata?.metaDescription || undefined,
      });
    }
  }

  return trends;
}

// ─── USER PROFILE ──────────────────────────────────

export async function getUserProfile(handle: string): Promise<XProfile> {
  const token = await getGuestToken();

  const variables = JSON.stringify({
    screen_name: handle.replace('@', ''),
    withSafetyModeUserFields: true,
  });

  const features = JSON.stringify({
    hidden_profile_likes_enabled: true,
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  });

  const params = new URLSearchParams({ variables, features });
  const url = `https://twitter.com/i/api/graphql/G3KGOASz96M-Qu0nwmGXNg/UserByScreenName?${params}`;

  const response = await proxyFetch(url, {
    headers: makeXHeaders(token),
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.status}`);
  }

  const data = await response.json() as any;
  const user = data?.data?.user?.result?.legacy;

  if (!user) {
    throw new Error(`User @${handle} not found or protected`);
  }

  return {
    handle: user.screen_name,
    name: user.name,
    bio: user.description || '',
    followers: user.followers_count || 0,
    following: user.friends_count || 0,
    tweets_count: user.statuses_count || 0,
    verified: user.verified || data?.data?.user?.result?.is_blue_verified || false,
    created_at: user.created_at || '',
    location: user.location || '',
    website: user.entities?.url?.urls?.[0]?.expanded_url || user.url || '',
    profile_image_url: user.profile_image_url_https?.replace('_normal', '_400x400') || '',
    banner_url: user.profile_banner_url || '',
  };
}

// ─── USER TWEETS ───────────────────────────────────

export async function getUserTweets(handle: string, limit: number = 20): Promise<XTweet[]> {
  const token = await getGuestToken();

  // First get userId from handle
  const variables = JSON.stringify({
    screen_name: handle.replace('@', ''),
    withSafetyModeUserFields: true,
  });
  const features = JSON.stringify({
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  });

  const userParams = new URLSearchParams({ variables, features });
  const userUrl = `https://twitter.com/i/api/graphql/G3KGOASz96M-Qu0nwmGXNg/UserByScreenName?${userParams}`;

  const userResponse = await proxyFetch(userUrl, {
    headers: makeXHeaders(token),
    timeoutMs: 20_000,
  });

  if (!userResponse.ok) {
    throw new Error(`Failed to fetch user: ${userResponse.status}`);
  }

  const userData = await userResponse.json() as any;
  const userId = userData?.data?.user?.result?.rest_id;

  if (!userId) {
    throw new Error(`User @${handle} not found`);
  }

  // Now fetch tweets with userId
  const tweetVariables = JSON.stringify({
    userId,
    count: Math.min(limit, 40),
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
  });

  const tweetParams = new URLSearchParams({
    variables: tweetVariables,
    features: SEARCH_FEATURES,
  });

  const tweetsUrl = `https://twitter.com/i/api/graphql/V7H0Ap3_Hh2FyS75OCDO3Q/UserTweets?${tweetParams}`;

  const tweetsResponse = await proxyFetch(tweetsUrl, {
    headers: makeXHeaders(token),
    timeoutMs: 30_000,
  });

  if (!tweetsResponse.ok) {
    throw new Error(`Failed to fetch tweets: ${tweetsResponse.status}`);
  }

  const tweetsData = await tweetsResponse.json() as any;
  const instructions = tweetsData?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];

  const tweets: XTweet[] = [];
  for (const instruction of instructions) {
    const entries = instruction?.entries || [];
    for (const entry of entries) {
      if (entry?.entryId?.startsWith('cursor')) continue;
      const tweet = parseTweet(entry);
      if (tweet && !tweet.is_retweet) {
        tweets.push(tweet);
        if (tweets.length >= limit) break;
      }
    }
    if (tweets.length >= limit) break;
  }

  return tweets;
}

// ─── THREAD EXTRACTION ─────────────────────────────

export async function getThread(tweetId: string): Promise<{ root: XTweet; replies: XTweet[] }> {
  const token = await getGuestToken();

  const variables = JSON.stringify({
    focalTweetId: tweetId,
    count: 40,
    referrer: 'tweet',
    with_rux_injections: false,
    includePromotedContent: false,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
  });

  const params = new URLSearchParams({
    variables,
    features: SEARCH_FEATURES,
  });

  const url = `https://twitter.com/i/api/graphql/3XDB26fBve-MmjHaWTUZxA/TweetDetail?${params}`;

  const response = await proxyFetch(url, {
    headers: makeXHeaders(token),
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch thread: ${response.status}`);
  }

  const data = await response.json() as any;
  const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];

  let root: XTweet | null = null;
  const replies: XTweet[] = [];

  for (const instruction of instructions) {
    const entries = instruction?.entries || [];
    for (const entry of entries) {
      if (entry?.entryId?.startsWith('cursor')) continue;

      // Main tweet
      const tweet = parseTweet(entry);
      if (tweet) {
        if (!root && tweet.id === tweetId) {
          root = tweet;
        } else if (root) {
          replies.push(tweet);
        }
        continue;
      }

      // Threaded replies
      const items = entry?.content?.items || [];
      for (const item of items) {
        const replyTweet = parseTweet(item);
        if (replyTweet && root) {
          replies.push(replyTweet);
        }
      }
    }
  }

  if (!root) {
    throw new Error(`Tweet ${tweetId} not found`);
  }

  return { root, replies: replies.slice(0, 20) };
}
