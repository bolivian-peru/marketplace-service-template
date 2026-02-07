/**
 * SERP Scraper Test - Proof of Concept with Debug
 */

import { createStealthPage, closeBrowser } from './browser';
import { parseGoogleSerp, SerpResults } from './parser';
import * as fs from 'fs';

const GOOGLE_DOMAINS: Record<string, string> = {
  US: 'google.com',
  UK: 'google.co.uk',
  DE: 'google.de',
};

interface TestQuery {
  q: string;
  country: string;
  description: string;
}

const testQueries: TestQuery[] = [
  { q: 'best AI assistants 2025', country: 'US', description: 'US query - likely to have AI Overview' },
  { q: 'how does photosynthesis work', country: 'UK', description: 'UK query - educational topic' },
  { q: 'weather Berlin today', country: 'DE', description: 'DE query - local search' },
];

async function runTest(query: TestQuery, index: number): Promise<SerpResults | null> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: "${query.q}" (${query.country})`);
  console.log('='.repeat(60));

  let context: any = null;
  
  try {
    const browser = await createStealthPage({ 
      country: query.country, 
      useProxy: false,
      headless: true,
    });
    context = browser.context;
    const page = browser.page;

    const domain = GOOGLE_DOMAINS[query.country] || 'google.com';
    const searchUrl = `https://www.${domain}/search?q=${encodeURIComponent(query.q)}&hl=en&gl=${query.country.toLowerCase()}`;

    console.log(`Navigating to: ${searchUrl}`);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for page to stabilize
    await page.waitForTimeout(3000);

    // Handle consent
    try {
      const consentSelectors = [
        '#L2AGLb', 
        'button[id*="agree"]',
        '[aria-label*="Accept"]',
        'button:has-text("Accept all")',
        'button:has-text("Alle akzeptieren")',
      ];
      for (const sel of consentSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          console.log('Accepted cookie consent');
          await page.waitForTimeout(2000);
          break;
        }
      }
    } catch {}

    // Save screenshot for proof
    const screenshotPath = `proof_${index}_${query.country}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Save HTML for debugging
    const html = await page.content();
    fs.writeFileSync(`debug_${index}_${query.country}.html`, html);
    console.log(`HTML saved: debug_${index}_${query.country}.html`);

    // Check for CAPTCHA
    const pageContent = await page.textContent('body');
    if (pageContent?.includes('unusual traffic') || pageContent?.includes('captcha')) {
      console.log('⚠️ CAPTCHA detected - would need mobile proxy in production');
    }

    // Extract results using evaluate
    const extractedData = await page.evaluate(() => {
      const results: any = {
        organic: [],
        peopleAlsoAsk: [],
        relatedSearches: [],
      };

      // Organic results - multiple selector strategies
      const organicSelectors = [
        'div.g div.yuRUbf a',
        'div[data-hveid] a[href^="http"]:not([href*="google"])',
        '.v5yQqb a.cz3goc',
        '#search a[data-ved][href^="http"]:not([href*="google"])',
      ];

      for (const selector of organicSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el, i) => {
            const link = el as HTMLAnchorElement;
            const href = link.href;
            if (href && !href.includes('google.com/search') && results.organic.length < 10) {
              // Find title
              let title = '';
              const h3 = link.querySelector('h3');
              if (h3) title = h3.textContent || '';
              if (!title) title = link.textContent || '';
              
              // Find snippet
              let snippet = '';
              const parent = link.closest('div.g') || link.closest('[data-hveid]');
              if (parent) {
                const snippetEl = parent.querySelector('.VwiC3b, .lEBKkf, [data-sncf], .st');
                if (snippetEl) snippet = snippetEl.textContent || '';
              }

              if (title && href && !results.organic.find((r: any) => r.url === href)) {
                results.organic.push({
                  position: results.organic.length + 1,
                  title: title.trim(),
                  url: href,
                  snippet: snippet.trim(),
                });
              }
            }
          });
          if (results.organic.length > 0) break;
        }
      }

      // People Also Ask
      const paaElements = document.querySelectorAll('[data-q], .wQiwMc, [jsname="Cpkphb"]');
      paaElements.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 10 && text.length < 200) {
          results.peopleAlsoAsk.push(text);
        }
      });

      // Related Searches
      const relatedElements = document.querySelectorAll('.k8XOCe, .s75CSd, .EIaa9b, [data-ved] a.k8XOCe');
      relatedElements.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 100) {
          results.relatedSearches.push(text);
        }
      });

      // Debug info
      results._debug = {
        bodyLength: document.body.innerHTML.length,
        hasResults: document.querySelector('#search') !== null,
        title: document.title,
      };

      return results;
    });

    console.log('\n📊 Raw Extraction:');
    console.log(`   Body length: ${extractedData._debug.bodyLength}`);
    console.log(`   Has #search: ${extractedData._debug.hasResults}`);
    console.log(`   Page title: ${extractedData._debug.title}`);
    console.log(`   Organic found: ${extractedData.organic.length}`);
    console.log(`   PAA found: ${extractedData.peopleAlsoAsk.length}`);
    console.log(`   Related found: ${extractedData.relatedSearches.length}`);

    // Build result
    const result: SerpResults = {
      query: query.q,
      country: query.country,
      timestamp: new Date().toISOString(),
      results: {
        organic: extractedData.organic,
        ads: [],
        aiOverview: null,
        featuredSnippet: null,
        peopleAlsoAsk: extractedData.peopleAlsoAsk.slice(0, 8),
        relatedSearches: extractedData.relatedSearches.slice(0, 8),
        knowledgePanel: null,
      },
      metadata: {
        totalResults: '',
        searchTime: '',
        scrapedAt: new Date().toISOString(),
        proxyCountry: query.country,
      },
    };

    await context.close();
    return result;

  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    if (context) await context.close().catch(() => {});
    return null;
  }
}

async function main() {
  console.log('\n🔍 Google SERP Scraper - Test Run');
  console.log('━'.repeat(60));

  const results: SerpResults[] = [];

  for (let i = 0; i < testQueries.length; i++) {
    const result = await runTest(testQueries[i], i);
    if (result) {
      results.push(result);
    }
    // Delay between queries
    if (i < testQueries.length - 1) {
      console.log('\nWaiting 3s before next query...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n\n' + '═'.repeat(60));
  console.log('📋 FINAL RESULTS');
  console.log('═'.repeat(60));

  if (results.length > 0) {
    console.log('\n📦 Full JSON Output:');
    console.log(JSON.stringify(results, null, 2));
  }

  await closeBrowser();
  console.log('\n✅ Done!');
}

main().catch(console.error);
