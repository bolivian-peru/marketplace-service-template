```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,12 +1,155 @@
 import { Hono } from 'hono';
 import { proxyFetch } from './proxies';
 import { verifyPayment } from './payment';
+import { parseAppleRankings, parseGoogleAppDetails, parseGoogleSearchResults, parseGoogleTrendingApps } from './scrapers';
 
 const app = new Hono();
 
 const SERVICE_NAME = 'app-store-intelligence';
 const PRICE_USDC = 0.01;
 const DESCRIPTION = 'Real-time app rankings, reviews, and metadata from Apple App Store and Google Play Store';
 
+app.get('/api/run', async (c) => {
+  const { type, store, category, country, appId, query } = c.req.query();
+
+  // Payment verification
+  const paymentSignature = c.req.header('Payment-Signature');
+  if (!paymentSignature || !(await verifyPayment(paymentSignature, PRICE_USDC))) {
+    return c.json({ error: 'Payment verification failed' }, 402);
+  }
+
+  let result;
+  try {
+    if (type === 'rankings' && store === 'apple') {
+      const url = `https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/charts?cc=${country}&genreId=${getAppleCategoryId(category)}&limit=200`;
+      const response = await proxyFetch(url);
+      const data = await response.json();
+      result = parseAppleRankings(data, category, country);
+    } else if (type === 'app' && store === 'google') {
+      const url = `https://play.google.com/store/apps/details?id=${appId}&hl=${country}`;
+      const response = await proxyFetch(url);
+      const data = await response.text();
+      result = parseGoogleAppDetails(data, appId, country);
+    } else if (type === 'search' && store === 'google') {
+      const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=${country}`;
+      const response = await proxyFetch(url);
+      const data = await response.text();
+      result = parseGoogleSearchResults(data, query, country);
+    } else if (type === 'trending' && store === 'google') {
+      const url = `https://play.google.com/store/apps/collection/topselling_new_free?hl=${country}`;
+      const response = await proxyFetch(url);
+      const data = await response.text();
+      result = parseGoogleTrendingApps(data, country);
+    } else {
+      return c.json({ error: 'Invalid request parameters' }, 400);
+    }
+  } catch (error) {
+    return c.json({ error: 'Failed to fetch data' }, 500);
+  }
+
+  return c.json(result);
+});
+
+function getAppleCategoryId(category: string): string {
+  switch (category) {
+    case 'games':
+      return '6014';
+    case 'productivity':
+      return '6007';
+    case 'social':
+      return '6005';
+    case 'entertainment':
+      return '6016';
+    case 'education':
+      return '6017';
+    case 'health':
+      return '6013';
+    default:
+      return '6014'; // Default to games
+  }
+}
+
+// Example scraper functions
+function parseAppleRankings(data: any, category: string, country: string) {
+  const rankings = data.feed.entry.map((entry: any, index: number) => ({
+    rank: index + 1,
+    appName: entry['im:name'].label,
+    developer: entry['im:artist'].label,
+    appId: entry.id.attributes['im:id'],
+    rating: parseFloat(entry['im:rating'].label),
+    ratingCount: parseInt(entry['im:rating-count'].label, 10),
+    price: entry['im:price'].label,
+    inAppPurchases: false, // Placeholder
+    category: category,
+    lastUpdated: entry['im:releaseDate'].attributes.label.split('T')[0],
+    size: 'Unknown', // Placeholder
+    icon: entry['im:image'][2].label,
+  }));
+
+  return {
+    type: 'rankings',
+    store: 'apple',
+    category,
+    country,
+    timestamp: new Date().toISOString(),
+    rankings,
+    metadata: {
+      totalRanked: rankings.length,
+      scrapedAt: new Date().toISOString(),
+    },
+    proxy: { country, carrier: 'T-Mobile', type: 'mobile' },
+    payment: { txHash: '...', amount: PRICE_USDC, verified: true },
+  };
+}
+
+function parseGoogleAppDetails(data: string, appId: string, country: string) {
+  // Placeholder implementation
+  return {
+    type: 'app',
+    store: 'google',
+    appId,
+    country,
+    timestamp: new Date().toISOString(),
+    appName: 'Unknown', // Placeholder
+    developer: 'Unknown', // Placeholder
+    rating: 0, // Placeholder
+    ratingCount: 0, // Placeholder
+    price: 'Free', // Placeholder
+    inAppPurchases: false, // Placeholder
+    category: 'Unknown', // Placeholder
+    lastUpdated: 'Unknown', // Placeholder
+    size: 'Unknown', // Placeholder
+    icon: 'https://...', // Placeholder
+    reviews: [], // Placeholder
+    metadata: {
+      scrapedAt: new Date().toISOString(),
+    },
+    proxy: { country, carrier: 'T-Mobile', type: 'mobile' },
+    payment: { txHash: '...', amount: PRICE_USDC, verified: true },
+  };
+}
+
+function parseGoogleSearchResults(data: string, query: string, country: string) {
+  // Placeholder implementation
+  return {
+    type: 'search',
+    store: 'google',
+    query,
+    country,
+    timestamp: new Date().toISOString(),
+    results: [], // Placeholder
+    metadata: {
+      totalResults: 0, // Placeholder
+      scrapedAt: new Date().toISOString(),
+    },
+    proxy: { country, carrier: 'T-Mobile', type: 'mobile' },
+    payment: { txHash: '...', amount: PRICE_USDC, verified: true },
+  };
+}
+
+function parseGoogleTrendingApps(data: string, country: string) {
+  // Placeholder implementation
+  return {
+    type: 'trending',
+    store: 'google',
+    country,
