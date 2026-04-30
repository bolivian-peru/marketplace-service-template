
import { Service, Inject } from 'typedi';
import { Scraper } from '../types';
import { Browser } from 'puppeteer';

@Service()
export class AmazonTrackerService implements Scraper {
  constructor(@Inject('browser') private browser: Browser) {}

  public async scrape(asin: string): Promise<any> {
    const page = await this.browser.newPage();
    try {
      // Implement header rotation mocks here
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Connection': 'keep-alive',
      });

      await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'networkidle2' });

      const data = await page.evaluate(() => {
        const priceElement = document.querySelector('.a-price-whole');
        const ratingElement = document.querySelector('.a-icon-alt');
        const bsrElement = document.querySelector('#SalesRank span.value');

        const price = priceElement ? priceElement.textContent?.trim() : 'N/A';
        const rating = ratingElement ? ratingElement.textContent?.trim().split(' ')[0] : 'N/A';
        const bsr = bsrElement ? bsrElement.textContent?.trim() : 'N/A';

        return { price, rating, bsr };
      });
      return data;
    } catch (error) {
      console.error(`Error scraping Amazon for ASIN ${asin}:`, error);
      return null;
    } finally {
      await page.close();
    }
  }
}
