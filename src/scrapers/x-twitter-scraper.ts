/**
 * X/Twitter Intelligence Scraper
 * ────────────────────────────────
 * Scraping strategy (NO official API subscription required):
 *
 * 1. Guest Token Auth — Uses the public app bearer token to obtain a
 *    short-lived guest token via POST /1.1/guest/activate.json.
 *    All requests route through Proxies.sx mobile proxies.
 *
 * 2. Syndication API — Twitter's public timeline/profile endpoint used
 *    by embedded tweet cards. No auth needed, proxy-routed.
 *
 * 3. Trends24 — Third-party trending aggregator, proxy-routed HTML scrape.
 *
 * Mobile proxies are critical: X's detection system gives mobile carrier IPs
 * 5-10× more generous rate limits than datacenter/residential IPs.
 */

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface TweetResult {
  id: string;
  author: { handle: string; name: string; verified: boolean; followers?: number };
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  url: string;
  hashtags: string[];
  media: string[];
}

export interface TrendingTopic {
  name: string;
  tweet_count: number | null;
  category: string | null;
  url: string;
}

export interface XUserProfile {
  handle: string;
  name: string;
  bio: string;
  location: string;
  followers: number;
  following: number;
  tweets_count: number;
  verified: boolean;
  joined: string;
  profile_image: string;
  banner_image: string;
}

export interface ThreadTweet {
  id: string;
  author: { handle: string; name: string };
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
}

// ─── CONSTANTS ──────────────────────────────────────

/** Public bearer token embedded in the X/Twitter web and mobile apps. */
const PUBLIC_APP_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I6BeUge7Gi0%3DEUifiRBkKG5E2XYQLpKOxGxZnUnOE9h6';

const TWITTER_API_BASE = 'https://api.twitter.com';
const SYNDICATION_BASE = 'https://syndication.twitter.com';
const DEFAULT_TIMEOUT_MS = 20_000;
const GUEST_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_QUERY_LEN = 512;
const MAX_HANDLE_LEN = 50;
const MAX_TWEET_ID_LEN = 30;

// ─── GUEST TOKEN CACHE ──────────────────────────────

interface GuestTokenEntry {
  token: string;
  expiresAt: number;
}

// Module-level cache — tokens are shared across requests within a process lifetime
const guestTokenCache = new Map<string, GuestTokenEntry>();

async function getGuestToken(proxyFetch: ProxyFetchFn): Promise<string> {
  const cacheKey = 'default';
  const cached = guestTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const resp = await proxyFetch(`${TWITTER_API_BASE}/1.1/guest/activate.json`, {
    method: 'POST',
    maxRetries: 3,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${PUBLIC_APP_BEARER}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TwitterAndroid/10.21.0-release.0 (310210000-r-0) ONEPLUS+A3003/9 (OnePlus;ONEPLUS+A3003;OnePlus;OnePlus3;0;;1;2016)',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    },
  });

  if (!resp.ok) {
    throw new Error(`Guest token activation HTTP ${resp.status}: ${await resp.text().then(t => t.slice(0, 200))}`);
  }

  const body = await resp.json() as { guest_token?: string };
  const token = body.guest_token;
  if (!token) throw new Error('No guest_token in activation response');

  guestTokenCache.set(cacheKey, { token, expiresAt: Date.now() + GUEST_TOKEN_TTL_MS });
  return token;
}

function buildGuestHeaders(guestToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${PUBLIC_APP_BEARER}`,
    'x-guest-token': guestToken,
    'User-Agent': 'TwitterAndroid/10.21.0-release.0 (310210000-r-0) ONEPLUS+A3003/9 (OnePlus;ONEPLUS+A3003;OnePlus;OnePlus3;0;;1;2016)',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'Content-Type': 'application/json',
  };
}

// ─── UTILITIES ──────────────────────────────────────

function sanitize(value: string | null | undefined, maxLen: number): string {
  if (!value) return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function safeInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([a-zA-Z0-9_]+)/g)].map(m => m[1]).slice(0, 10);
}

function normalizeDate(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return new Date(raw).toISOString();
  } catch {
    return raw;
  }
}

// ─── TWITTER V1.1 / GRAPHQL TYPES ───────────────────

interface LegacyTweet {
  id_str?: string;
  full_text?: string;
  created_at?: string;
  favorite_count?: number | string;
  retweet_count?: number | string;
  reply_count?: number | string;
  bookmark_count?: number | string;
  view_count_state?: string;
  views_count?: number | string;
  user_id_str?: string;
  user?: LegacyUser;
  entities?: {
    hashtags?: Array<{ text: string }>;
    media?: Array<{ media_url_https?: string; type?: string }>;
  };
  extended_entities?: {
    media?: Array<{ media_url_https?: string; type?: string }>;
  };
}

interface LegacyUser {
  id_str?: string;
  screen_name?: string;
  name?: string;
  description?: string;
  location?: string;
  followers_count?: number;
  friends_count?: number;
  statuses_count?: number;
  verified?: boolean;
  is_blue_verified?: boolean;
  created_at?: string;
  profile_image_url_https?: string;
  profile_banner_url?: string;
}

function legacyTweetToResult(tweet: LegacyTweet, user: LegacyUser | null): TweetResult {
  const handle = sanitize(user?.screen_name, 50);
  const id = tweet.id_str ?? '';
  const text = sanitize(tweet.full_text, 1000);
  const hashtagsFromEntities = (tweet.entities?.hashtags ?? []).map(h => h.text);
  const hashtags = hashtagsFromEntities.length ? hashtagsFromEntities : extractHashtags(text);
  const media = (tweet.extended_entities?.media ?? tweet.entities?.media ?? [])
    .filter(m => m.media_url_https)
    .map(m => m.media_url_https as string)
    .slice(0, 4);

  return {
    id,
    author: {
      handle,
      name: sanitize(user?.name, 100),
      verified: Boolean(user?.verified || user?.is_blue_verified),
      followers: safeInt(user?.followers_count),
    },
    text,
    created_at: normalizeDate(tweet.created_at),
    likes: safeInt(tweet.favorite_count),
    retweets: safeInt(tweet.retweet_count),
    replies: safeInt(tweet.reply_count),
    views: safeInt(tweet.views_count),
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
    hashtags,
    media,
  };
}

// ─── GRAPHQL SEARCH HELPER ────────────────────────────

interface GraphQLTweetEntry {
  entryId?: string;
  content?: {
    itemContent?: {
      tweet_results?: {
        result?: {
          core?: { user_results?: { result?: { legacy?: LegacyUser } } };
          legacy?: LegacyTweet;
          views?: { count?: string };
        };
      };
    };
  };
}

function parseGraphQLEntries(entries: GraphQLTweetEntry[]): TweetResult[] {
  const results: TweetResult[] = [];
  for (const entry of entries) {
    const result = entry.content?.itemContent?.tweet_results?.result;
    if (!result?.legacy) continue;
    const tweet = result.legacy;
    const user = result.core?.user_results?.result?.legacy ?? null;
    const viewCount = safeInt(result.views?.count);
    const parsed = legacyTweetToResult({ ...tweet, views_count: viewCount }, user);
    if (parsed.id) results.push(parsed);
  }
  return results;
}

// ─── SYNDICATION API HELPER ──────────────────────────

interface SyndicationTimeline {
  tweets: LegacyTweet[];
  user: LegacyUser | null;
}

async function syndicationProfileTimeline(
  handle: string,
  count: number,
  proxyFetch: ProxyFetchFn,
): Promise<SyndicationTimeline> {
  const url = `${SYNDICATION_BASE}/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?count=${count}`;
  const resp = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!resp.ok) throw new Error(`Syndication HTTP ${resp.status}`);
  const html = await resp.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!m) throw new Error('No __NEXT_DATA__ in syndication response');
  const data = JSON.parse(m[1]) as Record<string, unknown>;
  const pageProps = (data.props as Record<string, unknown>)?.pageProps as Record<string, unknown>;
  const entries: Array<Record<string, unknown>> =
    ((pageProps?.timeline as Record<string, unknown>)?.entries as Array<Record<string, unknown>>) ?? [];
  const userRaw = pageProps?.profile as LegacyUser | null;

  const tweets: LegacyTweet[] = entries
    .map(e => (e.content as Record<string, unknown>)?.tweet as LegacyTweet)
    .filter(Boolean);

  return { tweets, user: userRaw };
}

// ─── PUBLIC API FUNCTIONS ───────────────────────────

/**
 * Search tweets by keyword, hashtag, or query string.
 * Uses guest token auth + Proxies.sx mobile proxies — no official API subscription.
 */
export async function searchTweets(
  query: string,
  sort: 'relevancy' | 'recency' | 'latest' | 'top' = 'recency',
  limit: number,
  proxyFetch: ProxyFetchFn,
): Promise<TweetResult[]> {
  const q = sanitize(query, MAX_QUERY_LEN);
  if (!q) return [];
  const n = Math.min(Math.max(safeInt(limit) || 20, 10), 50);
  const sortMode = (sort === 'relevancy' || sort === 'top') ? 'Top' : 'Latest';

  const guestToken = await getGuestToken(proxyFetch);

  // Twitter's internal search GraphQL endpoint (same as used by the web app)
  const variables = JSON.stringify({
    rawQuery: `${q} -is:retweet lang:en`,
    count: n,
    querySource: 'typed_query',
    product: sortMode,
  });
  const features = JSON.stringify({
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
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
    interactive_text_enabled: true,
    responsive_web_text_conversations_enabled: false,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });

  const url = `${TWITTER_API_BASE}/graphql/nK1dw4oV3k4w5TdtcAdSww/SearchTimeline?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

  const resp = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headers: buildGuestHeaders(guestToken),
  });

  if (!resp.ok) {
    const errText = await resp.text().then(t => t.slice(0, 300));
    throw new Error(`Twitter GraphQL search HTTP ${resp.status}: ${errText}`);
  }

  const body = await resp.json() as {
    data?: {
      search_by_raw_query?: {
        search_timeline?: {
          timeline?: { instructions?: Array<{ entries?: GraphQLTweetEntry[] }> };
        };
      };
    };
  };

  const instructions = body.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];
  const allEntries: GraphQLTweetEntry[] = [];
  for (const inst of instructions) {
    if (inst.entries) allEntries.push(...inst.entries);
  }

  const results = parseGraphQLEntries(allEntries);
  return results.slice(0, n);
}

/**
 * Get trending topics on X/Twitter.
 * Uses Trends24 (aggregates Twitter trending data, publicly accessible) via proxy.
 */
export async function getTrending(
  country: string,
  proxyFetch: ProxyFetchFn,
): Promise<TrendingTopic[]> {
  const cc = sanitize(country, 10).toUpperCase() || 'US';
  const countryMap: Record<string, string> = {
    US: 'united-states', GB: 'united-kingdom', CA: 'canada',
    AU: 'australia', DE: 'germany', FR: 'france', JP: 'japan',
    BR: 'brazil', IN: 'india', MX: 'mexico',
  };
  const slug = countryMap[cc] ?? 'united-states';
  const url = `https://trends24.in/${slug}/`;

  const resp = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!resp.ok) throw new Error(`Trends24 HTTP ${resp.status}`);
  const html = await resp.text();

  const results: TrendingTopic[] = [];
  const trendMatches = html.matchAll(/<li[^>]*><a[^>]+href="[^"]*">([^<]+)<\/a>/g);
  for (const m of trendMatches) {
    const name = sanitize(m[1], 100);
    if (!name || name.length < 2 || /^(Home|Trending|About|Terms|Privacy|Login)$/i.test(name)) continue;
    results.push({
      name: name.startsWith('#') ? name : `#${name}`,
      tweet_count: null,
      category: null,
      url: `https://x.com/search?q=${encodeURIComponent(name)}&src=trend_click`,
    });
    if (results.length >= 20) break;
  }
  return results;
}

/**
 * Get X/Twitter user profile.
 * Uses Twitter v1.1 user/show endpoint with guest token, proxy-routed.
 */
export async function getUserProfile(
  handle: string,
  proxyFetch: ProxyFetchFn,
): Promise<XUserProfile> {
  const h = sanitize(handle, MAX_HANDLE_LEN).replace(/^@/, '');
  if (!h) throw new Error('Invalid handle');

  // Try v1.1 users/show (guest token approach)
  try {
    const guestToken = await getGuestToken(proxyFetch);
    const url = `${TWITTER_API_BASE}/1.1/users/show.json?screen_name=${encodeURIComponent(h)}&include_entities=false`;
    const resp = await proxyFetch(url, {
      maxRetries: 2,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      headers: buildGuestHeaders(guestToken),
    });

    if (resp.ok) {
      const u = await resp.json() as LegacyUser;
      if (u.screen_name) {
        return {
          handle: sanitize(u.screen_name, 50),
          name: sanitize(u.name, 100),
          bio: sanitize(u.description, 500),
          location: sanitize(u.location, 200),
          followers: safeInt(u.followers_count),
          following: safeInt(u.friends_count),
          tweets_count: safeInt(u.statuses_count),
          verified: Boolean(u.verified || u.is_blue_verified),
          joined: normalizeDate(u.created_at),
          profile_image: sanitize(
            (u.profile_image_url_https ?? '').replace('_normal', '_400x400'),
            500,
          ),
          banner_image: sanitize(u.profile_banner_url, 500),
        };
      }
    }
  } catch {
    // Fall through to syndication
  }

  // Fallback: Syndication API (no auth required, proxy-routed)
  const { user } = await syndicationProfileTimeline(h, 1, proxyFetch);
  if (!user) throw new Error(`Profile not found for @${h}`);
  return {
    handle: sanitize(user.screen_name, 50),
    name: sanitize(user.name, 100),
    bio: sanitize(user.description, 500),
    location: sanitize(user.location, 200),
    followers: safeInt(user.followers_count),
    following: safeInt(user.friends_count),
    tweets_count: safeInt(user.statuses_count),
    verified: Boolean(user.verified || user.is_blue_verified),
    joined: normalizeDate(user.created_at),
    profile_image: sanitize(
      ((user.profile_image_url_https as string) ?? '').replace('_normal', '_400x400'),
      500,
    ),
    banner_image: sanitize(user.profile_banner_url, 500),
  };
}

/**
 * Get recent tweets from a specific user.
 * Uses Twitter Syndication API (no auth, proxy-routed) with v1.1 fallback.
 */
export async function getUserTweets(
  handle: string,
  limit: number,
  proxyFetch: ProxyFetchFn,
): Promise<TweetResult[]> {
  const h = sanitize(handle, MAX_HANDLE_LEN).replace(/^@/, '');
  if (!h) return [];
  const n = Math.min(Math.max(safeInt(limit) || 20, 1), 100);

  // Syndication API — works without auth, route through proxy
  try {
    const { tweets, user } = await syndicationProfileTimeline(h, n, proxyFetch);
    return tweets.slice(0, n).map(t => legacyTweetToResult(t, user));
  } catch {
    // Fallback: v1.1 statuses/user_timeline with guest token
    const guestToken = await getGuestToken(proxyFetch);
    const params = new URLSearchParams({
      screen_name: h,
      count: String(Math.min(n, 200)),
      tweet_mode: 'extended',
      exclude_replies: 'true',
      include_rts: 'false',
    });
    const url = `${TWITTER_API_BASE}/1.1/statuses/user_timeline.json?${params}`;
    const resp = await proxyFetch(url, {
      maxRetries: 2,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      headers: buildGuestHeaders(guestToken),
    });
    if (!resp.ok) throw new Error(`User timeline HTTP ${resp.status}`);
    const body = await resp.json() as LegacyTweet[];
    return body.slice(0, n).map(t => legacyTweetToResult(t, t.user ?? null));
  }
}

/**
 * Get full thread/conversation from a tweet ID.
 * Uses v1.1 statuses/lookup with guest token, proxy-routed.
 */
export async function getThread(
  tweetId: string,
  proxyFetch: ProxyFetchFn,
): Promise<ThreadTweet[]> {
  const tid = sanitize(tweetId, MAX_TWEET_ID_LEN).replace(/[^0-9]/g, '');
  if (!tid) throw new Error('Invalid tweet ID');

  const guestToken = await getGuestToken(proxyFetch);
  const params = new URLSearchParams({
    id: tid,
    tweet_mode: 'extended',
    include_entities: 'true',
  });
  const url = `${TWITTER_API_BASE}/1.1/statuses/show.json?${params}`;
  const resp = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headers: buildGuestHeaders(guestToken),
  });
  if (!resp.ok) throw new Error(`Tweet lookup HTTP ${resp.status}`);

  const tweet = await resp.json() as LegacyTweet;
  const result = legacyTweetToResult(tweet, tweet.user ?? null);

  // Get conversation replies via search
  const replies: ThreadTweet[] = [];
  try {
    const convQuery = `conversation_id:${tid}`;
    const replyResults = await searchTweets(convQuery, 'recency', 20, proxyFetch);
    for (const r of replyResults) {
      if (r.id === tid) continue;
      replies.push({
        id: r.id,
        author: { handle: r.author.handle, name: r.author.name },
        text: r.text,
        created_at: r.created_at,
        likes: r.likes,
        retweets: r.retweets,
        replies: r.replies,
      });
    }
  } catch {
    // Thread search unavailable, return original tweet only
  }

  const original: ThreadTweet = {
    id: result.id,
    author: { handle: result.author.handle, name: result.author.name },
    text: result.text,
    created_at: result.created_at,
    likes: result.likes,
    retweets: result.retweets,
    replies: result.replies,
  };

  return [original, ...replies];
}
