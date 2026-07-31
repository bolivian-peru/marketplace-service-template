--- a/src/routes/research.ts
+++ b/src/routes/research.ts
@@ -12,7 +12,7 @@
 import { extractPayment, verifyPayment, build402Response } from '../payment';
 import { getProxy, proxyFetch } from '../proxy';
 import { searchReddit } from '../scrapers/reddit';
-import { searchWeb } from '../scrapers/web';
+import { searchDuckDuckGo } from '../scrapers/web';
 import { searchYouTube } from '../scrapers/youtube';
 import { searchTwitter } from '../scrapers/twitter';
 
@@ -45,7 +45,7 @@
         const redditData = await searchReddit(query, limit);
         const webData = await searchDuckDuckGo(query, limit);
-        const twitterData = await searchTwitter(query, limit);
+        const twitterData = await searchNitter(query, limit);
         const youtubeData = await searchYouTube(query, limit);
         const trendIntelligence = await synthesizeTrendIntelligence([redditData, webData, twitterData, youtubeData]);
         return build402Response(trendIntelligence, paymentInfo, query);
