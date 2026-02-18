/**
 * TypeScript interfaces for Instagram Intelligence API
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

export interface VisionAnalysisResult {
  account_type: {
    primary: string;
    niche: string;
    confidence: number;
    sub_niches: string[];
    signals: string[];
  };
  content_themes: {
    content_themes: string[];
    content_style: string;
    brand_safety_score: number;
    content_consistency: string;
  };
  sentiment: {
    overall: string;
    breakdown: { positive: number; neutral: number; negative: number };
    emotional_themes: string[];
    brand_alignment: string[];
  };
  authenticity: {
    score: number;
    verdict: string;
    face_consistency: boolean | string;
    engagement_pattern: string;
    follower_quality: string;
    comment_analysis: string;
    fake_signals: {
      stock_photo_detected: boolean;
      engagement_vs_followers: string;
      follower_growth_pattern: string;
    };
  };
  images_analyzed: number;
  model_used: string;
  recommendations: {
    good_for_brands: string[];
    estimated_post_value: string;
    risk_level: string;
  };
}

export interface FullAnalysisResponse {
  profile: InstagramProfile;
  ai_analysis: VisionAnalysisResult;
  recent_posts: {
    caption: string;
    likes: number;
    comments: number;
    engagement_rate: number;
  }[];
  meta: {
    proxy: { ip: string | null; country: string; type: string };
    analysis_time_ms: number;
  };
}
