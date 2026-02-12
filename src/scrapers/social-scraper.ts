/**
 * Social Profile Intelligence Scraper
 * ──────────────────────────────────
 * Extracts profile data from Reddit and Twitter (X).
 */

import { proxyFetch, browserFetch } from '../proxy';

export interface SocialProfile {
  username: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  posts?: number;
  platform: 'Twitter' | 'Reddit';
  joinDate?: string;
}

/**
 * Scrape Reddit Profile
 */
export async function scrapeReddit(username: string): Promise<SocialProfile> {
  const url = `https://www.reddit.com/user/${username}/about.json`;
  console.log(`[SocialScraper] Fetching Reddit: ${url}`);
  
  const response = await proxyFetch(url);

  if (!response.ok) {
    throw new Error(`Reddit fetch failed: ${response.status}`);
  }

  const json = await response.json();
  const data = json.data;

  return {
    username: data.name,
    displayName: data.subreddit?.title,
    bio: data.subreddit?.public_description,
    followers: data.subreddit?.subscribers,
    platform: 'Reddit',
    joinDate: new Date(data.created_utc * 1000).toISOString()
  };
}

/**
 * Scrape Twitter Profile
 * Note: Twitter is heavily protected. Uses browser.proxies.sx (headless).
 */
export async function scrapeTwitter(username: string): Promise<SocialProfile> {
  const url = `https://twitter.com/${username}`;
  console.log(`[SocialScraper] Fetching Twitter via Headless: ${url}`);
  
  const html = await browserFetch(url);
  
  // Extract data from the rendered HTML
  const bioMatch = html.match(/"description":"([^"]+)"/);
  const nameMatch = html.match(/"name":"([^"]+)"/);
  
  return {
    username,
    displayName: nameMatch ? nameMatch[1] : undefined,
    bio: bioMatch ? bioMatch[1] : undefined,
    platform: 'Twitter'
  };
}
