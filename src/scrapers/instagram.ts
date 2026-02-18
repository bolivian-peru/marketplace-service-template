/**
 * Instagram Scraper — Mobile Proxy Intelligence
 * Extracts profile data, posts, and images via Proxies.sx mobile proxies
 */

import { proxyFetch, getProxy } from '../proxy';

export interface InstagramProfile {
  username: string;
  full_name: string;
  bio: string;
  followers: number;
  following: number;
  posts_count: number;
  is_verified: boolean;
  is_business: boolean;
  profile_pic_url: string;
  external_url: string | null;
  category: string | null;
  engagement_rate: number;
  avg_likes: number;
  avg_comments: number;
  posting_frequency: string;
}

export interface InstagramPost {
  id: string;
  shortcode: string;
  caption: string;
  likes: number;
  comments: number;
  timestamp: number;
  is_video: boolean;
  image_url: string;
  thumbnail_url: string;
  engagement_rate: number;
}

export interface ScrapedData {
  profile: InstagramProfile;
  posts: InstagramPost[];
  image_urls: string[];
}

const INSTAGRAM_BASE = 'https://www.instagram.com';

/**
 * Extract profile data from Instagram's public JSON API
 */
export async function scrapeProfile(username: string): Promise<InstagramProfile> {
  const proxy = getProxy();

  // Try the web profile endpoint via mobile proxy
  const response = await proxyFetch(
    `${INSTAGRAM_BASE}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      headers: {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'Referer': `${INSTAGRAM_BASE}/${username}/`,
      },
      maxRetries: 3,
      timeoutMs: 30000,
    }
  );

  if (!response.ok) {
    // Fallback: try /?__a=1&__d=dis endpoint
    const fallback = await proxyFetch(
      `${INSTAGRAM_BASE}/${encodeURIComponent(username)}/?__a=1&__d=dis`,
      {
        headers: {
          'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
          'X-IG-App-ID': '936619743392459',
          'Accept': 'application/json',
        },
        maxRetries: 2,
        timeoutMs: 30000,
      }
    );
    if (!fallback.ok) {
      throw new Error(`Failed to fetch profile for @${username}: ${response.status}`);
    }
    return parseProfileResponse(await fallback.json(), username);
  }

  return parseProfileResponse(await response.json(), username);
}

function parseProfileResponse(data: any, username: string): InstagramProfile {
  const user = data?.data?.user || data?.graphql?.user || data?.user || {};

  const followers = user.edge_followed_by?.count ?? user.follower_count ?? 0;
  const posts_count = user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0;

  // Calculate engagement from recent posts if available
  const recentEdges = user.edge_owner_to_timeline_media?.edges ?? [];
  let totalLikes = 0;
  let totalComments = 0;
  const postCount = Math.min(recentEdges.length, 12);

  for (let i = 0; i < postCount; i++) {
    const node = recentEdges[i]?.node ?? {};
    totalLikes += node.edge_liked_by?.count ?? node.like_count ?? 0;
    totalComments += node.edge_media_to_comment?.count ?? node.comment_count ?? 0;
  }

  const avgLikes = postCount > 0 ? Math.round(totalLikes / postCount) : 0;
  const avgComments = postCount > 0 ? Math.round(totalComments / postCount) : 0;
  const engagementRate = followers > 0
    ? Math.round(((avgLikes + avgComments) / followers) * 10000) / 100
    : 0;

  // Estimate posting frequency
  let postingFrequency = 'unknown';
  if (postCount >= 2) {
    const timestamps = recentEdges
      .slice(0, postCount)
      .map((e: any) => e.node?.taken_at_timestamp ?? 0)
      .filter((t: number) => t > 0)
      .sort((a: number, b: number) => b - a);

    if (timestamps.length >= 2) {
      const daySpan = (timestamps[0] - timestamps[timestamps.length - 1]) / 86400;
      if (daySpan > 0) {
        const postsPerWeek = Math.round((timestamps.length / daySpan) * 7 * 10) / 10;
        postingFrequency = `${postsPerWeek} posts/week`;
      }
    }
  }

  return {
    username: user.username ?? username,
    full_name: user.full_name ?? '',
    bio: user.biography ?? '',
    followers,
    following: user.edge_follow?.count ?? user.following_count ?? 0,
    posts_count,
    is_verified: user.is_verified ?? false,
    is_business: user.is_business_account ?? user.is_business ?? false,
    profile_pic_url: user.profile_pic_url_hd ?? user.profile_pic_url ?? '',
    external_url: user.external_url ?? null,
    category: user.category_name ?? user.category ?? null,
    engagement_rate: engagementRate,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    posting_frequency: postingFrequency,
  };
}

/**
 * Extract recent posts with engagement data
 */
export async function scrapePosts(username: string, limit: number = 12): Promise<InstagramPost[]> {
  const proxy = getProxy();

  const response = await proxyFetch(
    `${INSTAGRAM_BASE}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      headers: {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'Referer': `${INSTAGRAM_BASE}/${username}/`,
      },
      maxRetries: 3,
      timeoutMs: 30000,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch posts for @${username}: ${response.status}`);
  }

  const data = await response.json();
  const user = data?.data?.user || data?.graphql?.user || {};
  const edges = user.edge_owner_to_timeline_media?.edges ?? [];
  const followers = user.edge_followed_by?.count ?? user.follower_count ?? 1;

  return edges.slice(0, limit).map((edge: any) => {
    const node = edge.node ?? {};
    const likes = node.edge_liked_by?.count ?? node.like_count ?? 0;
    const comments = node.edge_media_to_comment?.count ?? node.comment_count ?? 0;

    return {
      id: node.id ?? '',
      shortcode: node.shortcode ?? '',
      caption: node.edge_media_to_caption?.edges?.[0]?.node?.text ?? node.caption?.text ?? '',
      likes,
      comments,
      timestamp: node.taken_at_timestamp ?? 0,
      is_video: node.is_video ?? false,
      image_url: node.display_url ?? '',
      thumbnail_url: node.thumbnail_src ?? node.display_url ?? '',
      engagement_rate: Math.round(((likes + comments) / followers) * 10000) / 100,
    };
  });
}

/**
 * Get image URLs for AI vision analysis
 */
export async function getPostImageUrls(username: string, limit: number = 12): Promise<string[]> {
  const posts = await scrapePosts(username, limit);
  return posts.filter(p => !p.is_video).map(p => p.image_url);
}

/**
 * Full scrape: profile + posts + image URLs
 */
export async function scrapeAll(username: string, postLimit: number = 12): Promise<ScrapedData> {
  const profile = await scrapeProfile(username);
  const posts = await scrapePosts(username, postLimit);
  const image_urls = posts.filter(p => !p.is_video).map(p => p.image_url);

  return { profile, posts, image_urls };
}
