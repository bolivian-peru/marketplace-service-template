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

  // Perform AI analysis
  const aiAnalysis = performAIAnalysis(profileHtml);

  return { profile: profileData, ai_analysis: aiAnalysis };
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

  // Example extraction logic (to be replaced with actual parsing)
  profile.username = decodeHtmlEntities(html.match(/"username":"([^"]+)"/)?.[1] || '');
  profile.full_name = decodeHtmlEntities(html.match(/"full_name":"([^"]+)"/)?.[1] || '');
  profile.bio = decodeHtmlEntities(html.match(/"biography":"([^"]+)"/)?.[1] || '');
  profile.followers = parseInt(html.match(/"edge_followed_by":{"count":(\d+)}/)?.[1] || '0', 10);
  profile.following = parseInt(html.match(/"edge_follow":{"count":(\d+)}/)?.[1] || '0', 10);
  profile.posts_count = parseInt(html.match(/"edge_owner_to_timeline_media":{"count":(\d+)}/)?.[1] || '0', 10);
  profile.is_verified = html.includes('"is_verified":true');
  profile.is_business = html.includes('"is_business_account":true');

  // Placeholder values for engagement metrics
  profile.engagement_rate = 3.2;
  profile.avg_likes = 4000;
  profile.avg_comments = 120;
  profile.posting_frequency = '4.2 posts/week';

  return profile;
}

function performAIAnalysis(html: string): InstagramAIAnalysis {
  // Placeholder AI analysis
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