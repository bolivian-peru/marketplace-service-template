/**
 * Proof Script — demonstrates Trend Intelligence API
 * 
 * Shows real output for 2+ topics across 2+ platforms.
 * Run: bun run proof
 * 
 * NOTE: Requires proxy credentials in .env for live data.
 * This script tests the synthesis engine with real scraped data.
 */

import { searchRedditBroad } from '../src/scrapers/reddit-scraper';
import { searchX } from '../src/scrapers/x-scraper';
import { searchYouTube } from '../src/scrapers/youtube-scraper';
import { detectPatterns, analyzeSentiment, extractEmergingTopics, getTopDiscussions } from '../src/utils/synthesis';
import type { Platform, Evidence } from '../src/types';

async function research(topic: string, platforms: Platform[] = ['reddit', 'youtube']) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 RESEARCHING: "${topic}"`);
  console.log(`📡 Platforms: ${platforms.join(', ')}`);
  console.log('='.repeat(60));

  const startTime = Date.now();
  const evidenceByPlatform: Partial<Record<Platform, Evidence[]>> = {};

  const jobs = platforms.map(async (platform) => {
    console.log(`  → Fetching ${platform}...`);
    try {
      if (platform === 'reddit') {
        const posts = await searchRedditBroad(topic, 30, 30);
        evidenceByPlatform.reddit = posts;
        console.log(`  ✓ Reddit: ${posts.length} posts`);
      } else if (platform === 'x') {
        const posts = await searchX(topic, 30, 20);
        evidenceByPlatform.x = posts;
        console.log(`  ✓ X/Twitter: ${posts.length} posts`);
      } else if (platform === 'youtube') {
        const videos = await searchYouTube(topic, 30, 15);
        evidenceByPlatform.youtube = videos;
        console.log(`  ✓ YouTube: ${videos.length} videos`);
      }
    } catch (err: any) {
      console.error(`  ✗ ${platform} failed: ${err.message}`);
      evidenceByPlatform[platform] = [];
    }
  });

  await Promise.all(jobs);

  const allEvidence = Object.values(evidenceByPlatform).flat();
  console.log(`\n📊 Total evidence: ${allEvidence.length} items`);

  if (allEvidence.length === 0) {
    console.log('⚠️  No evidence found (proxy may not be configured)');
    return;
  }

  // Synthesis
  const patterns = detectPatterns(allEvidence, topic);
  const sentiment = analyzeSentiment(evidenceByPlatform);
  const topDiscussions = getTopDiscussions(allEvidence, 5);
  const emergingTopics = extractEmergingTopics(allEvidence, topic, 5);

  console.log(`\n🔍 PATTERNS DETECTED (${patterns.length}):`);
  for (const p of patterns.slice(0, 5)) {
    console.log(`  [${p.strength.toUpperCase()}] ${p.pattern}`);
    console.log(`    → Sources: ${p.sources.join(', ')} | Engagement: ${p.totalEngagement}`);
    if (p.evidence[0]) {
      const e = p.evidence[0];
      if (e.platform === 'reddit') console.log(`    → Top: "${e.title}" (score: ${e.score})`);
      if (e.platform === 'x') console.log(`    → Top: "${e.text.slice(0, 80)}..." (likes: ${e.likes})`);
      if (e.platform === 'youtube') console.log(`    → Top: "${e.title}" (views: ${e.viewCount.toLocaleString()})`);
    }
  }

  console.log(`\n💬 SENTIMENT:`);
  console.log(`  Overall: ${sentiment.overall.toUpperCase()}`);
  for (const [platform, s] of Object.entries(sentiment.by_platform)) {
    if (s) console.log(`  ${platform}: +${s.positive}% neutral:${s.neutral}% -${s.negative}% (n=${s.sampleSize})`);
  }

  console.log(`\n🌟 TOP DISCUSSIONS:`);
  for (const d of topDiscussions.slice(0, 3)) {
    if (d.platform === 'reddit') console.log(`  [reddit] "${d.title}" – score: ${d.score}, comments: ${d.numComments}`);
    if (d.platform === 'x') console.log(`  [x] "${d.text.slice(0, 70)}..." – likes: ${d.likes}`);
    if (d.platform === 'youtube') console.log(`  [youtube] "${d.title}" – views: ${d.viewCount.toLocaleString()}`);
  }

  console.log(`\n📈 EMERGING TOPICS: ${emergingTopics.join(', ') || 'none'}`);
  console.log(`\n⏱️  Query time: ${Date.now() - startTime}ms`);
}

// Run proof for 2 topics
async function main() {
  console.log('🚀 Trend Intelligence API — Proof Script');
  console.log('Bounty #70 | proxies.sx marketplace');

  await research('AI coding assistants', ['reddit', 'youtube']);
  await research('Bitcoin ETF', ['reddit', 'youtube']);

  console.log('\n✅ Proof complete!');
}

main().catch(console.error);
