/**
 * Google Discover Feed Scraper Service
 * Uses mobile proxies and headless browser to scrape Google Discover feed
 * @module services/discover-scraper.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright';
import { ProxyService } from './proxy.service';
import { PaymentService } from './payment.service';
import { ConfigService } from '@nestjs/config';

export interface DiscoverArticle {
  position: number;
  title: string;
  source: string;
  sourceUrl: string;
  url: string;
  snippet: string;
  imageUrl: string;
  contentType: 'article' | 'video' | 'web_story' | 'unknown';
  publishedAt: string | null;
  category: string;
  engagement: {
    hasVideoPreview: boolean;
    format: 'standard' | 'highlight' | 'trending';
  };
}

export interface DiscoverFeedResponse {
  country: string;
  category: string;
  timestamp: string;
  discover_feed: DiscoverArticle[];
  metadata: {
    feedLength: number;
    scrapedAt: string;
    proxyCountry: string;
    proxyCarrier: string;
  };
  proxy: {
    country: string;
    carrier: string;
    type: 'mobile';
  };
  payment: {
    txHash: string;
    amount: number;
    verified: boolean;
  };
}

@Injectable()
export class DiscoverScraperService {
  private readonly logger = new Logger(DiscoverScraperService.name);
  private readonly DISCOVER_URL = 'https://discover.google.com';
  private readonly MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';
  private readonly VIEWPORT = { width: 360, height: 800 };

  // Country to language/locale mapping
  private readonly COUNTRY_CONFIG = {
    US: { locale: 'en-US', language: 'en', domain: 'com' },
    DE: { locale: 'de-DE', language: 'de', domain: 'de' },
    GB: { locale: 'en-GB', language: 'en', domain: 'co.uk' },
    FR: { locale: 'fr-FR', language: 'fr', domain: 'fr' },
    ES: { locale: 'es-ES', language: 'es', domain: 'es' },
    PL: { locale: 'pl-PL', language: 'pl', domain: 'pl' },
  };

  // Category to Google Discover topic mapping
  private readonly CATEGORY_MAPPING = {
    technology: 'Technology',
    news: 'News',
    sports: 'Sports',
    entertainment: 'Entertainment',
    business: 'Business',
    science: 'Science',
    health: 'Health',
  };

  constructor(
    private readonly proxyService: ProxyService,
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Main method to scrape Google Discover feed
   */
  async scrapeFeed(
    country: string,
    category: string,
    paymentTxHash?: string,
  ): Promise<DiscoverFeedResponse> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    this.logger.log(`Starting Discover feed scrape for ${country}/${category}`);

    // Validate country
    if (!this.COUNTRY_CONFIG[country]) {
      throw new Error(`Unsupported country: ${country}. Supported: ${Object.keys(this.COUNTRY_CONFIG).join(', ')}`);
    }

    // Get mobile proxy
    const proxy = await this.proxyService.getMobileProxy(country);
    this.logger.debug(`Using proxy: ${proxy.country}/${proxy.carrier}`);

    // Verify payment if txHash provided
    let paymentVerified = false;
    let paymentAmount = 0;
    if (paymentTxHash) {
      const payment = await this.paymentService.verifyPayment(paymentTxHash);
      paymentVerified = payment.verified;
      paymentAmount = payment.amount;
    }

    // Launch browser with mobile proxy
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      browser = await this.launchBrowserWithProxy(proxy);
      page = await browser.newPage();

      // Configure mobile emulation
      await this.configureMobilePage(page, country);

      // Navigate to Google Discover
      await this.navigateToDiscover(page, country, category);

      // Wait for feed to load
      await this.waitForFeed(page);

      // Extract feed articles
      const articles = await this.extractFeedArticles(page, category);

      // Close browser
      await browser.close();

      const scrapedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      this.logger.log(`Scraped ${articles.length} articles in ${duration}ms`);

      return {
        country,
        category,
        timestamp,
        discover_feed: articles,
        metadata: {
          feedLength: articles.length,
          scrapedAt,
          proxyCountry: proxy.country,
          proxyCarrier: proxy.carrier,
        },
        proxy: {
          country: proxy.country,
          carrier: proxy.carrier,
          type: 'mobile',
        },
        payment: {
          txHash: paymentTxHash || '',
          amount: paymentAmount,
          verified: paymentVerified,
        },
      };
    } catch (error) {
      this.logger.error(`Scraping failed: ${error.message}`, error.stack);
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Launch browser with mobile proxy configuration
   */
  private async launchBrowserWithProxy(proxy: any): Promise<Browser> {
    const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;

    return await chromium.launch({
      headless: true,
      proxy: {
        server: proxyUrl,
      },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--window-size=${this.VIEWPORT.width},${this.VIEWPORT.height}`,
      ],
    });
  }

  /**
   * Configure page for mobile emulation
   */
  private async configureMobilePage(page: Page, country: string): Promise<void> {
    const config = this.COUNTRY_CONFIG[country];

    await page.setViewportSize(this.VIEWPORT);
    await page.setUserAgent(this.MOBILE_USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': `${config.language},en;q=0.9`,
      'X-Forwarded-For': '1.1.1.1', // Spoof IP for proxy
    });

    // Set geolocation based on country
    const geolocation = this.getCountryGeolocation(country);
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation(geolocation);
  }

  /**
   * Navigate to Google Discover with category preference
   */
  private async navigateToDiscover(page: Page, country: string, category: string): Promise<void> {
    const config = this.COUNTRY_CONFIG[country];
    const categoryParam = this.CATEGORY_MAPPING[category] || '';

    // Google Discover URL with parameters
    const url = `https://www.google.${config.domain}/?igu=1&source=discover`;
    
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // If category is specified, try to set preference
    if (categoryParam) {
      await this.setCategoryPreference(page, categoryParam);
    }
  }

  /**
   * Set category/topic preference in Discover
   */
  private async setCategoryPreference(page: Page, category: string): Promise<void> {
    try {
      // Click on "Customize" or settings button
      const customizeButton = await page.locator('button[aria-label*="Customize"], button[aria-label*="Settings"]').first();
      if (await customizeButton.isVisible()) {
        await customizeButton.click();
        await page.waitForTimeout(1000);

        // Search for category and select it
        const searchInput = await page.locator('input[type="search"], input[placeholder*="topic"]').first();
        if (await searchInput.isVisible()) {
          await searchInput.fill(category);
          await page.waitForTimeout(500);

          // Select the category if found
          const categoryOption = await page.locator(`div[role="option"]:has-text("${category}")`).first();
          if (await categoryOption.isVisible()) {
            await categoryOption.click();
            await page.waitForTimeout(500);
          }
        }

        // Close settings
        const closeButton = await page.locator('button[aria-label="Close"], button:has-text("Done")').first();
        if (await closeButton.isVisible()) {
          await closeButton.click();
          await page.waitForTimeout(2000);
        }
      }
    } catch (error) {
      this.logger.warn(`Could not set category preference: ${error.message}`);
    }
  }

  /**
   * Wait for Discover feed to load
   */
  private async waitForFeed(page: Page): Promise<void> {
    // Wait for feed container
    await page.waitForSelector('div[role="feed"], div[data-hveid], article, .EDblX', {
      timeout: 15000,
    });

    // Wait for at least some articles to load
    await page.waitForSelector('a[href*="/url?"], a[role="link"]', {
      timeout: 10000,
    });

    // Scroll to load more content
    await page.evaluate(() => {
      window.scrollBy(0, 800);
    });

    await page.waitForTimeout(2000);
  }

  /**
   * Extract articles from Discover feed
   */
  private async extractFeedArticles(page: Page, requestedCategory: string): Promise<DiscoverArticle[]> {
    const articles: DiscoverArticle[] = [];

    // Multiple selectors for Discover feed items
    const selectors = [
      'div[role="feed"] > div > div',
      'article',
      '.EDblX',
      '.WlydOe',
      '.mR2gOd',
    ];

    for (const selector of selectors) {
      const items = await page.locator(selector).all();
      if (items.length > 0) {
        for (let i = 0; i < Math.min(items.length, 50); i++) {
          try {
            const item = items[i];
            const article = await this.extractArticleData(item, i + 1, requestedCategory);
            if (article) {
              articles.push(article);
            }
          } catch (error) {
            this.logger.debug(`Failed to extract article ${i}: ${error.message}`);
          }
        }
        break;
      }
    }

    return articles;
  }

  /**
   * Extract data from individual article element
   */
  private async extractArticleData(
    element: any,
    position: number,
    requestedCategory: string,
  ): Promise<DiscoverArticle | null> {
    // Extract title
    const titleElement = await element.locator('h3, .nDgy9d, .mBsw3d').first();
    const title = await titleElement.textContent() || '';

    if (!title || title.length < 5) {
      return null;
    }

    // Extract source
    const sourceElement = await element.locator('.OSrXXb, .bVf5I, .UPmit').first();
    const source = await sourceElement.textContent() || 'Unknown';

    // Extract URL
    const linkElement = await element.locator('a[href*="/url?"]').first();
    const href = await linkElement.getAttribute('href') || '';
    const url = this.extractGoogleRedirectUrl(href);

    // Extract snippet
    const snippetElement = await element.locator('.GI74Re, .LRAIl').first();
    const snippet = await snippetElement.textContent() || '';

    // Extract image URL
    const imageElement = await element.locator('img, .LAA3yd').first();
    const imageUrl = await imageElement.getAttribute('src') || '';

    // Detect content type
    const contentType = await this.detectContentType(element);

    // Extract published date
    const publishedAt = await this.extractPublishedDate(element);

    // Detect video preview
    const hasVideoPreview = await this.hasVideoPreview(element);

    return {
      position,
      title: title.trim(),
      source: source.trim(),
      sourceUrl: this.extractSourceUrl(source, url),
      url,
      snippet: snippet.trim(),
      imageUrl,
      contentType,
      publishedAt,
      category: requestedCategory,
      engagement: {
        hasVideoPreview,
        format: await this.detectFormat(element),
      },
    };
  }

  /**
   * Extract actual URL from Google redirect
   */
  private extractGoogleRedirectUrl(href: string): string {
    if (!href.includes('/url?')) {
      return href;
    }

    try {
      const url = new URL(href, 'https://www.google.com');
      return url.searchParams.get('url') || href;
    } catch {
      return href;
    }
  }

  /**
   * Extract source URL from publisher name
   */
  private extractSourceUrl(source: string, articleUrl: string): string {
    try {
      const url = new URL(articleUrl);
      return `${url.protocol}//${url.hostname}`;
    } catch {
      // Try to construct from common patterns
      const cleanSource = source.toLowerCase().replace(/\s+/g, '');
      return `https://www.${cleanSource}.com`;
    }
  }

  /**
   * Detect content type of article
   */
  private async detectContentType(element: any): Promise<DiscoverArticle['contentType']> {
    // Check for video indicators
    const videoIndicator = await element.locator('.video-thumb, [aria-label*="video"], .PmEWV').first();
    if (await videoIndicator.isVisible()) {
      return 'video';
    }

    // Check for web story indicators
    const storyIndicator = await element.locator('.web-story, [data-story], .k2Oeod').first();
    if (await storyIndicator.isVisible()) {
      return 'web_story';
    }

    // Default to article
    return 'article';
  }

  /**
   * Extract published date if available
   */
  private async extractPublishedDate(element: any): Promise<string | null> {
    try {
      const dateElement = await element.locator('.LEwnzc, .h1hWbf, .OSrXXb + span').first();
      const dateText = await dateElement.textContent();
      
      if (dateText) {
        // Parse relative dates like "2 hours ago", "1 day ago"
        const parsedDate = this.parseRelativeDate(dateText);
        if (parsedDate) {
          return parsedDate.toISOString();
        }

        // Try to parse absolute dates
        const absoluteDate = new Date(dateText);
        if (!isNaN(absoluteDate.getTime())) {
          return absoluteDate.toISOString();
        }
      }
    } catch {
      // Ignore date parsing errors
    }

    return null;
  }

  /**
   * Parse relative date strings
   */
  private parseRelativeDate(text: string): Date | null {
    const now = new Date();
    const match = text.match(/(\d+)\s+(hour|day|minute|second)s?\s+ago/i);
    
    if (match) {
      const amount = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      
      switch (unit) {
        case 'hour':
          now.setHours(now.getHours() - amount);
          break;
        case 'day':
          now.setDate(now.getDate() - amount);
          break;
        case 'minute':
          now.setMinutes(now.getMinutes() - amount);
          break;
        case 'second':
          now.setSeconds(now.getSeconds() - amount);
          break;
      }
      
      return now;
    }
    
    return null;
  }

  /**
   * Check if article has video preview
   */
  private async hasVideoPreview(element: any): Promise<boolean> {
    const videoElements = await element.locator('video, .video-play-button, [data-video]').count();
    return videoElements > 0;
  }

  /**
   * Detect article format/type
   */
  private async detectFormat(element: any): Promise<'standard' | 'highlight' | 'trending'> {
    // Check for trending indicators
    const trendingIndicator = await element.locator('.trending, .hot, .fire').first();
    if (await trendingIndicator.isVisible()) {
      return 'trending';
    }

    // Check for highlight/featured indicators
    const highlightIndicator = await element.locator('.featured, .highlight, .promoted').first();
    if (await highlightIndicator.isVisible()) {
      return 'highlight';
    }

    return 'standard';
  }

  /**
   * Get geolocation coordinates for country
   */
  private getCountryGeolocation(country: string): { latitude: number; longitude: number } {
    const locations = {
      US: { latitude: 37.0902, longitude: -95.7129 }, // Center of US
      DE: { latitude: 51.1657, longitude: 10.4515 }, // Center of Germany
      GB: { latitude: 55.3781, longitude: -3.4360 }, // Center of UK
      FR: { latitude: 46.6034, longitude: 1.8883 }, // Center of France
      ES: { latitude: 40.4637, longitude: -3.7492 }, // Center of Spain
      PL: { latitude: 51.9194, longitude: 19.1451 }, // Center of Poland
    };

    return locations[country] || locations.US;
  }
}