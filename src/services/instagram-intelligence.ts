import { mockInstagramProfile, mockInstagramPosts } from './instagram-mock';

// Define the output schema for a Lead
export interface Lead {
  id: string;
  username: string;
  fullName: string;
  profilePictureUrl: string;
  bio: string;
  followers: number;
  following: number;
  postsCount: number;
  isVerified: boolean;
  isBusiness: boolean;
  category: string | null;
  externalUrl: string | null;
  engagementRate: number;
  averageLikes: number;
  averageComments: number;
  postingFrequency: string;
}

// Define the output schema for a Social Trend
export interface SocialTrend {
  keyword: string;
  type: 'hashtag' | 'keyword';
  posts: number;
  likes: number;
  comments: number;
}

// Parse an Instagram profile and format it as a Lead
export function parseInstagramProfile(username: string): Lead | null {
  const profile = mockInstagramProfile;
  if (!profile) return null;

  return {
    id: profile.username,
    username: profile.username,
    fullName: profile.full_name,
    profilePictureUrl: profile.profile_pic_url,
    bio: profile.bio,
    followers: profile.followers,
    following: profile.following,
    postsCount: profile.posts_count,
    isVerified: profile.is_verified,
    isBusiness: profile.is_business,
    category: profile.category,
    externalUrl: profile.external_url,
    engagementRate: profile.engagement_rate,
    averageLikes: profile.avg_likes,
    averageComments: profile.avg_comments,
    postingFrequency: profile.posting_frequency,
  };
}

// Identify social trends from Instagram posts
export function analyzeSocialTrends(username: string): SocialTrend[] {
  const posts = mockInstagramPosts;
  const trends: { [key: string]: SocialTrend } = {};

  for (const post of posts) {
    for (const hashtag of post.hashtags) {
      if (!trends[hashtag]) {
        trends[hashtag] = {
          keyword: hashtag,
          type: 'hashtag',
          posts: 0,
          likes: 0,
          comments: 0,
        };
      }
      trends[hashtag].posts++;
      trends[hashtag].likes += post.likes;
      trends[hashtag].comments += post.comments;
    }
  }

  return Object.values(trends);
}
