
import axios from 'axios';
import { TwitterResult } from '../types';

interface TwitterApiTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

interface TwitterApiUser {
  id: string;
  username: string;
}

interface TwitterApiResponse {
  data: TwitterApiTweet[];
  includes?: {
    users?: TwitterApiUser[];
  };
  meta: {
    newest_id: string;
    oldest_id: string;
    result_count: number;
    next_token?: string;
  };
}

export class TwitterSearchService {
  private bearerToken: string;
  private apiUrl: string;

  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN || '';
    if (!this.bearerToken) {
      throw new Error('TWITTER_BEARER_TOKEN environment variable is not set.');
    }
    this.apiUrl = 'https://api.twitter.com/2/tweets/search/recent';
  }

  public async search(query: string): Promise<TwitterResult[]> {
    try {
      const response = await axios.get<TwitterApiResponse>(this.apiUrl, {
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
        },
        params: {
          query: query,
          'tweet.fields': 'author_id,created_at,public_metrics',
          expansions: 'author_id',
        },
      });

      return this.parseTwitterResponse(response.data);
    } catch (error) {
      console.error('Error searching Twitter:', error);
      throw error;
    }
  }

  private parseTwitterResponse(response: TwitterApiResponse): TwitterResult[] {
    const users = response.includes?.users?.reduce((acc, user) => {
      acc[user.id] = user.username;
      return acc;
    }, {} as Record<string, string>) || {};

    return response.data.map(tweet => {
      const authorUsername = users[tweet.author_id] || null;
      const tweetUrl = `https://twitter.com/${authorUsername}/status/${tweet.id}`;

      return {
        tweetId: tweet.id,
        author: authorUsername,
        text: tweet.text,
        url: tweetUrl,
        likes: tweet.public_metrics.like_count,
        retweets: tweet.public_metrics.retweet_count,
        engagementScore: tweet.public_metrics.like_count + tweet.public_metrics.retweet_count,
        publishedAt: tweet.created_at,
        platform: 'twitter',
      };
    });
  }
}
