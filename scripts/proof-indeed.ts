diff --git a/scripts/proof-indeed.ts b/scripts/proof-indeed.ts
index 1234567..89abcde 100644
--- a/scripts/proof-indeed.ts
+++ b/scripts/proof-indeed.ts
@@ -1,10 +1,15 @@
 import { scrapeIndeed } from '../src/scrapers/job-scraper';
 import { getProxy, proxyFetch } from '../src/proxy';
 
+const MAX_RETRIES = 3;
+
 async function getExitIp() {
   try {
     const r = await proxyFetch('https://api.ipify.org?format=json', { headers: { Accept: 'application/json' } });
     if (!r.ok) return null;
     const j: any = await r.json();
     return typeof j?.ip === 'string' ? j.ip : null;
   } catch (e: any) {
+    console.error('Failed to get exit IP:', e.message);
+    if (MAX_RETRIES > 0) {
+      console.log(`Retrying... (${MAX_RETRIES} attempts left)`);
+      return await getExitIp();
+    }
     return null;
   }
 }