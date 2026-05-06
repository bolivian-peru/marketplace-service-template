export interface TweetResult {
  user: string;
  handle: string;
  text: string;
  likes: number;
  retweets: number;
  link: string;
}

// Scraping trending tweets or search results from X (via Nitter RSS fallback or direct JSON)
export async function searchX(query: string, limit: number = 10): Promise<TweetResult[]> {
  try {
    // Using a generic public Nitter instance RSS feed for X data (No API Key needed)
    const nitterInstance = 'https://nitter.privacydev.net';
    const rssUrl = `${nitterInstance}/search?f=tweets&q=${encodeURIComponent(query)}`;
    
    const response = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!response.ok) {
      throw new Error(`Nitter fetch failed: ${response.statusText}`);
    }

    const xml = await response.text();
    const results: TweetResult[] = [];
    
    // Simple XML parsing for RSS <item>
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    
    for (const item of items.slice(0, limit)) {
      const titleMatch = item.match(/<title>(.*?)<\/title>/s);
      const authorMatch = item.match(/<author>(.*?)\s\((.*?)\)<\/author>/);
      const statsMatch = item.match(/(\d+)\s*Likes.*?(\d+)\s*Retweets/s);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const contentMatch = item.match(/<content:encoded>(.*?)<\/content:encoded>/s);

      if (titleMatch && linkMatch) {
        let text = titleMatch[1].replace(`${authorMatch ? authorMatch[1] : ''}: `, '').trim();
        // Clean up HTML entities
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

        results.push({
          user: authorMatch?.[1] || 'Unknown',
          handle: authorMatch?.[2] || '@unknown',
          text: text,
          likes: parseInt(statsMatch?.[1] || '0'),
          retweets: parseInt(statsMatch?.[2] || '0'),
          link: linkMatch[1]
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error("X Scraper Error:", error);
    return [];
  }
}
