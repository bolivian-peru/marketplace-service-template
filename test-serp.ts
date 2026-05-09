/**
 * Test script for SERP Tracker service
 * Tests proxy connection and scraping functionality
 */

import { proxyFetch, getProxy } from './src/proxy';
import { scrapeMobileSERP } from './src/scrapers/serp-tracker';

async function testProxy() {
  console.log('Testing proxy connection...');
  const proxy = getProxy();
  console.log(`Proxy: ${proxy.host}:${proxy.port}`);
  console.log(`User: ${proxy.user}`);
  console.log(`Country: ${proxy.country}`);
  
  try {
    // Test IP check
    console.log('\nFetching exit IP...');
    const response = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 15000,
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`Exit IP: ${data.ip}`);
    } else {
      console.log(`IP check failed: ${response.status}`);
    }
  } catch (err) {
    console.log(`Proxy test failed: ${err}`);
  }
}

async function testSERP() {
  console.log('\nTesting SERP scrape...');
  try {
    const result = await scrapeMobileSERP('coffee shops near me', 'us', 'en', 'New York');
    console.log(`\nResults:`);
    console.log(`- Organic: ${result.organic.length}`);
    console.log(`- Ads: ${result.ads.length}`);
    console.log(`- PAA: ${result.peopleAlsoAsk.length}`);
    console.log(`- Map Pack: ${result.mapPack.length}`);
    console.log(`- Featured Snippet: ${result.featuredSnippet ? 'yes' : 'no'}`);
    console.log(`- AI Overview: ${result.aiOverview ? 'yes' : 'no'}`);
    console.log(`- Related Searches: ${result.relatedSearches.length}`);
    console.log(`- Total Results: ${result.totalResults}`);
    
    if (result.organic.length > 0) {
      console.log('\nTop 3 organic results:');
      result.organic.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.title}`);
        console.log(`     URL: ${r.url}`);
        console.log(`     Snippet: ${r.snippet.substring(0, 100)}...`);
      });
    }
  } catch (err: any) {
    console.log(`SERP test failed: ${err.message}`);
  }
}

// Run tests
(async () => {
  console.log('=== SERP Tracker Service Test ===\n');
  await testProxy();
  await testSERP();
  console.log('\n=== Test Complete ===');
  process.exit(0);
})();
