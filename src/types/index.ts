/**
 * Trend Intelligence API — TypeScript Types
 */

export type Platform = 'reddit' | 'x' | 'youtube';

// ─── REDDIT ──────────────────────────────────────────

export interface RedditPost {
  platform: 'reddit';
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
  url: string;
  selftext?: string;
  flair?: string | null;
  // Engagement weight for cross-platform scoring
  engagementScore: number;
}

// ─── X / TWITTER ─────────────────────────────────────

export interface XPost {
  platform: 'x';
  id: string;
  author: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  createdAt: string;
  url: string;
  engagementScore: number;
}

export interface XTrend {
  name: string;
  tweetVolume: number | null;
  url: string;
}

// ─── YOUTUBE ─────────────────────────────────────────

export interface YouTubeVideo {
  platform: 'youtube';
  id: string;
  title: string;
  channelTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  url: string;
  description?: string;
  engagementScore: number;
}

// ─── CROSS-PLATFORM EVIDENCE ─────────────────────────

export type Evidence = RedditPost | XPost | YouTubeVideo;

// ─── PATTERN DETECTION ───────────────────────────────

export type SignalStrength = 'established' | 'reinforced' | 'emerging';

export interface TrendPattern {
  pattern: string;
  strength: SignalStrength;
  sources: Platform[];
  evidence: Evidence[];
  totalEngagement: number;
}

// ─── SENTIMENT ───────────────────────────────────────

export interface PlatformSentiment {
  positive: number;
  neutral: number;
  negative: number;
  sampleSize: number;
}

export interface SentimentResult {
  overall: 'positive' | 'neutral' | 'negative' | 'mixed';
  by_platform: Partial<Record<Platform, PlatformSentiment>>;
}

// ─── RESEARCH REPORT ─────────────────────────────────

export interface ResearchReport {
  topic: string;
  timeframe: string;
  patterns: TrendPattern[];
  sentiment: SentimentResult;
  top_discussions: Evidence[];
  emerging_topics: string[];
  meta: {
    sources_checked: number;
    platforms_used: Platform[];
    query_time_ms: number;
    proxy: {
      ip: string;
      country: string;
      carrier?: string;
    };
    payment?: {
      txHash: string;
      network: string;
      amount: number;
      settled: boolean;
    };
  };
}

// ─── TRENDING RESPONSE ───────────────────────────────

export interface TrendingResponse {
  country: string;
  platforms: Platform[];
  trends: Array<{
    topic: string;
    platforms: Platform[];
    volume: number;
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
    samplePost?: Evidence;
  }>;
  meta: {
    fetched_at: string;
    proxy: { ip: string; country: string };
    payment?: {
      txHash: string;
      network: string;
      amount: number;
      settled: boolean;
    };
  };
}
