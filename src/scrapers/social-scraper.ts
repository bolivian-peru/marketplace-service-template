/**
 * Social Profile Intelligence Scraper
 * ──────────────────────────────────
 * Extracts profile data from Reddit and Twitter (X).
 */

import { proxyFetch } from '../proxy';

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
 * Note: Twitter is heavily protected. This basic implementation 
 * attempts to scrape the public profile page.
 */
export async function scrapeTwitter(username: string): Promise<SocialProfile> {
  const url = `https://twitter.com/${username}`;
  console.log(`[SocialScraper] Fetching Twitter: ${url}`);
  
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  if (!response.ok) {
    throw new Error(`Twitter fetch failed: ${response.status}`);
  }

  const html = await response.text();
  
  // Very basic regex extraction as Twitter is SPA and needs JS
  // In a real production environment, we'd use browser.proxies.sx
  const bioMatch = html.match(/"description":"([^"]+)"/);
  const nameMatch = html.match(/"name":"([^"]+)"/);
  
  return {
    username,
    displayName: nameMatch ? nameMatch[1] : undefined,
    bio: bioMatch ? bioMatch[1] : undefined,
    platform: 'Twitter'
  };
}
