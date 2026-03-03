/**
 * TikTok Trend Intelligence Scraper
 * ──────────────────────────────────
 * Extracts trending videos, hashtags, creator profiles, and sound data
 * from TikTok by parsing embedded JSON from server-rendered HTML.
 *
 * Self-contained: no imports from other project files.
 */

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface TikTokVideo {
  id: string;
  description: string;
  author: { username: string; followers: number };
  stats: { views: number; likes: number; comments: number; shares: number };
  sound: { name: string; author: string } | null;
  hashtags: string[];
  createdAt: string;
  url: string;
}

export interface TrendingResult {
  country: string;
  videos: TikTokVideo[];
  trending_hashtags: Array<{ name: string; views: number; velocity: string }>;
  trending_sounds: Array<{ name: string; uses: number; velocity: string }>;
}

export interface HashtagResult {
  tag: string;
  country: string;
  videos: TikTokVideo[];
  total_views: number;
}

export interface CreatorProfile {
  username: string;
  nickname: string;
  bio: string;
  followers: number;
  following: number;
  likes: number;
  videos_count: number;
  verified: boolean;
  avatar: string;
  recent_videos: TikTokVideo[];
}

export interface SoundResult {
  sound_id: string;
  name: string;
  author: string;
  duration: number;
  uses: number;
  videos: TikTokVideo[];
}

// ─── CONSTANTS ──────────────────────────────────────

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
];

const BASE_URL = 'https://www.tiktok.com';

// ─── UTILITIES ──────────────────────────────────────

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

function defaultHeaders(): Record<string, string> {
  return {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Parse human-readable count strings like "1.2M", "450K", "3.5B", or plain numbers.
 */
export function parseCount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.round(value);

  const s = String(value).trim().toUpperCase();
  if (!s) return 0;

  const match = s.match(/^([\d.]+)\s*([KMB])?$/);
  if (!match) {
    const plain = parseInt(s.replace(/[,\s]/g, ''), 10);
    return Number.isNaN(plain) ? 0 : plain;
  }

  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return 0;

  const suffix = match[2];
  if (suffix === 'K') return Math.round(num * 1_000);
  if (suffix === 'M') return Math.round(num * 1_000_000);
  if (suffix === 'B') return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

// ─── HTML + JSON EXTRACTION ─────────────────────────

/**
 * Extract embedded JSON from TikTok HTML.
 * TikTok stores page data in __UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE.
 */
function extractUniversalData(html: string): Record<string, any> | null {
  // Strategy 1: __UNIVERSAL_DATA_FOR_REHYDRATION__
  const universalPattern = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;
  const universalMatch = html.match(universalPattern);
  if (universalMatch) {
    try {
      return JSON.parse(universalMatch[1]);
    } catch { /* fall through */ }
  }

  // Strategy 2: window.__UNIVERSAL_DATA_FOR_REHYDRATION__ assignment
  const windowPattern = /window\['__UNIVERSAL_DATA_FOR_REHYDRATION__'\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/;
  const windowMatch = html.match(windowPattern);
  if (windowMatch) {
    try {
      return JSON.parse(windowMatch[1]);
    } catch { /* fall through */ }
  }

  return null;
}

function extractSigiState(html: string): Record<string, any> | null {
  // SIGI_STATE is older but still appears on some pages
  const sigiPattern = /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/;
  const sigiMatch = html.match(sigiPattern);
  if (sigiMatch) {
    try {
      return JSON.parse(sigiMatch[1]);
    } catch { /* fall through */ }
  }

  const sigiWindowPattern = /window\['SIGI_STATE'\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/;
  const sigiWindowMatch = html.match(sigiWindowPattern);
  if (sigiWindowMatch) {
    try {
      return JSON.parse(sigiWindowMatch[1]);
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Extract any JSON blob from TikTok HTML using all known strategies.
 */
function extractPageData(html: string): Record<string, any> | null {
  return extractUniversalData(html) || extractSigiState(html);
}

// ─── VIDEO PARSING ──────────────────────────────────

/**
 * Normalize a TikTok video item (from embedded JSON) into our TikTokVideo shape.
 * TikTok's JSON structure varies across pages, so we handle multiple shapes.
 */
function parseVideoItem(item: any): TikTokVideo | null {
  if (!item) return null;

  try {
    const id = String(item.id || item.video_id || item.itemId || '');
    if (!id) return null;

    const desc = item.desc || item.description || item.title || '';
    const authorObj = item.author || {};
    const statsObj = item.stats || item.statistics || {};
    const musicObj = item.music || item.sound || null;

    const username = authorObj.uniqueId || authorObj.unique_id || authorObj.username || '';
    const followers = parseCount(authorObj.followerCount || authorObj.fans || authorObj.follower_count);

    const views = parseCount(statsObj.playCount || statsObj.play_count || statsObj.views || 0);
    const likes = parseCount(statsObj.diggCount || statsObj.digg_count || statsObj.likes || 0);
    const comments = parseCount(statsObj.commentCount || statsObj.comment_count || statsObj.comments || 0);
    const shares = parseCount(statsObj.shareCount || statsObj.share_count || statsObj.shares || 0);

    let sound: TikTokVideo['sound'] = null;
    if (musicObj) {
      sound = {
        name: musicObj.title || musicObj.name || '',
        author: musicObj.authorName || musicObj.author || '',
      };
    }

    // Extract hashtags from description and from structured challenges array
    const hashtags: string[] = [];
    const tagPattern = /#([\w\u00C0-\u024F]+)/g;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(desc)) !== null) {
      hashtags.push(tagMatch[1].toLowerCase());
    }
    if (Array.isArray(item.challenges)) {
      for (const ch of item.challenges) {
        const t = (ch.title || ch.hashtagName || '').toLowerCase();
        if (t && !hashtags.includes(t)) hashtags.push(t);
      }
    }
    if (Array.isArray(item.textExtra)) {
      for (const te of item.textExtra) {
        if (te.hashtagName) {
          const t = te.hashtagName.toLowerCase();
          if (!hashtags.includes(t)) hashtags.push(t);
        }
      }
    }

    const createTime = item.createTime || item.create_time || '';
    const createdAt = createTime
      ? new Date(typeof createTime === 'number' ? createTime * 1000 : createTime).toISOString()
      : '';

    const url = username
      ? `${BASE_URL}/@${username}/video/${id}`
      : `${BASE_URL}/video/${id}`;

    return {
      id,
      description: desc,
      author: { username, followers },
      stats: { views, likes, comments, shares },
      sound,
      hashtags,
      createdAt,
      url,
    };
  } catch {
    return null;
  }
}

/**
 * Walk any deeply nested object to find arrays that look like video lists.
 */
function findVideoArrays(obj: any, depth: number = 0): TikTokVideo[] {
  if (depth > 8 || !obj) return [];
  const videos: TikTokVideo[] = [];

  if (Array.isArray(obj)) {
    // If every item has an "id" + ("desc" or "description"), treat as video list
    const looksLikeVideos = obj.length > 0 && obj.every(
      (i: any) => i && typeof i === 'object' && (i.id || i.video_id) && (i.desc || i.description || i.stats),
    );
    if (looksLikeVideos) {
      for (const item of obj) {
        const v = parseVideoItem(item);
        if (v) videos.push(v);
      }
      return videos;
    }
  }

  if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      const found = findVideoArrays(obj[key], depth + 1);
      if (found.length > 0) return found;
    }
  }

  return videos;
}

// ─── META TAG FALLBACK EXTRACTION ───────────────────

function extractMetaVideos(html: string): TikTokVideo[] {
  const videos: TikTokVideo[] = [];

  // TikTok embeds og:video meta tags and JSON-LD for individual pages
  const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const ld = JSON.parse(match[1]);
      if (ld['@type'] === 'VideoObject' || ld.interactionStatistic) {
        const id = (ld.url || '').match(/\/video\/(\d+)/)?.[1] || '';
        const username = (ld.creator?.name || ld.author?.name || '').replace('@', '');
        const interactions = Array.isArray(ld.interactionStatistic)
          ? ld.interactionStatistic
          : [];

        let views = 0, likes = 0, comments = 0, shares = 0;
        for (const stat of interactions) {
          const count = parseCount(stat.userInteractionCount);
          const type = (stat.interactionType || '').toLowerCase();
          if (type.includes('watch') || type.includes('view')) views = count;
          else if (type.includes('like')) likes = count;
          else if (type.includes('comment')) comments = count;
          else if (type.includes('share')) shares = count;
        }

        if (id) {
          videos.push({
            id,
            description: ld.description || ld.name || '',
            author: { username, followers: 0 },
            stats: { views, likes, comments, shares },
            sound: null,
            hashtags: [],
            createdAt: ld.uploadDate || ld.datePublished || '',
            url: ld.url || `${BASE_URL}/video/${id}`,
          });
        }
      }
    } catch { /* skip invalid JSON-LD */ }
  }

  return videos;
}

function extractMetaProfile(html: string): Partial<CreatorProfile> {
  const profile: Partial<CreatorProfile> = {};

  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) ;
  if (ogTitle) {
    const titleText = decodeHtmlEntities(ogTitle[1]);
    const nameMatch = titleText.match(/^(.+?)\s*\(@?(\w+)\)/);
    if (nameMatch) {
      profile.nickname = nameMatch[1].trim();
      profile.username = nameMatch[2];
    }
  }

  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/);
  if (ogDesc) {
    const desc = decodeHtmlEntities(ogDesc[1]);
    // Often: "Followers: 1.2M, Following: 300, Likes: 50M — Bio text"
    const followersMatch = desc.match(/(\d[\d.]*[KMB]?)\s*Followers/i);
    const followingMatch = desc.match(/(\d[\d.]*[KMB]?)\s*Following/i);
    const likesMatch = desc.match(/(\d[\d.]*[KMB]?)\s*Likes/i);
    if (followersMatch) profile.followers = parseCount(followersMatch[1]);
    if (followingMatch) profile.following = parseCount(followingMatch[1]);
    if (likesMatch) profile.likes = parseCount(likesMatch[1]);
  }

  const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/);
  if (ogImage) profile.avatar = ogImage[1];

  return profile;
}

// ─── TRENDING EXTRACTION ────────────────────────────

function extractTrendingHashtags(data: Record<string, any>): TrendingResult['trending_hashtags'] {
  const hashtags: TrendingResult['trending_hashtags'] = [];
  const seen = new Set<string>();

  // Walk the data looking for hashtag/challenge objects
  function walk(obj: any, depth: number): void {
    if (depth > 6 || !obj) return;

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
      return;
    }

    if (typeof obj !== 'object') return;

    // TikTok hashtag objects typically have hashtagName + stats
    const name = obj.hashtagName || obj.challengeName || obj.title || obj.name || '';
    const viewCount = obj.stats?.videoCount || obj.viewCount || obj.views || obj.videoCount || 0;

    if (name && typeof name === 'string' && name.length > 1 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      hashtags.push({
        name: name.toLowerCase(),
        views: parseCount(viewCount),
        velocity: classifyVelocity(parseCount(viewCount)),
      });
    }

    for (const key of Object.keys(obj)) {
      walk(obj[key], depth + 1);
    }
  }

  walk(data, 0);
  return hashtags;
}

function extractTrendingSounds(data: Record<string, any>): TrendingResult['trending_sounds'] {
  const sounds: TrendingResult['trending_sounds'] = [];
  const seen = new Set<string>();

  function walk(obj: any, depth: number): void {
    if (depth > 6 || !obj) return;

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
      return;
    }

    if (typeof obj !== 'object') return;

    // Sound/music objects have title + playCount or userCount
    const isMusic = obj.musicId || obj.music_id || (obj.title && (obj.playUrl || obj.userCount));
    if (isMusic) {
      const name = obj.title || obj.name || '';
      const uses = parseCount(obj.userCount || obj.videoCount || obj.stats?.videoCount || 0);
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        sounds.push({
          name,
          uses,
          velocity: classifyVelocity(uses),
        });
      }
    }

    for (const key of Object.keys(obj)) {
      walk(obj[key], depth + 1);
    }
  }

  walk(data, 0);
  return sounds;
}

function classifyVelocity(count: number): string {
  if (count >= 1_000_000_000) return 'viral';
  if (count >= 100_000_000) return 'explosive';
  if (count >= 10_000_000) return 'high';
  if (count >= 1_000_000) return 'rising';
  if (count >= 100_000) return 'moderate';
  return 'emerging';
}

// ─── FETCH HELPER ───────────────────────────────────

async function fetchTikTokPage(
  url: string,
  proxyFetch: ProxyFetchFn,
): Promise<string> {
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 30_000,
    headers: defaultHeaders(),
  });

  if (!response.ok) {
    throw new Error(`TikTok returned HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

// ─── PUBLIC API ─────────────────────────────────────

/**
 * Get trending videos and hashtags for a country.
 *
 * Scrapes tiktok.com/discover (or /trending) and parses the embedded
 * __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON for video and hashtag data.
 */
export async function getTrending(
  country: string,
  proxyFetch: ProxyFetchFn,
): Promise<TrendingResult> {
  const result: TrendingResult = {
    country,
    videos: [],
    trending_hashtags: [],
    trending_sounds: [],
  };

  // Try /discover first (more reliable), then /trending
  const urls = [
    `${BASE_URL}/discover?lang=en&region=${encodeURIComponent(country)}`,
    `${BASE_URL}/trending?lang=en&region=${encodeURIComponent(country)}`,
    `${BASE_URL}/explore?lang=en&region=${encodeURIComponent(country)}`,
  ];

  for (const url of urls) {
    try {
      const html = await fetchTikTokPage(url, proxyFetch);
      const data = extractPageData(html);

      if (data) {
        // Extract videos from embedded JSON
        const videos = findVideoArrays(data);
        if (videos.length > 0) {
          result.videos = videos;
        }

        // Extract trending hashtags
        const hashtags = extractTrendingHashtags(data);
        if (hashtags.length > 0) {
          result.trending_hashtags = hashtags;
        }

        // Extract trending sounds
        const sounds = extractTrendingSounds(data);
        if (sounds.length > 0) {
          result.trending_sounds = sounds;
        }
      }

      // Fallback: meta tag / JSON-LD videos
      if (result.videos.length === 0) {
        result.videos = extractMetaVideos(html);
      }

      // Fallback: extract hashtags from video descriptions
      if (result.trending_hashtags.length === 0 && result.videos.length > 0) {
        const tagCounts = new Map<string, number>();
        for (const v of result.videos) {
          for (const tag of v.hashtags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + v.stats.views);
          }
        }
        result.trending_hashtags = Array.from(tagCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([name, views]) => ({ name, views, velocity: classifyVelocity(views) }));
      }

      // If we got meaningful data from this URL, stop trying alternatives
      if (result.videos.length > 0 || result.trending_hashtags.length > 0) {
        break;
      }
    } catch (err) {
      console.log(`[TikTok] Failed to fetch ${url}: ${err}`);
      // Continue to next URL
    }
  }

  return result;
}

/**
 * Get videos for a specific hashtag.
 *
 * Scrapes tiktok.com/tag/HASHTAG and parses the embedded video list.
 */
export async function getHashtagData(
  tag: string,
  country: string,
  proxyFetch: ProxyFetchFn,
): Promise<HashtagResult> {
  const cleanTag = tag.replace(/^#/, '').trim();
  const result: HashtagResult = {
    tag: cleanTag,
    country,
    videos: [],
    total_views: 0,
  };

  try {
    const url = `${BASE_URL}/tag/${encodeURIComponent(cleanTag)}?lang=en&region=${encodeURIComponent(country)}`;
    const html = await fetchTikTokPage(url, proxyFetch);
    const data = extractPageData(html);

    if (data) {
      result.videos = findVideoArrays(data);

      // Try to find the challenge/hashtag stats object for total views
      const viewCount = findNestedValue(data, ['stats', 'viewCount'])
        || findNestedValue(data, ['challengeInfo', 'stats', 'viewCount'])
        || findNestedValue(data, ['hashtagInfo', 'stats', 'viewCount']);
      if (viewCount) {
        result.total_views = parseCount(viewCount);
      }
    }

    // Fallback: JSON-LD
    if (result.videos.length === 0) {
      result.videos = extractMetaVideos(html);
    }

    // Calculate total views from videos if not found in stats
    if (result.total_views === 0 && result.videos.length > 0) {
      result.total_views = result.videos.reduce((sum, v) => sum + v.stats.views, 0);
    }
  } catch (err) {
    console.log(`[TikTok] Failed to fetch hashtag ${cleanTag}: ${err}`);
  }

  return result;
}

/**
 * Get creator profile and recent videos.
 *
 * Scrapes tiktok.com/@USERNAME and parses profile stats from embedded data.
 */
export async function getCreatorProfile(
  username: string,
  proxyFetch: ProxyFetchFn,
): Promise<CreatorProfile> {
  const cleanUsername = username.replace(/^@/, '').trim();
  const profile: CreatorProfile = {
    username: cleanUsername,
    nickname: '',
    bio: '',
    followers: 0,
    following: 0,
    likes: 0,
    videos_count: 0,
    verified: false,
    avatar: '',
    recent_videos: [],
  };

  try {
    const url = `${BASE_URL}/@${encodeURIComponent(cleanUsername)}?lang=en`;
    const html = await fetchTikTokPage(url, proxyFetch);
    const data = extractPageData(html);

    if (data) {
      // Universal data format: __DEFAULT_SCOPE__["webapp.user-detail"]
      const userDetail = data['__DEFAULT_SCOPE__']?.['webapp.user-detail']
        || data['webapp.user-detail']
        || data.UserModule
        || data.userInfo
        || null;

      const userInfo = userDetail?.userInfo || userDetail;
      const user = userInfo?.user || userInfo?.userData || userInfo || {};
      const stats = userInfo?.stats || user?.stats || {};

      profile.nickname = user.nickname || user.nickName || '';
      profile.bio = user.signature || user.bio || user.desc || '';
      profile.followers = parseCount(stats.followerCount || stats.fans || stats.follower_count);
      profile.following = parseCount(stats.followingCount || stats.following_count || stats.following);
      profile.likes = parseCount(stats.heartCount || stats.heart || stats.total_likes || stats.diggCount);
      profile.videos_count = parseCount(stats.videoCount || stats.video_count || stats.aweme_count);
      profile.verified = Boolean(user.verified || user.isVerified);
      profile.avatar = user.avatarLarger || user.avatarMedium || user.avatarThumb || user.avatar || '';

      // Extract recent videos from the user page data
      const itemList = data['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.itemList
        || userDetail?.itemList
        || data.ItemModule
        || null;

      if (itemList) {
        // ItemModule can be an object keyed by video ID
        const items = Array.isArray(itemList) ? itemList : Object.values(itemList);
        for (const item of items) {
          const v = parseVideoItem(item);
          if (v) {
            // Ensure author info is populated from the profile
            if (!v.author.username) v.author.username = cleanUsername;
            if (!v.author.followers) v.author.followers = profile.followers;
            profile.recent_videos.push(v);
          }
        }
      }
    }

    // Fallback: extract from meta tags
    if (!profile.nickname || profile.followers === 0) {
      const meta = extractMetaProfile(html);
      if (!profile.nickname && meta.nickname) profile.nickname = meta.nickname;
      if (!profile.username && meta.username) profile.username = meta.username;
      if (profile.followers === 0 && meta.followers) profile.followers = meta.followers;
      if (profile.following === 0 && meta.following) profile.following = meta.following;
      if (profile.likes === 0 && meta.likes) profile.likes = meta.likes;
      if (!profile.avatar && meta.avatar) profile.avatar = meta.avatar;
    }

    // Fallback: JSON-LD videos
    if (profile.recent_videos.length === 0) {
      profile.recent_videos = extractMetaVideos(html);
    }
  } catch (err) {
    console.log(`[TikTok] Failed to fetch profile @${cleanUsername}: ${err}`);
  }

  return profile;
}

/**
 * Get data about a trending sound / music.
 *
 * Scrapes tiktok.com/music/NAME-ID and parses the video list using this sound.
 */
export async function getSoundData(
  soundId: string,
  proxyFetch: ProxyFetchFn,
): Promise<SoundResult> {
  const result: SoundResult = {
    sound_id: soundId,
    name: '',
    author: '',
    duration: 0,
    uses: 0,
    videos: [],
  };

  try {
    // TikTok music URLs use the format /music/title-ID
    const url = `${BASE_URL}/music/-${encodeURIComponent(soundId)}?lang=en`;
    const html = await fetchTikTokPage(url, proxyFetch);
    const data = extractPageData(html);

    if (data) {
      // Look for music info in the page data
      const musicDetail = data['__DEFAULT_SCOPE__']?.['webapp.music-detail']
        || data['webapp.music-detail']
        || data.MusicModule
        || data.musicInfo
        || null;

      const musicInfo = musicDetail?.musicInfo || musicDetail;
      const music = musicInfo?.music || musicInfo?.musicData || musicInfo || {};
      const musicStats = musicInfo?.stats || music?.stats || {};

      result.name = music.title || music.musicName || music.name || '';
      result.author = music.authorName || music.author || '';
      result.duration = parseInt(String(music.duration || 0), 10) || 0;
      result.uses = parseCount(musicStats.videoCount || musicStats.video_count || music.userCount || 0);

      // Extract videos using this sound
      const itemList = musicDetail?.itemList
        || data['__DEFAULT_SCOPE__']?.['webapp.music-detail']?.itemList
        || data.ItemModule
        || null;

      if (itemList) {
        const items = Array.isArray(itemList) ? itemList : Object.values(itemList);
        for (const item of items) {
          const v = parseVideoItem(item);
          if (v) result.videos.push(v);
        }
      }

      // Broader search for videos
      if (result.videos.length === 0) {
        result.videos = findVideoArrays(data);
      }
    }

    // Fallback: extract sound name from page title / meta
    if (!result.name) {
      const titleMatch = html.match(/<title>([^<]*)<\/title>/);
      if (titleMatch) {
        const title = decodeHtmlEntities(titleMatch[1])
          .replace(/\s*\|\s*TikTok.*$/i, '')
          .replace(/\s*-\s*TikTok.*$/i, '')
          .trim();
        result.name = title;
      }
    }

    // Fallback: JSON-LD videos
    if (result.videos.length === 0) {
      result.videos = extractMetaVideos(html);
    }

    // Estimate uses from video count if not found
    if (result.uses === 0 && result.videos.length > 0) {
      result.uses = result.videos.length;
    }
  } catch (err) {
    console.log(`[TikTok] Failed to fetch sound ${soundId}: ${err}`);
  }

  return result;
}

// ─── INTERNAL HELPERS ───────────────────────────────

/**
 * Walk a nested object to find a value at the given key path.
 * Returns the first match found via breadth-first search.
 */
function findNestedValue(obj: any, keyPath: string[], maxDepth: number = 8): any {
  if (!obj || typeof obj !== 'object' || keyPath.length === 0) return null;

  function search(current: any, depth: number): any {
    if (depth > maxDepth || !current || typeof current !== 'object') return null;

    // Check if the current object has the full key path
    let cursor: any = current;
    let matched = true;
    for (const key of keyPath) {
      if (cursor && typeof cursor === 'object' && key in cursor) {
        cursor = cursor[key];
      } else {
        matched = false;
        break;
      }
    }
    if (matched && cursor !== undefined) return cursor;

    // Recurse into children
    const keys = Array.isArray(current) ? current.map((_, i) => i) : Object.keys(current);
    for (const key of keys) {
      const found = search(current[key], depth + 1);
      if (found !== null) return found;
    }

    return null;
  }

  return search(obj, 0);
}