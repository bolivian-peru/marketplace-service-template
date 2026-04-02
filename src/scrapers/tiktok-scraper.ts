/**
 * TikTok Trend Intelligence Scraper (Bounty #51)
 * ───────────────────────────────────────────────
 * Scrapes TikTok trending videos, hashtag analytics, creator profiles,
 * and sound/audio trends using mobile proxies.
 *
 * Strategy:
 *   1. Fetch TikTok web pages via proxyFetch() with mobile UA
 *   2. Extract __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON from page source
 *   3. Parse and structure the embedded data
 *   4. For API endpoints, extract msToken from initial page load cookies
 *      and use it for subsequent API calls
 *
 * TikTok's anti-bot is the hardest in social media. Mobile carrier IPs
 * (T-Mobile, Vodafone, etc.) pass device trust checks that datacenter
 * and residential IPs fail.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface TikTokVideo {
  id: string;
  description: string;
  author: {
    username: string;
    nickname: string;
    followers: number;
    verified: boolean;
  };
  stats: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    bookmarks: number;
  };
  sound: {
    id: string;
    name: string;
    author: string;
  };
  hashtags: string[];
  createdAt: string;
  url: string;
  duration: number;
  coverUrl: string | null;
}

export interface TikTokHashtag {
  name: string;
  id: string;
  views: number;
  videoCount: number;
  description: string;
}

export interface TikTokSound {
  id: string;
  name: string;
  author: string;
  uses: number;
  duration: number;
  isOriginal: boolean;
}

export interface TikTokCreator {
  username: string;
  nickname: string;
  bio: string;
  verified: boolean;
  followers: number;
  following: number;
  likes: number;
  videoCount: number;
  avatarUrl: string | null;
  recentPosts: TikTokVideo[];
}

export interface TrendingResult {
  videos: TikTokVideo[];
  trending_hashtags: TikTokHashtag[];
  trending_sounds: TikTokSound[];
}

export interface HashtagResult {
  hashtag: TikTokHashtag;
  videos: TikTokVideo[];
}

export interface SoundResult {
  sound: TikTokSound;
  videos: TikTokVideo[];
}

// ─── CONSTANTS ──────────────────────────────────────

const TIKTOK_BASE = 'https://www.tiktok.com';

/** Mobile user agents for different countries */
const MOBILE_USER_AGENTS: Record<string, string> = {
  US: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  DE: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  GB: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  FR: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  ES: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  PL: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
};

const COUNTRY_LANGUAGES: Record<string, string> = {
  US: 'en',
  DE: 'de',
  GB: 'en',
  FR: 'fr',
  ES: 'es',
  PL: 'pl',
};

// ─── HELPERS ────────────────────────────────────────

function getMobileUA(country: string): string {
  return MOBILE_USER_AGENTS[country] || MOBILE_USER_AGENTS.US;
}

function getLanguage(country: string): string {
  return COUNTRY_LANGUAGES[country] || 'en';
}

/**
 * Build standard TikTok request headers for mobile browsing
 */
function buildHeaders(country: string): Record<string, string> {
  const lang = getLanguage(country);
  return {
    'User-Agent': getMobileUA(country),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': `${lang}-${country},${lang};q=0.9,en;q=0.8`,
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.tiktok.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

/**
 * Build TikTok API request headers with cookies/tokens
 */
function buildApiHeaders(country: string, cookies: string = ''): Record<string, string> {
  const lang = getLanguage(country);
  return {
    'User-Agent': getMobileUA(country),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': `${lang}-${country},${lang};q=0.9,en;q=0.8`,
    'Referer': 'https://www.tiktok.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...(cookies ? { 'Cookie': cookies } : {}),
  };
}

/**
 * Extract __UNIVERSAL_DATA_FOR_REHYDRATION__ from TikTok page HTML.
 * This contains all pre-rendered data as JSON.
 */
function extractUniversalData(html: string): any | null {
  // Try the SIGI_STATE pattern (older pages)
  const sigiMatch = html.match(/<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigiMatch) {
    try {
      return JSON.parse(sigiMatch[1]);
    } catch {}
  }

  // Try __UNIVERSAL_DATA_FOR_REHYDRATION__ (current pattern)
  const universalMatch = html.match(
    /<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (universalMatch) {
    try {
      return JSON.parse(universalMatch[1]);
    } catch {}
  }

  // Try NEXT_DATA pattern
  const nextMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      return JSON.parse(nextMatch[1]);
    } catch {}
  }

  return null;
}

/**
 * Extract cookies from response headers for subsequent requests
 */
function extractCookies(response: Response): string {
  const setCookies = response.headers.getAll?.('set-cookie') || [];
  if (setCookies.length === 0) {
    const single = response.headers.get('set-cookie');
    if (single) return single.split(',').map(c => c.split(';')[0].trim()).join('; ');
    return '';
  }
  return setCookies.map(c => c.split(';')[0].trim()).join('; ');
}

/**
 * Extract msToken from cookies string
 */
function extractMsToken(cookies: string): string | null {
  const match = cookies.match(/msToken=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Parse a TikTok video item from various data formats
 */
function parseVideoItem(item: any): TikTokVideo | null {
  if (!item) return null;

  try {
    // Handle different data structures (API vs page data)
    const video = item.video || item;
    const author = item.author || {};
    const stats = item.stats || item.statistics || {};
    const music = item.music || item.sound || {};

    const hashtags: string[] = [];
    if (item.textExtra) {
      for (const te of item.textExtra) {
        if (te.hashtagName) hashtags.push(te.hashtagName);
      }
    }
    if (item.challenges) {
      for (const ch of item.challenges) {
        if (ch.title && !hashtags.includes(ch.title)) hashtags.push(ch.title);
      }
    }
    // Extract hashtags from description
    const desc = item.desc || item.description || '';
    const hashtagMatches = desc.match(/#[\w\u00C0-\u024F]+/g);
    if (hashtagMatches) {
      for (const ht of hashtagMatches) {
        const tag = ht.slice(1);
        if (!hashtags.includes(tag)) hashtags.push(tag);
      }
    }

    const createdAt = item.createTime
      ? new Date(item.createTime * 1000).toISOString()
      : new Date().toISOString();

    const authorUsername = author.uniqueId || author.unique_id || author.username || 'unknown';

    return {
      id: String(item.id || item.video_id || ''),
      description: desc,
      author: {
        username: authorUsername,
        nickname: author.nickname || author.nick_name || authorUsername,
        followers: author.followerCount || author.follower_count || 0,
        verified: author.verified || false,
      },
      stats: {
        views: stats.playCount || stats.play_count || stats.viewCount || 0,
        likes: stats.diggCount || stats.digg_count || stats.likeCount || 0,
        comments: stats.commentCount || stats.comment_count || 0,
        shares: stats.shareCount || stats.share_count || 0,
        bookmarks: stats.collectCount || stats.collect_count || 0,
      },
      sound: {
        id: String(music.id || music.mid || ''),
        name: music.title || music.musicName || 'Original Sound',
        author: music.authorName || music.author || authorUsername,
      },
      hashtags,
      createdAt,
      url: `https://www.tiktok.com/@${authorUsername}/video/${item.id || item.video_id || ''}`,
      duration: video?.duration || item.duration || 0,
      coverUrl: video?.cover || video?.originCover || item.cover || null,
    };
  } catch {
    return null;
  }
}

// ─── SCRAPING FUNCTIONS ─────────────────────────────

/**
 * Scrape trending videos from TikTok's Explore/For You page
 */
export async function scrapeTrending(country: string = 'US'): Promise<TrendingResult> {
  const normalizedCountry = country.toUpperCase();
  const lang = getLanguage(normalizedCountry);

  // Strategy 1: Fetch the explore/trending page and extract embedded data
  const exploreUrl = `${TIKTOK_BASE}/explore?lang=${lang}`;
  const headers = buildHeaders(normalizedCountry);

  console.log(`[TIKTOK] Fetching trending for ${normalizedCountry}: ${exploreUrl}`);

  const response = await proxyFetch(exploreUrl, {
    headers,
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    // Check for specific error conditions
    if (response.status === 403) {
      throw new TikTokError('auth_required', 'TikTok returned 403 — login wall detected');
    }
    if (response.status === 429) {
      throw new TikTokError('rate_limited', 'TikTok rate limited this IP');
    }
    throw new TikTokError('scrape_failed', `TikTok returned ${response.status}`);
  }

  const html = await response.text();

  // Check for CAPTCHA
  if (html.includes('captcha') && html.includes('verify')) {
    throw new TikTokError('captcha_detected', 'TikTok CAPTCHA triggered — try different IP');
  }

  const data = extractUniversalData(html);

  const videos: TikTokVideo[] = [];
  const hashtagMap = new Map<string, TikTokHashtag>();
  const soundMap = new Map<string, TikTokSound>();

  if (data) {
    // Navigate the data structure to find video items
    const itemList = findVideoItems(data);

    for (const item of itemList) {
      const video = parseVideoItem(item);
      if (video && video.id) {
        videos.push(video);

        // Collect hashtags
        for (const tag of video.hashtags) {
          if (!hashtagMap.has(tag)) {
            hashtagMap.set(tag, {
              name: `#${tag}`,
              id: '',
              views: 0,
              videoCount: 1,
              description: '',
            });
          } else {
            const existing = hashtagMap.get(tag)!;
            existing.videoCount++;
          }
        }

        // Collect sounds
        if (video.sound.id && !soundMap.has(video.sound.id)) {
          soundMap.set(video.sound.id, {
            id: video.sound.id,
            name: video.sound.name,
            author: video.sound.author,
            uses: 0,
            duration: 0,
            isOriginal: video.sound.name.toLowerCase().includes('original'),
          });
        }
      }
    }
  }

  // If page data extraction failed, try the API endpoint
  if (videos.length === 0) {
    console.log('[TIKTOK] Page extraction failed, trying API endpoint...');
    const cookies = extractCookies(response);
    const apiVideos = await fetchTrendingApi(normalizedCountry, cookies);
    videos.push(...apiVideos);

    for (const video of apiVideos) {
      for (const tag of video.hashtags) {
        if (!hashtagMap.has(tag)) {
          hashtagMap.set(tag, {
            name: `#${tag}`,
            id: '',
            views: 0,
            videoCount: 1,
            description: '',
          });
        }
      }
      if (video.sound.id && !soundMap.has(video.sound.id)) {
        soundMap.set(video.sound.id, {
          id: video.sound.id,
          name: video.sound.name,
          author: video.sound.author,
          uses: 0,
          duration: 0,
          isOriginal: video.sound.name.toLowerCase().includes('original'),
        });
      }
    }
  }

  return {
    videos,
    trending_hashtags: Array.from(hashtagMap.values()).sort((a, b) => b.videoCount - a.videoCount),
    trending_sounds: Array.from(soundMap.values()),
  };
}

/**
 * Scrape hashtag/challenge data
 */
export async function scrapeHashtag(tag: string, country: string = 'US'): Promise<HashtagResult> {
  const normalizedCountry = country.toUpperCase();
  const cleanTag = tag.replace(/^#/, '').trim();
  const lang = getLanguage(normalizedCountry);

  if (!cleanTag) {
    throw new TikTokError('invalid_input', 'Hashtag tag is required');
  }

  const url = `${TIKTOK_BASE}/tag/${encodeURIComponent(cleanTag)}?lang=${lang}`;
  const headers = buildHeaders(normalizedCountry);

  console.log(`[TIKTOK] Fetching hashtag #${cleanTag} for ${normalizedCountry}`);

  const response = await proxyFetch(url, {
    headers,
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new TikTokError('not_found', `Hashtag #${cleanTag} not found`);
    }
    if (response.status === 403) {
      throw new TikTokError('auth_required', 'TikTok returned 403');
    }
    if (response.status === 429) {
      throw new TikTokError('rate_limited', 'TikTok rate limited this IP');
    }
    throw new TikTokError('scrape_failed', `TikTok returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.includes('verify')) {
    throw new TikTokError('captcha_detected', 'TikTok CAPTCHA triggered');
  }

  const data = extractUniversalData(html);

  let hashtag: TikTokHashtag = {
    name: `#${cleanTag}`,
    id: '',
    views: 0,
    videoCount: 0,
    description: '',
  };

  const videos: TikTokVideo[] = [];

  if (data) {
    // Extract challenge/hashtag metadata
    const challengeInfo = findChallengeInfo(data);
    if (challengeInfo) {
      hashtag = {
        name: `#${challengeInfo.title || cleanTag}`,
        id: String(challengeInfo.id || challengeInfo.cid || ''),
        views: challengeInfo.stats?.viewCount || challengeInfo.stats?.views || 0,
        videoCount: challengeInfo.stats?.videoCount || 0,
        description: challengeInfo.desc || challengeInfo.description || '',
      };
    }

    // Extract videos
    const itemList = findVideoItems(data);
    for (const item of itemList) {
      const video = parseVideoItem(item);
      if (video && video.id) videos.push(video);
    }
  }

  return { hashtag, videos };
}

/**
 * Scrape creator profile and recent posts
 */
export async function scrapeCreator(username: string, country: string = 'US'): Promise<TikTokCreator> {
  const normalizedCountry = country.toUpperCase();
  const cleanUsername = username.replace(/^@/, '').trim();

  if (!cleanUsername) {
    throw new TikTokError('invalid_input', 'Username is required');
  }

  const url = `${TIKTOK_BASE}/@${encodeURIComponent(cleanUsername)}`;
  const headers = buildHeaders(normalizedCountry);

  console.log(`[TIKTOK] Fetching creator @${cleanUsername}`);

  const response = await proxyFetch(url, {
    headers,
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new TikTokError('not_found', `User @${cleanUsername} not found`);
    }
    if (response.status === 403) {
      throw new TikTokError('auth_required', 'TikTok returned 403');
    }
    if (response.status === 429) {
      throw new TikTokError('rate_limited', 'TikTok rate limited this IP');
    }
    throw new TikTokError('scrape_failed', `TikTok returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.includes('verify')) {
    throw new TikTokError('captcha_detected', 'TikTok CAPTCHA triggered');
  }

  const data = extractUniversalData(html);

  let creator: TikTokCreator = {
    username: cleanUsername,
    nickname: cleanUsername,
    bio: '',
    verified: false,
    followers: 0,
    following: 0,
    likes: 0,
    videoCount: 0,
    avatarUrl: null,
    recentPosts: [],
  };

  if (data) {
    const userInfo = findUserInfo(data);
    if (userInfo) {
      const user = userInfo.user || userInfo;
      const stats = userInfo.stats || user.stats || {};

      creator = {
        username: user.uniqueId || user.unique_id || cleanUsername,
        nickname: user.nickname || cleanUsername,
        bio: user.signature || user.bio || '',
        verified: user.verified || false,
        followers: stats.followerCount || stats.follower_count || 0,
        following: stats.followingCount || stats.following_count || 0,
        likes: stats.heartCount || stats.heart_count || stats.diggCount || 0,
        videoCount: stats.videoCount || stats.video_count || 0,
        avatarUrl: user.avatarLarger || user.avatarMedium || user.avatar || null,
        recentPosts: [],
      };
    }

    // Extract recent posts
    const itemList = findVideoItems(data);
    for (const item of itemList) {
      const video = parseVideoItem(item);
      if (video && video.id) creator.recentPosts.push(video);
    }
  }

  return creator;
}

/**
 * Scrape sound/music data and videos using it
 */
export async function scrapeSound(soundId: string, country: string = 'US'): Promise<SoundResult> {
  const normalizedCountry = country.toUpperCase();

  if (!soundId) {
    throw new TikTokError('invalid_input', 'Sound ID is required');
  }

  const url = `${TIKTOK_BASE}/music/original-sound-${soundId}`;
  const headers = buildHeaders(normalizedCountry);

  console.log(`[TIKTOK] Fetching sound ${soundId}`);

  const response = await proxyFetch(url, {
    headers,
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new TikTokError('not_found', `Sound ${soundId} not found`);
    }
    if (response.status === 403) {
      throw new TikTokError('auth_required', 'TikTok returned 403');
    }
    if (response.status === 429) {
      throw new TikTokError('rate_limited', 'TikTok rate limited this IP');
    }
    throw new TikTokError('scrape_failed', `TikTok returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.includes('verify')) {
    throw new TikTokError('captcha_detected', 'TikTok CAPTCHA triggered');
  }

  const data = extractUniversalData(html);

  let sound: TikTokSound = {
    id: soundId,
    name: 'Unknown Sound',
    author: 'Unknown',
    uses: 0,
    duration: 0,
    isOriginal: false,
  };

  const videos: TikTokVideo[] = [];

  if (data) {
    const musicInfo = findMusicInfo(data);
    if (musicInfo) {
      sound = {
        id: String(musicInfo.id || musicInfo.mid || soundId),
        name: musicInfo.title || musicInfo.musicName || 'Unknown Sound',
        author: musicInfo.authorName || musicInfo.author || 'Unknown',
        uses: musicInfo.stats?.videoCount || musicInfo.userCount || 0,
        duration: musicInfo.duration || 0,
        isOriginal: musicInfo.original || false,
      };
    }

    const itemList = findVideoItems(data);
    for (const item of itemList) {
      const video = parseVideoItem(item);
      if (video && video.id) videos.push(video);
    }
  }

  return { sound, videos };
}

// ─── DATA EXTRACTION HELPERS ────────────────────────

/**
 * Recursively find video items in TikTok's nested data structures.
 * TikTok changes their data format frequently, so we search multiple paths.
 */
function findVideoItems(data: any): any[] {
  const items: any[] = [];

  if (!data || typeof data !== 'object') return items;

  // Direct item list paths (various TikTok data formats)
  const paths = [
    // __UNIVERSAL_DATA_FOR_REHYDRATION__ format
    data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct,
    data?.['__DEFAULT_SCOPE__']?.['webapp.browse-detail']?.data?.items,
    // Explore page
    data?.['__DEFAULT_SCOPE__']?.['webapp.explore']?.itemList,
    data?.['__DEFAULT_SCOPE__']?.['webapp.explore']?.data?.itemList,
    // Challenge/hashtag page
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.itemList,
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.data?.itemList,
    // User page
    data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.itemList,
    data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.data?.itemList,
    // Music page
    data?.['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.itemList,
    data?.['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.data?.itemList,
    // SIGI_STATE format
    data?.ItemModule,
    data?.items,
    data?.itemList,
    // NEXT_DATA format
    data?.props?.pageProps?.items,
    data?.props?.pageProps?.itemList,
  ];

  for (const path of paths) {
    if (path) {
      if (Array.isArray(path)) {
        items.push(...path);
      } else if (typeof path === 'object' && !Array.isArray(path)) {
        // SIGI_STATE ItemModule is an object keyed by video ID
        if (path.id) {
          items.push(path);
        } else {
          items.push(...Object.values(path));
        }
      }
      if (items.length > 0) break;
    }
  }

  // Deep search fallback — look for arrays with video-like objects
  if (items.length === 0) {
    deepFindItems(data, items, 0);
  }

  return items;
}

/**
 * Deep recursive search for video items in unknown data structures
 */
function deepFindItems(obj: any, results: any[], depth: number): void {
  if (depth > 6 || results.length >= 30) return;
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    // Check if this array contains video-like objects
    if (obj.length > 0 && obj[0] && (obj[0].desc !== undefined || obj[0].id) && obj[0].author) {
      results.push(...obj);
      return;
    }
    for (const item of obj) {
      deepFindItems(item, results, depth + 1);
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (['itemList', 'items', 'ItemModule', 'videoList', 'videoData'].includes(key)) {
        deepFindItems(obj[key], results, depth + 1);
      }
    }
    // Also search nested scopes
    if (depth < 3) {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          deepFindItems(obj[key], results, depth + 1);
        }
      }
    }
  }
}

/**
 * Find challenge/hashtag info in data
 */
function findChallengeInfo(data: any): any | null {
  const paths = [
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.challengeInfo?.challenge,
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.data?.challengeInfo?.challenge,
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.challengeData,
    data?.ChallengePage?.challengeInfo?.challenge,
    data?.props?.pageProps?.challengeInfo?.challenge,
  ];

  for (const path of paths) {
    if (path) return path;
  }

  // Also try to find stats separately
  const statsPaths = [
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.challengeInfo?.stats,
    data?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail']?.data?.challengeInfo?.stats,
    data?.ChallengePage?.challengeInfo?.stats,
  ];

  for (const path of paths) {
    if (path) {
      // Try to attach stats
      for (const statsPath of statsPaths) {
        if (statsPath) {
          path.stats = statsPath;
          break;
        }
      }
      return path;
    }
  }

  return null;
}

/**
 * Find user info in data
 */
function findUserInfo(data: any): any | null {
  const paths = [
    data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo,
    data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.data?.userInfo,
    data?.UserModule?.users,
    data?.UserPage?.userInfo,
    data?.props?.pageProps?.userInfo,
  ];

  for (const path of paths) {
    if (path) {
      // UserModule.users is keyed by username — get the first one
      if (!path.user && !path.uniqueId && !path.unique_id) {
        const values = Object.values(path);
        if (values.length > 0) return { user: values[0] };
      }
      return path;
    }
  }

  return null;
}

/**
 * Find music/sound info in data
 */
function findMusicInfo(data: any): any | null {
  const paths = [
    data?.['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.musicInfo?.music,
    data?.['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.data?.musicInfo?.music,
    data?.MusicPage?.musicInfo?.music,
    data?.props?.pageProps?.musicInfo?.music,
  ];

  for (const path of paths) {
    if (path) {
      // Try to attach stats
      const statsPaths = [
        data?.['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.musicInfo?.stats,
        data?.['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.data?.musicInfo?.stats,
      ];
      for (const statsPath of statsPaths) {
        if (statsPath) {
          path.stats = statsPath;
          break;
        }
      }
      return path;
    }
  }

  return null;
}

// ─── API FALLBACK ───────────────────────────────────

/**
 * Try TikTok's internal API for trending videos as fallback.
 * Requires cookies from an initial page load.
 */
async function fetchTrendingApi(country: string, cookies: string): Promise<TikTokVideo[]> {
  const msToken = extractMsToken(cookies);
  if (!msToken) {
    console.log('[TIKTOK] No msToken available, cannot use API fallback');
    return [];
  }

  const lang = getLanguage(country);
  const params = new URLSearchParams({
    aid: '1988',
    count: '30',
    region: country,
    priority_region: '',
    language: lang,
    msToken: msToken,
  });

  const apiUrl = `${TIKTOK_BASE}/api/recommend/item_list/?${params}`;
  const headers = buildApiHeaders(country, cookies);

  try {
    const response = await proxyFetch(apiUrl, {
      headers,
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    if (!response.ok) {
      console.log(`[TIKTOK] API fallback returned ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const items = data?.itemList || data?.items || [];
    const videos: TikTokVideo[] = [];

    for (const item of items) {
      const video = parseVideoItem(item);
      if (video && video.id) videos.push(video);
    }

    return videos;
  } catch (err: any) {
    console.log(`[TIKTOK] API fallback failed: ${err.message}`);
    return [];
  }
}

// ─── ERROR CLASS ────────────────────────────────────

export class TikTokError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TikTokError';
  }

  /**
   * Map error code to HTTP status
   */
  get httpStatus(): number {
    switch (this.code) {
      case 'captcha_detected': return 503;
      case 'rate_limited': return 503;
      case 'auth_required': return 403;
      case 'proxy_error': return 502;
      case 'not_found': return 404;
      case 'invalid_input': return 400;
      default: return 500;
    }
  }

  /**
   * Whether this error means we should NOT charge the customer
   */
  get shouldNotCharge(): boolean {
    return ['captcha_detected', 'rate_limited', 'auth_required', 'proxy_error', 'scrape_failed'].includes(this.code);
  }
}
