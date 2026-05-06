import * as cheerio from 'cheerio';

export interface AmazonProduct {
  title: string;
  price: string;
  rating: string;
  reviews: string;
  link: string;
  image: string;
}

export async function searchAmazon(query: string, limit: number = 5): Promise<AmazonProduct[]> {
  try {
    // Using Amazon search with a standard User-Agent
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Amazon fetch failed: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: AmazonProduct[] = [];

    // Amazon structure changes frequently, targeting generic data-asin cards
    $('div[data-component-type="s-search-result"]').each((_, element) => {
      const titleEl = $(element).find('h2 a span');
      const priceEl = $(element).find('.a-price-whole');
      const ratingEl = $(element).find('.a-icon-alt');
      const reviewEl = $(element).find('[data-csa-c-func-deps="aui-da-a-popover"]');
      const imgEl = $(element).find('img.s-image');

      if (titleEl.length && priceEl.length) {
        const title = titleEl.text().trim();
        const price = '$' + priceEl.text().trim().replace(',', '.');
        const rating = ratingEl.text() || 'N/A';
        const reviews = reviewEl.text() || '';
        const link = 'https://www.amazon.com' + ($(element).find('h2 a').attr('href') || '');
        const image = imgEl.attr('src') || '';

        results.push({ title, price, rating, reviews, link, image });
      }
    });

    return results.slice(0, limit);
  } catch (error) {
    console.error("Amazon Scraper Error:", error);
    return [];
  }
}
