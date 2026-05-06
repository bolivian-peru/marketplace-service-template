import * as cheerio from 'cheerio';

export interface BingNewsResult {
  title: string;
  source: string;
  time: string;
  link: string;
  snippet: string;
}

export async function searchBingNews(query: string): Promise<BingNewsResult[]> {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const results: BingNewsResult[] = [];

    $('item').each((_, el) => {
      const item = $(el);
      results.push({
        title: item.find('title').text(),
        source: item.find('source').text(),
        time: item.find('pubDate').text(),
        link: item.find('link').text(),
        snippet: item.find('description').text().substring(0, 150)
      });
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("Bing News Error:", e);
    return [];
  }
}
