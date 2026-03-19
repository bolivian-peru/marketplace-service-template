```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,12 +1,13 @@
 import { Hono } from 'hono';
 import { proxyFetch } from '../utils/proxyFetch';
 import { verifyPayment } from '../utils/payment';
+import { parseQueryParams } from '../utils/queryParams';
 
 const SERVICE_NAME = 'facebook-marketplace-monitor';
 const PRICE_USDC = 0.01;
 const DESCRIPTION = 'Search and monitor Facebook Marketplace listings by category, keyword, location, and price range.';
 
 const serviceRouter = new Hono();
+const listingRouter = new Hono();
 
 serviceRouter.get('/run', async (c) => {
   const { query, location, radius, min_price, max_price } = c.req.query();
@@ -15,7 +16,7 @@
   if (!paymentVerified) {
     return c.json({ error: 'Payment required' }, 402);
   }
-  const result = await proxyFetch('https://target.com');
+  const result = await searchFacebookMarketplace(query, location, radius, min_price, max_price);
   return c.json({ data: await result.text() });
 });
 
@@ -24,6 +25,100 @@
   return c.json({ status: 'healthy', service: SERVICE_NAME, description: DESCRIPTION });
 });
 
+async function searchFacebookMarketplace(query: string, location: string, radius: string, min_price: string, max_price: string) {
+  // Construct the search URL with query parameters
+  const searchUrl = `https://facebook.com/marketplace/search/?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&radius=${encodeURIComponent(radius)}&min_price=${encodeURIComponent(min_price)}&max_price=${encodeURIComponent(max_price)}`;
+  const response = await proxyFetch(searchUrl);
+  const html = await response.text();
+  // Parse the HTML to extract listing details
+  const listings = parseListings(html);
+  return new Response(JSON.stringify({ results: listings, meta: { query, total_results: listings.length } }), { headers: { 'Content-Type': 'application/json' } });
+}
+
+function parseListings(html: string) {
+  // Simple regex to extract listing details (this is a placeholder and should be replaced with a proper parser)
+  const listings = [];
+  const regex = /<div class="[^"]*x1lkfr7t[^"]*">([^<]+)<\/div>[\s\S]*?<div class="[^"]*x1lkfr7t[^"]*">(\$[\d,]+)<\/div>/g;
+  let match;
+  while ((match = regex.exec(html)) !== null) {
+    listings.push({
+      title: match[1].trim(),
+      price: parseInt(match[2].replace('$', '').replace(',', ''), 10),
+      currency: 'USD',
+      location: 'Unknown', // Location parsing is complex and requires more sophisticated HTML parsing
+      seller: {
+        name: 'Unknown',
+        joined: 'Unknown',
+        rating: 'Unknown'
+      },
+      condition: 'Unknown',
+      posted_at: new Date().toISOString(),
+      images: [],
+      url: 'https://facebook.com/marketplace/item/unknown'
+    });
+  }
+  return listings;
+}
+
+listingRouter.get('/:id', async (c) => {
+  const listingId = c.req.param('id');
+  const paymentVerified = await verifyPayment(c, PRICE_USDC);
+  if (!paymentVerified) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+  const listingUrl = `https://facebook.com/marketplace/item/${listingId}`;
+  const response = await proxyFetch(listingUrl);
+  const html = await response.text();
+  // Parse the HTML to extract listing details
+  const listing = parseListing(html);
+  return c.json(listing);
+});
+
+function parseListing(html: string) {
+  // Simple regex to extract listing details (this is a placeholder and should be replaced with a proper parser)
+  const titleMatch = /<h1 class="[^"]*x1lkfr7t[^"]*">([^<]+)<\/h1>/g.exec(html);
+  const priceMatch = /<div class="[^"]*x1lkfr7t[^"]*">(\$[\d,]+)<\/div>/g.exec(html);
+  return {
+    id: 'unknown',
+    title: titleMatch ? titleMatch[1].trim() : 'Unknown',
+    price: priceMatch ? parseInt(priceMatch[1].replace('$', '').replace(',', ''), 10) : 0,
+    currency: 'USD',
+    location: 'Unknown', // Location parsing is complex and requires more sophisticated HTML parsing
+    seller: {
+      name: 'Unknown',
      joined: 'Unknown',
      rating: 'Unknown'
    },
    condition: 'Unknown',
    posted_at: new Date().toISOString(),
    images: [],
    url: 'https://facebook.com/marketplace/item/unknown'
  };
}
+
+serviceRouter.get('/categories', async (c) => {
+  const { location } = c.req.query();
+  const paymentVerified = await verifyPayment(c, PRICE_USDC);
+  if (!paymentVerified) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+  const categoriesUrl = `https://facebook.com/marketplace/${encodeURIComponent(location)}/categories`;
+  const response = await proxyFetch(categoriesUrl);
+  const html = await response.text();
+  // Parse the HTML to extract categories
+  const categories = parseCategories(html);
+  return c.json({ results: categories, meta: { location } });
+});
+
+function parseCategories(html: string) {
+  // Simple regex to extract categories (this is a placeholder and should be replaced with a proper parser)
+  const categories = [];
+  const regex = /<div class="[^"]*x1lkfr7t[^"]*">([^<]+)<\/div>/g;
+  let match;
+  while ((match = regex.exec(html)) !== null) {
+    categories.push(match[1].trim());
+  }
+  return categories;
+}
+
+serviceRouter.get('/new', async (c) => {
+  const { query, since } = c.req.query();
+  const paymentVerified = await verifyPayment(c, 0.02);
+  if (!paymentVerified) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+  const newUrl = `https://facebook.com/marketplace/search/?query=${encodeURIComponent(query)}&since=${encodeURIComponent(since)}`;
+  const response = await proxyFetch(newUrl);
+  const html = await response.text();
+  // Parse the HTML