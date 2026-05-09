/**
 * Social Intel Scraper
 * Aggregates data from Twitter/X, Reddit, and other social platforms
 * with sentiment analysis and engagement metrics.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ─────────────────────────────────────────────

export interface SocialPost {
  id: string;
  platform: 'twitter' | 'reddit' | 'combined';
  author: string | null;
  text: string;
  url: string;
  likes: number | null;
  retweets: number | null;
  comments: number | null;
  score: number | null;
  engagementScore: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  publishedAt: string | null;
  hashtags: string[];
  mentions: string[];
}

export interface SocialIntelResult {
  query: string;
  posts: SocialPost[];
  summary: {
    totalPosts: number;
    twitterCount: number;
    redditCount: number;
    avgEngagement: number;
    sentimentBreakdown: {
      positive: number;
      negative: number;
      neutral: number;
    };
    topHashtags: Array<{ tag: string; count: number }>;
    trendingTopics: string[];
  };
  timestamp: string;
}

// ─── SENTIMENT ANALYSIS ─────────────────────────────────

const POSITIVE_WORDS = [
  'good', 'great', 'awesome', 'amazing', 'excellent', 'love', 'best', 'happy',
  'wonderful', 'fantastic', 'beautiful', 'perfect', 'brilliant', 'outstanding',
  'superb', 'terrific', 'magnificent', 'incredible', 'nice', 'enjoy', 'excited',
  'impressive', 'quality', 'recommend', 'success', 'win', 'gains', 'profit',
  'bullish', 'moon', 'pump', 'hold', 'hodl', 'diamond hands', 'yolo'
];

const NEGATIVE_WORDS = [
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'sad', 'angry',
  'scam', 'rug', 'rugpull', 'dump', 'crash', 'fail', 'lose', 'loss', 'fear',
  'panic', 'sell', 'bearish', 'overpriced', 'expensive', 'fake', 'fraud',
  'sucks', 'broken', 'bug', 'error', 'hack', 'exploit', 'warning', 'avoid',
  'regret', 'trash', 'garbage', 'waste', 'mistake', 'wrong', 'danger'
];

function analyzeSentiment(text: string): { sentiment: 'positive' | 'negative' | 'neutral'; score: number } {
  const lower = text.toLowerCase();
  let score = 0;
  
  for (const word of POSITIVE_WORDS) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of NEGATIVE_WORDS) {
    if (lower.includes(word)) score -= 1;
  }
  
  // Normalize score to -1 to 1 range
  const normalizedScore = Math.max(-1, Math.min(1, score / 10));
  
  if (normalizedScore > 0.1) return { sentiment: 'positive', score: normalizedScore };
  if (normalizedScore < -0.1) return { sentiment: 'negative', score: normalizedScore };
  return { sentiment: 'neutral', score: normalizedScore };
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#\w+/g) || [];
  const set = new Set(matches.map(h => h.toLowerCase()));
  return Array.from(set).slice(0, 10);
}

function extractMentions(text: string): string[] {
  const matches = text.match(/@\w+/g) || [];
  const set = new Set(matches.map(m => m.toLowerCase()));
  return Array.from(set).slice(0, 10);
}

// ─── TWITTER SCRAPER ────────────────────────────────────

const SEARXNG_BASE = 'http://100.91.53.54:8890';
const TIMEOUT_MS = 15_000;
const BOT_UA = 'SocialIntelBot/1.0';

async function searchTwitter(topic: string, limit: number = 20): Promise<SocialPost[]> {
  const queries = [
    `site:x.com ${topic}`,
    `site:twitter.com ${topic}`,
  ];
  
  const collected: SocialPost[] = [];
  
  for (const q of queries) {
    if (collected.length >= limit) break;
    
    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(q)}&format=json&engines=google,bing,duckduckgo`;
    
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
      });
      
      if (!res.ok) continue;
      
      const payload = await res.json() as { results?: any[] };
      const results = Array.isArray(payload?.results) ? payload.results : [];
      
      for (const item of results) {
        if (collected.length >= limit) break;
        if (!item || typeof item !== 'object') continue;
        
        const url = (item.url as string) || '';
        if (!url.includes('x.com') && !url.includes('twitter.com')) continue;
        
        const text = ((item.title as string) || '') + ' ' + ((item.content as string) || '');
        if (!text.trim()) continue;
        
        const sentiment = analyzeSentiment(text);
        const hashtags = extractHashtags(text);
        const mentions = extractMentions(text);
        
        // Extract tweet ID and author from URL
        const tweetMatch = url.match(/\/status\/(\d+)/);
        const authorMatch = url.match(/\/(?:i\/|)([a-zA-Z0-9_]+)\/status/);
        
        collected.push({
          id: tweetMatch ? tweetMatch[1] : `tw_${collected.length}`,
          platform: 'twitter',
          author: authorMatch ? `@${authorMatch[1]}` : null,
          text: text.slice(0, 500),
          url: url.slice(0, 2048),
          likes: null,
          retweets: null,
          comments: null,
          score: null,
          engagementScore: (item.score as number) || 50,
          sentiment: sentiment.sentiment,
          sentimentScore: sentiment.score,
          publishedAt: (item.publishedDate as string) || null,
          hashtags,
          mentions,
        });
      }
    } catch {
      continue;
    }
  }
  
  // Deduplicate
  const seen = new Set<string>();
  return collected.filter(p => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  }).slice(0, limit);
}

// ─── REDDIT SCRAPER ─────────────────────────────────────

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function searchReddit(topic: string, limit: number = 20): Promise<SocialPost[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=top&t=month&limit=${limit}&include_over_18=false`;
  
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json' },
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const children = data?.data?.children || [];
    
    return children.map((child: any, idx: number): SocialPost => {
      const post = child.data;
      const text = (post.title || '') + ' ' + (post.selftext || '');
      const sentiment = analyzeSentiment(text);
      const hashtags = extractHashtags(text);
      const mentions = extractMentions(text);
      
      return {
        id: post.id || `reddit_${idx}`,
        platform: 'reddit',
        author: post.author ? `u/${post.author}` : null,
        text: text.slice(0, 500),
        url: `https://reddit.com${post.permalink || ''}`,
        likes: null,
        retweets: null,
        comments: post.num_comments || 0,
        score: post.score || 0,
        engagementScore: Math.min((post.score || 0) / 10, 100),
        sentiment: sentiment.sentiment,
        sentimentScore: sentiment.score,
        publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
        hashtags,
        mentions,
      };
    }).slice(0, limit);
  } catch {
    return [];
  }
}

// ─── TRENDING TOPICS ────────────────────────────────────

async function getTrendingTopics(limit: number = 10): Promise<string[]> {
  // Try to get trending from Reddit
  try {
    const res = await fetch('https://www.reddit.com/r/popular/hot.json?limit=25', {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json' },
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const children = data?.data?.children || [];
    
    const topics: string[] = [];
    for (const child of children) {
      const title = (child.data?.title || '') as string;
      // Extract keywords (filter short words and common stop words)
      const words = title.split(/\s+/)
        .filter(w => w.length > 4 && !/^(the|this|that|with|from|have|will|been|would|could|should|about|into|over|after|more|than|then|they|what|when|where|which|their|there|here|some|these|those|other|into|also|just|only|very)/i.test(w))
        .map(w => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
      
      topics.push(...words);
    }
    
    // Count frequency and return top topics
    const counts = new Map<string, number>();
    for (const t of topics) {
      if (t.length > 3) counts.set(t, (counts.get(t) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([topic]) => topic);
  } catch {
    return [];
  }
}

// ─── MAIN AGGREGATOR ─────────────────────────────────────

export async function getSocialIntel(
  query: string,
  twitterLimit: number = 20,
  redditLimit: number = 20,
): Promise<SocialIntelResult> {
  const sanitizedQuery = query.slice(0, 200).trim();
  
  // Fetch from both platforms in parallel
  const [twitterPosts, redditPosts] = await Promise.all([
    searchTwitter(sanitizedQuery, twitterLimit),
    searchReddit(sanitizedQuery, redditLimit),
  ]);
  
  // Combine and deduplicate
  const allPosts = [...twitterPosts, ...redditPosts];
  const seen = new Set<string>();
  const uniquePosts = allPosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  
  // Sort by engagement score
  uniquePosts.sort((a, b) => b.engagementScore - a.engagementScore);
  
  // Calculate summary
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  const hashtagCounts = new Map<string, number>();
  
  for (const post of uniquePosts) {
    sentimentCounts[post.sentiment]++;
    for (const tag of post.hashtags) {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    }
  }
  
  const topHashtags = Array.from(hashtagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));
  
  const trendingTopics = topHashtags.slice(0, 5).map(t => t.tag);
  
  const totalPosts = uniquePosts.length;
  const avgEngagement = totalPosts > 0
    ? uniquePosts.reduce((sum, p) => sum + p.engagementScore, 0) / totalPosts
    : 0;
  
  return {
    query: sanitizedQuery,
    posts: uniquePosts.slice(0, twitterLimit + redditLimit),
    summary: {
      totalPosts,
      twitterCount: twitterPosts.length,
      redditCount: redditPosts.length,
      avgEngagement: Math.round(avgEngagement * 100) / 100,
      sentimentBreakdown: {
        positive: sentimentCounts.positive,
        negative: sentimentCounts.negative,
        neutral: sentimentCounts.neutral,
      },
      topHashtags,
      trendingTopics,
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── USER PROFILE LOOKUP ─────────────────────────────────

export interface SocialProfile {
  platform: 'twitter' | 'reddit';
  username: string;
  recentPosts: SocialPost[];
  stats: {
    totalPosts: number;
    avgEngagement: number;
    sentimentBreakdown: { positive: number; negative: number; neutral: number };
  };
}

export async function getTwitterProfile(username: string): Promise<SocialProfile | null> {
  const posts = await searchTwitter(`from:${username.replace('@', '')}`, 25);
  if (posts.length === 0) return null;
  
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  for (const p of posts) sentimentCounts[p.sentiment]++;
  
  return {
    platform: 'twitter',
    username: username.startsWith('@') ? username : `@${username}`,
    recentPosts: posts,
    stats: {
      totalPosts: posts.length,
      avgEngagement: posts.reduce((s, p) => s + p.engagementScore, 0) / posts.length,
      sentimentBreakdown: sentimentCounts,
    },
  };
}

export async function getRedditUser(username: string): Promise<SocialProfile | null> {
  const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?sort=top&limit=25`;
  
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json' },
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const children = data?.data?.children || [];
    
    const posts: SocialPost[] = children.map((child: any, idx: number) => {
      const post = child.data;
      const text = (post.title || '') + ' ' + (post.selftext || '');
      const sentiment = analyzeSentiment(text);
      
      return {
        id: post.id || `reddit_${idx}`,
        platform: 'reddit',
        author: `u/${post.author || username}`,
        text: text.slice(0, 500),
        url: `https://reddit.com${post.permalink || ''}`,
        likes: null,
        retweets: null,
        comments: post.num_comments || 0,
        score: post.score || 0,
        engagementScore: Math.min((post.score || 0) / 10, 100),
        sentiment: sentiment.sentiment,
        sentimentScore: sentiment.score,
        publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
        hashtags: extractHashtags(text),
        mentions: extractMentions(text),
      };
    });
    
    if (posts.length === 0) return null;
    
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    for (const p of posts) sentimentCounts[p.sentiment]++;
    
    return {
      platform: 'reddit',
      username: `u/${username}`,
      recentPosts: posts,
      stats: {
        totalPosts: posts.length,
        avgEngagement: posts.reduce((s, p) => s + p.engagementScore, 0) / posts.length,
        sentimentBreakdown: sentimentCounts,
      },
    };
  } catch {
    return null;
  }
}

// ─── TRENDING ────────────────────────────────────────────

export interface TrendingResult {
  topics: Array<{ topic: string; postCount: number; sentiment: 'positive' | 'negative' | 'neutral' }>;
  timestamp: string;
}

export async function getTrendingTopicsAnalysis(limit: number = 10): Promise<TrendingResult> {
  const trending = await getTrendingTopics(limit * 2);
  
  // For each trending topic, get sentiment
  const topics: TrendingResult['topics'] = [];
  
  for (const topic of trending.slice(0, limit)) {
    const posts = await searchReddit(topic, 10);
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    for (const p of posts) sentimentCounts[p.sentiment]++;
    
    const dominant = sentimentCounts.positive > sentimentCounts.negative && sentimentCounts.positive > sentimentCounts.neutral
      ? 'positive'
      : sentimentCounts.negative > sentimentCounts.positive && sentimentCounts.negative > sentimentCounts.neutral
        ? 'negative'
        : 'neutral';
    
    topics.push({
      topic,
      postCount: posts.length,
      sentiment: dominant,
    });
  }
  
  return {
    topics,
    timestamp: new Date().toISOString(),
  };
}
