import { scrapeSerp } from './src/scrapers/serp-scraper';

// Mock process.env for the test
process.env.PROXY_HOST = '172.26.176.1';
process.env.PROXY_HTTP_PORT = '7897';
process.env.PROXY_USER = 'dummy'; // Not needed for local proxy usually
process.env.PROXY_PASS = 'dummy';

async function test() {
  console.log("Testing SERP scraper with Windows proxy...");
  try {
    const data = await scrapeSerp("Python automation bounties 2026");
    console.log("SUCCESS!");
    console.log(`Results found: ${data.results.length}`);
    if (data.results.length > 0) {
      console.log(`First result: ${data.results[0].title}`);
    }
  } catch (e) {
    console.error("FAILED:", e);
  }
}

test();
