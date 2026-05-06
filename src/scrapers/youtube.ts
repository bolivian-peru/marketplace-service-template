import * as cheerio from 'cheerio';

export interface YouTubeVideo {
  title: string;
  channel: string;
  views: string;
  link: string;
  thumbnail: string;
}

export async function getYouTubeTrending(): Promise<YouTubeVideo[]> {
  try {
    const url = 'https://www.youtube.com/feed/trending';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    if (!response.ok) throw new Error('YouTube fetch failed');

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: YouTubeVideo[] = [];

    // YouTube's structure is complex and often changes. 
    // We try to find the main video containers.
    $('ytd-video-renderer, .ytd-video-renderer').each((_, el) => {
      const titleEl = $(el).find('#video-title');
      const channelEl = $(el).find('#channel-name a');
      const viewsEl = $(el).find('#metadata-line span:first-child');
      const thumbEl = $(el).find('img#img');

      if (titleEl.length) {
        results.push({
          title: titleEl.text().trim(),
          channel: channelEl.text().trim(),
          views: viewsEl.text().trim(),
          link: 'https://youtube.com' + (titleEl.attr('href') || ''),
          thumbnail: thumbEl.attr('src') || ''
        });
      }
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("YT Error:", e);
    return [];
  }
}
