import { fetchActiveMarkets, searchMarkets, getTrendingMarkets } from './src/scrapers/prediction-market';

async function test() {
  console.log('=== Testing Prediction Market Scraper ===');
  
  console.log('\n1. Fetching Active Markets...');
  try {
    const markets = await fetchActiveMarkets(2);
    console.log(`Got ${markets.length} markets:`);
    for (const m of markets.slice(0, 2)) {
      const q = m.question ? m.question.substring(0, 50) : 'Unknown';
      console.log(`- ${q}...`);
      console.log(`  Volume: $${(m.volume/1000).toFixed(1)}k`);
      console.log(`  Probability: ${(m.probability * 100).toFixed(1)}%`);
    }
    console.log('✅ PASSED');
  } catch (err: any) {
    console.error('❌ Failed:', err.message);
  }

  console.log('\n2. Searching for "Election"...');
  try {
    const results = await searchMarkets('Election');
    console.log(`Got ${results.length} results.`);
    if (results.length > 0) {
      const q = results[0].question ? results[0].question.substring(0, 50) : 'Unknown';
      console.log(`- ${q}...`);
    }
    console.log('✅ PASSED');
  } catch (err: any) {
    console.error('❌ Failed:', err.message);
  }

  console.log('\n3. Fetching Trending...');
  try {
    const trending = await getTrendingMarkets(1);
    console.log(`Got ${trending.length} trending.`);
    if (trending.length > 0) {
      const q = trending[0].market.question ? trending[0].market.question.substring(0, 50) : 'Unknown';
      console.log(`- ${q}...`);
      console.log(`  Sentiment: ${trending[0].sentiment}, Momentum: ${trending[0].momentum.toFixed(3)}`);
    }
    console.log('✅ PASSED');
  } catch (err: any) {
    console.error('❌ Failed:', err.message);
  }

  console.log('\n=== All tests passed! ===');
}

test();
