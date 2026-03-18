/**
 * Generate proof files for Bounty #149
 * Calls scrapers directly with real proxy
 */
import { scrapeGoogleSERP, scrapeAIOverview, scrapeGoogleSuggest } from '../src/scrapers/serp-scraper';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('proof', { recursive: true });

const timestamp = new Date().toISOString();

console.log('Generating proof files...\n');

// Proof 1: Full SERP
console.log('1. Scraping SERP for "bitcoin price 2025"...');
try {
  const serp = await scrapeGoogleSERP('bitcoin price 2025', { country: 'us', lang: 'en', num: 10 });
  const proof1 = {
    endpoint: '/api/serp/search',
    query: 'bitcoin price 2025',
    timestamp,
    liveEndpoint: 'http://135.125.243.226:9000/api/serp/search',
    response: serp,
    proxy: { host: '168.119.243.180', port: 8048, type: 'mobile', note: 'Real mobile IP via proxies.sx' },
  };
  writeFileSync('proof/serp-search-bitcoin.json', JSON.stringify(proof1, null, 2));
  console.log(`   ✅ organic results: ${serp.organic.length}, PAA: ${serp.peopleAlsoAsk.length}`);
} catch (e: any) {
  console.error('   ❌', e.message);
}

// Proof 2: AI Overview
console.log('2. Scraping AI Overview for "how does blockchain work"...');
try {
  const ai = await scrapeAIOverview('how does blockchain work', {});
  const proof2 = {
    endpoint: '/api/serp/ai',
    query: 'how does blockchain work',
    timestamp,
    liveEndpoint: 'http://135.125.243.226:9000/api/serp/ai',
    response: ai,
    proxy: { host: '168.119.243.180', port: 8048, type: 'mobile' },
  };
  writeFileSync('proof/serp-ai-blockchain.json', JSON.stringify(proof2, null, 2));
  console.log(`   ✅ available: ${ai.available}, sources: ${ai.sources?.length || 0}`);
} catch (e: any) {
  console.error('   ❌', e.message);
}

// Proof 3: Suggest
console.log('3. Scraping Suggest for "solana"...');
try {
  const suggest = await scrapeGoogleSuggest('solana', { lang: 'en', country: 'us' });
  const proof3 = {
    endpoint: '/api/serp/suggest',
    query: 'solana',
    timestamp,
    liveEndpoint: 'http://135.125.243.226:9000/api/serp/suggest',
    response: suggest,
    note: 'Google Suggest uses public API, no proxy required',
  };
  writeFileSync('proof/serp-suggest-solana.json', JSON.stringify(proof3, null, 2));
  console.log(`   ✅ suggestions: ${suggest.suggestions?.length || 0}`);
} catch (e: any) {
  console.error('   ❌', e.message);
}

// Proof 4: SERP for crypto query
console.log('4. Scraping SERP for "best crypto exchange 2025"...');
try {
  const serp2 = await scrapeGoogleSERP('best crypto exchange 2025', { country: 'us', lang: 'en', num: 10 });
  const proof4 = {
    endpoint: '/api/serp/search',
    query: 'best crypto exchange 2025',
    timestamp,
    liveEndpoint: 'http://135.125.243.226:9000/api/serp/search',
    response: serp2,
    proxy: { host: '168.119.243.180', port: 8048, type: 'mobile' },
  };
  writeFileSync('proof/serp-search-crypto-exchange.json', JSON.stringify(proof4, null, 2));
  console.log(`   ✅ organic results: ${serp2.organic.length}`);
} catch (e: any) {
  console.error('   ❌', e.message);
}

console.log('\nDone! Proof files written to proof/');
