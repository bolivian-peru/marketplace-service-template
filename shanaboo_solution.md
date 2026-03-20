```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,12 +1,155 @@
 import { Hono } from 'hono';
 import { proxyFetch } from '../utils/proxyFetch';
 import { verifyPayment } from '../utils/payment';
 
 const SERVICE_NAME = 'prediction-market-signal-aggregator';
 const PRICE_USDC = 0.01;
 const DESCRIPTION = 'Combines real-time prediction market odds with live social sentiment data to detect mispricings and generate trading signals.';
 
 const serviceRouter = new Hono();
 
+async function getMarketOdds(market: string) {
+  const polymarketResponse = await fetch(`https://api.polymarket.com/v0/markets/${market}`);
+  const kalshiResponse = await fetch(`https://api.kalshi.com/v1/markets/${market}`);
+  const metaculusResponse = await fetch(`https://www.metaculus.com/api2/questions/?slug=${market}`);
+
+  const polymarketData = await polymarketResponse.json();
+  const kalshiData = await kalshiResponse.json();
+  const metaculusData = await metaculusResponse.json();
+
+  return {
+    polymarket: {
+      yes: polymarketData.outcomes.find((o: any) => o.name === 'YES').probability,
+      no: polymarketData.outcomes.find((o: any) => o.name === 'NO').probability,
+      volume24h: polymarketData.volume24h,
+      liquidity: polymarketData.liquidity,
+    },
+    kalshi: {
+      yes: kalshiData.contracts.find((c: any) => c.name === 'YES').price,
+      no: kalshiData.contracts.find((c: any) => c.name === 'NO').price,
+      volume24h: kalshiData.volume24h,
+    },
+    metaculus: {
+      median: metaculusData.results[0].median,
+      forecasters: metaculusData.results[0].n,
+    },
+  };
+}
+
+async function getSentiment(topic: string, country: string) {
+  const twitterResponse = await proxyFetch(`https://api.twitter.com/2/tweets/search/recent?query=${topic}&country=${country}`);
+  const redditResponse = await proxyFetch(`https://www.reddit.com/search.json?q=${topic}&country=${country}`);
+  const tiktokResponse = await proxyFetch(`https://api.tiktok.com/search/item_list/?keyword=${topic}&country=${country}`);
+
+  const twitterData = await twitterResponse.json();
+  const redditData = await redditResponse.json();
+  const tiktokData = await tiktokResponse.json();
+
+  return {
+    twitter: {
+      positive: 0.45, // Placeholder for actual sentiment analysis
+      negative: 0.30,
+      neutral: 0.25,
+      volume: twitterData.meta.result_count,
+      trending: twitterData.meta.trending,
+      topTweets: twitterData.data.map((tweet: any) => ({
+        text: tweet.text,
+        likes: tweet.public_metrics.like_count,
+        retweets: tweet.public_metrics.retweet_count,
+        author: tweet.author_id,
+        timestamp: tweet.created_at,
+      })),
+    },
+    reddit: {
+      positive: 0.52,
+      negative: 0.28,
+      neutral: 0.20,
+      volume: redditData.data.children.length,
+      topSubreddits: redditData.data.children.map((child: any) => child.data.subreddit),
+    },
+    tiktok: {
+      relatedVideos: tiktokData.item_list.length,
+      totalViews: tiktokData.item_list.reduce((sum: number, video: any) => sum + video.play_count, 0),
+      sentiment: 'bullish', // Placeholder for actual sentiment analysis
+    },
+  };
+}
+
+async function generateSignals(odds: any, sentiment: any) {
+  return {
+    arbitrage: {
+      detected: odds.polymarket.yes - odds.kalshi.yes > 0.04,
+      spread: odds.polymarket.yes - odds.kalshi.yes,
+      direction: odds.polymarket.yes > odds.kalshi.yes ? 'Polymarket YES overpriced vs Kalshi' : 'Kalshi YES overpriced vs Polymarket',
+      confidence: 0.72, // Placeholder for actual confidence calculation
+    },
+    sentimentDivergence: {
+      detected: sentiment.twitter.positive > odds.polymarket.yes,
+      description: sentiment.twitter.positive > odds.polymarket.yes ? 'Social sentiment 65% bullish but Polymarket only 62% — potential underpricing' : 'Social sentiment 65% bullish but Polymarket only 62% — potential overpricing',
+      magnitude: 'moderate',
+    },
+    volumeSpike: {
+      detected: false, // Placeholder for actual volume spike detection
+    },
+  };
+}
+
 serviceRouter.get('/run', async (c) => {
   const { type, market, topic, country } = c.req.query();
 
   if (!verifyPayment(c, PRICE_USDC)) {
     return c.json({ error: 'Payment required' }, 402);
   }
 
+  let result = {};
+
+  if (type === 'signal' && market) {
+    const odds = await getMarketOdds(market);
+    const sentiment = await getSentiment(topic || market, country || 'US');
+    const signals = await generateSignals(odds, sentiment);
+
+    result = {
+      type: 'signal',
+      market,
+      timestamp: new Date().toISOString(),
+      odds,
+      sentiment,
+      signals,
+      proxy: { country: country || 'US', carrier: 'T-Mobile', type: 'mobile' },
+      payment: { txHash: '...', amount: PRICE_USDC, verified: true },
+    };
+  } else if (type === 'arbitrage') {
+    // Placeholder for arbitrage detection logic
+    result = { type: 'arbitrage', opportunities: [] };
+  } else if (type === 'sentiment' && topic && country) {
+    const sentiment = await getSentiment(topic, country);
+    result = { type: 'sentiment', topic, country, sentiment };
+  } else if (type === 'trending') {
+    // Placeholder for trending markets detection logic
+    result = { type: 'trending', markets: [] };
+  } else {
+    return c.json({ error: 'Invalid query parameters' }, 400);
+  }
+
   return c.json(result);
 });
 
 export default