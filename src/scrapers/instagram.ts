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

interface InstagramAnalysis {
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

export async function analyzeInstagramProfile(username: string): Promise<InstagramAnalysis> {
  const profileResponse = await proxyFetch(`https://www.instagram.com/${username}/?__a=1`);
  const profileData = await profileResponse.json();

  const profile = profileData.graphql.user;

  const engagementRate = (profile.edge_owner_to_timeline_media.edges.reduce((sum, post) => sum + post.node.edge_media_to_comment.count + post.node.edge_liked_by.count, 0) / profile.edge_followed_by.count) || 0;
  const avgLikes = profile.edge_owner_to_timeline_media.edges.reduce((sum, post) => sum + post.node.edge_liked_by.count, 0) / profile.edge_owner_to_timeline_media.edges.length || 0;
  const avgComments = profile.edge_owner_to_timeline_media.edges.reduce((sum, post) => sum + post.node.edge_media_to_comment.count, 0) / profile.edge_owner_to_timeline_media.edges.length || 0;
  const postingFrequency = `${profile.edge_owner_to_timeline_media.edges.length / (profile.edge_owner_to_timeline_media.edges[0].node.taken_at_timestamp - profile.edge_owner_to_timeline_media.edges[profile.edge_owner_to_timeline_media.edges.length - 1].node.taken_at_timestamp) * 604800} posts/week`;

  const instagramProfile: InstagramProfile = {
    username: profile.username,
    full_name: profile.full_name,
    bio: profile.biography,
    followers: profile.edge_followed_by.count,
    following: profile.edge_following.count,
    posts_count: profile.edge_owner_to_timeline_media.count,
    is_verified: profile.is_verified,
    is_business: profile.is_business_account,
    engagement_rate: engagementRate,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    posting_frequency: postingFrequency,
  };

  const aiAnalysis = {
    account_type: {
      primary: 'influencer', // Placeholder for AI analysis
      niche: 'travel_lifestyle', // Placeholder for AI analysis
      confidence: 0.94, // Placeholder for AI analysis
      sub_niches: ['luxury_travel', 'food_travel', 'photography'], // Placeholder for AI analysis
    },
    content_themes: ['lifestyle', 'travel', 'food'], // Placeholder for AI analysis
    content_style: 'professional_photography', // Placeholder for AI analysis
    brand_safety_score: 92, // Placeholder for AI analysis
    content_consistency: 'high', // Placeholder for AI analysis
    overall_sentiment: 'positive', // Placeholder for AI analysis
    sentiment_breakdown: {
      positive: 72, // Placeholder for AI analysis
      neutral: 20, // Placeholder for AI analysis
      negative: 8, // Placeholder for AI analysis
    },
    emotional_themes: ['aspirational', 'happy', 'adventurous'], // Placeholder for AI analysis
    brand_alignment: ['luxury', 'wellness', 'outdoor'], // Placeholder for AI analysis
    authenticity_score: 87, // Placeholder for AI analysis
    fake_signals: {
      stock_photo_detected: false, // Placeholder for AI analysis
      face_consistency: 'same_person_across_posts', // Placeholder for AI analysis
      engagement_vs_followers: 'healthy', // Placeholder for AI analysis
      comment_quality: 'organic', // Placeholder for AI analysis
      follower_growth_pattern: 'natural', // Placeholder for AI analysis
    },
    verdict: 'likely_authentic', // Placeholder for AI analysis
  };

  return {
    profile: instagramProfile,
    ai_analysis: aiAnalysis,
  };
}