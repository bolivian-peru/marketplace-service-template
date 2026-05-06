import * as cheerio from 'cheerio';

export interface SOQuestion {
  title: string;
  votes: string;
  answers: string;
  views: string;
  link: string;
  tags: string[];
}

export async function searchStackOverflow(query: string): Promise<SOQuestion[]> {
  try {
    const url = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SOQuestion[] = [];

    $('.search-results .s-post-summary').each((_, el) => {
      const linkEl = $(el).find('a.s-link');
      const stats = $(el).find('.s-post-summary--stats-item');
      results.push({
        title: linkEl.text().trim(),
        votes: stats.eq(0).text().trim(),
        answers: stats.eq(1).text().trim(),
        views: stats.eq(2)?.text().trim() || 'N/A',
        link: 'https://stackoverflow.com' + linkEl.attr('href'),
        tags: $(el).find('.post-tag').toArray().map(t => $(t).text().trim())
      });
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("SO Error:", e);
    return [];
  }
}
