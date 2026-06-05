export interface InstagramProfile {
  username: string;
  full_name: string;
  bio: string;
  followers: number;
  following: number;
  posts_count: number;
  is_verified: boolean;
  is_business: boolean;
  engagement_rate: number;
  avg_likes: number;
  avg_comments: number;
  posting_frequency: string;
}

export interface InstagramPost {
  id: string;
  image_url: string;
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
}

export interface InstagramAnalysis {
  profile: InstagramProfile;
  ai_analysis: {
    account_type: {
      primary: string;
      niche: string;
      confidence: number;
      sub_niches: string[];
    };
    content_themes: string[];
    content_style: string;
    brand_safety_score: number;
    content_consistency: string;
    overall_sentiment: string;
    sentiment_breakdown: {
      positive: number;
      neutral: number;
      negative: number;
    };
    emotional_themes: string[];
    brand_alignment: string[];
    authenticity_score: number;
    fake_signals: {
      stock_photo_detected: boolean;
      face_consistency: string;
      engagement_vs_followers: string;
      comment_quality: string;
      follower_growth_pattern: string;
    };
    verdict: string;
  };
}