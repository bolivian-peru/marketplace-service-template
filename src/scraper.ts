/**
 * Google SERP + AI Overview Scraper
 * Puppeteer-based scraper with stealth plugin for rendering dynamic content
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import { getProxy } from './proxy';

puppeteer.use(StealthPlugin());

export interface SerpResult {
  query: string;
  timestamp: string;
  organicResults: Array<{
    position: number;
    title: string;
    url: string;
    description: string;
  }>;
  featuredSnippet?: {
    title: string;
    answer: string;
    source: string;
    sourceUrl: string;
  };
  peopleAlsoAsk: Array<{
    question: string;
    answer: string;
    source: string;
    sourceUrl: string;
  }>;
  aiOverview?: {
    title: string;
    content: string;
    sources: Array<{
      title: string;
      url: string;
    }>;
  };
  proxyCountry?: string;
  totalResults?: string;
}

export async function scrapeGoogleSerp(query: string): Promise<SerpResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const proxy = getProxy();

    browser = (await puppeteer.launch({
      headless: true,
      args: [
        `--proxy-server=${proxy.host}:${proxy.port}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })) as Browser;

    page = await browser.newPage();

    // Authenticate the mobile proxy (required for credentials)
    await page.authenticate({
      username: proxy.user,
      password: proxy.pass,
    });

    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844 });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const organicResults = await page.evaluate(() => {
      const results: any[] = [];
      const items = document.querySelectorAll('div[data-sokoban-container] > div');
      let position = 1;

      items.forEach((item) => {
        const titleEl = item.querySelector('h3');
        const linkEl = item.querySelector('a[data-gsr]');
        const descEl = item.querySelector('[data-content-feature="snippet"]');

        if (titleEl && linkEl) {
          const url = linkEl.getAttribute('href') || '';
          if (url && !url.includes('webcache')) {
            results.push({
              position,
              title: titleEl.textContent?.trim() || '',
              url,
              description: descEl?.textContent?.trim() || '',
            });
            position++;
          }
        }
      });

      return results.slice(0, 10);
    });

    const featuredSnippet = await page.evaluate(() => {
      const box = document.querySelector('[data-answer-type="snippet"]');
      if (!box) return null;

      return {
        title: box.querySelector('h3')?.textContent?.trim() || '',
        answer: box.querySelector('[data-text-lines]')?.textContent?.trim() || '',
        source: box.querySelector('a')?.textContent?.trim() || '',
        sourceUrl: box.querySelector('a')?.getAttribute('href') || '',
      };
    });

    const peopleAlsoAsk = await page.evaluate(() => {
      const results: any[] = [];
      const container = document.querySelector('[aria-label*="People also ask"]');
      if (!container) return results;

      const items = container.querySelectorAll('[jsaction*="gsearch.ri"]');
      items.forEach((item) => {
        const q = item.querySelector('[role="button"]')?.textContent?.trim();
        const a = item.querySelector('[data-text-lines]')?.textContent?.trim();
        const s = item.querySelector('a[href]');

        if (q && a && s) {
          results.push({
            question: q,
            answer: a,
            source: s.textContent?.trim() || '',
            sourceUrl: s.getAttribute('href') || '',
          });
        }
      });

      return results.slice(0, 5);
    });

    const aiOverview = await page.evaluate(() => {
      const container =
        document.querySelector('[data-answer-type="generative"]') ||
        document.querySelector('g-expandable-content[data-answer-type="generative"]');

      if (!container) return null;

      const sources: any[] = [];
      container.querySelectorAll('a[href]').forEach((el) => {
        const url = el.getAttribute('href');
        const title = el.textContent?.trim();
        if (url && title && sources.length < 5) {
          sources.push({ title, url });
        }
      });

      return {
        title: container.querySelector('h3')?.textContent?.trim() || 'AI Overview',
        content: container.querySelector('[data-text-lines]')?.textContent?.trim() || '',
        sources,
      };
    });

    const totalResults = await page.evaluate(() => {
      return document.querySelector('#result-stats')?.textContent || '';
    });

    return {
      query,
      timestamp: new Date().toISOString(),
      organicResults,
      featuredSnippet: featuredSnippet || undefined,
      peopleAlsoAsk,
      aiOverview: aiOverview || undefined,
      proxyCountry: proxy.country,
      totalResults,
    };
  } catch (error: any) {
    console.error('[SCRAPER]', error.message);
    throw new Error(`Failed to scrape SERP: ${error.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
