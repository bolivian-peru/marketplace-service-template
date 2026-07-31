--- a/src/routes/research.ts
+++ b/src/routes/research.ts
@@ -1,6 +1,7 @@
 /**
  * POST /api/research
  * Cross-platform trend intelligence synthesis.
+ * Prediction Market Signal Aggregator Integration
  *
  * Pricing tiers (x402):
  *   $0.10 USDC - single platform
  *   $0.50 USDC - 2-3 platforms (cross-platform synthesis)
@@ -15,6 +16,22 @@
 import { getProxy, proxyFetch } from '../proxy';
 import { searchReddit } from '../scrapers/reddit';

+import { fetchPolymarketData } from '../integrations/polymarket';
+import { fetchKalshiData } from '../integrations/kalshi';
+import { analyzeTwitterSentiment } from '../integrations/twitter';
+import { analyzeRedditSentiment } from '../integrations/reddit';
+import { generateSignal } from '../utils/signalGenerator';
+
+const predictionMarketSignalAggregator = async () => {
+  const polymarketData = await fetchPolymarketData();
+  const kalshiData = await fetchKalshiData();
+  const twitterSentiment = await analyzeTwitterSentiment();
+  const redditSentiment = await analyzeRedditSentiment();
+  const signal = generateSignal(polymarketData, kalshiData, twitterSentiment, redditSentiment);
+  return signal;
+};
+
 export const researchRoute = async (c: Context) => {
   try {
     const payment = extractPayment(c);
     if (!payment) return build402Response(c, 'Payment not found');
