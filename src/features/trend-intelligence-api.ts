import axios from 'axios';

interface TrendData {
  platform: string;
  data: any;
}

interface AggregatedData {
  trends: TrendData[];
  timestamp: string;
}

class TrendIntelligenceAPI {
  private static apiEndpoints = {
    twitter: 'https://api.twitter.com/2/tweets',
    reddit: 'https://www.reddit.com/r/{subreddit}/top.json',
    youtube: 'https://www.googleapis.com/youtube/v3/videos',
  };

  static async fetchTrends(platform: string, params: object): Promise<any> {
    const endpoint = this.apiEndpoints[platform];
    if (!endpoint) throw new Error('Platform not supported');

    try {
      const response = await axios.get(endpoint, { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching trend data:', error);
      throw new Error('Failed to fetch trend data');
    }
  }

  static async aggregateData(): Promise<AggregatedData> {
    const twitterTrends = await this.fetchTrends('twitter', { query: 'latest' });
    const redditTrends = await this.fetchTrends('reddit', { subreddit: 'popular' });
    const youtubeTrends = await this.fetchTrends('youtube', { part: 'snippet,statistics', chart: 'mostPopular' });

    const aggregated: AggregatedData = {
      trends: [
        { platform: 'Twitter', data: twitterTrends },
        { platform: 'Reddit', data: redditTrends },
        { platform: 'YouTube', data: youtubeTrends },
      ],
      timestamp: new Date().toISOString(),
    };

    return aggregated;
  }
}

export default TrendIntelligenceAPI;