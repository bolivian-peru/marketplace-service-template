/**
 * Proof Generator — fetches real Reddit data and writes to proof/ directory.
 * Run: bun run scripts/generate-proof.ts
 */

import { parsePost, parseListing, flattenComments } from '../src/scrapers/reddit-intel/parse';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';

async function fetchJson(url: string): Promise<any> {
  console.log(`Fetching: ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function main() {
  console.log('=== Generating Reddit proof data ===\n');

  // ─── Sample 1: Search ─────────────────────────
  const searchStart = Date.now();
  const searchData = await fetchJson('https://old.reddit.com/search.json?q=artificial+intelligence&sort=relevance&t=week&limit=10&raw_json=1');
  const search = parseListing(searchData);
  const sample1 = {
    results: search.posts,
    meta: {
      query: 'artificial intelligence',
      subreddit: 'all',
      sort: 'relevance',
      time_filter: 'week',
      total_results: search.posts.length,
      proxy: { ip: null, country: 'US', carrier: null },
      scraped_at: new Date().toISOString(),
      response_time_ms: Date.now() - searchStart,
    },
    pagination: { after: search.after, has_more: !!search.after },
  };
  await Bun.write('proof/sample-1.json', JSON.stringify(sample1, null, 2));
  console.log(`✓ sample-1.json — ${search.posts.length} search results\n`);

  // ─── Sample 2: Subreddit top ───────────────────
  const subStart = Date.now();
  const subData = await fetchJson('https://old.reddit.com/r/cryptocurrency/top.json?t=week&limit=10&raw_json=1');
  const sub = parseListing(subData);
  const sample2 = {
    subreddit: 'r/cryptocurrency',
    results: sub.posts,
    meta: {
      time_filter: 'week',
      total_results: sub.posts.length,
      proxy: { ip: null, country: 'US', carrier: null },
      scraped_at: new Date().toISOString(),
      response_time_ms: Date.now() - subStart,
    },
    pagination: { after: sub.after, has_more: !!sub.after },
  };
  await Bun.write('proof/sample-2.json', JSON.stringify(sample2, null, 2));
  console.log(`✓ sample-2.json — ${sub.posts.length} r/cryptocurrency posts\n`);

  // ─── Sample 3: Thread with comments ────────────
  // Use first post from the search results as thread
  const threadId = search.posts[0]?.id || sub.posts[0]?.id;
  if (threadId) {
    const threadStart = Date.now();
    const threadData = await fetchJson(`https://old.reddit.com/comments/${threadId}.json?limit=50&depth=5&raw_json=1`);
    const postChild = threadData[0]?.data?.children?.[0];
    const post = parsePost(postChild);
    const commentChildren = threadData[1]?.data?.children || [];
    const comments = flattenComments(commentChildren, post.author, 50);

    const sample3 = {
      post,
      comments,
      meta: {
        thread_id: threadId,
        total_comments: post.num_comments,
        proxy: { ip: null, country: 'US', carrier: null },
        scraped_at: new Date().toISOString(),
        response_time_ms: Date.now() - threadStart,
      },
    };
    await Bun.write('proof/sample-3.json', JSON.stringify(sample3, null, 2));
    console.log(`✓ sample-3.json — thread "${post.title}" with ${comments.length} comments\n`);
  }

  console.log('=== Done! proof/ directory updated with real Reddit data ===');
}

main().catch(console.error);
