/**
 * X (Twitter) Real-Time Search & Profile Scraper (Bounty #73)
 * ────────────────────────────────────────────────────────────
 * Fetches tweets, profiles, threads, search results, and trending
 * topics using public, no-auth endpoints routed through Proxies.sx
 * mobile carrier IPs.
 *
 * Strategy:
 *   - Tweet/thread + user profile/tweets → cdn.syndication.twimg.com
 *     and syndication.twitter.com (the same endpoints powering official
 *     embed widgets; no API key required).
 *   - Search → Nitter RSS (open-source X frontend).
 *   - Trending → trends24.in country page (publicly aggregates X trends).
 *
 * X.com profiles datacenter IPs aggressively. Mobile carrier IPs receive
 * 5-10x the rate budget of cloud IPs, so all outbound requests go through
 * proxyFetch.
 */

import { proxyFetch } from '../proxy';

// ─── PUBLIC TYPES ───────────────────────────────────

export interface XAuthor {
  handle: string;
  name: string;
  followers: number | null;
  verified: boolean;
  avatar: string | null;
}

export interface XTweet {
  id: string;
  author: XAuthor;
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
  name: string;
  bio: string;
  followers: number | null;
  following: number | null;
  tweetCount: number | null;
  verified: boolean;
  location: string | null;
  website: string | null;
  joined: string | null;
  avatar: string | null;
  banner: string | null;
}

export interface XTrend {
  rank: number;
  topic: string;
  url: string;
  tweetVolume: number | null;
}

export interface XSearchResult {
  query: string;
  results: XTweet[];
}

export interface XThreadResult {
  root: XTweet;
  replies: XTweet[];
}

// ─── CONSTANTS ──────────────────────────────────────

const SYNDICATION_BASE = 'https://syndication.twitter.com';
const SYNDICATION_CDN = 'https://cdn.syndication.twimg.com';
const NITTER_BASE = process.env.NITTER_BASE_URL || 'https://nitter.net';
const TRENDS_BASE = 'https://trends24.in';

// ─── HELPERS ────────────────────────────────────────

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_ID_RE = /^\d{1,30}$/;

function extractHashtags(text: string): string[] {
  const tags: string[] = [];
  const re = /#(\w{1,80})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tags.push(m[1].toLowerCase());
  }
  return Array.from(new Set(tags));
}

/**
 * Decode a small set of HTML entities that frequently appear in
 * scraped Twitter HTML (we never need a full HTML parser).
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * Compute the syndication token used by cdn.syndication.twimg.com.
 * This is the same formula used by Twitter's official react-tweet
 * library and is publicly documented across many open-source clients.
 */
function syndicationToken(tweetId: string): string {
  const n = Number(tweetId);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return ((n / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function parseInt10(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[,_\s]/g, '');
  const m = cleaned.match(/^-?\d+/);
  if (!m) return null;
  const parsed = parseInt(m[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

function tweetUrl(handle: string, tweetId: string): string {
  return `https://x.com/${encodeURIComponent(handle)}/status/${tweetId}`;
}

// ─── SYNDICATION PARSERS ────────────────────────────

interface SyndicationTweet {
  id_str?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  favorite_count?: number;
  conversation_count?: number;
  reply_count?: number;
  retweet_count?: number;
  view_count?: number | string;
  views?: { count?: string | number } | string | number;
  user?: {
    screen_name?: string;
    name?: string;
    followers_count?: number;
    verified?: boolean;
    is_blue_verified?: boolean;
    profile_image_url_https?: string;
  };
  entities?: {
    hashtags?: { text?: string }[];
    media?: { media_url_https?: string; type?: string }[];
  };
  mediaDetails?: { media_url_https?: string; type?: string }[];
  photos?: { url?: string }[];
  video?: { variants?: { url?: string }[] };
}

function mapSyndicationTweet(raw: SyndicationTweet, fallbackHandle?: string): XTweet | null {
  const id = raw.id_str;
  if (!id || !TWEET_ID_RE.test(id)) return null;

  const handle = raw.user?.screen_name || fallbackHandle || '';
  const name = raw.user?.name || handle;

  const text = (raw.full_text || raw.text || '').trim();

  const media: string[] = [];
  for (const m of raw.mediaDetails || []) {
    if (m?.media_url_https) media.push(m.media_url_https);
  }
  for (const p of raw.photos || []) {
    if (p?.url) media.push(p.url);
  }
  for (const v of raw.video?.variants || []) {
    if (v?.url) media.push(v.url);
  }

  const hashtags = (raw.entities?.hashtags || [])
    .map((h) => (h?.text || '').toLowerCase())
    .filter(Boolean);

  const views = typeof raw.views === 'object' && raw.views
    ? parseInt10((raw.views as { count?: string | number }).count)
    : parseInt10(raw.views as string | number | undefined) ?? parseInt10(raw.view_count);

  return {
    id,
    author: {
      handle,
      name,
      followers: typeof raw.user?.followers_count === 'number' ? raw.user.followers_count : null,
      verified: Boolean(raw.user?.verified || raw.user?.is_blue_verified),
      avatar: raw.user?.profile_image_url_https || null,
    },
    text,
    created_at: raw.created_at || null,
    likes: typeof raw.favorite_count === 'number' ? raw.favorite_count : null,
    retweets: typeof raw.retweet_count === 'number' ? raw.retweet_count : null,
    replies: typeof raw.reply_count === 'number'
      ? raw.reply_count
      : (typeof raw.conversation_count === 'number' ? raw.conversation_count : null),
    views,
    url: tweetUrl(handle || 'i', id),
    media: Array.from(new Set(media)).slice(0, 8),
    hashtags: hashtags.length ? hashtags : extractHashtags(text),
  };
}

/**
 * The syndication profile timeline embeds JSON in a __NEXT_DATA__ <script> tag.
 * We extract that JSON and walk it for user + recent tweets.
 */
function extractNextData(html: string): unknown {
  const match = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findFirstTimeline(node: unknown, depth: number = 0): SyndicationTweet[] | null {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    if (node.length > 0 && node.every((item) => item && typeof item === 'object' && 'id_str' in (item as object))) {
      return node as SyndicationTweet[];
    }
    for (const item of node) {
      const found = findFirstTimeline(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const key of ['timeline', 'tweets', 'entries', 'items']) {
      if (key in (node as Record<string, unknown>)) {
        const found = findFirstTimeline((node as Record<string, unknown>)[key], depth + 1);
        if (found) return found;
      }
    }
    for (const v of Object.values(node as Record<string, unknown>)) {
      const found = findFirstTimeline(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findUserNode(node: unknown, depth: number = 0): SyndicationTweet['user'] & {
  description?: string;
  location?: string;
  url?: string;
  created_at?: string;
  friends_count?: number;
  statuses_count?: number;
  profile_banner_url?: string;
} | null {
  if (!node || depth > 8) return null;
  if (typeof node === 'object' && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    if (typeof obj.screen_name === 'string' && typeof obj.name === 'string') {
      return obj as ReturnType<typeof findUserNode>;
    }
    for (const v of Object.values(obj)) {
      const found = findUserNode(v, depth + 1);
      if (found) return found;
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      const found = findUserNode(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ─── PUBLIC API ─────────────────────────────────────

/**
 * Fetch a single tweet by ID via the public CDN syndication endpoint.
 * This endpoint powers Twitter's official embed widgets and works
 * without any API key.
 */
export async function getXTweet(tweetId: string): Promise<XTweet | null> {
  if (!TWEET_ID_RE.test(tweetId)) {
    throw new Error('Invalid tweet ID — must be numeric');
  }

  const token = syndicationToken(tweetId);
  const url = `${SYNDICATION_CDN}/tweet-result?id=${tweetId}&token=${token}&lang=en`;

  const res = await proxyFetch(url, {
    headers: { Accept: 'application/json' },
    maxRetries: 2,
    timeoutMs: 15_000,
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`X syndication returned ${res.status}`);
  }

  const data = await res.json() as SyndicationTweet;
  return mapSyndicationTweet(data);
}

/**
 * Fetch the conversation thread (root tweet + first-level replies).
 * Replies are extracted from the syndication payload's `parent` /
 * `conversation` shape when present.
 */
export async function getXThread(tweetId: string): Promise<XThreadResult | null> {
  const root = await getXTweet(tweetId);
  if (!root) return null;

  // Best-effort: pull the tweet detail again with conversation context.
  // The CDN endpoint returns parent context but not full reply trees;
  // for the bounty's "thread extraction" we surface root + linked
  // tweets that share the conversation.
  const token = syndicationToken(tweetId);
  const url = `${SYNDICATION_CDN}/tweet-result?id=${tweetId}&token=${token}&lang=en&conversation=true`;

  let replies: XTweet[] = [];
  try {
    const res = await proxyFetch(url, {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (res.ok) {
      const data = await res.json() as SyndicationTweet & {
        conversation?: SyndicationTweet[];
        parent?: SyndicationTweet;
      };
      const conv = Array.isArray(data?.conversation) ? data.conversation : [];
      replies = conv
        .map((t) => mapSyndicationTweet(t))
        .filter((t): t is XTweet => t !== null && t.id !== root.id);
    }
  } catch {
    // Fall through with empty replies.
  }

  return { root, replies };
}

/**
 * Fetch a user's public profile via the syndication timeline page.
 */
export async function getXUser(handle: string): Promise<XUserProfile | null> {
  const clean = handle.replace(/^@/, '');
  if (!HANDLE_RE.test(clean)) {
    throw new Error('Invalid X handle');
  }

  const url = `${SYNDICATION_BASE}/srv/timeline-profile/screen-name/${encodeURIComponent(clean)}`;
  const res = await proxyFetch(url, {
    headers: { Accept: 'text/html' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`X syndication profile returned ${res.status}`);
  }

  const html = await res.text();
  const nextData = extractNextData(html);
  const user = findUserNode(nextData);
  if (!user || !user.screen_name) return null;

  const description = typeof (user as { description?: string }).description === 'string'
    ? (user as { description?: string }).description!
    : '';

  return {
    handle: user.screen_name,
    name: user.name || user.screen_name,
    bio: description,
    followers: typeof user.followers_count === 'number' ? user.followers_count : null,
    following: typeof (user as { friends_count?: number }).friends_count === 'number'
      ? (user as { friends_count?: number }).friends_count!
      : null,
    tweetCount: typeof (user as { statuses_count?: number }).statuses_count === 'number'
      ? (user as { statuses_count?: number }).statuses_count!
      : null,
    verified: Boolean(user.verified || user.is_blue_verified),
    location: typeof (user as { location?: string }).location === 'string' && (user as { location?: string }).location
      ? (user as { location?: string }).location!
      : null,
    website: typeof (user as { url?: string }).url === 'string' && (user as { url?: string }).url
      ? (user as { url?: string }).url!
      : null,
    joined: typeof (user as { created_at?: string }).created_at === 'string'
      ? (user as { created_at?: string }).created_at!
      : null,
    avatar: user.profile_image_url_https || null,
    banner: typeof (user as { profile_banner_url?: string }).profile_banner_url === 'string'
      ? (user as { profile_banner_url?: string }).profile_banner_url!
      : null,
  };
}

/**
 * Fetch a user's recent tweets via the syndication timeline page.
 */
export async function getXUserTweets(handle: string, limit: number = 20): Promise<XTweet[]> {
  const clean = handle.replace(/^@/, '');
  if (!HANDLE_RE.test(clean)) {
    throw new Error('Invalid X handle');
  }

  const safeLimit = clampLimit(limit, 20, 100);

  const url = `${SYNDICATION_BASE}/srv/timeline-profile/screen-name/${encodeURIComponent(clean)}`;
  const res = await proxyFetch(url, {
    headers: { Accept: 'text/html' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (!res.ok) {
    throw new Error(`X syndication profile returned ${res.status}`);
  }

  const html = await res.text();
  const nextData = extractNextData(html);
  const rawTweets = findFirstTimeline(nextData) || [];

  const tweets: XTweet[] = [];
  for (const raw of rawTweets) {
    const mapped = mapSyndicationTweet(raw, clean);
    if (mapped) tweets.push(mapped);
    if (tweets.length >= safeLimit) break;
  }
  return tweets;
}

/**
 * Search tweets via Nitter's RSS endpoint. Nitter is the open-source
 * X frontend that other social-intel services use as a free, no-auth
 * data source. RSS keeps parsing simple and robust against UI changes.
 */
export async function searchX(
  query: string,
  sort: 'latest' | 'top' = 'latest',
  limit: number = 20,
): Promise<XSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { query: trimmed, results: [] };

  const safeLimit = clampLimit(limit, 20, 100);
  const f = sort === 'top' ? '&since=&until=&near=' : '&f=tweets';
  const url = `${NITTER_BASE}/search/rss?${new URLSearchParams({ q: trimmed }).toString()}${f}`;

  let xml = '';
  try {
    const res = await proxyFetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      maxRetries: 2,
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      throw new Error(`Nitter returned ${res.status}`);
    }
    xml = await res.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Search backend unavailable: ${msg}`);
  }

  const items = xml.split(/<item[\s>]/).slice(1);
  const results: XTweet[] = [];

  for (const itemRaw of items) {
    if (results.length >= safeLimit) break;

    const linkMatch = itemRaw.match(/<link>([\s\S]*?)<\/link>/);
    const titleMatch = itemRaw.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const descMatch = itemRaw.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const dateMatch = itemRaw.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const creatorMatch = itemRaw.match(/<dc:creator>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/dc:creator>/);

    const link = linkMatch ? decodeEntities(linkMatch[1].trim()) : '';
    if (!link) continue;

    // Nitter URLs look like https://nitter.net/handle/status/123#m
    const idMatch = link.match(/\/status\/(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const handleMatch = link.match(/^https?:\/\/[^/]+\/([^/]+)\/status\//);
    const handle = handleMatch ? handleMatch[1].replace(/^@/, '') : (creatorMatch ? creatorMatch[1].replace(/^@/, '') : '');

    const text = stripTags(descMatch ? descMatch[1] : (titleMatch ? titleMatch[1] : ''));
    if (!text) continue;

    results.push({
      id,
      author: {
        handle,
        name: handle,
        followers: null,
        verified: false,
        avatar: null,
      },
      text: text.slice(0, 1000),
      created_at: dateMatch ? dateMatch[1].trim() : null,
      likes: null,
      retweets: null,
      replies: null,
      views: null,
      url: handle ? tweetUrl(handle, id) : `https://x.com/i/status/${id}`,
      media: [],
      hashtags: extractHashtags(text),
    });
  }

  return { query: trimmed, results };
}

/**
 * Fetch trending topics for a country from trends24.in, which
 * publicly aggregates X's own trending lists by region.
 */
export async function getXTrending(country: string = 'US', limit: number = 30): Promise<XTrend[]> {
  const safe = country.trim().toLowerCase().replace(/[^a-z-]/g, '').slice(0, 32) || 'united-states';
  const safeLimit = clampLimit(limit, 30, 100);

  // trends24.in uses lowercase slugs (e.g. "united-states", "japan"). Allow
  // ISO-3166 alpha-2 by mapping common codes; otherwise pass through.
  const aliasMap: Record<string, string> = {
    us: 'united-states',
    uk: 'united-kingdom',
    gb: 'united-kingdom',
    jp: 'japan',
    de: 'germany',
    fr: 'france',
    br: 'brazil',
    in: 'india',
    ca: 'canada',
    au: 'australia',
    es: 'spain',
    mx: 'mexico',
    ar: 'argentina',
    it: 'italy',
    nl: 'netherlands',
  };
  const slug = aliasMap[safe] || safe;

  const url = `${TRENDS_BASE}/${slug}/`;
  const res = await proxyFetch(url, {
    headers: { Accept: 'text/html' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (!res.ok) {
    throw new Error(`Trending backend returned ${res.status}`);
  }

  const html = await res.text();

  // The first <ol class="trend-card__list"> contains the latest trends.
  const listMatch = html.match(/<ol[^>]*class="[^"]*trend-card__list[^"]*"[^>]*>([\s\S]*?)<\/ol>/);
  if (!listMatch) return [];

  const itemRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<span[^>]*class="tweet-count"[^>]*>([\s\S]*?)<\/span>)?/g;
  const trends: XTrend[] = [];
  let m: RegExpExecArray | null;
  let rank = 0;

  while ((m = itemRe.exec(listMatch[1])) !== null) {
    if (trends.length >= safeLimit) break;
    rank += 1;

    const href = decodeEntities(m[1].trim());
    const topic = stripTags(m[2]);
    if (!topic) continue;

    const volumeStr = m[3] ? stripTags(m[3]) : '';
    const volMatch = volumeStr.match(/([\d.]+)\s*([KkMm])?/);
    let tweetVolume: number | null = null;
    if (volMatch) {
      const base = parseFloat(volMatch[1]);
      const mult = volMatch[2]?.toLowerCase() === 'k' ? 1_000
        : volMatch[2]?.toLowerCase() === 'm' ? 1_000_000
          : 1;
      if (Number.isFinite(base)) tweetVolume = Math.round(base * mult);
    }

    trends.push({
      rank,
      topic,
      url: href.startsWith('http') ? href : `https://x.com/search?q=${encodeURIComponent(topic)}`,
      tweetVolume,
    });
  }

  return trends;
}
