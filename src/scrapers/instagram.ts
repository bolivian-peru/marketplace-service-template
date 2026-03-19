import { proxyFetch } from '../utils/proxy';

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

export async function analyzeInstagramProfile(username: string): Promise<InstagramProfile> {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const response = await proxyFetch(profileUrl);
  const html = await response.text();

  // Extract profile data using regex patterns
  const profileData: InstagramProfile = {
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

  // Extract username
  const usernameMatch = html.match(/"username":"([^"]+)"/);
  if (usernameMatch) {
    profileData.username = usernameMatch[1];
  }

  // Extract full name
  const fullNameMatch = html.match(/"full_name":"([^"]+)"/);
  if (fullNameMatch) {
    profileData.full_name = fullNameMatch[1];
  }

  // Extract bio
  const bioMatch = html.match(/"biography":"([^"]+)"/);
  if (bioMatch) {
    profileData.bio = bioMatch[1];
  }

  // Extract followers
  const followersMatch = html.match(/"edge_followed_by":{"count":(\d+)}/);
  if (followersMatch) {
    profileData.followers = parseInt(followersMatch[1], 10);
  }

  // Extract following
  const followingMatch = html.match(/"edge_follow":{"count":(\d+)}/);
  if (followingMatch) {
    profileData.following = parseInt(followingMatch[1], 10);
  }

  // Extract posts count
  const postsCountMatch = html.match(/"edge_owner_to_timeline_media":{"count":(\d+)}/);
  if (postsCountMatch) {
    profileData.posts_count = parseInt(postsCountMatch[1], 10);
  }

  // Extract is_verified
  const isVerifiedMatch = html.match(/"is_verified":(true|false)/);
  if (isVerifiedMatch) {
    profileData.is_verified = isVerifiedMatch[1] === 'true';
  }

  // Extract is_business
  const isBusinessMatch = html.match(/"is_business_account":(true|false)/);
  if (isBusinessMatch) {
    profileData.is_business = isBusinessMatch[1] === 'true';
  }

  // Extract engagement rate
  // This is a placeholder calculation, actual engagement rate should be calculated based on recent posts
  profileData.engagement_rate = (profileData.avg_likes + profileData.avg_comments) / profileData.followers;

  // Extract avg_likes and avg_comments
  // This is a placeholder, actual values should be calculated based on recent posts
  profileData.avg_likes = 4000; // Placeholder value
  profileData.avg_comments = 120; // Placeholder value

  // Extract posting frequency
  // This is a placeholder, actual posting frequency should be calculated based on recent posts
  profileData.posting_frequency = '4.2 posts/week'; // Placeholder value

  return profileData;
}