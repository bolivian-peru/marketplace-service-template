/**
 * X/Twitter Real-Time Search Scraper
 * ───────────────────────────────────
 * Scrapes tweets, trending topics, user profiles, and threads
 * via Nitter instances (primary) with x.com HTML fallback.
 */

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface TweetResult {
  id: string;
  author: { handle: string; name: string; verified: boolean };
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
  hashtags: string[];
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

// ─── NITTER INSTANCES ───────────────────────────────

const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.woodland.cafe',
  'https://nitter.mint.lg.ua',
  'https://nitter.projectsegfau.lt',
];

// ─── UTILITIES ──────────────────────────────────────

/**
 * Parse a human-readable number string into an integer.
 * Handles commas, K (thousands), and M (millions) suffixes.
 */
function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;

  const kMatch = cleaned.match(/^([\d.]+)\s*[kK]$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);

  const mMatch = cleaned.match(/^([\d.]+)\s*[mM]$/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);

  const num = parseInt(cleaned, 10);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Strip HTML tags from a string.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Extract hashtags from tweet text.
 */
function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w]+/g);
  return matches ? [...new Set(matches.map((h) => h.toLowerCase()))] : [];
}

/**
 * Try fetching from Nitter instances in order until one responds.
 * Returns the HTML body and the instance base URL that worked.
 */
async function fetchFromNitter(
  path: string,
  proxyFetch: ProxyFetchFn,
): Promise<{ html: string; instance: string } | null> {
  for (const instance of NITTER_INSTANCES) {
    const url = `${instance}${path}`;
    try {
      const response = await proxyFetch(url, {
        timeoutMs: 20_000,
        maxRetries: 1,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (response.ok) {
        const html = await response.text();
        // Sanity check: Nitter pages include a recognizable container
        if (html.length > 500) {
          return { html, instance };
        }
      }
    } catch {
      // Instance unreachable; try next
    }
  }
  return null;
}

// ─── SEARCH TWEETS ──────────────────────────────────

/**
 * Search tweets by keyword or hashtag.
 * @param query   - Search term (e.g. "AI agents" or "#bitcoin")
 * @param sort    - "top" | "latest" (maps to Nitter's f= param)
 * @param limit   - Max results to return
 */
export async function searchTweets(
  query: string,
  sort: 'top' | 'latest' = 'latest',
  limit: number = 20,
  proxyFetch: ProxyFetchFn,
): Promise<TweetResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const filterParam = sort === 'top' ? 'tweets' : 'tweets';
  const path = `/search?f=${filterParam}&q=${encodedQuery}`;

  const result = await fetchFromNitter(path, proxyFetch);
  if (!result) {
    console.log('[X-Scraper] All Nitter instances failed for search, trying x.com fallback');
    return searchTweetsFallback(query, limit, proxyFetch);
  }

  return parseTweetsFromHtml(result.html, result.instance, limit);
}

/**
 * Fallback: scrape x.com search using a guest-accessible path.
 */
async function searchTweetsFallback(
  query: string,
  limit: number,
  proxyFetch: ProxyFetchFn,
): Promise<TweetResult[]> {
  try {
    const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(query)}`;
    const response = await proxyFetch(url, {
      timeoutMs: 25_000,
      maxRetries: 1,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseSyndicationTweets(html, limit);
  } catch {
    return [];
  }
}

// ─── GET TRENDING ───────────────────────────────────

/**
 * Get trending topics. Nitter exposes a /trending page for some instances.
 * @param country - ISO country code or "worldwide"
 */
export async function getTrending(
  country: string = 'worldwide',
  proxyFetch: ProxyFetchFn,
): Promise<TrendingTopic[]> {
  // Strategy 1: Nitter trending page
  const result = await fetchFromNitter('/trending', proxyFetch);
  if (result) {
    const topics = parseTrendingFromHtml(result.html, result.instance);
    if (topics.length > 0) return topics;
  }

  // Strategy 2: x.com explore page (guest accessible)
  console.log('[X-Scraper] Nitter trending failed, trying x.com explore');
  return getTrendingFallback(country, proxyFetch);
}

/**
 * Fallback trending: scrape x.com/explore or the trends API with guest token.
 */
async function getTrendingFallback(
  country: string,
  proxyFetch: ProxyFetchFn,
): Promise<TrendingTopic[]> {
  try {
    // Try the guest-accessible explore page
    const response = await proxyFetch('https://x.com/explore/tabs/trending', {
      timeoutMs: 25_000,
      maxRetries: 1,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return [];

    const html = await response.text();
    const topics: TrendingTopic[] = [];

    // X embeds trend data in __NEXT_DATA__ or script tags
    const trendPattern = /"name"\s*:\s*"([^"]{2,80})"[\s\S]*?(?:"tweet_count"\s*:\s*(\d+))?/g;
    let match;
    const seen = new Set<string>();

    while ((match = trendPattern.exec(html)) !== null) {
      const name = match[1];
      if (seen.has(name.toLowerCase()) || name.length < 2) continue;
      seen.add(name.toLowerCase());

      topics.push({
        name,
        tweet_count: match[2] ? parseInt(match[2], 10) : null,
        category: null,
        url: `https://x.com/search?q=${encodeURIComponent(name)}`,
      });
    }

    return topics;
  } catch {
    return [];
  }
}

// ─── USER PROFILE ───────────────────────────────────

/**
 * Get a user's profile data (bio, follower counts, etc).
 * @param handle - Twitter handle without the @ sign
 */
export async function getUserProfile(
  handle: string,
  proxyFetch: ProxyFetchFn,
): Promise<XUserProfile | null> {
  const cleanHandle = handle.replace(/^@/, '');
  const result = await fetchFromNitter(`/${cleanHandle}`, proxyFetch);

  if (!result) {
    console.log('[X-Scraper] All Nitter instances failed for profile, trying fallback');
    return getUserProfileFallback(cleanHandle, proxyFetch);
  }

  return parseProfileFromHtml(result.html, cleanHandle);
}

/**
 * Fallback: scrape the x.com syndication endpoint for profile data.
 */
async function getUserProfileFallback(
  handle: string,
  proxyFetch: ProxyFetchFn,
): Promise<XUserProfile | null> {
  try {
    const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`;
    const response = await proxyFetch(url, { timeoutMs: 25_000, maxRetries: 1 });
    if (!response.ok) return null;

    const html = await response.text();
    return parseSyndicationProfile(html, handle);
  } catch {
    return null;
  }
}

// ─── USER TWEETS ────────────────────────────────────

/**
 * Get recent tweets from a user.
 * @param handle - Twitter handle without the @ sign
 * @param limit  - Max tweets to return
 */
export async function getUserTweets(
  handle: string,
  limit: number = 20,
  proxyFetch: ProxyFetchFn,
): Promise<TweetResult[]> {
  const cleanHandle = handle.replace(/^@/, '');
  const result = await fetchFromNitter(`/${cleanHandle}`, proxyFetch);

  if (!result) {
    console.log('[X-Scraper] All Nitter instances failed for user tweets');
    return [];
  }

  return parseTweetsFromHtml(result.html, result.instance, limit);
}

// ─── GET THREAD ─────────────────────────────────────

/**
 * Extract a full conversation thread for a given tweet.
 * @param tweetId - The numeric tweet/status ID
 */
export async function getThread(
  tweetId: string,
  proxyFetch: ProxyFetchFn,
): Promise<ThreadTweet[]> {
  // We need the author handle to build the Nitter URL.
  // Try multiple patterns: /i/status/ID and also search for the tweet directly.
  // Nitter uses /USERNAME/status/ID format, but we can try a redirect from /i/status/ID.

  // Strategy 1: Try /i/status/ID which some Nitter instances redirect
  let result = await fetchFromNitter(`/i/status/${tweetId}`, proxyFetch);

  // Strategy 2: If that fails, try the tweet embed endpoint to discover the author
  if (!result) {
    const author = await discoverTweetAuthor(tweetId, proxyFetch);
    if (author) {
      result = await fetchFromNitter(`/${author}/status/${tweetId}`, proxyFetch);
    }
  }

  if (!result) {
    console.log('[X-Scraper] Could not fetch thread from any Nitter instance');
    return getThreadFallback(tweetId, proxyFetch);
  }

  return parseThreadFromHtml(result.html);
}

/**
 * Discover the author of a tweet using the syndication embed endpoint.
 */
async function discoverTweetAuthor(
  tweetId: string,
  proxyFetch: ProxyFetchFn,
): Promise<string | null> {
  try {
    const url = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}`;
    const response = await proxyFetch(url, { timeoutMs: 15_000, maxRetries: 1 });
    if (!response.ok) return null;

    const html = await response.text();
    const handleMatch = html.match(/"screen_name"\s*:\s*"([^"]+)"/);
    if (handleMatch) return handleMatch[1];

    const linkMatch = html.match(/x\.com\/(\w+)\/status/);
    if (linkMatch) return linkMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback thread extraction via x.com syndication.
 */
async function getThreadFallback(
  tweetId: string,
  proxyFetch: ProxyFetchFn,
): Promise<ThreadTweet[]> {
  try {
    const url = `https://syndication.twitter.com/srv/timeline-conversation/tweet/${tweetId}`;
    const response = await proxyFetch(url, { timeoutMs: 25_000, maxRetries: 1 });
    if (!response.ok) return [];

    const html = await response.text();
    return parseSyndicationThread(html);
  } catch {
    return [];
  }
}

// ─── HTML PARSING: NITTER ───────────────────────────

/**
 * Parse tweet cards from Nitter HTML.
 * Nitter renders tweets in <div class="timeline-item"> blocks.
 */
function parseTweetsFromHtml(html: string, instance: string, limit: number): TweetResult[] {
  const tweets: TweetResult[] = [];
  const seen = new Set<string>();

  // Nitter timeline items: each tweet is inside a div.timeline-item
  const itemPattern =
    /<div[^>]*class="[^"]*timeline-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*timeline-item[^"]*"|<div[^>]*class="[^"]*show-more|$)/gi;

  let match;
  while ((match = itemPattern.exec(html)) !== null && tweets.length < limit) {
    const card = match[1];
    const tweet = parseSingleNitterTweet(card, instance);
    if (tweet && !seen.has(tweet.id)) {
      seen.add(tweet.id);
      tweets.push(tweet);
    }
  }

  // Fallback: try tweet-body class pattern (some Nitter forks)
  if (tweets.length === 0) {
    const altPattern =
      /<div[^>]*class="[^"]*tweet-body[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*tweet-body|$)/gi;

    while ((match = altPattern.exec(html)) !== null && tweets.length < limit) {
      const card = match[1];
      const tweet = parseSingleNitterTweet(card, instance);
      if (tweet && !seen.has(tweet.id)) {
        seen.add(tweet.id);
        tweets.push(tweet);
      }
    }
  }

  return tweets;
}

/**
 * Parse a single tweet from a Nitter HTML card block.
 */
function parseSingleNitterTweet(card: string, instance: string): TweetResult | null {
  // Extract tweet link/ID: href="/USER/status/ID"
  const linkMatch = card.match(/href="\/([^/]+)\/status\/(\d+)/);
  if (!linkMatch) return null;

  const handle = linkMatch[1];
  const id = linkMatch[2];

  // Display name: <a class="fullname" ...>Name</a>
  const nameMatch =
    card.match(/class="[^"]*fullname[^"]*"[^>]*>([^<]+)</) ||
    card.match(/class="[^"]*username[^"]*"[^>]*title="([^"]+)"/);
  const name = nameMatch ? decodeEntities(stripTags(nameMatch[1])).trim() : handle;

  // Verified badge: presence of icon-verified class or checkmark
  const verified = /class="[^"]*verified[^"]*"/.test(card) || /\u2713/.test(card);

  // Tweet text: <div class="tweet-content ...">...</div>
  const textMatch =
    card.match(/class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
    card.match(/class="[^"]*media-body[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const rawText = textMatch ? textMatch[1] : '';
  const text = decodeEntities(stripTags(rawText)).trim();

  if (!text) return null;

  // Timestamp: <span class="tweet-date"><a ...title="DATE">
  const dateMatch =
    card.match(/class="[^"]*tweet-date[^"]*"[^>]*>[\s\S]*?title="([^"]+)"/) ||
    card.match(/datetime="([^"]+)"/) ||
    card.match(/title="(\w{3}\s+\d{1,2},\s+\d{4})/);
  const created_at = dateMatch ? dateMatch[1].trim() : '';

  // Engagement stats: <span class="icon-*"></span> COUNT
  const likesMatch =
    card.match(/class="[^"]*icon-heart[^"]*"[^>]*><\/span>\s*([\d,.]+[kKmM]?)/) ||
    card.match(/class="[^"]*tweet-stat[^"]*"[^>]*>[^<]*like[^<]*<[^>]*>([\d,.]+[kKmM]?)/i);
  const rtMatch =
    card.match(/class="[^"]*icon-retweet[^"]*"[^>]*><\/span>\s*([\d,.]+[kKmM]?)/) ||
    card.match(/class="[^"]*tweet-stat[^"]*"[^>]*>[^<]*re(?:tweet|post)[^<]*<[^>]*>([\d,.]+[kKmM]?)/i);
  const repliesMatch =
    card.match(/class="[^"]*icon-comment[^"]*"[^>]*><\/span>\s*([\d,.]+[kKmM]?)/) ||
    card.match(/class="[^"]*tweet-stat[^"]*"[^>]*>[^<]*repl[^<]*<[^>]*>([\d,.]+[kKmM]?)/i);

  const hashtags = extractHashtags(text);

  return {
    id,
    author: { handle, name, verified },
    text,
    created_at,
    likes: parseCount(likesMatch?.[1]),
    retweets: parseCount(rtMatch?.[1]),
    replies: parseCount(repliesMatch?.[1]),
    url: `https://x.com/${handle}/status/${id}`,
    hashtags,
  };
}

/**
 * Parse trending topics from Nitter's /trending page HTML.
 */
function parseTrendingFromHtml(html: string, instance: string): TrendingTopic[] {
  const topics: TrendingTopic[] = [];
  const seen = new Set<string>();

  // Nitter trending items: <div class="trend-item"> or <li> inside trending list
  const patterns = [
    /class="[^"]*trend-(?:item|link)[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?(?:(\d[\d,.]*[kKmM]?)\s*(?:tweets?|posts?))?/gi,
    /<li[^>]*class="[^"]*trend[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?(?:<span[^>]*>([\d,.]+[kKmM]?)\s*(?:tweets?|posts?)?<\/span>)?/gi,
    /class="[^"]*trending[^"]*"[^>]*>[\s\S]*?href="([^"]*)"[^>]*>([^<]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      // Handle different capture group layouts between patterns
      let name: string;
      let countStr: string | null = null;
      let href: string | null = null;

      if (match.length >= 3 && match[1].startsWith('/')) {
        // Pattern with href first
        href = match[1];
        name = decodeEntities(stripTags(match[2])).trim();
        countStr = match[3] || null;
      } else {
        name = decodeEntities(stripTags(match[1])).trim();
        countStr = match[2] || null;
      }

      if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      topics.push({
        name,
        tweet_count: countStr ? parseCount(countStr) : null,
        category: null,
        url: href
          ? `${instance}${href}`
          : `https://x.com/search?q=${encodeURIComponent(name)}`,
      });
    }
    if (topics.length > 0) break;
  }

  return topics;
}

/**
 * Parse a user profile from Nitter HTML.
 */
function parseProfileFromHtml(html: string, handle: string): XUserProfile | null {
  // Display name: <a class="profile-card-fullname" ...>Name</a>
  const nameMatch =
    html.match(/class="[^"]*profile-card-fullname[^"]*"[^>]*>([^<]+)</) ||
    html.match(/class="[^"]*profile-card-fullname[^"]*"[^>]*>[\s\S]*?<span>([^<]+)</) ||
    html.match(/<title>([^(<]+)/);
  const name = nameMatch ? decodeEntities(stripTags(nameMatch[1])).trim() : handle;

  // Bio: <div class="profile-bio"> or <p class="bio">
  const bioMatch =
    html.match(/class="[^"]*profile-bio[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/) ||
    html.match(/class="[^"]*bio[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/);
  const bio = bioMatch ? decodeEntities(stripTags(bioMatch[1])).trim() : '';

  // Location
  const locMatch =
    html.match(/class="[^"]*profile-location[^"]*"[^>]*>([\s\S]*?)<\//) ||
    html.match(/class="[^"]*location[^"]*"[^>]*>([^<]+)</);
  const location = locMatch ? decodeEntities(stripTags(locMatch[1])).trim() : '';

  // Stat counts: Nitter usually has <li class="posts-count">, <li class="following-count">, etc.
  const tweetsMatch =
    html.match(/class="[^"]*posts-count[^"]*"[^>]*>[\s\S]*?class="[^"]*profile-stat-num[^"]*"[^>]*>([\d,.]+[kKmM]?)/) ||
    html.match(/class="[^"]*posts-count[^"]*"[^>]*>([\d,.]+[kKmM]?)/);
  const followingMatch =
    html.match(/class="[^"]*following-count[^"]*"[^>]*>[\s\S]*?class="[^"]*profile-stat-num[^"]*"[^>]*>([\d,.]+[kKmM]?)/) ||
    html.match(/class="[^"]*following[^"]*"[^>]*>([\d,.]+[kKmM]?)/);
  const followersMatch =
    html.match(/class="[^"]*followers-count[^"]*"[^>]*>[\s\S]*?class="[^"]*profile-stat-num[^"]*"[^>]*>([\d,.]+[kKmM]?)/) ||
    html.match(/class="[^"]*followers[^"]*"[^>]*>([\d,.]+[kKmM]?)/);

  // Verified badge
  const verified = /class="[^"]*verified[^"]*"/.test(html);

  // Joined date
  const joinedMatch =
    html.match(/class="[^"]*profile-joindate[^"]*"[^>]*>[\s\S]*?title="([^"]+)"/) ||
    html.match(/Joined\s*:?\s*([A-Za-z]+\s+\d{4})/i);
  const joined = joinedMatch ? joinedMatch[1].trim() : '';

  // Profile image
  const avatarMatch =
    html.match(/class="[^"]*profile-card-avatar[^"]*"[^>]*src="([^"]+)"/) ||
    html.match(/class="[^"]*profile-card-avatar[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/) ||
    html.match(/class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/);
  const profile_image = avatarMatch ? avatarMatch[1] : '';

  // Banner image
  const bannerMatch =
    html.match(/class="[^"]*profile-banner[^"]*"[^>]*>[\s\S]*?<(?:img|a)[^>]*(?:src|href)="([^"]+)"/) ||
    html.match(/class="[^"]*banner[^"]*"[^>]*src="([^"]+)"/);
  const banner_image = bannerMatch ? bannerMatch[1] : '';

  return {
    handle,
    name,
    bio,
    location,
    followers: parseCount(followersMatch?.[1]),
    following: parseCount(followingMatch?.[1]),
    tweets_count: parseCount(tweetsMatch?.[1]),
    verified,
    joined,
    profile_image,
    banner_image,
  };
}

/**
 * Parse a thread (conversation) from Nitter HTML.
 * Nitter renders thread tweets in <div class="timeline-item"> within the
 * main-thread and after-thread sections.
 */
function parseThreadFromHtml(html: string): ThreadTweet[] {
  const thread: ThreadTweet[] = [];
  const seen = new Set<string>();

  // Nitter shows the main tweet + replies in timeline-item blocks, often
  // wrapped in <div class="main-thread"> and <div class="after-thread">.
  const itemPattern =
    /<div[^>]*class="[^"]*(?:timeline-item|thread-line|main-tweet|reply)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:timeline-item|thread-line|main-tweet|reply)[^"]*"|<div[^>]*class="[^"]*show-more|$)/gi;

  let match;
  while ((match = itemPattern.exec(html)) !== null) {
    const card = match[1];

    const linkMatch = card.match(/href="\/([^/]+)\/status\/(\d+)/);
    if (!linkMatch) continue;

    const handle = linkMatch[1];
    const id = linkMatch[2];

    if (seen.has(id)) continue;
    seen.add(id);

    const nameMatch =
      card.match(/class="[^"]*fullname[^"]*"[^>]*>([^<]+)</) ||
      card.match(/class="[^"]*username[^"]*"[^>]*title="([^"]+)"/);
    const name = nameMatch ? decodeEntities(stripTags(nameMatch[1])).trim() : handle;

    const textMatch =
      card.match(/class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
      card.match(/class="[^"]*media-body[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = textMatch ? decodeEntities(stripTags(textMatch[1])).trim() : '';

    const dateMatch =
      card.match(/class="[^"]*tweet-date[^"]*"[^>]*>[\s\S]*?title="([^"]+)"/) ||
      card.match(/datetime="([^"]+)"/);
    const created_at = dateMatch ? dateMatch[1].trim() : '';

    const likesMatch = card.match(/class="[^"]*icon-heart[^"]*"[^>]*><\/span>\s*([\d,.]+[kKmM]?)/);
    const rtMatch = card.match(/class="[^"]*icon-retweet[^"]*"[^>]*><\/span>\s*([\d,.]+[kKmM]?)/);
    const repliesMatch = card.match(/class="[^"]*icon-comment[^"]*"[^>]*><\/span>\s*([\d,.]+[kKmM]?)/);

    thread.push({
      id,
      author: { handle, name },
      text,
      created_at,
      likes: parseCount(likesMatch?.[1]),
      retweets: parseCount(rtMatch?.[1]),
      replies: parseCount(repliesMatch?.[1]),
    });
  }

  return thread;
}

// ─── HTML PARSING: SYNDICATION FALLBACKS ────────────

/**
 * Parse tweets from the Twitter syndication embed HTML.
 */
function parseSyndicationTweets(html: string, limit: number): TweetResult[] {
  const tweets: TweetResult[] = [];
  const seen = new Set<string>();

  // Syndication timeline renders tweets in <div class="timeline-Tweet">
  const tweetPattern =
    /<div[^>]*class="[^"]*(?:timeline-Tweet|tweet)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:timeline-Tweet|tweet)[^"]*"|$)/gi;

  let match;
  while ((match = tweetPattern.exec(html)) !== null && tweets.length < limit) {
    const card = match[1];

    // Extract tweet ID from data-tweet-id or status link
    const idMatch =
      card.match(/data-tweet-id="(\d+)"/) ||
      card.match(/\/status\/(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);

    // Handle and name
    const handleMatch =
      card.match(/data-screen-name="([^"]+)"/) ||
      card.match(/x\.com\/(\w+)\/status/);
    const handle = handleMatch ? handleMatch[1] : 'unknown';

    const nameMatch =
      card.match(/class="[^"]*(?:TweetAuthor-name|fullname)[^"]*"[^>]*>([^<]+)</) ||
      card.match(/data-name="([^"]+)"/);
    const name = nameMatch ? decodeEntities(nameMatch[1]).trim() : handle;

    // Text
    const textMatch =
      card.match(/class="[^"]*(?:timeline-Tweet-text|tweet-text|e-entry-title)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/) ||
      card.match(/class="[^"]*(?:js-tweet-text|tweet-text)[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const text = textMatch ? decodeEntities(stripTags(textMatch[1])).trim() : '';
    if (!text) continue;

    // Date
    const dateMatch =
      card.match(/datetime="([^"]+)"/) ||
      card.match(/class="[^"]*dt-updated[^"]*"[^>]*title="([^"]+)"/);
    const created_at = dateMatch ? dateMatch[1].trim() : '';

    tweets.push({
      id,
      author: { handle, name, verified: false },
      text,
      created_at,
      likes: 0,
      retweets: 0,
      replies: 0,
      url: `https://x.com/${handle}/status/${id}`,
      hashtags: extractHashtags(text),
    });
  }

  return tweets;
}

/**
 * Parse a user profile from syndication HTML.
 */
function parseSyndicationProfile(html: string, handle: string): XUserProfile | null {
  const nameMatch =
    html.match(/data-name="([^"]+)"/) ||
    html.match(/class="[^"]*TweetAuthor-name[^"]*"[^>]*>([^<]+)</);
  const name = nameMatch ? decodeEntities(nameMatch[1]).trim() : handle;

  const bioMatch = html.match(/class="[^"]*(?:ProfileHeaderCard-bio|bio)[^"]*"[^>]*>([\s\S]*?)<\//);
  const bio = bioMatch ? decodeEntities(stripTags(bioMatch[1])).trim() : '';

  return {
    handle,
    name,
    bio,
    location: '',
    followers: 0,
    following: 0,
    tweets_count: 0,
    verified: false,
    joined: '',
    profile_image: '',
    banner_image: '',
  };
}

/**
 * Parse a thread from the syndication conversation endpoint.
 */
function parseSyndicationThread(html: string): ThreadTweet[] {
  const thread: ThreadTweet[] = [];
  const seen = new Set<string>();

  const tweetPattern =
    /<div[^>]*class="[^"]*(?:timeline-Tweet|tweet)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:timeline-Tweet|tweet)[^"]*"|$)/gi;

  let match;
  while ((match = tweetPattern.exec(html)) !== null) {
    const card = match[1];

    const idMatch =
      card.match(/data-tweet-id="(\d+)"/) ||
      card.match(/\/status\/(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const handleMatch =
      card.match(/data-screen-name="([^"]+)"/) ||
      card.match(/x\.com\/(\w+)\/status/);
    const handle = handleMatch ? handleMatch[1] : 'unknown';

    const nameMatch =
      card.match(/class="[^"]*(?:TweetAuthor-name|fullname)[^"]*"[^>]*>([^<]+)</) ||
      card.match(/data-name="([^"]+)"/);
    const name = nameMatch ? decodeEntities(nameMatch[1]).trim() : handle;

    const textMatch = card.match(
      /class="[^"]*(?:timeline-Tweet-text|tweet-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/,
    );
    const text = textMatch ? decodeEntities(stripTags(textMatch[1])).trim() : '';

    const dateMatch = card.match(/datetime="([^"]+)"/);
    const created_at = dateMatch ? dateMatch[1].trim() : '';

    thread.push({
      id,
      author: { handle, name },
      text,
      created_at,
      likes: 0,
      retweets: 0,
      replies: 0,
    });
  }

  return thread;
}