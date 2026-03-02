/**
 * Generate proof data for Amazon BSR Tracker (Bounty #72)
 *
 * Run: bun run scripts/proof-amazon.ts
 *
 * Requires PROXY_HOST, PROXY_HTTP_PORT, PROXY_USER, PROXY_PASS env vars.
 * Outputs real scraped data to proof/ directory.
 */

import { scrapeProduct, scrapeSearch, scrapeBestsellers, scrapeReviews } from '../src/scrapers/amazon';

const TEST_ASINS = [
  { asin: 'B0BSHF7WHW', name: 'Apple AirPods Pro 2nd Gen' },
  { asin: 'B0D1XD1ZV3', name: 'Samsung Galaxy S24 Ultra' },
  { asin: 'B0CHX3QBCH', name: 'PlayStation 5 Slim' },
  { asin: 'B0BT2KFJ8V', name: 'Anker USB-C Charger' },
  { asin: 'B09V3KXJPB', name: 'Apple Watch SE' },
];

const MARKETPLACES = ['US', 'UK', 'DE'];

async function generateProof() {
  console.log('🔍 Amazon BSR Tracker — Proof Generation\n');

  for (const mp of MARKETPLACES) {
    console.log(`\n══════ Marketplace: ${mp} ══════\n`);

    const proofData: any = {
      proof_type: 'amazon-product-scrape',
      marketplace: mp,
      generated_at: new Date().toISOString(),
      products: [],
      search: null,
      bestsellers: null,
      reviews: null,
    };

    // Product lookups
    for (const { asin, name } of TEST_ASINS.slice(0, mp === 'US' ? 5 : 2)) {
      try {
        console.log(`  📦 Product: ${name} (${asin})...`);
        const product = await scrapeProduct(asin, mp);
        proofData.products.push(product);
        console.log(`     ✅ ${product.title || 'No title'} — $${product.price.current} — BSR #${product.bsr.rank}`);
      } catch (err: any) {
        console.log(`     ❌ ${err.message}`);
        proofData.products.push({ asin, error: err.message });
      }
      // Rate limit delay
      await new Promise(r => setTimeout(r, 2000));
    }

    // Search (US only)
    if (mp === 'US') {
      try {
        console.log('\n  🔎 Search: "wireless headphones"...');
        const results = await scrapeSearch('wireless headphones', mp, 'electronics', 10);
        proofData.search = { query: 'wireless headphones', results };
        console.log(`     ✅ Found ${results.length} results`);
      } catch (err: any) {
        console.log(`     ❌ ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));

      // Bestsellers
      try {
        console.log('  🏆 Bestsellers: electronics...');
        const bestsellers = await scrapeBestsellers(mp, 'electronics', 10);
        proofData.bestsellers = { category: 'electronics', results: bestsellers };
        console.log(`     ✅ Found ${bestsellers.length} bestsellers`);
      } catch (err: any) {
        console.log(`     ❌ ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));

      // Reviews
      try {
        console.log('  💬 Reviews: B0BSHF7WHW...');
        const reviews = await scrapeReviews('B0BSHF7WHW', mp, 'recent', 5);
        proofData.reviews = reviews;
        console.log(`     ✅ Found ${reviews.reviews.length} reviews`);
      } catch (err: any) {
        console.log(`     ❌ ${err.message}`);
      }
    }

    // Write proof
    const outPath = `proof/amazon-bsr-tracker-${mp}.json`;
    await Bun.write(outPath, JSON.stringify(proofData, null, 2));
    console.log(`\n  📁 Saved: ${outPath}`);
  }

  console.log('\n✅ Proof generation complete!');
}

generateProof().catch(console.error);
