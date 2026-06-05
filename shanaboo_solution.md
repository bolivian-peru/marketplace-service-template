```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,12 +1,12 @@
 /**
- * Google Maps Lead Generator — Reference Implementation
+ * Instagram Intelligence + AI Vision Analysis API
  *
- * This is the reference service built by @aliraza556.
- * Replace with your own service logic.
+ * Premium Instagram intelligence API that uses AI vision models
+ * to analyze post images, detect account authenticity, classify
+ * content themes, and generate engagement predictions.
  */
 
 import { Hono } from 'hono';
 import { cors } from 'hono/cors';
 import { logger } from 'hono/logger';
-import { proxyFetch } from './utils/proxy';
-import { extractBusinessInfo, extractReviews, extractLeads } from './scrapers/reviews';
-import type { BusinessInfo, Review, Lead } from './types';
+import { proxyFetch } from './utils/proxy';
+import { analyzeInstagramProfile, analyzeInstagramPosts, runAIVisionAnalysis, runAuthenticityAudit } from './scrapers/instagram';
+import type { InstagramProfile, InstagramPost, AIAnalysisResult, AuthenticityAudit } from './types';
 
 // ─── CONFIG ─────────────────────────────────────────────────────────
 
-const SERVICE_NAME = 'google-maps-lead-generator';
-const PRICE_USDC = 0.005;
-const DESCRIPTION = 'Extract business leads, reviews, and contact info from Google Maps';
+const SERVICE_NAME = 'instagram-intelligence-api';
+const PRICE_USDC = 0.02;
+const DESCRIPTION = 'Instagram profile intelligence + AI vision analysis for influencer authenticity, content classification, and engagement prediction';
 
 // ─── SERVICE ROUTER ─────────────────────────────────────────────────
 
 const serviceRouter = new Hono();
 
 // Service discovery endpoint (no payment required)
 serviceRouter.get('/', (c) => {
   return c.json({
     name: SERVICE_NAME,
     description: DESCRIPTION,
     price_usdc: PRICE_USDC,
     endpoints: [
       {
-        path: '/api/run',
-        description: 'Search Google Maps and extract business leads',
+        path: '/api/instagram/profile/:username',
+        description: 'Basic profile data + engagement metrics',
+        method: 'GET',
+        parameters: {
+          username: 'Instagram username (required)',
+        },
+      },
+      {
+        path: '/api/instagram/posts/:username',
+        description: 'Recent posts with engagement data',
+        method: 'GET',
+        parameters: {
+          username: 'Instagram username (required)',
+          limit: 'Number of posts to return (default: 12, max: 50)',
+        },
+      },
+      {
+        path: '/api/instagram/analyze/:username',
+        description: 'FULL AI analysis: profile + vision analysis + sentiment + authenticity',
+        method: 'GET',
+        parameters: {
+          username: 'Instagram username (required)',
+        },
+      },
+      {
+        path: '/api/instagram/analyze/:username/images',
+        description: 'AI vision analysis of recent post images only',
+        method: 'GET',
+        parameters: {
+          username: 'Instagram username (required)',
+        },
+      },
+      {
+        path: '/api/instagram/audit/:username',
+        description: 'Fake follower / bot detection (AI-enhanced)',
         method: 'GET',
         parameters: {
-          query: 'Search query (e.g., "plumbers", "restaurants")',
-          location: 'Location (e.g., "Austin, TX")',
+          username: 'Instagram username (required)',
+        },
+      },
+      {
+        path: '/api/instagram/discover',
+        description: 'Search/filter accounts by AI-derived attributes',
+        method: 'GET',
+        parameters: {
+          niche: 'Content niche (e.g., travel, fashion, food)',
+          account_type: 'Account type filter (influencer, business, personal, bot/fake, meme_page, news_media)',
+          min_followers: 'Minimum follower count',
+          max_followers: 'Maximum follower count',
+          sentiment: 'Overall sentiment filter (positive, neutral, negative)',
+          brand_safe: 'Filter for brand-safe accounts only (true/false)',
         },
       },
     ],
   });
 });
 
-// Main service endpoint (payment required)
-serviceRouter.get('/run', async (c) => {
-  const query = c.req.query('query');
-  const location = c.req.query('location');
+// Profile endpoint
+serviceRouter.get('/profile/:username', async (c) => {
+  const username = c.req.param('username');
+  
+  if (!username) {
+    return c.json({ error: 'Username is required' }, 400);
+  }
 
-  if (!query || !location) {
-    return c.json({ error: 'Missing required parameters: query, location' }, 400);
+  try {
+    const profile = await analyzeInstagramProfile(username);
+    return c.json({ profile });
+  } catch (error) {
+    return c.json({ error: 'Failed to fetch profile', message: (error as Error).message }, 500);
   }
+});
+
+// Posts endpoint
+serviceRouter.get('/posts/:username', async (c) => {
+  const username = c.req.param('username');
+  const limit = parseInt(c.req.query('limit') || '12');
 
+  if (!username) {
+    return c.json({ error: 'Username is required' }, 400);
+  }
+
   try {
-    const results = await scrapeGoogleMaps(query, location);
-    return c.json(results);
+    const posts = await analyzeInstagramPosts(username, Math.min(limit, 50));
+    return c.json({ posts });
   } catch (error) {
-    return c.json({ error: 'Scraping failed', message: (error as Error).message }, 500);
+    return c.json({ error: 'Failed to fetch posts', message: (error as Error).message }, 500);
   }
 });
 
-// ─── SCRAPING LOGIC ─────────────────────────────────────────────────
+// Full AI analysis endpoint
+serviceRouter.get('/analyze/:username', async (c) => {
+  const username = c.req.param('username');
+  
+  if (!username) {
+    return c.json({ error: 'Username is required' }, 400);
+  }
 
-async function scrapeGoogleMaps(query: string, location: string) {
-  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query + ' ' + location)}`;
-  
-  const response = await proxyFetch(searchUrl);
-  const html = await response.text();
+  try {
+    const [profile, aiAnalysis] = await Promise.all([
+      analyzeInstagramProfile(username),
+      runAIVisionAnalysis(username),
+    ]);
+
+    return c.json({
+