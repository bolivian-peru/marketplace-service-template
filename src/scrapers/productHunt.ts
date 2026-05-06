import * as cheerio from 'cheerio';

export interface PHPost {
  title: string;
  tagline: string;
  votes: string;
  comments: string;
  link: string;
}

export async function getProductHuntTrending(): Promise<PHPost[]> {
  try {
    const url = 'https://www.producthunt.com/';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    if (!response.ok) throw new Error('PH fetch failed');

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: PHPost[] = [];

    $('a[data-test="homepage-post-item"]').each((_, el) => {
      const titleEl = $(el).find('[class*="styles_postTitle__"]');
      const taglineEl = $(el).find('[class*="styles_tagline__"]');
      const votesEl = $(el).find('[class*="styles_votesCount__"]');
      
      if (titleEl.length) {
        results.push({
          title: titleEl.text().trim(),
          tagline: taglineEl.text().trim() || '',
          votes: votesEl.text().trim() || '0',
          comments: '0',
          link: 'https://producthunt.com' + ($(el).attr('href') || '')
        });
      }
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("PH Error:", e);
    return [];
  }
}
