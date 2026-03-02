import axios from 'axios';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class InstagramService {
  private async fetchInstagramData(username: string, proxy: any) {
    const url = `https://www.instagram.com/${username}/`;
    
    const response = await axios.get(url, {
      proxy: {
        host: proxy.ip.split(':')[0],
        port: parseInt(proxy.ip.split(':')[1]),
        protocol: 'http'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive'
      }
    });

    const $ = cheerio.load(response.data);
    const scriptTag = $('script[type="application/ld+json"]').html();
    
    if (!scriptTag) {
      throw new Error('Could not find Instagram data');
    }

    const data = JSON.parse(scriptTag);
    return data;
  }

  private async extractProfileData(html: string) {
    const $ = cheerio.load(html);
    const sharedData = $('script').filter((i, el) => 
      $(el).html()?.includes('window._sharedData')
    ).html();
    
    if (!sharedData) return null;
    
    const jsonStr = sharedData.match(/window\._sharedData = ({.+});/)?.[1];
    if (!jsonStr) return null;
    
    const data = JSON.parse(jsonStr);
    const user = data.entry_data?.ProfilePage?.[0]?.graphql?.user;
    
    if (!user) return null;
    
    return {
      username: user.username,
      full_name: user.full_name,
      bio: user.biography,
      followers: user.edge_followed_by.count,
      following: user.edge_follow.count,
      posts_count: user.edge_owner_to_timeline_media.count,
      is_verified: user.is_verified,
      is_business: user.is_business_account,
      profile_pic_url: user.profile_pic_url_hd
    };
  }

  private async getRecentPosts(username: string, limit: number, proxy: any) {
    const url = `https://www.instagram.com/${username}/`;
    
    const response = await axios.get(url, {
      proxy: {
        host: proxy.ip.split(':')[0],
        port: parseInt(proxy.ip.split(':')[1]),
        protocol: 'http'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      }
    });

    const $ = cheerio.load(response.data);
    const sharedData = $('script').filter((i, el) => 
      $(el).html()?.includes('window._sharedData')
    ).html();
    
    if (!sharedData) return [];
    
    const jsonStr = sharedData.match(/window\._sharedData = ({.+});/)?.[1];
    if (!jsonStr) return [];
    
    const data = JSON.parse(jsonStr);
    const posts = data.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges || [];
    
    return posts.slice(0, limit).map((edge: any) => ({
      id: edge.node.id,
      shortcode: edge.node.shortcode,
      caption: edge.node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      likes: edge.node.edge_liked_by.count,
      comments: edge.node.edge_media_to_comment.count,
      timestamp: edge.node.taken_at_timestamp,
      image_url: edge.node.display_url,
      is_video: edge.node.is_video
    }));
  }

  private async analyzeImagesWithAI(images: string[], captions: string[]) {
    const imageUrls = images.slice(0, 12);
    
    const prompt = `Analyze these Instagram posts for:
    1. Content themes (travel, food, fashion, lifestyle, etc.)
    2. Content style (professional photography, casual, etc.)
    3. Account type (influencer, business, personal, bot/fake, meme_page, news_media)
    4. Sentiment from images and captions
    5. Authenticity signals (stock photos, face consistency, etc.)
    
    Return JSON with:
    {
      "content_themes": ["theme1", "theme2"],
      "content_style": "style",
      "account_type": "type",
      "niche": "specific niche",
      "confidence": 0.95,
      "brand_safety_score": 90,
      "sentiment": {"overall": "positive", "breakdown": {"positive": 70, "neutral": 20, "negative": 10}},
      "authenticity": {"score": 85, "fake_signals": {...}, "verdict": "authentic"}
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...imageUrls.map(url => ({
              type: "image_url" as const,
              image_url: { url }
            }))
          ]
        }
      ],
      max_tokens: 1000
    });

    return JSON.parse(response.choices[0].message.content || '{}');
  }

  private calculateEngagementRate(followers: number, avgLikes: number, avgComments: number) {
    return ((avgLikes + avgComments) / followers * 100).toFixed(2);
  }

  async getProfile(username: string, proxy: any) {
    const response = await axios.get(`https://www.instagram.com/${username}/`, {
      proxy: {
        host: proxy.ip.split(':')[0],
        port: parseInt(proxy.ip.split(':')[1]),
        protocol: 'http'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      }
    });

    const profile = await this.extractProfileData(response.data);
    if (!profile) throw new Error('Could not extract profile data');

    const posts = await this.getRecentPosts(username, 12, proxy);
    const avgLikes = posts.reduce((sum, p) => sum + p.likes, 0) / posts.length;
    const avgComments = posts.reduce((sum, p) => sum + p.comments, 0) / posts.length;
    const engagementRate = this.calculateEngagementRate(profile.followers, avgLikes, avgComments);

    return {
      profile: {
        ...profile,
        engagement_rate: parseFloat(engagementRate),
        avg_likes: Math.round(avgLikes),
        avg_comments: Math.round(avgComments),
        posting_frequency: `${(posts.length / 4).toFixed(1)} posts/week`
      }
    };
  }

  async getPosts(username: string, limit: number, proxy: any) {
    const posts = await this.getRecentPosts(username, limit, proxy);
    return { posts };
  }

  async analyzeAccount(username: string, proxy: any) {
    const startTime = Date.now();
    
    const profileData = await this.getProfile(username, proxy);
    const posts = await this.getRecentPosts(username, 12, proxy);
    
    const images = posts.filter(p => !p.is_video).map(p => p.image_url);
    const captions = posts.map(p => p.caption);
    
    const aiAnalysis = await this.analyzeImagesWithAI(images, captions);
    
    const estimatedPostValue = profileData.profile.followers > 100000 
      ? '$800-1200' 
      : profileData.profile.followers > 50000 
      ? '$400-600' 
      : '$100-300';

    return {
      profile: profileData.profile,
      ai_analysis: {
        ...aiAnalysis,
        images_analyzed: images.length,
        model_used: 'gpt-4o-vision'
      },
      recommendations: {
        good_for_brands: this.getBrandRecommendations(aiAnalysis.niche),
        estimated_post_value: estimatedPostValue,
        risk_level: aiAnalysis.authenticity?.score > 80 ? 'low' : 'medium'
      },
      meta: {
        proxy: {
          ip: proxy.ip,
          country: proxy.country || 'US',
          carrier: proxy.carrier || 'T-Mobile'
        },
        analysis_time_ms: Date.now() - startTime
      }
    };
  }

  async analyzeImages(username: string, proxy: any) {
    const posts = await this.getRecentPosts(username, 12, proxy);
    const images = posts.filter(p => !p.is_video).map(p => p.image_url);
    const captions = posts.map(p => p.caption);
    
    const analysis = await this.analyzeImagesWithAI(images, captions);
    
    return {
      images_analyzed: images.length,
      analysis
    };
  }

  async auditAccount(username: string, proxy: any) {
    const profileData = await this.getProfile(username, proxy);
    const posts = await this.getRecentPosts(username, 12, proxy);
    
    const images = posts.filter(p => !p.is_video).map(p => p.image_url);
    const aiAnalysis = await this.analyzeImagesWithAI(images, []);
    
    const followerGrowthPattern = this.analyzeFollowerGrowth(profileData.profile.followers, posts);
    const engagementQuality = this.analyzeEngagementQuality(posts, profileData.profile.followers);
    
    return {
      authenticity: {
        ...aiAnalysis.authenticity,
        follower_growth_pattern: followerGrowthPattern,
        engagement_quality: engagementQuality
      },
      profile: {
        username: profileData.profile.username,
        followers: profileData.profile.followers,
        following: profileData.profile.following,
        posts_count: profileData.profile.posts_count
      }
    };
  }

  async discoverAccounts(filters: any, proxy: any) {
    // This would typically search a database of pre-analyzed accounts
    // For now, return mock data structure
    const { niche, min_followers, account_type, sentiment, brand_safe } = filters;
    
    return {
      accounts: [],
      filters: { niche, min_followers, account_type, sentiment, brand_safe },
      total_results: 0
    };
  }

  private getBrandRecommendations(niche: string): string[] {
    const recommendations: { [key: string]: string[] } = {
      'travel_lifestyle': ['travel_agencies', 'hotels', 'airlines', 'camera_brands'],
      'fashion': ['clothing_brands', 'accessories', 'beauty', 'lifestyle'],
      'food': ['restaurants', 'food_brands', 'kitchenware', 'delivery_services'],
      'fitness': ['gym_wear', 'supplements', 'fitness_equipment', 'health_apps'],
      'tech': ['gadgets', 'software', 'apps', 'electronics']
    };
    
    return recommendations[niche] || ['general_brands'];
  }

  private analyzeFollowerGrowth(followers: number, posts: any[]) {
    // Simplified analysis - in real implementation would use historical data
    return followers > 10000 && posts.length > 100 ? 'natural' : 'unknown';
  }

  private analyzeEngagementQuality(posts: any[], followers: number) {
    const avgLikes = posts.reduce((sum, p) => sum + p.likes, 0) / posts.length;
    const engagementRate = (avgLikes / followers) * 100;
    
    if (engagementRate > 3) return 'high';
    if (engagementRate > 1.5) return 'medium';
    return 'low';
  }
}