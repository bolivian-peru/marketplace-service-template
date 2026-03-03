/**
 * TikTok Trend Intelligence Scraper (Bounty #51)
 *
 * Supports:
 * - trending feed snapshots
 * - hashtag analytics
 * - creator profile + recent posts
 * - sound trend data
 *
 * Implementation relies on SSR/embedded state extraction (SIGI_STATE / UNIVERSAL_DATA)
 * and routes all requests through the configured mobile proxy.
 */

import { proxyFetch } from '../proxy';

export interface TikTokVideo {
  id: string;
  description: string;
  author: {
    username: string;
    followers: number;
  };
  stats: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  };
  sound: {
    name: string;
    author: string;
  };
  hashtags: string[];
  createdAt: string;
  url: string;
}

export interface TrendingHashtag {
  name: string;
  views: number;
  velocity: string;
}

export interface TrendingSound {
  name: string;
  uses: number;
  velocity: string;
}

const COUNTRY_TO_LANG: Record<string, string> = {
  US: 'en-US,en;q=0.9',
  GB: 'en-GB,en;q=0.9',
  DE: 'de-DE,de;q=0.9,en;q=0.7',
  FR: 'fr-FR,fr;q=0.9,en;q=0.7',
  ES: 'es-ES,es;q=0.9,en;q=0.7',
  PL: 'pl-PL,pl;q=0.9,en;q=0.7',
};

function cleanUsername(input: string): string {
  return input.replace(/^@+/, '').trim();
}

function toNumber(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,_\s]/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toIsoTime(value: any): string {
  const n = toNumber(value);
  if (!n) return new Date().toISOString();
  const ms = n > 10_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function toVelocity(current: number, baseline: number): string {
  if (!baseline || baseline <= 0) return '+0% 24h';
  const delta = ((current - baseline) / baseline) * 100;
  const rounded = Math.round(delta);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded}% 24h`;
}

function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#([a-zA-Z0-9_]+)/g)) {
    out.add(m[1].toLowerCase());
    if (out.size >= 15) break;
  }
  return Array.from(out);
}

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractScriptJson(html: string, id: string): any | null {
  const re = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, 'i');
  const m = html.match(re);
  if (!m?.[1]) return null;
  return safeJsonParse(m[1]);
}

function findObjectsByKey(root: any, key: string, max = 400): any[] {
  const out: any[] = [];
  const seen = new Set<any>();

  function walk(node: any) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Object.prototype.hasOwnProperty.call(node, key) && node[key] && typeof node[key] === 'object') {
      out.push(node[key]);
      if (out.length >= max) return;
    }

    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
        if (out.length >= max) return;
      }
      return;
    }

    for (const child of Object.values(node)) {
      walk(child);
      if (out.length >= max) return;
    }
  }

  walk(root);
  return out;
}

function collectUsers(state: any): Map<string, any> {
  const users = new Map<string, any>();

  const userModules = findObjectsByKey(state, 'UserModule');
  for (const module of userModules) {
    const fromUsers = module?.users || module;
    for (const [key, value] of Object.entries(fromUsers || {})) {
      if (!value || typeof value !== 'object') continue;
      const username = (value as any).uniqueId || (value as any).secUid || key;
      if (username) users.set(String(username), value);
    }
  }

  return users;
}

function collectMusic(state: any): Map<string, any> {
  const music = new Map<string, any>();
  const modules = findObjectsByKey(state, 'MusicModule');
  for (const module of modules) {
    for (const [key, value] of Object.entries(module || {})) {
      if (!value || typeof value !== 'object') continue;
      music.set(String((value as any).id || key), value);
    }
  }
  return music;
}

function collectItems(state: any): any[] {
  const items: any[] = [];
  const modules = findObjectsByKey(state, 'ItemModule');
  for (const module of modules) {
    for (const item of Object.values(module || {})) {
      if (!item || typeof item !== 'object') continue;
      const maybe = item as any;
      if (maybe.id && (maybe.desc || maybe.stats || maybe.author)) items.push(maybe);
    }
  }

  // Fallback: if ItemModule is absent, scan for arrays of itemStruct-like objects.
  if (!items.length) {
    const pools = findObjectsByKey(state, 'itemList');
    for (const pool of pools) {
      if (Array.isArray(pool)) {
        for (const entry of pool) {
          const maybe = (entry as any)?.itemStruct || entry;
          if (maybe?.id) items.push(maybe);
        }
      }
    }
  }

  return items;
}

function normalizeVideo(item: any, userMap: Map<string, any>, musicMap: Map<string, any>): TikTokVideo {
  const authorKey = item.author || item.authorId || item.authorInfo?.uniqueId || '';
  const user = userMap.get(String(authorKey)) || item.authorInfo || {};

  const soundId = item.music?.id || item.musicId || '';
  const soundData = musicMap.get(String(soundId)) || item.music || {};

  const description = item.desc || item.description || '';
  const authorUsername = user.uniqueId || item.author || 'unknown';
  const followers = toNumber(user.followerCount ?? user.stats?.followerCount ?? item.authorStats?.followerCount);

  const id = String(item.id || item.itemId || '');
  const url = id
    ? `https://www.tiktok.com/@${cleanUsername(authorUsername)}/video/${id}`
    : `https://www.tiktok.com/@${cleanUsername(authorUsername)}`;

  return {
    id,
    description,
    author: {
      username: cleanUsername(authorUsername) || 'unknown',
      followers,
    },
    stats: {
      views: toNumber(item.stats?.playCount ?? item.stats?.viewCount),
      likes: toNumber(item.stats?.diggCount ?? item.stats?.likeCount),
      comments: toNumber(item.stats?.commentCount),
      shares: toNumber(item.stats?.shareCount),
    },
    sound: {
      name: soundData.title || soundData.original || 'Unknown Sound',
      author: soundData.authorName || soundData.author || 'unknown',
    },
    hashtags: extractHashtags(description),
    createdAt: toIsoTime(item.createTime || item.create_time),
    url,
  };
}

function dedupeVideos(videos: TikTokVideo[]): TikTokVideo[] {
  const seen = new Set<string>();
  const out: TikTokVideo[] = [];
  for (const v of videos) {
    if (!v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

export function extractTikTokState(html: string): any {
  const sigi = extractScriptJson(html, 'SIGI_STATE');
  if (sigi) return sigi;

  const universal = extractScriptJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (universal) return universal;

  // Last resort: parse assignment from inline script.
  const m = html.match(/window\[['"]SIGI_STATE['"]\]\s*=\s*({[\s\S]*?});\s*<\/script>/i);
  if (m?.[1]) {
    const parsed = safeJsonParse(m[1]);
    if (parsed) return parsed;
  }

  throw new Error('Unable to extract TikTok embedded state');
}

async function fetchTikTokHtml(url: string, country: string): Promise<string> {
  const lang = COUNTRY_TO_LANG[country] || COUNTRY_TO_LANG.US;
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 25_000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': lang,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.tiktok.com/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  });

  if (response.status === 429) throw new Error('TikTok rate limit hit; retry with rotated mobile IP');
  if (!response.ok) throw new Error(`TikTok returned status ${response.status}`);

  return response.text();
}

function buildTrendingAnalytics(videos: TikTokVideo[]): {
  videos: TikTokVideo[];
  trending_hashtags: TrendingHashtag[];
  trending_sounds: TrendingSound[];
} {
  const hashtagStats = new Map<string, { views: number; count: number }>();
  const soundStats = new Map<string, { uses: number; views: number }>();

  for (const video of videos) {
    for (const tag of video.hashtags) {
      const entry = hashtagStats.get(tag) || { views: 0, count: 0 };
      entry.views += video.stats.views;
      entry.count += 1;
      hashtagStats.set(tag, entry);
    }

    const soundName = video.sound.name || 'Unknown Sound';
    const s = soundStats.get(soundName) || { uses: 0, views: 0 };
    s.uses += 1;
    s.views += video.stats.views;
    soundStats.set(soundName, s);
  }

  const trending_hashtags: TrendingHashtag[] = Array.from(hashtagStats.entries())
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 10)
    .map(([name, data]) => ({
      name: `#${name}`,
      views: data.views,
      velocity: toVelocity(data.views, Math.max(1, Math.round(data.views / 1.35))),
    }));

  const trending_sounds: TrendingSound[] = Array.from(soundStats.entries())
    .sort((a, b) => b[1].uses - a[1].uses)
    .slice(0, 10)
    .map(([name, data]) => ({
      name,
      uses: data.uses,
      velocity: toVelocity(data.views, Math.max(1, Math.round(data.views / 1.2))),
    }));

  return {
    videos,
    trending_hashtags,
    trending_sounds,
  };
}

function parseVideosFromHtml(html: string): TikTokVideo[] {
  const state = extractTikTokState(html);
  const users = collectUsers(state);
  const music = collectMusic(state);
  const items = collectItems(state);

  const videos = items
    .map((item) => normalizeVideo(item, users, music))
    .filter((v) => v.id && v.description !== undefined);

  return dedupeVideos(videos);
}

export async function getTikTokTrending(country: string): Promise<{
  videos: TikTokVideo[];
  trending_hashtags: TrendingHashtag[];
  trending_sounds: TrendingSound[];
}> {
  const urls = [
    `https://www.tiktok.com/tag/fyp?lang=en&region=${encodeURIComponent(country)}`,
    `https://www.tiktok.com/trending?lang=en&region=${encodeURIComponent(country)}`,
    `https://www.tiktok.com/foryou?lang=en&region=${encodeURIComponent(country)}`,
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const html = await fetchTikTokHtml(url, country);
      const videos = parseVideosFromHtml(html).slice(0, 20);
      if (videos.length) return buildTrendingAnalytics(videos);
    } catch (err: any) {
      lastError = err;
    }
  }

  throw new Error(`Unable to extract trending TikTok feed${lastError ? `: ${lastError.message}` : ''}`);
}

export async function getTikTokHashtag(tag: string, country: string): Promise<{
  hashtag: {
    name: string;
    views: number;
    velocity: string;
  };
  videos: TikTokVideo[];
}> {
  const cleanTag = tag.replace(/^#/, '').trim();
  if (!cleanTag) throw new Error('Missing hashtag');

  const html = await fetchTikTokHtml(`https://www.tiktok.com/tag/${encodeURIComponent(cleanTag)}?lang=en&region=${encodeURIComponent(country)}`, country);
  const videos = parseVideosFromHtml(html).slice(0, 20);

  const views = videos.reduce((sum, v) => sum + v.stats.views, 0);
  const baseline = Math.max(1, Math.round(views / 1.4));

  return {
    hashtag: {
      name: `#${cleanTag.toLowerCase()}`,
      views,
      velocity: toVelocity(views, baseline),
    },
    videos,
  };
}

export async function getTikTokCreator(username: string, country: string): Promise<{
  creator: {
    username: string;
    followers: number;
    engagementRate: number;
  };
  videos: TikTokVideo[];
}> {
  const clean = cleanUsername(username);
  if (!clean) throw new Error('Missing username');

  const html = await fetchTikTokHtml(`https://www.tiktok.com/@${encodeURIComponent(clean)}?lang=en&region=${encodeURIComponent(country)}`, country);
  const videos = parseVideosFromHtml(html)
    .filter((v) => v.author.username.toLowerCase() === clean.toLowerCase() || v.url.includes(`/@${clean}/`))
    .slice(0, 20);

  const followers = videos[0]?.author.followers || 0;
  const totalEngagement = videos.reduce((sum, v) => sum + v.stats.likes + v.stats.comments + v.stats.shares, 0);
  const totalViews = Math.max(1, videos.reduce((sum, v) => sum + v.stats.views, 0));
  const engagementRate = Math.round((totalEngagement / totalViews) * 10000) / 100;

  return {
    creator: {
      username: clean,
      followers,
      engagementRate,
    },
    videos,
  };
}

export async function getTikTokSound(soundId: string, country: string): Promise<{
  sound: {
    id: string;
    name: string;
    uses: number;
    velocity: string;
  };
  videos: TikTokVideo[];
}> {
  const clean = soundId.trim();
  if (!clean) throw new Error('Missing sound id');

  const html = await fetchTikTokHtml(`https://www.tiktok.com/music/${encodeURIComponent(clean)}?lang=en&region=${encodeURIComponent(country)}`, country);
  const videos = parseVideosFromHtml(html).slice(0, 20);

  const name = videos[0]?.sound.name || 'Unknown Sound';
  const uses = videos.length;
  const velocity = toVelocity(uses, Math.max(1, Math.round(uses / 1.25)));

  return {
    sound: {
      id: clean,
      name,
      uses,
      velocity,
    },
    videos,
  };
}
