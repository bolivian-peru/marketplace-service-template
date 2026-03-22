import { analyzeProfile } from './src/scrapers/instagram-scraper';

const testUser = 'instagram'; // Use a high-quality global account for baseline

async function runTest() {
    console.log(`🚀 Starting Test: ${testUser}...`);
    try {
        const result = await analyzeProfile(testUser);
        console.log("✅ Analysis Complete!");
        console.log(JSON.stringify(result.ai_analysis, null, 2));
    } catch (err) {
        console.error("❌ Test Failed:", err);
    }
}

runTest();
