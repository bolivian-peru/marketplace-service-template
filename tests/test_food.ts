import { searchUberEats, scrapeUberEats } from '../src/scrapers/food-scraper';
import process from 'node:process';

async function testFood() {
    console.log('🚀 Testing Uber Eats Intelligence API...');
    
    const lat = 40.7128;
    const lng = -74.0060;
    const query = 'pizza';

    console.log(`\n🔍 Searching for '${query}' in NYC...`);
    const searchResults = await searchUberEats(query, lat, lng);
    console.log(`✅ Found ${searchResults.length} restaurants.`);
    
    if (searchResults.length > 0) {
        const first = searchResults[0];
        console.log(`\n🍴 Picking first restaurant: ${first.name} (${first.id})`);
        
        console.log('💰 Fetching prices/menu...');
        const menu = await scrapeUberEats(first.id, lat, lng);
        console.log(`✅ Extracted ${menu.items.length} items.`);
        
        if (menu.collection_meta) {
            console.log('\n⚖️ Collection Meta:');
            console.log(`  - SHA256: ${menu.collection_meta.sha256}`);
            console.log(`  - Collected At: ${menu.collection_meta.collected_at}`);
            console.log(`  - Node ID: ${menu.collection_meta.node_id}`);
            console.log(`  - Latency: ${menu.collection_meta.latency_ms}ms`);
        }
        
        console.log('\n📈 Sample Items:');
        menu.items.slice(0, 5).forEach(item => {
            console.log(`  - ${item.name}: ${item.price} ${item.currency}`);
        });
    }
}

testFood().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
