/**
 * TikTok Trend Intelligence Scraper
 * Extracts trending content, hashtags, sounds, and creator profiles
 * Bypasses TikTok's encrypted signatures via mobile proxy simulation
 */

import { proxyFetch, getProxy } from '../proxy';

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
    saves: number;
  };
  sound: {
    name: string;
    author: string;
    id: string;
  } | null;
  hashtags: string[];
  created_at: string;
  url: string;
  duration: number;
  cover_url: string | null;
}

export interface TikTokTrendingHashtag {
  name: string;
  views: number;
  video_count: number | null;
  velocity: string | null;
}

export interface TikTokTrendingSound {
  id: string;
  name: string;
  author: string;
  uses: number;
  url: string;
}

export interface TikTokCreator {
  username: string;
  nickname: string;
  bio: string;
  followers: number;
  following: number;
  likes: number;
  video_count: number;
  verified: boolean;
  avatar_url: string | null;
  profile_url: string;
  recent_posts: TikTokVideo[];
}

const TT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const TT_API_HEADERS = {
  'User-Agent': 'com.zhiliaoapp.musically/2023501030 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ2A.230505.002; Cronet/58.0.2991.0)',
  'Accept': 'application/json',
};

// Country mapping for TikTok regions
export const TT_COUNTRY_CODES: Record<string, string> = {
  US: 'us', UK: 'gb', DE: 'de', FR: 'fr', ES: 'es', PL: 'pl',
  JP: 'jp', BR: 'br', IN: 'in', CA: 'ca', AU: 'au', MX: 'mx',
};

/**
 * Extract SIGI_STATE data from TikTok SSR pages
 */
function extractSigiState(html: string): any {
  // TikTok embeds state as SIGI_STATE or __UNIVERSAL_DATA_FOR_REHYDRATION__
  const sigiMatch = html.match(/SIGI_STATE['"\s]*=\s*({.+?})\s*;\s*<\/script>/s);
  if (sigiMatch) {
    try { return JSON.parse(sigiMatch[1]); } catch {}
  }

  const universalMatch = html.match(/__UNIVERSAL_DATA_FOR_REHYDRATION__['"\s]*=\s*({.+?})\s*;\s*<\/script>/s);
  if (universalMatch) {
    try { return JSON.parse(universalMatch[1]); } catch {}
  }

  // Fallback: look for JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/);
  if (jsonLdMatch) {
    try { return { jsonLd: JSON.parse(jsonLdMatch[1]) }; } catch {}
  }

  return null;
}

function parseVideoFromState(item: any): TikTokVideo {
  const author = item.author || {};
  const stats = item.stats || {};
  const music = item.music || {};
  const challenges = item.challenges || item.textExtra?.filter((t: any) => t.hashtagName) || [];

  return {
    id: item.id || String(item.video?.id || ''),
    description: item.desc || item.description || '',
    author: {
      username: author.uniqueId || author.username || '',
      nickname: author.nickname || '',
      followers: author.followerCount ?? 0,
      verified: author.verified ?? false,
    },
    stats: {
      views: stats.playCount ?? stats.views ?? 0,
      likes: stats.diggCount ?? stats.likes ?? 0,
      comments: stats.commentCount ?? stats.comments ?? 0,
      shares: stats.shareCount ?? stats.shares ?? 0,
      saves: stats.collectCount ?? 0,
    },
    sound: music.title ? {
      name: music.title,
      author: music.authorName || '',
      id: String(music.id || ''),
    } : null,
    hashtags: challenges.map((c: any) => c.title || c.hashtagName || '').filter(Boolean),
    created_at: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
    url: author.uniqueId ? `https://www.tiktok.com/@${author.uniqueId}/video/${item.id}` : '',
    duration: item.video?.duration ?? 0,
    cover_url: item.video?.cover ?? item.video?.dynamicCover ?? null,
  };
}

/**
 * Get trending videos by country
 */
export async function getTrending(
  country = 'US',
): Promise<{ videos: TikTokVideo[]; trending_hashtags: TikTokTrendingHashtag[] }> {
  const region = TT_COUNTRY_CODES[country.toUpperCase()] || 'us';

  // Fetch TikTok trending/discover page
  const response = await proxyFetch(`https://www.tiktok.com/trending?lang=en&region=${region}`, {
    headers: TT_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    // Fallback: try the Discover page
    const fallback = await proxyFetch(`https://www.tiktok.com/discover?lang=en`, {
      headers: TT_HEADERS,
      maxRetries: 2,
      timeoutMs: 30000,
    });

    if (!fallback.ok) {
      throw new Error(`TikTok trending failed: ${response.status} / fallback: ${fallback.status}`);
    }

    const html = await fallback.text();
    const state = extractSigiState(html);

    if (!state) return { videos: [], trending_hashtags: [] };

    const items = state.ItemModule ? Object.values(state.ItemModule) : [];
    const videos = (items as any[]).slice(0, 20).map(parseVideoFromState);

    const hashtags: TikTokTrendingHashtag[] = [];
    if (state.DiscoverModule?.hashtags) {
      for (const h of state.DiscoverModule.hashtags) {
        hashtags.push({
          name: h.name || h.hashtagName || '',
          views: h.stats?.videoCount ?? h.viewCount ?? 0,
          video_count: h.stats?.videoCount ?? null,
          velocity: null,
        });
      }
    }

    return { videos, trending_hashtags: hashtags };
  }

  const html = await response.text();
  const state = extractSigiState(html);

  if (!state) return { videos: [], trending_hashtags: [] };

  const items = state.ItemModule ? Object.values(state.ItemModule) : [];
  const videos = (items as any[]).slice(0, 20).map(parseVideoFromState);

  const hashtags: TikTokTrendingHashtag[] = [];

  return { videos, trending_hashtags: hashtags };
}

/**
 * Get hashtag analytics
 */
export async function getHashtagData(
  tag: string,
  country = 'US',
): Promise<{ hashtag: string; views: number; videos: TikTokVideo[] }> {
  const cleanTag = tag.replace('#', '');

  const response = await proxyFetch(`https://www.tiktok.com/tag/${encodeURIComponent(cleanTag)}?lang=en`, {
    headers: TT_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new Error(`TikTok hashtag fetch failed for #${cleanTag}: ${response.status}`);
  }

  const html = await response.text();
  const state = extractSigiState(html);

  if (!state) return { hashtag: cleanTag, views: 0, videos: [] };

  const challengeInfo = state.ChallengePage || state.DiscoverModule || {};
  const viewCount = challengeInfo.stats?.viewCount ?? challengeInfo.viewCount ?? 0;

  const items = state.ItemModule ? Object.values(state.ItemModule) : [];
  const videos = (items as any[]).slice(0, 20).map(parseVideoFromState);

  return {
    hashtag: cleanTag,
    views: viewCount,
    videos,
  };
}

/**
 * Get creator profile with recent posts
 */
export async function getCreatorProfile(username: string): Promise<TikTokCreator> {
  const cleanUsername = username.replace('@', '');

  const response = await proxyFetch(`https://www.tiktok.com/@${encodeURIComponent(cleanUsername)}?lang=en`, {
    headers: TT_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new Error(`TikTok creator profile failed for @${cleanUsername}: ${response.status}`);
  }

  const html = await response.text();
  const state = extractSigiState(html);

  if (!state) {
    return {
      username: cleanUsername,
      nickname: '',
      bio: '',
      followers: 0,
      following: 0,
      likes: 0,
      video_count: 0,
      verified: false,
      avatar_url: null,
      profile_url: `https://www.tiktok.com/@${cleanUsername}`,
      recent_posts: [],
    };
  }

  const userInfo = state.UserModule?.users?.[cleanUsername] || state.UserPage?.user || {};
  const userStats = state.UserModule?.stats?.[cleanUsername] || userInfo.stats || {};

  const items = state.ItemModule ? Object.values(state.ItemModule) : [];
  const recentPosts = (items as any[]).slice(0, 10).map(parseVideoFromState);

  return {
    username: userInfo.uniqueId || cleanUsername,
    nickname: userInfo.nickname || '',
    bio: userInfo.signature || '',
    followers: userStats.followerCount ?? 0,
    following: userStats.followingCount ?? 0,
    likes: userStats.heartCount ?? userStats.heart ?? 0,
    video_count: userStats.videoCount ?? 0,
    verified: userInfo.verified ?? false,
    avatar_url: userInfo.avatarLarger || userInfo.avatarMedium || null,
    profile_url: `https://www.tiktok.com/@${userInfo.uniqueId || cleanUsername}`,
    recent_posts: recentPosts,
  };
}

/**
 * Get sound/audio data
 */
export async function getSoundData(soundId: string): Promise<{
  id: string;
  name: string;
  author: string;
  uses: number;
  videos: TikTokVideo[];
}> {
  const response = await proxyFetch(`https://www.tiktok.com/music/id-${soundId}?lang=en`, {
    headers: TT_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new Error(`TikTok sound fetch failed for ${soundId}: ${response.status}`);
  }

  const html = await response.text();
  const state = extractSigiState(html);

  if (!state) return { id: soundId, name: '', author: '', uses: 0, videos: [] };

  const musicInfo = state.MusicPage?.musicInfo || state.MusicModule || {};
  const music = musicInfo.music || {};

  const items = state.ItemModule ? Object.values(state.ItemModule) : [];
  const videos = (items as any[]).slice(0, 20).map(parseVideoFromState);

  return {
    id: String(music.id || soundId),
    name: music.title || '',
    author: music.authorName || '',
    uses: musicInfo.stats?.videoCount ?? music.userCount ?? 0,
    videos,
  };
}
