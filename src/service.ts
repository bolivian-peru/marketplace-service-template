import { chromium, firefox, type Browser, type Page } from 'playwright';
import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'google-serp-ai-scraper';
const PRICE_USDC = 0.01;  // $0.01 per query
const DESCRIPTION = 'Scrape Google SERPs with AI Overview, Featured Snippets, and People Also Ask using real local browser rendering and mobile IPs.';

const OUTPUT_SCHEMA = {
  input: {
    q: 'string — search query (required)',
    gl: 'string — country code (optional, e.g., US, GB, DE, default US)',
    hl: 'string — language code (optional, e.g., en, de, default en)',
    num: 'number — results per page (optional, default 10, max 20)',
  },
  output: {
    query: 'string — search query',
    country: 'string — country code used',
    results: {
      organic: 'array — [{position, title, url, snippet}]',
      aiOverview: 'object|null — {text, sources: [{title, url}]}',
      featuredSnippet: 'object|null — {text, source, url}',
      peopleAlsoAsk: 'array — list of questions',
      relatedSearches: 'array — list of related search terms',
    },
    proxy: '{ country: string, type: "mobile" }',
  },
};

// ─── TYPES ─────────────────────────────────────────────

interface OrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

interface AiOverview {
  text: string;
  sources: Array<{ title: string; url: string }>;
}

interface FeaturedSnippet {
  text: string;
  source: string;
  url: string;
}

interface SerpResults {
  organic: OrganicResult[];
  aiOverview: AiOverview | null;
  featuredSnippet: FeaturedSnippet | null;
  peopleAlsoAsk: string[];
  relatedSearches: string[];
}

// ─── BROWSER UTILITIES ─────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── CONSENT / CAPTCHA HANDLING ─────────────────────────

async function handleConsentAndCaptcha(page: Page): Promise<{ success: boolean; captchaDetected: boolean }> {
  try {
    // Check for consent screen (EU cookie consent)
    const consentButton = await page.waitForSelector('button#L2AGLb, button[aria-label*="Accept"], form[action*="consent"] button', { timeout: 3000 }).catch(() => null);

    if (consentButton) {
      await consentButton.click();
      await sleep(1500);
    }
  } catch (e) {
    // Ignore if not found
  }

  // Check for CAPTCHA indicators in HTML
  const html = await page.content();
  const captchaIndicators = [
    'unusual traffic',
    'captcha',
    'recaptcha',
    'g-recaptcha',
    'not a robot',
    'automated queries',
  ];

  const captchaDetected = captchaIndicators.some(indicator =>
    html.toLowerCase().includes(indicator)
  );

  return { success: !captchaDetected, captchaDetected };
}

// ─── GOOGLE SEARCH & DOM EXTRACTION ─────────────────────

async function extractSerpFromPage(page: Page): Promise<SerpResults> {
  const results: SerpResults = {
    organic: [],
    aiOverview: null,
    featuredSnippet: null,
    peopleAlsoAsk: [],
    relatedSearches: [],
  };

  // Organic Results
  results.organic = await page.evaluate(() => {
    const items: OrganicResult[] = [];
    const containers = document.querySelectorAll('div.g, div[data-hveid] > div.g, div.MjjYud > div.g');
    let position = 1;

    containers.forEach(container => {
      const linkEl = container.querySelector('a[href^="http"]:not([href*="google.com"])') as HTMLAnchorElement;
      const titleEl = container.querySelector('h3');
      const snippetEl = container.querySelector('[data-sncf], [data-snf], .VwiC3b, .lEBKkf, span.aCOpRe');

      if (linkEl && titleEl) {
        const url = linkEl.href;
        const title = titleEl.textContent?.trim() || '';
        const snippet = snippetEl?.textContent?.trim() || '';

        if (url && title && !url.includes('google.com/search')) {
          items.push({ position: position++, title, url, snippet });
        }
      }
    });
    return items.slice(0, 20);
  });

  // AI Overview
  results.aiOverview = await page.evaluate(() => {
    const aiContainer = document.querySelector('[data-attrid="ai_overview"]') ||
      document.querySelector('div[data-sgrd]') ||
      document.querySelector('.wDYxhc[data-md]');

    if (!aiContainer) return null;

    const text = aiContainer.textContent?.trim() || '';
    if (text.length < 50) return null;

    const sources: Array<{ title: string; url: string }> = [];
    const sourceLinks = aiContainer.querySelectorAll('a[href^="http"]');
    sourceLinks.forEach(link => {
      const l = link as HTMLAnchorElement;
      const title = l.textContent?.trim() || '';
      const url = l.href;
      if (title && url && !url.includes('google.com')) {
        sources.push({ title: title.slice(0, 100), url });
      }
    });

    return {
      text: text.slice(0, 4000),
      sources: sources.slice(0, 5),
    };
  });

  // Featured Snippet
  results.featuredSnippet = await page.evaluate(() => {
    const snippetContainer = document.querySelector('.xpdopen .kno-rdesc, .xpdopen .ILfuVd, div.xpdopen span[data-ved], .co8aDb');
    const linkEl = snippetContainer?.closest('.xpdopen')?.querySelector('a[href^="http"]') as HTMLAnchorElement ||
      snippetContainer?.parentElement?.querySelector('a[href^="http"]') as HTMLAnchorElement;

    if (!snippetContainer) return null;

    const text = snippetContainer.textContent?.trim() || '';
    if (text.length < 20) return null;

    const url = linkEl?.href || '';
    const source = linkEl?.textContent?.trim() || (url ? new URL(url).hostname : '');

    return { text: text.slice(0, 1000), source, url };
  });

  // People Also Ask
  results.peopleAlsoAsk = await page.evaluate(() => {
    const questions: string[] = [];
    const paaItems = document.querySelectorAll('[data-sgrd="true"] [jsname], div.related-question-pair, div[data-q]');

    paaItems.forEach(item => {
      const text = item.getAttribute('data-q') || item.textContent?.trim() || '';
      if (text && text.length > 10 && text.length < 200) {
        questions.push(text);
      }
    });

    document.querySelectorAll('[role="button"][aria-expanded]').forEach(btn => {
      const text = btn.textContent?.trim() || '';
      if (text && text.endsWith('?') && text.length > 10 && text.length < 200) {
        if (!questions.includes(text)) {
          questions.push(text);
        }
      }
    });

    return [...new Set(questions)].slice(0, 10);
  });

  // Related Searches
  results.relatedSearches = await page.evaluate(() => {
    const searches: string[] = [];
    const relatedItems = document.querySelectorAll('div.k8XOCe a, a.ZWRArf, div.s75CSd a, div.brs_col a');

    relatedItems.forEach(item => {
      const text = item.textContent?.trim() || '';
      if (text && text.length > 2 && text.length < 100) {
        searches.push(text);
      }
    });

    return [...new Set(searches)].slice(0, 8);
  });

  return results;
}

// ─── MAIN SCRAPPING FUNCTION ────────────────────────────

async function scrapeGoogleSerp(
  query: string,
  gl: string,
  hl: string,
  num: number,
  maxRetries: number = 2,
): Promise<{ success: boolean; results?: SerpResults; error?: string; isBlock?: boolean }> {
  let lastError = '';
  let browser: Browser | null = null;
  const proxy = getProxy();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Rotate Engine: Chromium (0, 2) vs Firefox (1)
      const engineName = attempt === 1 ? 'firefox' : 'chromium';
      const engine = engineName === 'firefox' ? firefox : chromium;
      const method = attempt % 2 === 0 ? 'organic' : 'direct';

      console.log(`[${attempt + 1}] Scraping via ${method} using ${engineName}`);

      browser = await engine.launch({
        headless: true,
        proxy: {
          server: `http://${proxy.host}:${proxy.port}`,
          username: proxy.user,
          password: proxy.pass,
        },
        args: engineName === 'chromium' ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ] : [],
      });

      const viewports = [
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 412, height: 915 },
      ];
      const selectedViewport = viewports[Math.floor(Math.random() * viewports.length)];

      const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.8', 'en-US,en;q=0.5'];
      const selectedLang = languages[Math.floor(Math.random() * languages.length)];

      const context = await browser.newContext({
        userAgent: attempt === 1
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15'
          : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
        viewport: selectedViewport,
        hasTouch: true,
        extraHTTPHeaders: {
          'Accept-Language': selectedLang,
        }
      });

      const page = await context.newPage();

      if (engineName === 'chromium') {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          (window as any).chrome = { runtime: {} };
        });
      }

      // OPTIMIZATION: Block heavy resources
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media'].includes(type) || route.request().url().includes('google-analytics')) {
          return route.abort();
        }
        return route.continue();
      });

      // NEW: Log the actual public IP to verify rotation
      try {
        const ipResp = await page.goto('https://api.ipify.org?format=json', { timeout: 15000 });
        if (ipResp?.ok()) {
          const ipData = JSON.parse(await page.textContent('body') || '{}');
          console.log(`[${attempt + 1}] Session IP: ${ipData.ip} (${engineName})`);
        }
      } catch (e: any) {
        console.log(`[${attempt + 1}] Skip IP check: ${e.message}`);
      }

      if (method === 'organic') {
        const homeUrl = `https://www.google.com/?gl=${gl}&hl=en`;
        console.log(`[${attempt + 1}] ${engineName}: Navigating to Home...`);
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 50000, referer: 'https://www.google.com/' });
        console.log(`[${attempt + 1}] ${engineName}: Home Page Loaded.`);

        await sleep(1000 + Math.random() * 2000); // Wait for mobile JS
        console.log(`[${attempt + 1}] ${engineName}: Handling consent...`);
        await handleConsentAndCaptcha(page);

        const searchBox = await page.waitForSelector('textarea[name="q"], input[name="q"]', { timeout: 15000 }).catch(() => null);
        if (!searchBox) {
          const title = await page.title();
          console.log(`[${attempt + 1}] ${engineName}: No search box. Title: ${title}`);
          if (title.includes('Sorry')) {
            await browser.close();
            return {
              success: false,
              error: `Blocked on Home Page (${engineName})`,
              isBlock: true
            };
          }
        }
        console.log(`[${attempt + 1}] ${engineName}: Search Box Found.`);

        console.log(`[${attempt + 1}] ${engineName}: Typing query...`);
        for (const char of query) {
          await searchBox?.type(char, { delay: Math.random() * 100 + 50 });
        }
        await sleep(800);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 50000 }).catch(() => { }),
          searchBox?.press('Enter')
        ]);
      } else {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${gl}&hl=en&num=${num}`;
        console.log(`[${attempt + 1}] ${engineName}: Navigating Direct...`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 50000, referer: 'https://www.google.com/' });
        console.log(`[${attempt + 1}] ${engineName}: Search Page Loaded.`);
        console.log(`[${attempt + 1}] ${engineName}: Handling consent...`);
        await handleConsentAndCaptcha(page);
      }

      await sleep(3000 + Math.random() * 2000);

      const currentUrl = page.url();
      console.log(`[${attempt + 1}] ${engineName}: Current URL: ${currentUrl}`);
      if (currentUrl.includes('google.com/sorry')) {
        const content = await page.content();
        await Bun.write(`debug_blocked_${engineName}_att${attempt}.html`, content);
        await browser.close();
        return {
          success: false,
          error: `Blocked via ${engineName} (429/Sorry)`,
          isBlock: true
        };
      }

      console.log(`[${attempt + 1}] ${engineName}: Extraction Start.`);
      const results = await extractSerpFromPage(page);

      if (results.organic.length === 0) {
        lastError = 'No results extracted from page';
        await browser.close();
        continue;
      }

      console.log(`[${attempt + 1}] SUCCESS! Organic results found.`);
      await browser.close();
      return { success: true, results };

    } catch (err: any) {
      lastError = err.message;
      if (browser) await browser.close();
    }
  }

  return { success: false, error: lastError };
}

// ─── ENDPOINTS ─────────────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const query = c.req.query('q');
  if (!query) return c.json({ error: 'Missing parameter: q' }, 400);

  const gl = (c.req.query('gl') || 'US').toUpperCase();
  const hl = (c.req.query('hl') || 'en').toLowerCase();
  const num = Math.min(parseInt(c.req.query('num') || '10', 10), 20);

  const scrapeResult = await scrapeGoogleSerp(query, gl, hl, num);

  if (!scrapeResult.success || !scrapeResult.results) {
    const status = scrapeResult.isBlock ? 429 : 502;
    return c.json({ error: 'Scrape failed', message: scrapeResult.error }, status);
  }

  return c.json({
    query,
    country: gl,
    results: scrapeResult.results,
    proxy: { type: 'mobile' },
    payment: { txHash: payment.txHash, settled: true },
  });
});

serviceRouter.get('/discover', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not set' }, 500);
  return c.json({
    ...build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
    service: SERVICE_NAME,
  });
});

serviceRouter.get('/test', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: 'Missing parameter: q' }, 400);
  const gl = (c.req.query('gl') || 'US').toUpperCase();

  const scrapeResult = await scrapeGoogleSerp(query, gl, 'en', 10);
  if (!scrapeResult.success) {
    const status = scrapeResult.isBlock ? 429 : 502;
    return c.json({ error: scrapeResult.error }, status);
  }

  return c.json({
    query,
    results: scrapeResult.results,
    _test: true,
    _timestamp: new Date().toISOString()
  });
});
