import { chromium } from 'playwright';
import { ProxyConfig } from '../types';

export interface SubstackNote {
  author: string;
  timestamp: string;
  content: string;
  url: string;
  likes?: number;
  comments?: number;
}

export class SubstackScraper {
  private proxyConfig: ProxyConfig;

  constructor(proxyConfig: ProxyConfig) {
    this.proxyConfig = proxyConfig;
  }

  async scrapeNotes(url: string, limit: number = 10): Promise<SubstackNote[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        `--proxy-server=${this.proxyConfig.host}:${this.proxyConfig.port}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
    });

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      
      // Wait for notes to load
      await page.waitForSelector('[data-testid="author-link"]', { timeout: 10000 });

      const notes = await page.evaluate((limit) => {
        const noteElements = document.querySelectorAll('[data-testid="note"], .note, article');
        const results: SubstackNote[] = [];

        for (let i = 0; i < Math.min(noteElements.length, limit); i++) {
          const element = noteElements[i];
          
          // Updated selectors for April 2026 reader2 theme
          const authorEl = element.querySelector('a[data-testid="author-link"]');
          const timestampEl = element.querySelector('time');
          const contentEl = element.querySelector('.note-content, .post-content, p');
          
          const author = authorEl?.textContent?.trim() || 'Unknown';
          const timestamp = timestampEl?.getAttribute('datetime') || timestampEl?.textContent?.trim() || '';
          const content = contentEl?.textContent?.trim() || '';
          const noteUrl = authorEl?.getAttribute('href') || url;
          
          // Extract engagement metrics if available
          const likesEl = element.querySelector('[data-testid="like-button"], .like-count');
          const commentsEl = element.querySelector('[data-testid="comment-button"], .comment-count');
          
          const likes = likesEl ? parseInt(likesEl.textContent?.match(/\d+/)?.[0] || '0') : undefined;
          const comments = commentsEl ? parseInt(commentsEl.textContent?.match(/\d+/)?.[0] || '0') : undefined;

          if (author && content) {
            results.push({
              author,
              timestamp,
              content,
              url: noteUrl,
              likes,
              comments
            });
          }
        }

        return results;
      }, limit);

      return notes;
    } finally {
      await browser.close();
    }
  }

  async getAuthorNotes(authorUrl: string, limit: number = 20): Promise<SubstackNote[]> {
    return this.scrapeNotes(authorUrl, limit);
  }

  async searchNotes(query: string, limit: number = 10): Promise<SubstackNote[]> {
    const searchUrl = `https://substack.com/search?q=${encodeURIComponent(query)}`;
    return this.scrapeNotes(searchUrl, limit);
  }
}