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
+import { proxyFetch, proxyFetchImage } from './utils/proxy';
 import { 
   verifyPayment, 
   requirePayment, 
@@ -15,12 +15,14 @@
   type PaymentConfig 
 } from './utils/payment';
 import { rateLimit } from './utils/rate-limit';
+import { analyzeProfile, analyzePosts, analyzeVision, analyzeAuthenticity, discoverAccounts } from './scrapers/instagram/intelligence';
+import type { InstagramAnalysisResult, InstagramProfile, InstagramPost, AIVisionAnalysis, AuthenticityReport } from './types/instagram';
 
 // ─── Service Configuration ─────────────────────────────────────────
 
-const SERVICE_NAME = 'google-maps-leads';
-const PRICE_USDC = 0.005;
-const DESCRIPTION = 'Extract business leads from Google Maps with reviews, ratings, and contact info';
+const SERVICE_NAME = 'instagram-intelligence';
+const PRICE_USDC = 0.02;
+const DESCRIPTION = 'Instagram intelligence API with AI vision analysis for influencer discovery, authenticity detection, and content classification';
 
 const paymentConfig: PaymentConfig = {
   price: PRICE_USDC,
@@ -30,7 +32,7 @@
 // ─── Hono App ──────────────────────────────────────────────────────
 
 const app = new Hono();
-const serviceRouter = new Hono();
+const serviceRouter = new Hono({ strict: false });
 
 app.use('*', logger());
 app.use('*', cors({
@@ -49,7 +51,7 @@
 // ─── Health & Discovery ────────────────────────────────────────────
 
 app.get('/health', (c) => {
-  return c.json({ status: 'healthy', service: SERVICE_NAME });
+  return c.json({ status: 'healthy', service: SERVICE_NAME, version: '1.0.0' });
 });
 
 app.get('/', (c) => {
@@ -57,9 +59,15 @@
     name: SERVICE_NAME,
     description: DESCRIPTION,
     price: PRICE_USDC,
-    endpoints: ['/api/run'],
+    endpoints: [
+      '/api/instagram/profile/:username',
+      '/api/instagram/posts/:username',
+      '/api/instagram/analyze/:username',
+      '/api/instagram/analyze/:username/images',
+      '/api/instagram/audit/:username',
+      '/api/instagram/discover'
+    ],
     payment: { type: 'x402', scheme: 'exact' },
-    example: '/api/run?query=plumbers&location=Austin+TX'
+    example: '/api/instagram/analyze/traveljane'
   });
 });
 
@@ -67,29 +75,222 @@
 
 serviceRouter.use(requirePayment(paymentConfig));
 
-serviceRouter.get('/run', async (c) => {
-  const query = c.req.query('query');
-  const location = c.req.query('location');
+// GET /api/instagram/profile/:username
+// Basic profile data + engagement metrics
+serviceRouter.get('/instagram/profile/:username', async (c) => {
+  const username = c.req.param('username');
+  const refresh = c.req.query('refresh') === 'true';
   
-  if (!query || !location) {
-    return c.json({ error: 'Missing query or location parameter' }, 400);
+  try {
+    const profile = await analyzeProfile(username, { refresh, proxyFetch });
+    return c.json({ success: true, data: profile });
+  } catch (error) {
+    console.error('Profile analysis error:', error);
+    return c.json({ 
+      success: false, 
+      error: 'Failed to fetch profile', 
+      message: error instanceof Error ? error.message : 'Unknown error' 
+    }, 500);
   }
+});
+
+// GET /api/instagram/posts/:username
+// Recent posts with engagement data
+serviceRouter.get('/instagram/posts/:username', async (c) => {
+  const username = c.req.param('username');
+  const limit = Math.min(parseInt(c.req.query('limit') || '12', 10), 50);
+  const refresh = c.req.query('refresh') === 'true';
   
   try {
-    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}+in+${encodeURIComponent(location)}`;
-    const response = await proxyFetch(searchUrl);
-    const html = await response.text();
+    const posts = await analyzePosts(username, { limit, refresh, proxyFetch, proxyFetchImage });
+    return c.json({ success: true, data: posts });
+  } catch (error) {
+    console.error('Posts analysis error:', error);
+    return c.json({ 
+      success: false, 
+      error: 'Failed to fetch posts', 
+      message: error instanceof Error ? error.message : 'Unknown error' 
+    }, 500);
+  }
+});
+
+// GET /api/instagram/analyze/:username
+// FULL AI analysis: profile + vision analysis + sentiment + authenticity
+serviceRouter.get('/instagram/analyze/:username', async (c) => {
+  const username = c.req.param('username');
+  const includeVision = c.req.query('vision') !== 'false';
+  const includeAudit = c.req.query('audit') !== 'false';
+  const refresh = c.req.query('refresh') === 'true';
+  
+  try {
+    const result = await analyzeProfile(username, { 
+      refresh, 
+      includeVision, 
+      includeAudit, 
+      proxyFetch, 
+      proxyFetchImage 
+    });
+    
+    return c.json({ 
+      success: true, 
+      data: result,
+      meta: {
+        analysis_version: '1.0.0',
+        vision_enabled: includeVision,
+        audit_enabled: includeAudit
+      }
+    });
+  } catch (error) {
+    console.error('Full analysis error:', error);
+    return c.json({ 
+      success: false, 
+      error: 'Failed to analyze account', 
+      message: error instanceof Error ? error.message : 'Unknown error' 
+    }, 500);
+  }
+});
+
+// GET /api/instagram/analyze/: