import { scrapeMobileSERP } from './src/scrapers/serp-tracker';
import * as dotenv from 'dotenv';

dotenv.config();

async function test() {
  try {
    const query = 'best laptop 2026';
    console.log(`Testing SERP scraper for query: ${query}`);
    const results = await scrapeMobileSERP(query);
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Test failed:', err);
  }
}

test();
