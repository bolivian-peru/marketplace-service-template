// serp/google-serp-scraper.js
// Proxies.sx $200 Google SERP Scraper Bounty
// Built for mobile proxy pool + anti-bot resistance

const { chromium } = require('playwright');

async function scrapeGoogleSERP(query, proxyUrl) {
  let browser;
  try {
    browser = await chromium.launch({
      proxy: { server: proxyUrl },
      headless: true,
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });

    const page = await context.newPage();

    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Extract structured results
    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.g').forEach((el, index) => {
        const titleEl = el.querySelector('h3');
        const linkEl = el.querySelector('a');
        const snippetEl = el.querySelector('.VwiC3b') || el.querySelector('.V3FYCf');

        if (titleEl && linkEl) {
          items.push({
            position: index + 1,
            title: titleEl.innerText.trim(),
            link: linkEl.href,
            snippet: snippetEl ? snippetEl.innerText.trim() : '',
          });
        }
      });
      return items;
    });

    return {
      success: true,
      query: query,
      resultCount: results.length,
      results: results,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      query: query,
      timestamp: new Date().toISOString(),
    };
  } finally {
    if (browser) await browser.close();
  }
}

// Example usage (Proxies.sx will call this with their proxy pool)
async function main() {
  const query = process.argv[2] || "best mobile proxies 2026";
  const proxy = process.argv[3] || "http://user:pass@proxy.proxies.sx:port";

  console.log(`Scraping Google for: "${query}" using proxy: ${proxy}`);

  const result = await scrapeGoogleSERP(query, proxy);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { scrapeGoogleSERP };