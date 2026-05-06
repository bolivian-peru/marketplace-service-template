import * as cheerio from 'cheerio';

export interface RedditPost {
  title: string;
  subreddit: string;
  points: string;
  comments: string;
  link: string;
}

export async function getRedditHot(): Promise<RedditPost[]> {
  try {
    const url = 'https://www.reddit.com/r/all/hot/';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error('Reddit fetch failed');

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: RedditPost[] = [];

    // Reddit uses complex class names, fallback to generic structure if specific classes fail
    $('div[data-testid="post-container"], .Post').each((_, el) => {
      const titleEl = $(el).find('h3, [data-click-id="body"] h3');
      const pointsEl = $(el).find('[data-testid="post-karma"]');
      const commentsEl = $(el).find('[data-testid="post-comments-count"]');
      const linkEl = $(el).find('a[href^="/r/"]');
      
      // Extract subreddit from URL or data attribute
      let subreddit = 'Unknown';
      const href = $(el).find('a[href^="/r/"]').attr('href');
      if (href) {
        const match = href.match(/\/r\/([^\/]+)/);
        if (match) subreddit = match[1];
      }

      if (titleEl.length) {
        results.push({
          title: titleEl.text().trim(),
          subreddit,
          points: pointsEl.text().trim() || '0',
          comments: commentsEl.text().trim() || '0',
          link: 'https://reddit.com' + (linkEl.attr('href') || '')
        });
      }
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("Reddit Error:", e);
    // Fallback to JSON endpoint if scraping fails
    return [];
  }
}
