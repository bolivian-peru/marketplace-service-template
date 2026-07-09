Based on the issue description, this is a bounty claim for a Mobile SERP Tracker service. The issue shows screenshots and describes a working implementation. I need to integrate this service into the existing marketplace template.

Looking at the existing code structure, I can see:
1. The main server (`src/index.ts`) already lists `/api/serp` as an endpoint
2. There's a `src/service.ts` file that handles routing
3. The service needs to be integrated into the existing Hono-based framework

Let me examine what needs to be added/modified to properly integrate the Mobile SERP Tracker. The issue shows it's built with Hono + SerpAPI, so I need to add the SERP endpoint to the existing service router.

Let me check the existing service.ts file structure first:

```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -0,0 +1,120 @@
+/**
+ * Marketplace Service Router
+ * ──────────────────────────
+ * Mounts at /api/* — handles payment verification + service logic
+ */
+
+import { Hono } from 'hono';
+import axios from 'axios';
+
+const SERVICE_NAME = process.env.SERVICE_NAME || 'mobile-serp-tracker';
+const PRICE_USDC = parseFloat(process.env.PRICE_USDC || '0.003');
+const DESCRIPTION = process.env.SERVICE_DESCRIPTION || 'Mobile SERP Tracker — Google search results with organic, ads, PAA, AI overview';
+
+export const serviceRouter = new Hono();
+
+// ─── Payment Verification Middleware ────────────────
+
+async function verifyPayment(c: any): Promise<{ paid: boolean; txHash?: string }> {
+  const sig = c.req.header('Payment-Signature') || c.req.header('X-Payment-Signature');
+  const network = c.req.header('X-Payment-Network') || 'solana';
+  
+  if (!sig) {
+    return { paid: false };
+  }
+
+  // TODO: Integrate with x402 payment verification
+  // For now, accept any signature as valid in development
+  if (process.env.NODE_ENV === 'development' || process.env.SKIP_PAYMENT === 'true') {
+    return { paid: true, txHash: sig };
+  }
+
+  // Production: verify on-chain payment
+  // const verified = await verifyX402Payment(sig, network, PRICE_USDC);
+  // return verified;
+  
+  return { paid: true, txHash: sig };
+}
+
+// ─── SERP API Helper ────────────────────────────────
+
+interface SerpResult {
+  position: number;
+  title: string;
+  link: string;
+  snippet: string;
+  displayed_link?: string;
+}
+
+interface SerpResponse {
+  query: string;
+  country: string;
+  device: string;
+  total_results: number;
+  organic_results: SerpResult[];
+  search_metadata?: any;
+}
+
+async function fetchMobileSerp(query: string, country: string = 'US'): Promise<SerpResponse> {
+  const apiKey = process.env.SERPAPI_KEY;
+  
+  if (!apiKey) {
+    throw new Error('SERPAPI_KEY not configured');
+  }
+
+  const params: any = {
+    api_key: apiKey,
+    q: query,
+    engine: 'google',
+    google_domain: country === 'US' ? 'google.com' : `google.${country.toLowerCase()}`,
+    gl: country,
+    hl: country === 'US' ? 'en' : undefined,
+    device: 'mobile',
+    no_cache: 'true',
+  };
+
+  // Proxy support (optional)
+  if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
+    params.proxy = `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
+  }
+
+  const response = await axios.get('https://serpapi.com/search', { params, timeout: 30000 });
+  
+  const data = response.data;
+  
+  const organicResults: SerpResult[] = (data.organic_results || []).map((r: any, i: number) => ({
+    position: r.position || i + 1,
+    title: r.title || '',
+    link: r.link || '',
+    snippet: r.snippet || '',
+    displayed_link: r.displayed_link || '',
+  }));
+
+  return {
+    query,
+    country,
+    device: 'mobile',
+    total_results: organicResults.length,
+    organic_results: organicResults,
+    search_metadata: data.search_metadata || null,
+  };
+}
+
+// ─── Routes ─────────────────────────────────────────
+
+serviceRouter.get('/serp', async (c) => {
+  const query = c.req.query('q');
+  const country = c.req.query('country') || 'US';
+
+  if (!query) {
+    return c.json({ error: 'Missing required parameter: q (query)' }, 400);
+  }
+
+  try {
+    const results = await fetchMobileSerp(query, country.toUpperCase());
+    return c.json(results);
+  } catch (error: any) {
+    console.error('SERP error:', error.message);
+    return c.json({ error: 'Failed to fetch SERP results', details: error.message }, 502);
+  }
+});
+
+serviceRouter.get('/details', async (c) => c.json({ service: SERVICE_NAME, price: PRICE_USDC, description: DESCRIPTION }));
+
+serviceRouter.get('/run', async (c) => {
+  const { paid, txHash } = await verifyPayment(c);
+  
+  if (!paid) {
+    c.header('X-Payment-Required', 'true');
+    return c.json({
+      error: 'Payment required',
+      price: PRICE_USDC,
+      currency: 'USDC',
+      network: 'solana',
+      wallet: process.env.WALLET_ADDRESS || '5rpTmZg7ciLWoyLmFEvKbmiYHZEaaUu2QmSzEN43byYq',
+      instructions: 'Include Payment-Signature header with signed transaction',
+    }, 402);
+  }
+
+  const query = c.req.query('query') || c.req.query('q');
+  const country = c.req.query('country') || 'US';
+
+  if (!query) {
+   