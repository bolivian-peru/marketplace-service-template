/**
 * X/Twitter Intelligence Scraper
 * 
 * Uses Proxies.sx mobile proxies to search and extract data from X/Twitter.
 * 
 * Features:
 * - Search tweets by keyword/hashtag
 * - Get trending topics by country
 * - Extract user profiles
 * - Thread extraction
 * 
 * Strategy:
 * - Use search engines (DuckDuckGo, Brave) via mobile proxies to find Twitter content
 * - Direct fetch for user profiles and threads (with mobile UA)
 */

import { proxyFetch, getProxy } from '../proxy';

export interface TwitterSearchResult {
  id: string;
  author: {
    handle: string;
    name: string;
    followers: number | null;
    verified: boolean;
  };
  text: string;
  created_at: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  url: string;
  media: string[];
  hashtags: string[];
}

export interface TwitterTrendingResult {
  name: string;
  tweet_count: string | null;
  category: string | null;
  url: string | null;
}

export interface TwitterUserProfile {
  handle: string;
  name: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  joined: string | null;
  followers: number | null;
  following: number | null;
  tweets_count: number | null;
  verified: boolean;
  profile_image: string | null;
  banner_image: string | null;
}

export interface TwitterThreadResult {
  tweet_id: string;
  author: {
    handle: string;
    name: string;
  };
  tweets: Array<{
    id: string;
    text: string;
    created_at: string | null;
    likes: number | null;
    retweets: number | null;
    replies: number | null;
  }>;
}

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const SEARCH_ENGINES = [
  { name: 'duckduckgo', url: 'https://html.duckduckgo.com/html' },
  { name: 'brave', url: 'https://search.brave.com/search' },
];

/**
 * Search Twitter/X content by keyword
 */
export async function searchTwitterX(
  query: string,
  options: {
    sort?: 'latest' | 'top';
    limit?: number;
  } = {},
): Promise<TwitterSearchResult[]> {
  const { sort = 'latest', limit = 20 } = options;
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  
  const searchQuery = `site:x.com ${query}`;
  const results: TwitterSearchResult[] = [];
  
  for (const engine of SEARCH_ENGINES) {
    if (results.length >= safeLimit) break;
    
    try {
      const searchUrl = engine.name === 'duckduckgo'
        ? `${engine.url}?q=${encodeURIComponent(searchQuery)}`
        : `${engine.url}?q=${encodeURIComponent(searchQuery)}&source=web`;
      
      const response = await proxyFetch(searchUrl, {
        headers: {
          'User-Agent': MOBILE_UA,
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeoutMs: 15000,
        maxRetries: 2,
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const extracted = extractTweetsFromHTML(html, query);
      
      for (const tweet of extracted) {
        if (results.length >= safeLimit) break;
        if (!results.find(r => r.id === tweet.id)) {
          results.push(tweet);
        }
      }
    } catch (error) {
      console.error(`[TwitterX] Search via ${engine.name} failed:`, error);
      continue;
    }
  }
  
  return results.slice(0, safeLimit);
}

/**
 * Get trending topics for a country
 */
export async function getTwitterXTrending(
  country: string = 'US',
  limit: number = 20,
): Promise<TwitterTrendingResult[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const trendingQuery = `twitter trending topics ${country} ${new Date().getFullYear()}`;
  
  const results: TwitterTrendingResult[] = [];
  
  for (const engine of SEARCH_ENGINES) {
    if (results.length >= safeLimit) break;
    
    try {
      const searchUrl = engine.name === 'duckduckgo'
        ? `${engine.url}?q=${encodeURIComponent(trendingQuery)}`
        : `${engine.url}?q=${encodeURIComponent(trendingQuery)}&source=web`;
      
      const response = await proxyFetch(searchUrl, {
        headers: {
          'User-Agent': MOBILE_UA,
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeoutMs: 15000,
        maxRetries: 2,
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const extracted = extractTrendingFromHTML(html);
      
      for (const trend of extracted) {
        if (results.length >= safeLimit) break;
        if (!results.find(r => r.name === trend.name)) {
          results.push(trend);
        }
      }
    } catch (error) {
      console.error(`[TwitterX] Trending via ${engine.name} failed:`, error);
      continue;
    }
  }
  
  return results.slice(0, safeLimit);
}

/**
 * Get user profile
 */
export async function getTwitterXUserProfile(
  handle: string,
): Promise<TwitterUserProfile | null> {
  const cleanHandle = handle.replace(/^@/, '');
  
  try {
    const url = `https://x.com/${cleanHandle}`;
    
    const response = await proxyFetch(url, {
      headers: {
        'User-Agent': MOBILE_UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeoutMs: 15000,
      maxRetries: 2,
    });
    
    if (!response.ok) {
      console.error(`[TwitterX] Profile fetch failed: ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    return extractUserProfileFromHTML(html, cleanHandle);
  } catch (error) {
    console.error(`[TwitterX] Profile fetch error:`, error);
    return null;
  }
}

/**
 * Get user's recent tweets
 */
export async function getTwitterXUserTweets(
  handle: string,
  limit: number = 20,
): Promise<TwitterSearchResult[]> {
  const cleanHandle = handle.replace(/^@/, '');
  const query = `from:${cleanHandle}`;
  return searchTwitterX(query, { limit });
}

/**
 * Get thread by tweet ID
 */
export async function getTwitterXThread(
  tweetId: string,
): Promise<TwitterThreadResult | null> {
  try {
    const url = `https://x.com/i/status/${tweetId}`;
    
    const response = await proxyFetch(url, {
      headers: {
        'User-Agent': MOBILE_UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeoutMs: 15000,
      maxRetries: 2,
    });
    
    if (!response.ok) {
      console.error(`[TwitterX] Thread fetch failed: ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    return extractThreadFromHTML(html, tweetId);
  } catch (error) {
    console.error(`[TwitterX] Thread fetch error:`, error);
    return null;
  }
}

// ─── HTML Extraction Helpers ─────────────────────────

function extractTweetsFromHTML(html: string, query: string): TwitterSearchResult[] {
  const results: TwitterSearchResult[] = [];
  
  // Extract x.com/twitter.com URLs
  const urlRegex = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/g;
  let match;
  
  while ((match = urlRegex.exec(html)) !== null) {
    const handle = match[1];
    const tweetId = match[2];
    const url = `https://x.com/${handle}/status/${tweetId}`;
    
    // Try to extract surrounding text as tweet content
    const contextStart = Math.max(0, match.index - 200);
    const contextEnd = Math.min(html.length, match.index + 500);
    const context = html.substring(contextStart, contextEnd);
    
    // Extract text content (simplified)
    const textMatch = context.match(/>([^<]{10,280}?)</);
    const text = textMatch ? textMatch[1].trim() : 'Tweet content';
    
    // Extract hashtags
    const hashtags: string[] = [];
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    let hashtagMatch;
    while ((hashtagMatch = hashtagRegex.exec(text)) !== null) {
      hashtags.push(hashtagMatch[1]);
    }
    
    results.push({
      id: tweetId,
      author: {
        handle: `@${handle}`,
        name: handle,
        followers: null,
        verified: false,
      },
      text: cleanText(text),
      created_at: null,
      likes: null,
      retweets: null,
      replies: null,
      views: null,
      url,
      media: [],
      hashtags,
    });
  }
  
  return results;
}

function extractTrendingFromHTML(html: string): TwitterTrendingResult[] {
  const results: TwitterTrendingResult[] = [];
  
  // Look for trending topic patterns
  const patterns = [
    /trending[:\s]+([^<\n]{5,100})/gi,
    /twitter trends?[:\s]+([^<\n]{5,100})/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const name = cleanText(match[1]).trim();
      if (name.length > 3 && name.length < 100 && !results.find(r => r.name === name)) {
        results.push({
          name,
          tweet_count: null,
          category: null,
          url: null,
        });
      }
    }
  }
  
  return results;
}

function extractUserProfileFromHTML(html: string, handle: string): TwitterUserProfile | null {
  // Try to extract profile information
  const nameMatch = html.match(/<title[^>]*>([^<]+) \(@([a-zA-Z0-9_]+)\)/i);
  const bioMatch = html.match(/"description"[^>]*"[^"]*([^"]{10,160}[^"]*)"/i);
  
  // Extract follower count (simplified)
  const followersMatch = html.match(/(\d+(?:\.\d+)?[KMB]?)\s*[Ff]ollowers/i);
  const followingMatch = html.match(/(\d+(?:\.\d+)?[KMB]?)\s*[Ff]ollowing/i);
  
  return {
    handle: `@${handle}`,
    name: nameMatch ? nameMatch[1].trim() : handle,
    bio: bioMatch ? cleanText(bioMatch[1]) : null,
    location: null,
    website: null,
    joined: null,
    followers: followersMatch ? parseCount(followersMatch[1]) : null,
    following: followingMatch ? parseCount(followingMatch[1]) : null,
    tweets_count: null,
    verified: html.includes('verified') || html.includes('✓'),
    profile_image: null,
    banner_image: null,
  };
}

function extractThreadFromHTML(html: string, tweetId: string): TwitterThreadResult | null {
  const tweets: Array<{
    id: string;
    text: string;
    created_at: string | null;
    likes: number | null;
    retweets: number | null;
    replies: number | null;
  }> = [];
  
  // Extract main tweet
  const authorMatch = html.match(/<title[^>]*>([^<]+) \(@([a-zA-Z0-9_]+)\)/i);
  const authorHandle = authorMatch ? authorMatch[2] : 'unknown';
  const authorName = authorMatch ? authorMatch[1] : authorHandle;
  
  // Try to extract tweet text
  const textMatch = html.match(/<div[^>]*data-testid="tweetText"[^>]*>([^<]+(?:<[^>]*>[^<]*)*)<\/div>/i);
  const mainText = textMatch ? cleanText(textMatch[1]) : 'Tweet content';
  
  tweets.push({
    id: tweetId,
    text: mainText,
    created_at: null,
    likes: null,
    retweets: null,
    replies: null,
  });
  
  return {
    tweet_id: tweetId,
    author: {
      handle: `@${authorHandle}`,
      name: authorName,
    },
    tweets,
  };
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 280);
}

function parseCount(str: string): number | null {
  const multipliers: Record<string, number> = {
    'K': 1000,
    'M': 1000000,
    'B': 1000000000,
  };
  
  const match = str.match(/^([\d.]+)([KMB])?$/i);
  if (!match) return null;
  
  const num = parseFloat(match[1]);
  const mult = match[2] ? multipliers[match[2].toUpperCase()] : 1;
  
  return Math.round(num * mult);
}
