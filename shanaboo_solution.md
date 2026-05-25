Looking at the issue, this is a bounty submission for a Mobile SERP Tracker service. I need to examine the code to understand how to integrate this service into the marketplace template.

Let me analyze what needs to be done:

1. The issue shows a mobile SERP tracker implementation that should be integrated into the marketplace service template
2. I can see the service has API endpoints defined in the src/index.ts file
3. The main app already has a health endpoint and service discovery
4. I need to add the SERP tracker functionality to the existing service

Let me check what files I can see and make the necessary changes:

```diff
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+/// <reference path="index.ts" />
 /**
  * Marketplace Service — Server Entry Point
  * ─────────────────────────────────────────
@@ -26,6 +27,10 @@ app.get('/health', (c) => c.json({
   version: '2.0.0',
   timestamp: new Date().toISOString(),
   endpoints: [
+    '/api/serp',
     '/api/reviews/search',
     '/api/reviews/:place_id',
     '/api/reviews/summary/:place_id',
@@ -35,6 +39,7 @@ app.get('/health', (c) => c.json({
     '/api/linkedin/person',
     '/api/linkedin/company',
     '/api/linkedin/search/people',
+    '/api/serp',
     '/api/linkedin/company/:id/employees',
     '/api/reddit/search',
     '/api/reddit/trending',
@@ -53,7 +54,8 @@ app.get('/', (c) => c.json({
     { method: 'GET', path: '/api/reviews/summary/:place_id', description: 'Get business details + review summary by Place ID', price: '0.01 USDC' },
     { method: 'GET', path: '/api/business/:place_id', description: 'Get business details + review summary by Place ID', price: '0.01 USDC' },
-    { method: 'GET', path: '/api/linkedin/company/:id/employees', description: 'Get company employees from LinkedIn by company ID', price: '0.01 USDC' },
+    { method: 'GET', path: '/api/linkedin/company/:id/employees', description: 'Get company employees from LinkedIn by company ID', price: '0.01 USDC' },
+    { method: 'GET', path: '/api/serp', description: 'Mobile SERP Tracker - Google search results', price: '0.003 USDC' },
     { method: 'GET', path: '/api/reddit/search', description: 'Search Reddit posts by keyword', price: '0.01 USDC' },
     { method: 'GET', path: '/api/reddit/trending', description: 'Get trending Reddit posts', price: '0.01 USDC' },
@@ -61,7 +62,8 @@ app.get('/', (c) => c.json({
     { method: 'GET', path: '/api/airbnb/analyze/:username', description: 'Analyze Instagram profile for business verification', price: '0.01 USDC' },
     { method: 'GET', path: '/api/airbnb/market-stats', description: 'Get Airbnb market statistics for an area', price: '0.02 USDC' },
-    { method: 'GET', path: '/api/research', description: 'Research and extract data from a URL', price: '0.005 USDC' },
-    { method: 'GET', path: '/api/trending', description: 'Get trending search terms', price: '0.005 USDC' },
+    { method: 'GET', path: '/api/research', description: 'Research and extract data from a URL', price: '0.005 USDC' },
+    { method: 'GET', path: '/api/trending', description: 'Get trending search terms', price: '0.005 USDC' },
   ],
 }));
@@ -70,7 +72,8 @@ app.get('/', (c) => c.json({
     { method: 'GET', path: '/api/serp', description: 'Mobile SERP Tracker - Google search results', price: '0.003 USDC' },
     { method: 'GET', path: '/api/jobs', description: 'Get job listings (Indeed/LinkedIn) with salary + date + proxy metadata' },
     { method: 'GET', path: '/api/reviews/:place_id', description: 'Fetch Google reviews by Place ID', price: '0.02 USDC' },
-    { method: 'GET', path: '/api/business/:place_id', description: 'Get business details + review summary', price: '0.01 USDC' },
+    { method: 'GET', path: '/api/business/:place_id', description: 'Get business details + review summary', price: '0.01 USDC' },
     { method: 'GET', path: '/api/linkedin/company/:id/employees', description: 'Get company employees from LinkedIn by company ID', price: '0.01 USDC' },
   ],
 }));
@@ -80,6 +82,7 @@ app.get('/', (c) => c.json({
     { method: 'GET', path: '/api/reddit/subreddit/:name', description: 'Get subreddit posts by name', price: '0.01 USDC' },
     { method: 'GET', path: '/api/reddit/thread/*', description: 'Get Reddit thread by URL', price: '0.01 USDC' },
     { method: 'GET', path: '/api/instagram/profile/:username', description: 'Get Instagram profile data by username', price: '0.01 USDC' },
+    { method: 'GET', path: '/api/instagram/posts/:username', description: 'Get Instagram posts by username', price: '0.01 USDC' },
     { method: 'GET', path: '/api/instagram/analyze/:username', description: 'Analyze Instagram profile for business verification', price: '0.01 USDC' },
     { method: 'GET', path: '/api/airbnb/search', description: 'Search Airbnb listings by location', price: '0.01 USDC' },
@@ -87,6 +88,7 @@ app.get('/', (c) => c.json({
     { method: 'GET', path: '/api/airbnb/market-stats', description: 'Get Airbnb market statistics for an area', price: '0.02 USDC' },
     { method: 'GET', path: '/api/research', description: 'Research and extract data from a URL', price: '0.005 USDC' },
    