/**
 * TikTok Trend Intelligence Scraper (Bounty #51)
 * ───────────────────────────────────────────────
 * Sources:
 * - TikTok Creative Center (__NEXT_DATA__)
 * - TikTok video pages (__UNIVERSAL_DATA_FOR_REHYDRATION__)
 *
 * All HTTP requests are routed through proxyFetch() (mobile proxy).
 */

import { proxyFetch } from '../proxy';

export const TIKTOK_SUPPORTED_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'] as const;
export type TikTokCountry = typeof TIKTOK_SUPPORTED_COUNTRIES[number];

type TrendType = 'trending' | 'hashtag' | 'creator' | 'sound';

interface NumberPoint {
  time?: number;
  value?: number;
}

interface GenericRecord {
  [key: string]: unknown;
}

export interface TikTokVideo {
  id: string;
  description: string;
  author: {
    username: string;
    followers: number | null;
  };
  stats: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
  sound: {
    name: string | null;
    author: string | null;
  };
  hashtags: string[];
  createdAt: string | null;
  url: string;
}

export interface TikTokHashtag {
  name: string;
  views: number | null;
  velocity: string | null;
  publishCount: number | null;
  rank: number | null;
}

export interface TikTokSound {
  id: string;
  name: string;
  author: string | null;
  uses: number | null;
  velocity: string | null;
  url: string | null;
}

export interface TikTokCreatorPost {
  id: string;
  views: number | null;
  likes: number | null;
  createdAt: string | null;
  url: string | null;
}

export interface TikTokCreator {
  username: string;
  nickname: string | null;
  followers: number | null;
  likes: number | null;
  engagementRate: number | null;
  recentPosts: TikTokCreatorPost[];
  profileUrl: string | null;
}

interface CreativeCenterData {
  videos: TikTokVideo[];
  hashtags: TikTokHashtag[];
  sounds: TikTokSound[];
  creators: TikTokCreator[];
}

const CREATIVE_CENTER_BASE = 'https://ads.tiktok.com/business/creativecenter/inspiration/popular';

export function normalizeTikTokCountry(input: string | null | undefined): TikTokCountry {
  const country = (input || 'US').toUpperCase().trim();
  if (TIKTOK_SUPPORTED_COUNTRIES.includes(country as TikTokCountry)) {
    return country as TikTokCountry;
  }
  return 'US';
}

export async function getTikTokTrending(country: TikTokCountry, limit: number): Promise<{
  videos: TikTokVideo[];
  trending_hashtags: TikTokHashtag[];
  trending_sounds: TikTokSound[];
}> {
  const [trendingData, hashtagData, soundData] = await Promise.all([
    fetchCreativeCenterData('trending', country),
    fetchCreativeCenterData('hashtag', country),
    fetchCreativeCenterData('sound', country),
  ]);

  const cappedVideos = trendingData.videos.slice(0, limit);
  const enrichedVideos = await enrichVideoDetails(cappedVideos);

  return {
    videos: enrichedVideos,
    trending_hashtags: hashtagData.hashtags.slice(0, limit),
    trending_sounds: soundData.sounds.slice(0, limit),
  };
}

export async function getTikTokHashtagTrend(
  country: TikTokCountry,
  tag: string,
  limit: number,
): Promise<{ hashtag: TikTokHashtag | null; alternatives: TikTokHashtag[] }> {
  const data = await fetchCreativeCenterData('hashtag', country);
  const normalizedTag = stripHash(tag).toLowerCase();
  const hashtag = data.hashtags.find((item) => stripHash(item.name).toLowerCase() === normalizedTag) || null;
  return {
    hashtag,
    alternatives: data.hashtags.slice(0, limit),
  };
}

export async function getTikTokCreatorInsight(
  country: TikTokCountry,
  username: string,
  limit: number,
): Promise<{ creator: TikTokCreator | null; alternatives: TikTokCreator[] }> {
  const data = await fetchCreativeCenterData('creator', country);
  const normalized = stripAt(username).toLowerCase();

  const creator = data.creators.find((item) => {
    const user = stripAt(item.username).toLowerCase();
    return user === normalized;
  }) || null;

  return {
    creator,
    alternatives: data.creators.slice(0, limit),
  };
}

export async function getTikTokSoundInsight(
  country: TikTokCountry,
  soundId: string,
  limit: number,
): Promise<{ sound: TikTokSound | null; alternatives: TikTokSound[] }> {
  const data = await fetchCreativeCenterData('sound', country);
  const normalized = soundId.trim().toLowerCase();

  const sound = data.sounds.find((item) => item.id.toLowerCase() === normalized) || null;

  return {
    sound,
    alternatives: data.sounds.slice(0, limit),
  };
}

async function fetchCreativeCenterData(type: TrendType, country: TikTokCountry): Promise<CreativeCenterData> {
  const url = buildCreativeCenterUrl(type, country);
  const response = await proxyFetch(url, {
    maxRetries: 3,
    timeoutMs: 45_000,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://ads.tiktok.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`Creative Center fetch failed (${type}): ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const nextData = extractJsonScript(html, '__NEXT_DATA__');

  return {
    videos: extractTrendingVideos(nextData),
    hashtags: extractHashtags(nextData),
    sounds: extractSounds(nextData),
    creators: extractCreators(nextData),
  };
}

function buildCreativeCenterUrl(type: TrendType, country: TikTokCountry): string {
  const segment = type === 'trending' ? '' : `/${type}`;
  const url = new URL(`${CREATIVE_CENTER_BASE}${segment}/pc/en`);
  url.searchParams.set('countryCode', country);
  url.searchParams.set('period', '7');
  return url.toString();
}

function extractJsonScript(html: string, scriptId: string): GenericRecord {
  const pattern = new RegExp(`<script[^>]*id=["']${scriptId}["'][^>]*>([\\s\\S]*?)<\\/script>`);
  const match = html.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Unable to locate ${scriptId} script payload`);
  }
  try {
    return JSON.parse(match[1]) as GenericRecord;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${scriptId} JSON payload: ${message}`);
  }
}

function extractTrendingVideos(root: unknown): TikTokVideo[] {
  const rows = findArrayByKeys(root, ['itemUrl', 'itemId']);
  if (!rows) return [];

  const videos: TikTokVideo[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = asString(row.itemId) || asString(row.id);
    const url = normalizeTikTokUrl(asString(row.itemUrl));
    if (!id || !url || seen.has(id)) continue;

    seen.add(id);

    videos.push({
      id,
      description: asString(row.title) || '',
      author: {
        username: extractUsernameFromUrl(url) || 'unknown',
        followers: null,
      },
      stats: {
        views: null,
        likes: null,
        comments: null,
        shares: null,
      },
      sound: {
        name: null,
        author: null,
      },
      hashtags: [],
      createdAt: null,
      url,
    });
  }

  return videos;
}

function extractHashtags(root: unknown): TikTokHashtag[] {
  const rows = findArrayByKeys(root, ['hashtagName']);
  if (!rows) return [];

  const out: TikTokHashtag[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const tagName = asString(row.hashtagName);
    if (!tagName) continue;
    const normalized = `#${stripHash(tagName)}`;
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());

    out.push({
      name: normalized,
      views: asNumber(row.videoViews),
      velocity: formatVelocity(row.trend),
      publishCount: asNumber(row.publishCnt),
      rank: asNumber(row.rank),
    });
  }

  return out.sort((a, b) => (b.views || 0) - (a.views || 0));
}

function extractSounds(root: unknown): TikTokSound[] {
  const rows = findArrayByKeys(root, ['title', 'clipId']);
  const fallbackRows = rows || findArrayByKeys(root, ['title', 'songId']) || [];

  const out: TikTokSound[] = [];
  const seen = new Set<string>();

  for (const row of fallbackRows) {
    if (!isRecord(row)) continue;
    const id = asString(row.songId) || asString(row.clipId);
    const title = asString(row.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      name: title,
      author: asString(row.author),
      uses: pickFirstNumber([
        row.useCnt,
        row.usageCnt,
        row.usedCnt,
        row.videoCount,
        row.publishCnt,
        row.onListTimes,
      ]) || (Array.isArray(row.relatedItems) ? row.relatedItems.length : null),
      velocity: formatVelocity(row.trend),
      url: asString(row.link) || null,
    });
  }

  return out.sort((a, b) => (b.uses || 0) - (a.uses || 0));
}

function extractCreators(root: unknown): TikTokCreator[] {
  const rows = findArrayByKeys(root, ['nickName']);
  if (!rows) return [];

  const out: TikTokCreator[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) continue;

    const profileUrl = normalizeTikTokUrl(asString(row.ttLink));
    const username = extractUsernameFromUrl(profileUrl) || null;
    const nickname = asString(row.nickName) || null;
    const uniqueKey = (username || nickname || '').toLowerCase();
    if (!uniqueKey || seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const recentPosts = extractCreatorPosts(row.items, username || undefined);

    out.push({
      username: username ? `@${username}` : `@${(nickname || 'unknown').replace(/\s+/g, '').toLowerCase()}`,
      nickname,
      followers: asNumber(row.followerCnt),
      likes: asNumber(row.likedCnt),
      engagementRate: computeEngagementRate(recentPosts),
      recentPosts,
      profileUrl,
    });
  }

  return out.sort((a, b) => (b.followers || 0) - (a.followers || 0));
}

function extractCreatorPosts(items: unknown, username?: string): TikTokCreatorPost[] {
  if (!Array.isArray(items)) return [];

  const posts: TikTokCreatorPost[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = asString(item.itemId);
    if (!id) continue;
    posts.push({
      id,
      views: asNumber(item.vv),
      likes: asNumber(item.likedCnt),
      createdAt: toIsoDate(item.createTime),
      url: normalizeTikTokUrl(asString(item.ttLink)) || (username ? `https://www.tiktok.com/@${username}/video/${id}` : null),
    });
  }
  return posts.slice(0, 5);
}

async function enrichVideoDetails(videos: TikTokVideo[]): Promise<TikTokVideo[]> {
  const enriched = await Promise.all(videos.map(async (video) => {
    try {
      const response = await proxyFetch(video.url, {
        maxRetries: 2,
        timeoutMs: 35_000,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://www.tiktok.com/',
        },
      });
      if (!response.ok) return video;

      const html = await response.text();
      const payload = extractJsonScript(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
      const item = extractVideoItemStruct(payload);
      if (!item) return video;

      const author = asGenericRecord(item.author);
      const authorStats = asGenericRecord(item.authorStats);
      const stats = asGenericRecord(item.stats);
      const music = asGenericRecord(item.music);
      const username = asString(author?.uniqueId) || asString(author?.nickname) || video.author.username;

      return {
        id: asString(item.id) || video.id,
        description: asString(item.desc) || video.description,
        author: {
          username,
          followers: asNumber(authorStats?.followerCount),
        },
        stats: {
          views: asNumber(stats?.playCount),
          likes: asNumber(stats?.diggCount),
          comments: asNumber(stats?.commentCount),
          shares: asNumber(stats?.shareCount),
        },
        sound: {
          name: asString(music?.title) || null,
          author: asString(music?.authorName) || null,
        },
        hashtags: extractVideoHashtags(item),
        createdAt: toIsoDate(item.createTime),
        url: video.url,
      };
    } catch {
      return video;
    }
  }));

  return enriched;
}

function extractVideoItemStruct(root: unknown): GenericRecord | null {
  if (!isRecord(root)) return null;

  const scope = root.__DEFAULT_SCOPE__;
  if (isRecord(scope)) {
    const detail = scope['webapp.video-detail'];
    if (isRecord(detail) && isRecord(detail.itemInfo) && isRecord(detail.itemInfo.itemStruct)) {
      return detail.itemInfo.itemStruct as GenericRecord;
    }
  }

  return findObjectByKeys(root, ['id', 'stats', 'author']);
}

function extractVideoHashtags(item: GenericRecord): string[] {
  const tags = new Set<string>();

  const challenges = item.challenges;
  if (Array.isArray(challenges)) {
    for (const challenge of challenges) {
      if (!isRecord(challenge)) continue;
      const title = asString(challenge.title);
      if (!title) continue;
      tags.add(`#${stripHash(title)}`);
    }
  }

  const textExtra = item.textExtra;
  if (Array.isArray(textExtra)) {
    for (const extra of textExtra) {
      if (!isRecord(extra)) continue;
      const hashtag = asString(extra.hashtagName);
      if (!hashtag) continue;
      tags.add(`#${stripHash(hashtag)}`);
    }
  }

  return Array.from(tags).slice(0, 20);
}

function findArrayByKeys(root: unknown, requiredKeys: string[]): GenericRecord[] | null {
  const arrays = collectArrays(root);
  for (const arr of arrays) {
    const hasMatch = arr.some((item) => isRecord(item) && requiredKeys.every((key) => key in item));
    if (hasMatch) {
      return arr.filter((item): item is GenericRecord => isRecord(item));
    }
  }
  return null;
}

function collectArrays(root: unknown): unknown[][] {
  const arrays: unknown[][] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length > 0) arrays.push(node);
      for (const value of node) walk(value);
      return;
    }

    for (const value of Object.values(node as GenericRecord)) {
      walk(value);
    }
  };

  walk(root);
  return arrays;
}

function findObjectByKeys(root: unknown, keys: string[]): GenericRecord | null {
  const seen = new Set<unknown>();

  const walk = (node: unknown): GenericRecord | null => {
    if (!node || typeof node !== 'object') return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (isRecord(node) && keys.every((key) => key in node)) {
      return node;
    }

    if (Array.isArray(node)) {
      for (const value of node) {
        const found = walk(value);
        if (found) return found;
      }
      return null;
    }

    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) return found;
    }

    return null;
  };

  return walk(root);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[,_%\s]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickFirstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const n = asNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  const n = asNumber(value);
  if (!n) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeTikTokUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('https://')) return value;
  if (value.startsWith('http://')) return `https://${value.slice('http://'.length)}`;
  if (value.startsWith('/')) return `https://www.tiktok.com${value}`;
  return null;
}

function extractUsernameFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/@([^/?]+)/);
  return match?.[1] || null;
}

function stripHash(tag: string): string {
  return tag.replace(/^#+/, '').trim();
}

function stripAt(username: string): string {
  return username.replace(/^@+/, '').trim();
}

function formatVelocity(trendValue: unknown): string | null {
  if (!Array.isArray(trendValue)) return null;
  const points: NumberPoint[] = trendValue.filter((v): v is NumberPoint => isRecord(v));
  const values = points.map((p) => asNumber(p.value)).filter((v): v is number => v !== null);
  if (values.length < 2) return null;

  const latest = values[values.length - 1];
  let baseline = values[0];
  if (baseline <= 0) {
    const fallback = values.slice(0, -1).reverse().find((v) => v > 0);
    if (!fallback) return null;
    baseline = fallback;
  }

  const pct = ((latest - baseline) / baseline) * 100;
  if (!Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded}% 7d`;
}

function computeEngagementRate(posts: TikTokCreatorPost[]): number | null {
  const ratios = posts
    .map((post) => {
      if (!post.views || !post.likes || post.views <= 0) return null;
      return (post.likes / post.views) * 100;
    })
    .filter((r): r is number => r !== null);

  if (ratios.length === 0) return null;
  const avg = ratios.reduce((sum, n) => sum + n, 0) / ratios.length;
  return Math.round(avg * 100) / 100;
}

function asGenericRecord(value: unknown): GenericRecord | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
