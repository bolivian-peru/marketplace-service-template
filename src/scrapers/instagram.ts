import { proxyFetch } from '../utils/proxy';
import { decodeHtmlEntities } from '../utils/helpers';

interface InstagramProfile {
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

interface InstagramAIAnalysis {
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
}

export async function analyzeInstagramProfile(username: string): Promise<{ profile: InstagramProfile; ai_analysis: InstagramAIAnalysis }> {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const profileResponse = await proxyFetch(profileUrl);
  const profileHtml = await profileResponse.text();

  // Extract profile data
  const profileData = extractProfileData(profileHtml);

  // Extract AI analysis data
  const aiAnalysisData = extractAIAnalysisData(profileHtml);

  return { profile: profileData, ai_analysis: aiAnalysisData };
}

function extractProfileData(html: string): InstagramProfile {
  const profile: InstagramProfile = {
    username: '',
    full_name: '',
    bio: '',
    followers: 0,
    following: 0,
    posts_count: 0,
    is_verified: false,
    is_business: false,
    engagement_rate: 0,
    avg_likes: 0,
    avg_comments: 0,
    posting_frequency: '',
  };

  // Example extraction logic (needs to be refined)
  const scriptPattern = /<script type="text\/javascript">window\._sharedData = (.*);<\/script>/;
  const match = html.match(scriptPattern);
  if (match) {
    const jsonData = JSON.parse(match[1]);
    const user = jsonData.entry_data.ProfilePage[0].graphql.user;
    profile.username = user.username;
    profile.full_name = user.full_name;
    profile.bio = user.biography;
    profile.followers = user.edge_followed_by.count;
    profile.following = user.edge_follow.count;
    profile.posts_count = user.edge_owner_to_timeline_media.count;
    profile.is_verified = user.is_verified;
    profile.is_business = user.is_business_account;
    // Additional fields like engagement_rate, avg_likes, avg_comments, posting_frequency need to be calculated
  }

  return profile;
}

function extractAIAnalysisData(html: string): InstagramAIAnalysis {
  // Placeholder for AI analysis extraction logic
  return {
    account_type: {
      primary: 'influencer',
      niche: 'travel_lifestyle',
      confidence: 0.94,
      sub_niches: ['luxury_travel', 'food_travel', 'photography'],
    },
    content_themes: ['lifestyle', 'travel', 'food', 'fashion'],
    content_style: 'professional_photography',
    brand_safety_score: 92,
    content_consistency: 'high',
    overall_sentiment: 'positive',
    sentiment_breakdown: {
      positive: 72,
      neutral: 20,
      negative: 8,
    },
    emotional_themes: ['aspirational', 'happy', 'adventurous'],
    brand_alignment: ['luxury', 'wellness', 'outdoor'],
    authenticity_score: 87,
    fake_signals: {
      stock_photo_detected: false,
      face_consistency: 'same_person_across_posts',
      engagement_vs_followers: 'healthy',
      comment_quality: 'organic',
      follower_growth_pattern: 'natural',
    },
    verdict: 'likely_authentic',
  };
}