import * as cheerio from 'cheerio';

export interface IMDBResult {
  title: string;
  year: string;
  rating: string;
  link: string;
  image: string;
}

export async function searchIMDB(query: string): Promise<IMDBResult[]> {
  try {
    const url = `https://www.imdb.com/find/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: IMDBResult[] = [];

    // IMDb uses various selectors, try generic ones
    $('.findList .findResult').each((_, el) => {
      const linkEl = $(el).find('.result_text a');
      const imgEl = $(el).find('.primary_photo img');
      results.push({
        title: linkEl.text().trim(),
        year: $(el).find('.result_text .text-muted').text().trim(),
        rating: $(el).find('.ipl-rating-star__rating').text().trim() || 'N/A',
        link: 'https://www.imdb.com' + linkEl.attr('href'),
        image: imgEl.attr('src') || ''
      });
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("IMDB Error:", e);
    return [];
  }
}
