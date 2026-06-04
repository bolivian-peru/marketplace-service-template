/**
 * Social Profile Intelligence Scraper
 *
 * Scrapes public social media profile data across platforms using
 * search engine queries and direct profile page fetching via mobile proxies.
 *
 * Supported platforms: Twitter/X, Instagram, TikTok, Reddit, YouTube
 *
 * Strategy:
 *   1. Search engine lookup (DuckDuckGo/Google) for "username site:platform.com"
 *   2. Direct profile page fetch via proxyFetch for platforms with server-rendered HTML
 *   3. Parse and normalize profile metadata (bio, followers, avatar, etc.)
 */

import { proxyFetch } from '../proxy';

export interface SocialProfile {
  platform: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  profileUrl: string;
  avatarUrl: string | null;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  verified: boolean;
  location: string | null;
  website: string | null;
  recentPosts: RecentPost[];
  scrapedAt: string;
}

export interface RecentPost {
  text: string;
  url: string;
  likes: number | null;
  timestamp: string | null;
}

interface ScrapeResult {
  profiles: SocialProfile[];
  query: string;
  platformsSearched: string[];
  errors: string[];
}

const TIMEOUT_MS = 20_000;
const MAX_BIO_LENGTH = 500;
const MAX_POST_TEXT = 300;

const PLATFORMS = [
  { name: 'twitter', domain: 'x.com', searchDomain: 'x.com' },
  { name: 'instagram', domain: 'instagram.com', searchDomain: 'instagram.com' },
  { name: 'tiktok', domain: 'tiktok.com', searchDomain: 'tiktok.com' },
  { name: 'reddit', domain: 'reddit.com', searchDomain: 'reddit.com/user' },
  { name: 'youtube', domain: 'youtube.com', searchDomain: 'youtube.com/@' },
] as const;

function sanitize(text: string, maxLen: number): string {
  return text.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function parseCount(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s]/g, '').toUpperCase();
  const match = cleaned.match(/([\d.]+)\s*([KMB])?/);
  if (!match) return null;
  let num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  const suffix = match[2];
  if (suffix === 'K') num *= 1_000;
  else if (suffix === 'M') num *= 1_000_000;
  else if (suffix === 'B') num *= 1_000_000_000;
  return Math.round(num);
}

/**
 * Fetch a URL through the Proxies.sx mobile proxy and return HTML.
 */
async function fetchViaProxy(url: string): Promise<string | null> {
  try {
    const resp = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      maxRetries: 2,
      timeoutMs: TIMEOUT_MS,
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

/**
 * Search DuckDuckGo HTML for a query and return result snippets.
 */
async function searchDDG(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchViaProxy(searchUrl);
    if (!html) return results;

    // Parse DDG HTML results
    const resultBlocks = html.split(/class="result\s/);
    for (const block of resultBlocks.slice(1, 10)) {
      // Extract URL
      const urlMatch = block.match(/href="([^"]+)"/);
      const url = urlMatch ? urlMatch[1] : '';
      if (!url) continue;

      // Extract title
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
      const title = titleMatch ? sanitize(titleMatch[1], 200) : '';

      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+)/);
      const snippet = snippetMatch ? sanitize(snippetMatch[1], 300) : '';

      if (title || snippet) {
        results.push({ title, url, snippet });
      }
    }
  } catch {
    // Search failed, return empty
  }

  return results;
}

/**
 * Parse Twitter/X profile page HTML for profile data.
 */
function parseTwitterProfile(html: string, username: string): SocialProfile | null {
  // Twitter requires JS rendering, but meta tags contain profile info
  const nameMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/);
  const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/);
  const imageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/);

  if (!nameMatch && !descMatch) return null;

  const bio = descMatch ? sanitize(descMatch[1], MAX_BIO_LENGTH) : null;
  
  // Try to extract follower counts from bio/description
  // Twitter meta description often has format: "Name (@handle) / X ... N Followers ..."
  let followerCount: number | null = null;
  const followerMatch = bio?.match(/([\d,.]+[KMB]?)\s*Followers/i);
  if (followerMatch) followerCount = parseCount(followerMatch[1]);

  return {
    platform: 'twitter',
    username,
    displayName: nameMatch ? sanitize(nameMatch[1].split('(')[0].trim(), 100) : null,
    bio,
    profileUrl: `https://x.com/${username}`,
    avatarUrl: imageMatch ? imageMatch[1] : null,
    followerCount,
    followingCount: null,
    postCount: null,
    verified: false,
    location: null,
    website: null,
    recentPosts: [],
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Parse Reddit user page for profile data.
 */
function parseRedditProfile(html: string, username: string): SocialProfile | null {
  const nameMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/);
  const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/);
  const imageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/);

  if (!nameMatch && !descMatch) return null;

  return {
    platform: 'reddit',
    username,
    displayName: nameMatch ? sanitize(nameMatch[1], 100) : null,
    bio: descMatch ? sanitize(descMatch[1], MAX_BIO_LENGTH) : null,
    profileUrl: `https://www.reddit.com/user/${username}`,
    avatarUrl: imageMatch ? imageMatch[1] : null,
    followerCount: null,
    followingCount: null,
    postCount: null,
    verified: false,
    location: null,
    website: null,
    recentPosts: [],
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Build a profile from search engine results when direct scraping fails.
 */
function buildProfileFromSearch(
  platform: string,
  username: string,
  searchResults: Array<{ title: string; url: string; snippet: string }>,
): SocialProfile | null {
  const relevant = searchResults.filter(r =>
    r.url.toLowerCase().includes(username.toLowerCase()) ||
    r.title.toLowerCase().includes(username.toLowerCase())
  );

  if (relevant.length === 0) return null;

  const best = relevant[0];
  const platformInfo = PLATFORMS.find(p => p.name === platform);

  return {
    platform,
    username,
    displayName: best.title.split('|')[0].split('-')[0].trim().slice(0, 100) || null,
    bio: sanitize(best.snippet, MAX_BIO_LENGTH),
    profileUrl: `https://${platformInfo?.domain || 'example.com'}/${username}`,
    avatarUrl: null,
    followerCount: null,
    followingCount: null,
    postCount: null,
    verified: false,
    location: null,
    website: null,
    recentPosts: [],
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Scrape a single platform for a username.
 */
async function scrapePlatform(
  platform: typeof PLATFORMS[number],
  username: string,
): Promise<SocialProfile | null> {
  // Try direct profile fetch first
  const profileUrl = `https://${platform.domain}/${username}`;
  const html = await fetchViaProxy(profileUrl);

  if (html) {
    switch (platform.name) {
      case 'twitter': {
        const profile = parseTwitterProfile(html, username);
        if (profile) return profile;
        break;
      }
      case 'reddit': {
        const profile = parseRedditProfile(html, username);
        if (profile) return profile;
        break;
      }
    }
  }

  // Fallback: search engine lookup
  const query = `site:${platform.searchDomain} "${username}"`;
  const results = await searchDDG(query);
  
  if (results.length > 0) {
    return buildProfileFromSearch(platform.name, username, results);
  }

  return null;
}

/**
 * Main entry point: search for a username across all social platforms.
 *
 * @param username - The username/handle to look up
 * @param platforms - Optional list of platform names to search (default: all)
 */
export async function searchSocialProfiles(
  username: string,
  platforms?: string[],
): Promise<ScrapeResult> {
  const safeUsername = username.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 50);
  if (!safeUsername) {
    return { profiles: [], query: username, platformsSearched: [], errors: ['Invalid username'] };
  }

  const targetPlatforms = platforms?.length
    ? PLATFORMS.filter(p => platforms.includes(p.name))
    : [...PLATFORMS];

  const profiles: SocialProfile[] = [];
  const errors: string[] = [];
  const searched: string[] = [];

  // Scrape platforms in parallel
  const promises = targetPlatforms.map(async (platform) => {
    searched.push(platform.name);
    try {
      const profile = await scrapePlatform(platform, safeUsername);
      if (profile) profiles.push(profile);
    } catch (err: any) {
      errors.push(`${platform.name}: ${err?.message || String(err)}`);
    }
  });

  await Promise.allSettled(promises);

  return {
    profiles,
    query: safeUsername,
    platformsSearched: searched,
    errors,
  };
}

/**
 * Get detailed profile for a specific platform.
 */
export async function getProfileDetail(
  platform: string,
  username: string,
): Promise<SocialProfile | null> {
  const safePlatform = PLATFORMS.find(p => p.name === platform);
  if (!safePlatform) return null;

  const safeUsername = username.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 50);
  if (!safeUsername) return null;

  return scrapePlatform(safePlatform, safeUsername);
}
