```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,12 +1,153 @@
 import { Hono } from 'hono';
 import { proxyFetch } from './proxy';
 import { verifyPayment } from './payment';
+import { z } from 'zod';
+import { parse } from 'node-html-parser';
+import axios from 'axios';

 const SERVICE_NAME = 'real-estate-listing-intelligence';
 const PRICE_USDC = 0.02;
 const DESCRIPTION = 'Real Estate Listing Intelligence API';

 const serviceRouter = new Hono();
+const zpidSchema = z.string().regex(/^\d+$/);
+const searchSchema = z.object({
+  address: z.string().optional(),
+  zip: z.string().optional(),
+  type: z.enum(['for_sale', 'for_rent', 'sold']).optional(),
+  min_price: z.number().optional(),
+  max_price: z.number().optional(),
+  bedrooms: z.number().optional(),
+  bathrooms: z.number().optional(),
+  property_type: z.string().optional(),
+});
+const marketSchema = z.object({
+  zip: z.string(),
+});
+const compsSchema = z.object({
+  zpid: z.string().regex(/^\d+$/),
+  radius: z.string().optional(),
+});

-serviceRouter.get('/run', async (c) => {
+serviceRouter.get('/api/realestate/property/:zpid', async (c) => {
+  const { zpid } = c.req.param();
+  const parsedZpid = zpidSchema.safeParse(zpid);
+  if (!parsedZpid.success) {
+    return c.json({ error: 'Invalid ZPID' }, 400);
+  }
+
+  if (!await verifyPayment(c, PRICE_USDC)) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+
+  try {
+    const response = await proxyFetch(`https://www.zillow.com/homedetails/${parsedZpid.data}_zpid/`);
+    const html = await response.text();
+    const root = parse(html);
+
+    // Extract data from the HTML
+    const address = root.querySelector('h1')?.innerText.trim() || '';
+    const price = parseFloat(root.querySelector('.Text-c111i4e0-0')?.innerText.replace(/[^0-9.]/g, '') || '0');
+    const zestimate = parseFloat(root.querySelector('.Text__styledText-sc-16l9dox-0')?.innerText.replace(/[^0-9.]/g, '') || '0');
+    const photos = Array.from(root.querySelectorAll('.photo-card-image')).map(img => img.getAttribute('src') || '');
+
+    return c.json({
+      zpid: parsedZpid.data,
+      address,
+      price,
+      zestimate,
+      price_history: [],
+      details: {},
+      neighborhood: {},
+      photos,
+      meta: {
+        proxy: { ip: '', country: 'US', carrier: 'AT&T' }
+      }
+    });
+  } catch (error) {
+    return c.json({ error: 'Failed to fetch property data' }, 500);
+  }
+});
+
+serviceRouter.get('/api/realestate/search', async (c) => {
+  const query = c.req.query();
+  const parsedQuery = searchSchema.safeParse(query);
+  if (!parsedQuery.success) {
+    return c.json({ error: 'Invalid search parameters' }, 400);
+  }
+
+  if (!await verifyPayment(c, PRICE_USDC)) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+
+  try {
+    const response = await proxyFetch(`https://www.zillow.com/search/?address=${parsedQuery.data.address || ''}&zipcode=${parsedQuery.data.zip || ''}`);
+    const html = await response.text();
+    const root = parse(html);
+
+    // Extract data from the HTML
+    const listings = Array.from(root.querySelectorAll('.list-card-info')).map(listing => ({
+      address: listing.querySelector('.list-card-addr')?.innerText.trim() || '',
+      price: parseFloat(listing.querySelector('.list-card-price')?.innerText.replace(/[^0-9.]/g, '') || '0'),
+      zpid: listing.getAttribute('id')?.replace('zpid_', '') || '',
+    }));
+
+    return c.json(listings);
+  } catch (error) {
+    return c.json({ error: 'Failed to fetch search results' }, 500);
+  }
+});
+
+serviceRouter.get('/api/realestate/market', async (c) => {
+  const query = c.req.query();
+  const parsedQuery = marketSchema.safeParse(query);
+  if (!parsedQuery.success) {
+    return c.json({ error: 'Invalid market parameters' }, 400);
+  }
+
+  if (!await verifyPayment(c, 0.05)) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+
+  try {
+    const response = await axios.get(`https://api.realtor.com/v2/zip-code/${parsedQuery.data.zip}/statistics`);
+    const data = response.data;
+
+    return c.json({
+      zip: parsedQuery.data.zip,
+      median_home_value: data.median_home_value,
+      median_rent: data.median_rent,
+      inventory: data.inventory
+    });
+  } catch (error) {
+    return c.json({ error: 'Failed to fetch market data' }, 500);
+  }
+});
+
+serviceRouter.get('/api/realestate/comps/:zpid', async (c) => {
+  const { zpid } = c.req.param();
+  const query = c.req.query();
+  const parsedZpid = zpidSchema.safeParse(zpid);
+  const parsedQuery = compsSchema.safeParse(query);
+  if (!parsedZpid.success || !parsedQuery.success) {
+    return c.json({ error: 'Invalid parameters' }, 400);
+  }
+
+  if (!await verifyPayment(c, 0.03)) {
+    return c.json({ error: 'Payment required' }, 402);
+  }
+
+  try {
+    const response = await proxyFetch(`https://www.zillow.com/homedetails/${parsedZpid.data}_zpid/comparables/`);
+    const html = await response.text();
+    const root = parse(html);
+
+    // Extract data from the HTML
+    const comps = Array.from(root.querySelectorAll('.comparables-list-item')).map(comp => ({
+      address: comp.querySelector('.list-card-addr')?.innerText.trim() || '',
+      price: parseFloat(comp.querySelector('.list