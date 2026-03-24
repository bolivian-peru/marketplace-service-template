/**
 * TikTok Trend Intelligence API (Bounty #51)
 * Scrapes trending videos, hashtags, and sounds via mobile proxy.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── Types ──────────────────────────────────────────

export interface TikTokVideo {
  id: string;
  desc: string;
  author: {
    uniqueId: string;
    nickname: string;
    avatar: string;
    verified: boolean;
    followers: number;
  };
  stats: {
    playCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    collectCount: number;
  };
  music?: {
    id: string;
    title: string;
    authorName: string;
    coverThumb: string;
    playUrl: string;
  };
  hashtags: string[];
  createTime: string;
  videoUrl: string;
  coverUrl: string;
  duration: number;
  isAd: boolean;
}

export interface TikTokHashtag {
  id: string;
  name: string;
  title: string;
  cover: string;
  videoCount: number;
  viewCount: number;
  trending?: boolean;
}

export interface TikTokSound {
  id: string;
  title: string;
  authorName: string;
  coverThumb: string;
  playUrl: string;
  duration: number;
  videoCount: number;
  isOriginal: boolean;
}

export interface TikTokTrendingResponse {
  videos: TikTokVideo[];
  cursor: string | null;
  hasMore: boolean;
  fetchedAt: string;
  region: string;
}

export interface TikTokHashtagsResponse {
  hashtags: TikTokHashtag[];
  cursor: number;
  hasMore: boolean;
}

export interface TikTokSoundsResponse {
  sounds: TikTokSound[];
  cursor: number;
  hasMore: boolean;
}

// ─── Constants ──────────────────────────────────────

const TIKTOK_API_BASE = 'https://www.tiktok.com/api';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ─── Helper Functions ───────────────────────────────

function formatNumber(num: number): number {
  return typeof num === 'number' ? num : 0;
}

function parseHashtags(desc: string): string[] {
  const matches = desc.match(/#\w+/g) || [];
  return matches.map(h => h.substring(1)).slice(0, 20);
}

function extractFromHTML(html: string): any {
  // Try to extract __UNIVERSAL_DATA_FOR_REHYDRATION__
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      // Ignore parse errors
    }
  }
  return null;
}

// ─── Trending Videos ────────────────────────────────

export async function getTrendingVideos(
  count: number = 20,
  cursor?: string,
  region: string = 'US'
): Promise<TikTokTrendingResponse> {
  const url = new URL(`${TIKTOK_API_BASE}/item_list/`);
  
  // TikTok API parameters
  url.searchParams.set('aid', '1988');
  url.searchParams.set('app_name', 'tiktok_web');
  url.searchParams.set('device_platform', 'web_mobile');
  url.searchParams.set('region', region);
  url.searchParams.set('count', String(Math.min(count, 50)));
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('secUid', '');
  url.searchParams.set('id', '');
  url.searchParams.set('type', '5'); // Trending feed
  url.searchParams.set('min_cursor', '0');
  url.searchParams.set('max_cursor', cursor || '0');
  url.searchParams.set('shareUid', '');
  url.searchParams.set('lang', 'en');

  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/foryou',
    'Origin': 'https://www.tiktok.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };

  try {
    const response = await proxyFetch(url.toString(), {
      headers,
      maxRetries: 3,
      timeoutMs: 30000,
    });

    if (!response.ok) {
      throw new Error(`TikTok API returned ${response.status}`);
    }

    const data = await response.json() as any;
    
    if (!data.itemList && !data.items) {
      // Fallback: try HTML scraping
      return await scrapeTrendingFromHTML(count, region);
    }

    const items = data.itemList || data.items || [];
    
    const videos: TikTokVideo[] = items.map((item: any) => ({
      id: item.id || '',
      desc: item.desc || '',
      author: {
        uniqueId: item.author?.uniqueId || '',
        nickname: item.author?.nickname || '',
        avatar: item.author?.avatarThumb || item.author?.avatarMedium || '',
        verified: item.author?.verified || false,
        followers: formatNumber(item.authorStats?.followerCount || 0),
      },
      stats: {
        playCount: formatNumber(item.stats?.playCount || 0),
        likeCount: formatNumber(item.stats?.diggCount || 0),
        commentCount: formatNumber(item.stats?.commentCount || 0),
        shareCount: formatNumber(item.stats?.shareCount || 0),
        collectCount: formatNumber(item.stats?.collectCount || 0),
      },
      music: item.music ? {
        id: item.music.id || '',
        title: item.music.title || '',
        authorName: item.music.authorName || '',
        coverThumb: item.music.coverThumb || '',
        playUrl: item.music.playUrl || '',
      } : undefined,
      hashtags: parseHashtags(item.desc || ''),
      createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
      videoUrl: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
      coverUrl: item.video?.cover || item.video?.originCover || '',
      duration: item.video?.duration || 0,
      isAd: item.isAd || false,
    }));

    return {
      videos,
      cursor: data.cursor || null,
      hasMore: data.hasMore || false,
      fetchedAt: new Date().toISOString(),
      region,
    };
  } catch (error: any) {
    // Try HTML scraping as fallback
    return await scrapeTrendingFromHTML(count, region);
  }
}

async function scrapeTrendingFromHTML(count: number, region: string): Promise<TikTokTrendingResponse> {
  const url = 'https://www.tiktok.com/foryou';
  
  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };

  const response = await proxyFetch(url, {
    headers,
    maxRetries: 2,
    timeoutMs: 25000,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch TikTok trending page: ${response.status}`);
  }

  const html = await response.text();
  const data = extractFromHTML(html);
  
  if (!data || !data['__DEFAULT_SCOPE__']?.['webapp.video-home']?.itemList) {
    throw new Error('Could not extract trending videos from TikTok');
  }

  const items = data['__DEFAULT_SCOPE__']['webapp.video-home'].itemList || [];
  
  const videos: TikTokVideo[] = items.slice(0, count).map((item: any) => ({
    id: item.id || '',
    desc: item.desc || '',
    author: {
      uniqueId: item.author?.uniqueId || '',
      nickname: item.author?.nickname || '',
      avatar: item.author?.avatarThumb || '',
      verified: item.author?.verified || false,
      followers: formatNumber(item.authorStats?.followerCount || 0),
    },
    stats: {
      playCount: formatNumber(item.stats?.playCount || 0),
      likeCount: formatNumber(item.stats?.diggCount || 0),
      commentCount: formatNumber(item.stats?.commentCount || 0),
      shareCount: formatNumber(item.stats?.shareCount || 0),
      collectCount: formatNumber(item.stats?.collectCount || 0),
    },
    music: item.music ? {
      id: item.music.id || '',
      title: item.music.title || '',
      authorName: item.music.authorName || '',
      coverThumb: item.music.coverThumb || '',
      playUrl: item.music.playUrl || '',
    } : undefined,
    hashtags: item.challengeList?.map((c: any) => c.title || c.name) || parseHashtags(item.desc || ''),
    createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
    videoUrl: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
    coverUrl: item.video?.cover || '',
    duration: item.video?.duration || 0,
    isAd: item.isAd || false,
  }));

  return {
    videos,
    cursor: null,
    hasMore: false,
    fetchedAt: new Date().toISOString(),
    region,
  };
}

// ─── Trending Hashtags ──────────────────────────────

export async function getTrendingHashtags(
  count: number = 20,
  cursor: number = 0
): Promise<TikTokHashtagsResponse> {
  const url = new URL(`${TIKTOK_API_BASE}/discover/challenge/`);
  
  url.searchParams.set('aid', '1988');
  url.searchParams.set('app_name', 'tiktok_web');
  url.searchParams.set('device_platform', 'web_mobile');
  url.searchParams.set('count', String(Math.min(count, 50)));
  url.searchParams.set('cursor', String(cursor));
  url.searchParams.set('lang', 'en');

  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/discover',
    'Origin': 'https://www.tiktok.com',
  };

  try {
    const response = await proxyFetch(url.toString(), {
      headers,
      maxRetries: 3,
      timeoutMs: 25000,
    });

    if (!response.ok) {
      throw new Error(`TikTok API returned ${response.status}`);
    }

    const data = await response.json() as any;
    const items = data.challengeList || data.items || [];

    const hashtags: TikTokHashtag[] = items.map((item: any) => ({
      id: item.id || String(item.challenge?.id || ''),
      name: item.title || item.challenge?.title || '',
      title: item.desc || item.challenge?.desc || '',
      cover: item.cover || item.challenge?.cover || '',
      videoCount: formatNumber(item.stats?.videoCount || item.challenge?.stats?.videoCount || 0),
      viewCount: formatNumber(item.stats?.viewCount || item.challenge?.stats?.viewCount || 0),
      trending: item.isTrending || false,
    }));

    return {
      hashtags,
      cursor: data.cursor || cursor + items.length,
      hasMore: data.hasMore || items.length >= count,
    };
  } catch (error: any) {
    // Fallback to HTML scraping
    return await scrapeHashtagsFromHTML(count);
  }
}

async function scrapeHashtagsFromHTML(count: number): Promise<TikTokHashtagsResponse> {
  const url = 'https://www.tiktok.com/discover';
  
  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const response = await proxyFetch(url, {
    headers,
    maxRetries: 2,
    timeoutMs: 25000,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch TikTok discover page: ${response.status}`);
  }

  const html = await response.text();
  const data = extractFromHTML(html);
  
  if (!data || !data['__DEFAULT_SCOPE__']?.['webapp.discover']?.challengeList) {
    // Try alternative extraction
    const trendingMatch = html.match(/trending.*?hashtag/gi);
    if (!trendingMatch) {
      throw new Error('Could not extract trending hashtags from TikTok');
    }
    return { hashtags: [], cursor: 0, hasMore: false };
  }

  const items = data['__DEFAULT_SCOPE__']['webapp.discover'].challengeList || [];
  
  const hashtags: TikTokHashtag[] = items.slice(0, count).map((item: any) => ({
    id: String(item.id || ''),
    name: item.title || '',
    title: item.desc || '',
    cover: item.cover || '',
    videoCount: formatNumber(item.stats?.videoCount || 0),
    viewCount: formatNumber(item.stats?.viewCount || 0),
    trending: true,
  }));

  return {
    hashtags,
    cursor: count,
    hasMore: false,
  };
}

// ─── Trending Sounds ────────────────────────────────

export async function getTrendingSounds(
  count: number = 20,
  cursor: number = 0
): Promise<TikTokSoundsResponse> {
  const url = new URL(`${TIKTOK_API_BASE}/discover/music/`);
  
  url.searchParams.set('aid', '1988');
  url.searchParams.set('app_name', 'tiktok_web');
  url.searchParams.set('device_platform', 'web_mobile');
  url.searchParams.set('count', String(Math.min(count, 50)));
  url.searchParams.set('cursor', String(cursor));
  url.searchParams.set('lang', 'en');

  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/music',
    'Origin': 'https://www.tiktok.com',
  };

  try {
    const response = await proxyFetch(url.toString(), {
      headers,
      maxRetries: 3,
      timeoutMs: 25000,
    });

    if (!response.ok) {
      throw new Error(`TikTok API returned ${response.status}`);
    }

    const data = await response.json() as any;
    const items = data.musicList || data.items || [];

    const sounds: TikTokSound[] = items.map((item: any) => ({
      id: item.id || String(item.music?.id || ''),
      title: item.title || item.music?.title || '',
      authorName: item.authorName || item.music?.authorName || '',
      coverThumb: item.coverThumb || item.music?.coverThumb || '',
      playUrl: item.playUrl || item.music?.playUrl || '',
      duration: item.duration || item.music?.duration || 0,
      videoCount: formatNumber(item.videoCount || item.music?.videoCount || 0),
      isOriginal: item.isOriginal || false,
    }));

    return {
      sounds,
      cursor: data.cursor || cursor + items.length,
      hasMore: data.hasMore || items.length >= count,
    };
  } catch (error: any) {
    // Fallback to HTML scraping
    return await scrapeSoundsFromHTML(count);
  }
}

async function scrapeSoundsFromHTML(count: number): Promise<TikTokSoundsResponse> {
  const url = 'https://www.tiktok.com/music/trending';
  
  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const response = await proxyFetch(url, {
    headers,
    maxRetries: 2,
    timeoutMs: 25000,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch TikTok music page: ${response.status}`);
  }

  const html = await response.text();
  const data = extractFromHTML(html);
  
  if (!data || !data['__DEFAULT_SCOPE__']?.['webapp.music']?.musicList) {
    return { sounds: [], cursor: 0, hasMore: false };
  }

  const items = data['__DEFAULT_SCOPE__']['webapp.music'].musicList || [];
  
  const sounds: TikTokSound[] = items.slice(0, count).map((item: any) => ({
    id: String(item.id || ''),
    title: item.title || '',
    authorName: item.authorName || '',
    coverThumb: item.coverThumb || '',
    playUrl: item.playUrl || '',
    duration: item.duration || 0,
    videoCount: formatNumber(item.videoCount || 0),
    isOriginal: item.isOriginal || false,
  }));

  return {
    sounds,
    cursor: count,
    hasMore: false,
  };
}

// ─── Hashtag Details ────────────────────────────────

export async function getHashtagVideos(
  hashtag: string,
  count: number = 20,
  cursor?: string
): Promise<TikTokTrendingResponse> {
  const url = new URL(`${TIKTOK_API_BASE}/challenge/item_list/`);
  
  url.searchParams.set('aid', '1988');
  url.searchParams.set('app_name', 'tiktok_web');
  url.searchParams.set('device_platform', 'web_mobile');
  url.searchParams.set('challengeName', encodeURIComponent(hashtag));
  url.searchParams.set('count', String(Math.min(count, 50)));
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('lang', 'en');

  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `https://www.tiktok.com/tag/${encodeURIComponent(hashtag)}`,
    'Origin': 'https://www.tiktok.com',
  };

  try {
    const response = await proxyFetch(url.toString(), {
      headers,
      maxRetries: 3,
      timeoutMs: 30000,
    });

    if (!response.ok) {
      throw new Error(`TikTok API returned ${response.status}`);
    }

    const data = await response.json() as any;
    const items = data.itemList || data.items || [];

    const videos: TikTokVideo[] = items.map((item: any) => ({
      id: item.id || '',
      desc: item.desc || '',
      author: {
        uniqueId: item.author?.uniqueId || '',
        nickname: item.author?.nickname || '',
        avatar: item.author?.avatarThumb || '',
        verified: item.author?.verified || false,
        followers: formatNumber(item.authorStats?.followerCount || 0),
      },
      stats: {
        playCount: formatNumber(item.stats?.playCount || 0),
        likeCount: formatNumber(item.stats?.diggCount || 0),
        commentCount: formatNumber(item.stats?.commentCount || 0),
        shareCount: formatNumber(item.stats?.shareCount || 0),
        collectCount: formatNumber(item.stats?.collectCount || 0),
      },
      music: item.music ? {
        id: item.music.id || '',
        title: item.music.title || '',
        authorName: item.music.authorName || '',
        coverThumb: item.music.coverThumb || '',
        playUrl: item.music.playUrl || '',
      } : undefined,
      hashtags: parseHashtags(item.desc || ''),
      createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
      videoUrl: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
      coverUrl: item.video?.cover || '',
      duration: item.video?.duration || 0,
      isAd: item.isAd || false,
    }));

    return {
      videos,
      cursor: data.cursor || null,
      hasMore: data.hasMore || false,
      fetchedAt: new Date().toISOString(),
      region: 'Global',
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch hashtag videos: ${error.message}`);
  }
}

// ─── Sound Details ──────────────────────────────────

export async function getSoundVideos(
  soundId: string,
  count: number = 20,
  cursor?: string
): Promise<TikTokTrendingResponse> {
  const url = new URL(`${TIKTOK_API_BASE}/music/item_list/`);
  
  url.searchParams.set('aid', '1988');
  url.searchParams.set('app_name', 'tiktok_web');
  url.searchParams.set('device_platform', 'web_mobile');
  url.searchParams.set('musicId', soundId);
  url.searchParams.set('count', String(Math.min(count, 50)));
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('lang', 'en');

  const headers: Record<string, string> = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `https://www.tiktok.com/music/${soundId}`,
    'Origin': 'https://www.tiktok.com',
  };

  try {
    const response = await proxyFetch(url.toString(), {
      headers,
      maxRetries: 3,
      timeoutMs: 30000,
    });

    if (!response.ok) {
      throw new Error(`TikTok API returned ${response.status}`);
    }

    const data = await response.json() as any;
    const items = data.itemList || data.items || [];

    const videos: TikTokVideo[] = items.map((item: any) => ({
      id: item.id || '',
      desc: item.desc || '',
      author: {
        uniqueId: item.author?.uniqueId || '',
        nickname: item.author?.nickname || '',
        avatar: item.author?.avatarThumb || '',
        verified: item.author?.verified || false,
        followers: formatNumber(item.authorStats?.followerCount || 0),
      },
      stats: {
        playCount: formatNumber(item.stats?.playCount || 0),
        likeCount: formatNumber(item.stats?.diggCount || 0),
        commentCount: formatNumber(item.stats?.commentCount || 0),
        shareCount: formatNumber(item.stats?.shareCount || 0),
        collectCount: formatNumber(item.stats?.collectCount || 0),
      },
      music: item.music ? {
        id: item.music.id || '',
        title: item.music.title || '',
        authorName: item.music.authorName || '',
        coverThumb: item.music.coverThumb || '',
        playUrl: item.music.playUrl || '',
      } : undefined,
      hashtags: parseHashtags(item.desc || ''),
      createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
      videoUrl: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
      coverUrl: item.video?.cover || '',
      duration: item.video?.duration || 0,
      isAd: item.isAd || false,
    }));

    return {
      videos,
      cursor: data.cursor || null,
      hasMore: data.hasMore || false,
      fetchedAt: new Date().toISOString(),
      region: 'Global',
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch sound videos: ${error.message}`);
  }
}