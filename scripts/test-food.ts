
import { scrapeUberEatsSearch, scrapeUberEatsRestaurant } from '../src/scrapers/food-scraper';

async function main() {
  console.log('--- Testing Uber Eats Search ---');
  try {
    // Test a known location and query
    const query = 'pizza';
    const address = 'New York, NY 10001';
    console.log(`Searching for "${query}" near "${address}"...`);

    // Attempt 1: Search
    const results = await scrapeUberEatsSearch(query, address);
    console.log(`Found ${results.length} results`);

    if (results.length > 0) {
      console.log('First result:', JSON.stringify(results[0], null, 2));

      console.log('\n--- Testing Restaurant Details ---');
      const firstStore = results[0];
      // ID might be URL or slug or ID. The scraper logic sets ID to slug/ID if possible.
      const storeId = firstStore.id;
      console.log('Fetching details for ID:', storeId);

      const details = await scrapeUberEatsRestaurant(storeId);
      console.log(`Details found for ${details.name}:`);
      console.log(`- Rating: ${details.rating} (${details.reviewCount} reviews)`);
      console.log(`- Menu items count: ${details.menu.length}`);

      if (details.menu.length > 0) {
        console.log('First menu item:', JSON.stringify(details.menu[0], null, 2));
      } else {
        console.log('No menu items found. Check JSON-LD parsing.');
      }
    } else {
      console.log('No results found. This might be due to anti-bot or parsing issues.');
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

main();
