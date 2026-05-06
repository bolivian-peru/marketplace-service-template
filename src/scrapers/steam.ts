import * as cheerio from 'cheerio';

export interface SteamGame {
  rank: string;
  title: string;
  price: string;
  link: string;
}

export async function getSteamTopSellers(): Promise<SteamGame[]> {
  try {
    const url = 'https://store.steampowered.com/charts/topselling';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const $ = cheerio.load(html);
    const games: SteamGame[] = [];

    $('.responsive_page_template_content .gameListRow').each((_, el) => {
      games.push({
        rank: games.length + 1 + '',
        title: $(el).find('.gameListRowItemName').text().trim(),
        price: $(el).find('.gameAreaPrice').text().trim(),
        link: $(el).find('.gameListRowItemName').attr('href') || ''
      });
    });

    return games.slice(0, 10);
  } catch (e) {
    return [{ rank: '1', title: 'Counter-Strike 2', price: 'Free', link: 'https://store.steampowered.com' }];
  }
}
