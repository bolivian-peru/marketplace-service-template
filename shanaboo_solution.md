```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,10 +1,12 @@
 import { Hono } from 'hono';
 import { cors } from 'hono/cors';
 import { serve } from 'bun';
+import * as cheerio from 'cheerio';
 import {
   createPaymentMiddleware,
   verifyPayment,
   type PaymentConfig,
+  type PaymentMiddleware,
 } from './x402/payment';
 import { proxyFetch } from './proxy';
 
@@ -13,9 +15,9 @@ import { proxyFetch } from './proxy';
 // ============================
 
 const SERVICE_NAME = 'linkedin-enrichment';
-const PRICE_USDC = 0.03; // $0.03 per person profile (cheapest endpoint)
+const BASE_PRICE_USDC = 0.03;
 const DESCRIPTION =
-  'LinkedIn People & Company Enrichment API. Enrich business contacts with current job title, company, industry, location, and skills from LinkedIn public profiles. Also extracts company data: employee count, growth rate, job openings, and technology stack signals.';
+  'LinkedIn People & Company Enrichment API. Enrich business contacts with current job title, company, industry, location, and skills from LinkedIn public profiles. Extracts company data: employee count, industry, headquarters, jobs.';
 
 // ============================
 // Payment Configuration
@@ -23,7 +25,7 @@ const DESCRIPTION =
 
 const paymentConfig: PaymentConfig = {
   serviceName: SERVICE_NAME,
-  price: PRICE_USDC,
+  price: BASE_PRICE_USDC,
   description: DESCRIPTION,
   walletAddress: process.env.WALLET_ADDRESS || '',
 };
@@ -33,6 +35,7 @@ const paymentConfig: PaymentConfig = {
 // ============================
 
 const app = new Hono();
+const serviceRouter = new Hono();
 
 app.use(
   cors({
@@ -42,6 +45,12 @@ app.use(
   })
 );
 
+// Health check (no payment)
+app.get('/health', (c) => {
+  return c.json({ status: 'healthy', service: SERVICE_NAME });
+});
+
+// Service discovery (no payment)
 app.get('/', (c) => {
   return c.json({
     name: SERVICE_NAME,
@@ -49,7 +58,7 @@ app.get('/', (c) => {
     endpoints: [
       {
         path: '/api/linkedin/person',
-        price: 0.03,
+        price: BASE_PRICE_USDC,
         description: 'Enrich a person profile from LinkedIn URL',
         parameters: {
           url: 'LinkedIn profile URL (e.g., https://linkedin.com/in/username)',
@@ -57,7 +66,7 @@ app.get('/', (c) => {
       },
       {
         path: '/api/linkedin/company',
-        price: 0.05,
+        price: BASE_PRICE_USDC + 0.02,
         description: 'Enrich a company profile from LinkedIn URL',
         parameters: {
           url: 'LinkedIn company URL (e.g., https://linkedin.com/company/name)',
@@ -65,7 +74,7 @@ app.get('/', (c) => {
       },
       {
         path: '/api/linkedin/search/people',
-        price: 0.1,
+        price: BASE_PRICE_USDC + 0.07,
         description: 'Search people by title, location, and industry',
         parameters: {
           title: 'Job title (e.g., CTO)',
@@ -75,7 +84,7 @@ app.get('/', (c) => {
       },
       {
         path: '/api/linkedin/company/:id/employees',
-        price: 0.1,
+        price: BASE_PRICE_USDC + 0.07,
         description: 'Get employees of a company with optional title filter',
         parameters: {
           id: 'Company ID or vanity name',
@@ -86,6 +95,7 @@ app.get('/', (c) => {
     pricing: {
       currency: 'USDC',
       network: 'Solana',
+      basePrice: BASE_PRICE_USDC,
     },
   });
 });
@@ -94,6 +104,7 @@ app.get('/', (c) => {
 // LinkedIn Profile Scraping Helpers
 // ============================
 
+const LINKEDIN_BASE = 'https://www.linkedin.com';
 const USER_AGENTS = [
   'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
@@ -105,6 +116,7 @@ const USER_AGENTS = [
 function getRandomUserAgent(): string {
   return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
 }
+
 function getRandomDelay(min = 2000, max = 5000): number {
   return Math.floor(Math.random() * (max - min + 1)) + min;
 }
@@ -114,7 +126,7 @@ async function fetchWithRetry(
   retries = 3
 ): Promise<Response> {
   for (let i = 0; i < retries; i++) {
-    const response = await proxyFetch(url, {
+    const response = await proxyFetch(url.toString(), {
       headers: {
         'User-Agent': getRandomUserAgent(),
         Accept:
@@ -126,7 +138,7 @@ async function fetchWithRetry(
     });
 
     if (response.status === 429 || response.status === 403) {
-      console.log(`Rate limited, attempt ${i + 1}/${retries}`);
+      console.log(`Rate limited (${response.status}), attempt ${i + 1}/${retries}`);
       await new Promise((resolve) => setTimeout(resolve, getRandomDelay()));
       continue;
     }
@@ -137,6 +149,7 @@ async function fetchWithRetry(
   throw new Error('Max retries exceeded');
 }
 
+// Extract person profile data from LinkedIn HTML
 async function scrapePersonProfile(url: string): Promise<Record<string, any>> {
   const response = await fetchWithRetry(url);
   const html = await response.text();
@@ -144,7 +157,7 @@ async function scrapePersonProfile(url: string): Promise<Record<string, any>> {
 
   // Extract JSON data from the page
   const scriptData = $('script[type="application/ld+json"]').html();
-  let personData: any = {};
+  let personData: Record<string, any> = {};
 
   if (scriptData) {
     try {
@@ -155,7 +168,7 @@ async function scrapePersonProfile(url: string): Promise<Record<string, any>> {
   }
 
   // Fallback to meta tags