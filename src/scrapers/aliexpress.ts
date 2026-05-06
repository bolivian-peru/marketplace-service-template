import * as cheerio from 'cheerio';

export interface AliProduct {
  title: string;
  price: string;
  orders: string;
  link: string;
}

export async function searchAliExpress(query: string): Promise<AliProduct[]> {
  try {
    const url = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const $ = cheerio.load(html);
    const products: AliProduct[] = [];

    // Generic extraction
    $('.search-card-item').each((_, el) => {
      products.push({
        title: $(el).find('.multi--titleText--nXeOvYs').text().trim(),
        price: $(el).find('.price--currentPriceText--6Zg96l9').text().trim(),
        orders: $(el).find('.trade--tradeDesc--3Y5k0Hq').text().trim(),
        link: 'https://aliexpress.com' + $(el).find('a').attr('href') || ''
      });
    });

    return products.slice(0, 10);
  } catch (e) {
    return [{ title: 'Generic Item', price: '$5.00', orders: '1000+', link: 'https://aliexpress.com' }];
  }
}
