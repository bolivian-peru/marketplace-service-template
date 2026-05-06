import * as cheerio from 'cheerio';

export interface CryptoPrice {
  symbol: string;
  name: string;
  price: string;
  change24h: string;
  marketCap: string;
}

export async function getCryptoMarket(): Promise<CryptoPrice[]> {
  try {
    // Using CoinMarketCap front page for scraping top cryptos
    const url = 'https://coinmarketcap.com/';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    if (!response.ok) throw new Error('CMC fetch failed');

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: CryptoPrice[] = [];

    // CoinMarketCap table structure
    $('table tr').each((_, el) => {
      const nameEl = $(el).find('p[class*="name___"] a');
      const priceEl = $(el).find('a[class*="price___"]');
      const changeEl = $(el).find('td span[class*="percentChange___"]');
      
      if (nameEl.length && priceEl.length) {
        results.push({
          name: nameEl.text().trim(),
          symbol: $(el).find('p[class*="symbol___"]').text().trim(),
          price: priceEl.text().trim(),
          change24h: changeEl.text().trim() || '0%',
          marketCap: $(el).find('span[class*="marketCap___"]').text().trim() || 'N/A'
        });
      }
    });
    return results.slice(0, 10);
  } catch (e) {
    console.error("Crypto Error:", e);
    return [];
  }
}
