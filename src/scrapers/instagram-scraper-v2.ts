import axios from 'axios';
import { ProxyManager } from '../proxy';

interface InstagramPost {
  id: string;
  username: string;
  caption: string;
  imageUrl: string;
  timestamp: string;
}

export class InstagramScraper {
  private proxyManager: ProxyManager;

  constructor(proxyManager: ProxyManager) {
    this.proxyManager = proxyManager;
  }

  private async getInstagramData(url: string): Promise<InstagramPost[]> {
    const proxy = this.proxyManager.getProxy();
    try {
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        proxy: { host: proxy.host, port: proxy.port }
      });
      return this.extractPostData(response.data);
    } catch (error) {
      throw new Error('Error fetching Instagram data: ' + error.message);
    }
  }

  private extractPostData(data: string): InstagramPost[] {
    const posts: InstagramPost[] = [];
    // Logic to parse the HTML data and extract Instagram posts
    // This is a simplified version, you can enhance it based on real Instagram HTML structure
    const postRegex = /<div class="v1Nh3 kIKUG  _bz0w"><a href="(.*?)".*?title="(.*?)".*?<img src="(.*?)"/g;
    let match;
    while ((match = postRegex.exec(data)) !== null) {
      posts.push({
        id: match[1],
        username: match[2],
        caption: match[3],
        imageUrl: match[4],
        timestamp: new Date().toISOString(),
      });
    }
    return posts;
  }

  public async scrapeProfile(username: string): Promise<InstagramPost[]> {
    const url = `https://www.instagram.com/${username}/`;
    return await this.getInstagramData(url);
  }
}
