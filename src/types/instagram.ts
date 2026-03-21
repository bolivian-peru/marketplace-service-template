/**
 * Instagram Intelligence API — Type Definitions
 */

export interface InstagramProfile {
  username: string;
  full_name: string;
  bio: string;
  followers: number;
  following: number;
  posts_count: number;
  is_verified: boolean;
  is_business: boolean;
  is_private: boolean;
  profile_pic_url: string | null;
  external_url: string | null;
  category: string | null;
  engagement_rate: number;
  avg_likes: number;
  avg_comments: number;
  posting_frequency: string;
  follower_growth_signal: 'growing' | 'declining' | 'stagnant' | 'unknown';
  scraped_at: string;
}

export interface InstagramPost {
  id: string;
  shortcode: string;
  type: 'image' | 'video' | 'carousel' | 'reel';
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
  image_url: string | null;
  video_url: string | null;
  is_sponsored: boolean;
  hashtags: string[];
  mentions: string[];
}

export interface AIAccountType {
  primary: string;
  niche: string;
  confidence: number;
  sub_niches: string[];
  signals: string[];
}

export interface AIContentThemes {
  top_themes: string[];
  style: string;
  aesthetic_consistency: 'high' | 'medium' | 'low';
  brand_safety_score: number;
  content_consistency: 'high' | 'medium' | 'low';
}

export interface AISentiment {
  overall: 'positive' | 'neutral' | 'negative' | 'mixed';
  breakdown: {
    positive: number;
    neutral: number;
    negative: number;
  };
  emotional_themes: string[];
  brand_alignment: string[];
}

export interface AIAuthenticity {
  score: number;
  verdict: 'authentic' | 'likely_authentic' | 'suspicious' | 'likely_fake' | 'fake';
  face_consistency: boolean | null;
  engagement_pattern: 'organic' | 'inflated' | 'bot-like' | 'purchased' | 'unknown';
  follower_quality: 'high' | 'medium' | 'low' | 'unknown';
  comment_analysis: 'mostly_genuine' | 'mixed' | 'mostly_generic' | 'bot-like' | 'unknown';
  fake_signals: {
    stock_photo_detected: boolean;
    engagement_vs_followers: string;
    follower_growth_pattern: string;
    posting_pattern: string;
  };
}

export interface AIAnalysis {
  account_type: AIAccountType;
  content_themes: AIContentThemes;
  sentiment: AISentiment;
  authenticity: AIAuthenticity;
  images_analyzed: number;
  model_used: string;
}

export interface BrandRecommendations {
  good_for_brands: string[];
  estimated_post_value: string;
  risk_level: 'low' | 'medium' | 'high';
}

export interface FullAnalysisResult {
  profile: InstagramProfile;
  posts: InstagramPost[];
  ai_analysis: AIAnalysis;
  recommendations: BrandRecommendations;
}

export interface ImageAnalysisResult {
  username: string;
  images_analyzed: number;
  analysis: AIAnalysis;
}

export interface AuditResult {
  profile: InstagramProfile;
  authenticity: AIAuthenticity & {
    raw_signals: string[];
    engagement_analysis: {
      engagement_rate: number;
      expected_range: string;
      assessment: string;
    };
    follower_to_following_ratio: number;
    ratio_assessment: string;
  };
}
