/**
 * TikTok Trend Intelligence — TypeScript Types
 */

// ─── VIDEO TYPES ─────────────────────────────────────

export interface TikTokAuthor {
  username: string;
  displayName: string;
  followers: number;
  following?: number;
  likes?: number;
  verified: boolean;
  bio?: string;
  avatar?: string;
}

export interface TikTokStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  bookmarks?: number;
}

export interface TikTokSound {
  id?: string;
  name: string;
  author: string;
  original: boolean;
  uses?: number;
}

export interface TikTokVideo {
  id: string;
  description: string;
  author: TikTokAuthor;
  stats: TikTokStats;
  sound: TikTokSound;
  hashtags: string[];
  createdAt: string;
  url: string;
  duration?: number;
  coverUrl?: string;
  region?: string;
}

// ─── HASHTAG TYPES ───────────────────────────────────

export interface TrendingHashtag {
  name: string;
  views: number;
  videosCount?: number;
  velocity: string;
  rank?: number;
}

// ─── SOUND TYPES ─────────────────────────────────────

export interface TrendingSound {
  id?: string;
  name: string;
  author: string;
  uses: number;
  velocity: string;
  rank?: number;
  link?: string;
}

// ─── CREATOR TYPES ───────────────────────────────────

export interface CreatorProfile {
  username: string;
  displayName: string;
  bio: string;
  followers: number;
  following: number;
  likes: number;
  videoCount: number;
  verified: boolean;
  engagementRate: number;
  avgViews: number;
  avgLikes: number;
  recentPosts: TikTokVideo[];
}

// ─── RESPONSE TYPES ──────────────────────────────────

export interface ProxyMeta {
  country: string;
  carrier?: string;
  type: 'mobile';
  ip?: string;
}

export interface PaymentMeta {
  txHash: string;
  network: 'solana' | 'base';
  amount?: number;
  verified: boolean;
}

export interface TrendingResponse {
  type: 'trending';
  country: string;
  timestamp: string;
  data: {
    videos: TikTokVideo[];
    trending_hashtags: TrendingHashtag[];
    trending_sounds: TrendingSound[];
  };
  proxy: ProxyMeta;
  payment: PaymentMeta;
}

export interface HashtagResponse {
  type: 'hashtag';
  tag: string;
  country: string;
  timestamp: string;
  data: {
    hashtag: TrendingHashtag;
    videos: TikTokVideo[];
    related_hashtags?: string[];
  };
  proxy: ProxyMeta;
  payment: PaymentMeta;
}

export interface CreatorResponse {
  type: 'creator';
  timestamp: string;
  data: CreatorProfile;
  proxy: ProxyMeta;
  payment: PaymentMeta;
}

export interface SoundResponse {
  type: 'sound';
  soundId: string;
  timestamp: string;
  data: {
    sound: TrendingSound;
    videos: TikTokVideo[];
  };
  proxy: ProxyMeta;
  payment: PaymentMeta;
}
