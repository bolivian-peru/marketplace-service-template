/**
 * Social Profile Intelligence API
 * ───────────────────────────────
 * Aggregates public social profile data across platforms.
 * Extracts bio, follower counts, recent posts, and verification status.
 *
 * Bounty: Wave 2 — $50 Social Profile Intelligence API
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ───────────────────────────────────────────

export interface SocialProfile {
  /** Platform name (twitter, instagram, linkedin, github) */
  platform: string;
  /** Username / handle */
  username: string;
  /** Display name */
  displayName: string | null;
  /** Bio / description */
  bio: string | null;
  /** Follower count */
  followers: number | null;
  /** Following count */
  following: number | null;
  /** Post count */
  posts: number | null;
  /** Verified badge */
  verified: boolean;
  /** Profile URL */
  url: string;
  /** Avatar URL */
  avatar: string | null;
  /** Join date */
  joinedDate: string | null;
  /** Location */
  location: string | null;
  /** Website link */
  website: string | null;
  /** Timestamp */
  checkedAt: string;
}

export interface SocialResponse {
  username: string;
  profiles: SocialProfile[];
  totalPlatforms: number;
}

// ─── PLATFORM SCRAPERS ──────────────────────────────

async function scrapeTwitter(username: string): Promise<SocialProfile | null> {
  const url = `https://nitter.net/${encodeURIComponent(username)}`;
  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en' },
    timeoutMs: 20_000,
    maxRetries: 1,
  });

  if (!response.ok) return null;
  const html = await response.text();

  // Extract from nitter
  const displayName = html.match(/<a[^>]*class="profile-card-fullname"[^>]*>([^<]+)</i)?.[1]?.trim() || null;
  const bio = html.match(/<div[^>]*class="profile-bio"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
  const tweetsMatch = html.match(/(\d[\d,]*)\s*Tweets/i);
  const followingMatch = html.match(/(\d[\d,]*)\s*Following/i);
  const followersMatch = html.match(/(\d[\d,]*)\s*Followers/i);
  const avatar = html.match(/<img[^>]*class="profile-avatar"[^>]*src="([^"]+)"/i)?.[1] || null;

  if (!displayName && !bio) return null;

  return {
    platform: 'twitter',
    username,
    displayName,
    bio: bio?.substring(0, 500) || null,
    followers: followersMatch ? parseInt(followersMatch[1].replace(/,/g, '')) : null,
    following: followingMatch ? parseInt(followingMatch[1].replace(/,/g, '')) : null,
    posts: tweetsMatch ? parseInt(tweetsMatch[1].replace(/,/g, '')) : null,
    verified: html.includes('icon-verified'),
    url: `https://twitter.com/${username}`,
    avatar,
    joinedDate: null,
    location: null,
    website: null,
    checkedAt: new Date().toISOString(),
  };
}

async function scrapeInstagram(username: string): Promise<SocialProfile | null> {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=1`;
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'application/json,text/html',
      'X-Requested-With': 'XMLHttpRequest',
    },
    timeoutMs: 20_000,
    maxRetries: 1,
  });

  if (!response.ok) return null;

  try {
    const text = await response.text();
    // Instagram's JSON is embedded in the page
    const jsonMatch = text.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[1]);
    const user = data?.require?.[0]?.[3]?.[0]?.user || data?.graphql?.user;
    if (!user) return null;

    return {
      platform: 'instagram',
      username,
      displayName: user.full_name || null,
      bio: user.biography || null,
      followers: user.edge_followed_by?.count || null,
      following: user.edge_follow?.count || null,
      posts: user.edge_owner_to_timeline_media?.count || null,
      verified: user.is_verified || false,
      url: `https://instagram.com/${username}`,
      avatar: user.profile_pic_url_hd || user.profile_pic_url || null,
      joinedDate: null,
      location: null,
      website: user.external_url || null,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function scrapeGithub(username: string): Promise<SocialProfile | null> {
  const url = `https://api.github.com/users/${encodeURIComponent(username)}`;
  const response = await proxyFetch(url, {
    headers: { 'Accept': 'application/json' },
    timeoutMs: 15_000,
    maxRetries: 1,
  });

  if (!response.ok) return null;

  try {
    const user = await response.json() as any;
    return {
      platform: 'github',
      username,
      displayName: user.name || null,
      bio: user.bio || null,
      followers: user.followers || null,
      following: user.following || null,
      posts: user.public_repos || null,
      verified: false,
      url: user.html_url || `https://github.com/${username}`,
      avatar: user.avatar_url || null,
      joinedDate: user.created_at || null,
      location: user.location || null,
      website: user.blog || null,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── MAIN ────────────────────────────────────────────

export async function getSocialProfiles(
  username: string,
  platforms?: string[],
): Promise<SocialResponse> {
  const targets = platforms || ['twitter', 'instagram', 'github'];
  const scrapers: Record<string, (u: string) => Promise<SocialProfile | null>> = {
    twitter: scrapeTwitter,
    instagram: scrapeInstagram,
    github: scrapeGithub,
  };

  const profiles: SocialProfile[] = [];

  const tasks = targets
    .filter(p => scrapers[p])
    .map(async (platform) => {
      try {
        const profile = await scrapers[platform](username);
        if (profile) profiles.push(profile);
      } catch {}
    });

  await Promise.allSettled(tasks);

  return {
    username,
    profiles,
    totalPlatforms: profiles.length,
  };
}
