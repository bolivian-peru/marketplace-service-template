/**
 * Mobile Ad Scraper Service
 * Uses headless browser and mobile proxies for ad verification
 */
import { chromium, Browser, Page } from 'playwright';
import { proxyFetch } from './proxy';
import { PaymentService } from './payment';
import { Ad, AdResult, SearchAdsParams, DisplayAdsParams, AdvertiserParams } from '../types/ads';

export class AdScraperService {
  private browser: Browser | null = null;
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  /**
   * Initialize headless browser with mobile emulation
   */
  private async initBrowser(country: string): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials'
        ]
      });
    }

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 }, // iPhone 12 Pro
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: this.getLocaleForCountry(country),
      timezoneId: this.getTimezoneForCountry(country)
    });

    // Add stealth plugins to avoid detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    return await context.newPage();
  }

  /**
   * Scrape Google Search ads for a query
   */
  async scrapeSearchAds(params: SearchAdsParams): Promise<AdResult> {
    const { query, country } = params;
    const page = await this.initBrowser(country);
    
    try {
      // Use mobile proxy for requests
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        const response = await proxyFetch(url, country);
        
        if (response) {
          await route.fulfill({
            status: response.status,
            headers: response.headers,
            body: response.body
          });
        } else {
          await route.continue();
        }
      });

      // Navigate to Google with mobile parameters
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${this.getLanguageForCountry(country)}&gl=${country.toLowerCase()}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Wait for ads to load
      await page.waitForTimeout(2000);
      
      // Extract ads
      const ads = await this.extractSearchAds(page);
      const organicCount = await this.countOrganicResults(page);
      
      return {
        type: 'search_ads',
        query,
        country,
        timestamp: new Date().toISOString(),
        ads,
        organic_count: organicCount,
        total_ads: ads.length,
        ad_positions: this.calculateAdPositions(ads),
        proxy: { country, carrier: 'T-Mobile', type: 'mobile' }, // Would be dynamic from proxy service
        payment: await this.paymentService.verifyPayment(params.paymentTxHash)
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Scrape display ads from a webpage
   */
  async scrapeDisplayAds(params: DisplayAdsParams): Promise<AdResult> {
    const { url, country } = params;
    const page = await this.initBrowser(country);
    
    try {
      await page.route('**/*', async (route) => {
        const requestUrl = route.request().url();
        const response = await proxyFetch(requestUrl, country);
        
        if (response) {
          await route.fulfill({
            status: response.status,
            headers: response.headers,
            body: response.body
          });
        } else {
          await route.continue();
        }
      });

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000); // Wait for ads to load
      
      // Extract display ads
      const ads = await this.extractDisplayAds(page);
      
      return {
        type: 'display_ads',
        url,
        country,
        timestamp: new Date().toISOString(),
        ads,
        organic_count: 0,
        total_ads: ads.length,
        ad_positions: { top: 0, bottom: 0, sidebar: ads.length },
        proxy: { country, carrier: 'T-Mobile', type: 'mobile' },
        payment: await this.paymentService.verifyPayment(params.paymentTxHash)
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Lookup advertiser in Google Ads Transparency Center
   */
  async lookupAdvertiser(params: AdvertiserParams): Promise<AdResult> {
    const { domain, country } = params;
    const page = await this.initBrowser(country);
    
    try {
      await page.route('**/*', async (route) => {
        const requestUrl = route.request().url();
        const response = await proxyFetch(requestUrl, country);
        
        if (response) {
          await route.fulfill({
            status: response.status,
            headers: response.headers,
            body: response.body
          });
        } else {
          await route.continue();
        }
      });

      // Navigate to Google Ads Transparency Center
      const transparencyUrl = `https://adstransparency.google.com/advertiser/${domain}?region=${country}`;
      await page.goto(transparencyUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Extract advertiser data
      const ads = await this.extractTransparencyAds(page, domain);
      
      return {
        type: 'advertiser',
        domain,
        country,
        timestamp: new Date().toISOString(),
        ads,
        organic_count: 0,
        total_ads: ads.length,
        ad_positions: {},
        proxy: { country, carrier: 'T-Mobile', type: 'mobile' },
        payment: await this.paymentService.verifyPayment(params.paymentTxHash)
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Extract Google Search ads from page
   */
  private async extractSearchAds(page: Page): Promise<Ad[]> {
    const ads: Ad[] = [];
    
    // Top ads (above organic results)
    const topAdElements = await page.$$('[data-text-ad="1"]');
    for (let i = 0; i < topAdElements.length; i++) {
      const ad = await this.extractAdFromElement(topAdElements[i], 'top', i + 1);
      if (ad) ads.push(ad);
    }
    
    // Bottom ads (below organic results)
    const bottomAdElements = await page.$$('.commercial-unit-desktop-top');
    for (let i = 0; i < bottomAdElements.length; i++) {
      const ad = await this.extractAdFromElement(bottomAdElements[i], 'bottom', i + 1);
      if (ad) ads.push(ad);
    }
    
    // Side ads (if any)
    const sideAdElements = await page.$$('[data-dtld="1"]');
    for (let i = 0; i < sideAdElements.length; i++) {
      const ad = await this.extractAdFromElement(sideAdElements[i], 'side', i + 1);
      if (ad) ads.push(ad);
    }
    
    return ads;
  }

  /**
   * Extract display ads from webpage
   */
  private async extractDisplayAds(page: Page): Promise<Ad[]> {
    const ads: Ad[] = [];
    
    // Common ad selectors across websites
    const adSelectors = [
      '[id*="ad-"]', '[class*="ad-"]', '[id*="Ad-"]', '[class*="Ad-"]',
      'iframe[src*="ads"]', 'ins.adsbygoogle', '.ad-container',
      '.advertisement', '.ad-unit', '.banner-ad'
    ];
    
    for (const selector of adSelectors) {
      const adElements = await page.$$(selector);
      for (let i = 0; i < adElements.length; i++) {
        const ad = await this.extractDisplayAdFromElement(adElements[i], i + 1);
        if (ad) ads.push(ad);
      }
    }
    
    return ads;
  }

  /**
   * Extract ads from Google Ads Transparency Center
   */
  private async extractTransparencyAds(page: Page, domain: string): Promise<Ad[]> {
    const ads: Ad[] = [];
    
    try {
      // Wait for ad cards to load
      await page.waitForSelector('.ad-card', { timeout: 10000 });
      
      const adCards = await page.$$('.ad-card');
      for (let i = 0; i < adCards.length; i++) {
        const card = adCards[i];
        
        const title = await card.$eval('.ad-title', el => el.textContent?.trim() || '');
        const description = await card.$eval('.ad-description', el => el.textContent?.trim() || '');
        const displayUrl = await card.$eval('.ad-url', el => el.textContent?.trim() || '');
        
        ads.push({
          position: i + 1,
          placement: 'transparency',
          title,
          description,
          displayUrl,
          finalUrl: `https://${domain}`,
          advertiser: domain,
          extensions: [],
          isResponsive: true
        });
      }
    } catch (error) {
      console.warn('Could not extract transparency ads:', error);
    }
    
    return ads;
  }

  /**
   * Extract ad data from a single element
   */
  private async extractAdFromElement(element: any, placement: string, position: number): Promise<Ad | null> {
    try {
      const title = await element.$eval('h3, .ads-title, .ad-title', el => el.textContent?.trim() || '');
      const description = await element.$eval('.ads-creative, .ad-description', el => el.textContent?.trim() || '');
      const displayUrl = await element.$eval('.ads-visurl, .ad-url', el => el.textContent?.trim() || '');
      
      // Get final URL from click tracking
      const link = await element.$('a');
      const finalUrl = link ? await link.getAttribute('href') : '';
      
      // Check for extensions
      const extensions = await this.detectExtensions(element);
      
      return {
        position,
        placement,
        title,
        description,
        displayUrl,
        finalUrl: finalUrl || displayUrl,
        advertiser: this.extractAdvertiserFromUrl(displayUrl),
        extensions,
        isResponsive: await this.isResponsiveAd(element)
      };
    } catch (error) {
      console.warn('Failed to extract ad element:', error);
      return null;
    }
  }

  /**
   * Extract display ad data
   */
  private async extractDisplayAdFromElement(element: any, position: number): Promise<Ad | null> {
    try {
      // Try to get ad content from iframe
      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      
      if (tagName === 'iframe') {
        const src = await element.getAttribute('src');
        return {
          position,
          placement: 'display',
          title: 'Display Ad',
          description: 'Banner advertisement',
          displayUrl: src || 'unknown',
          finalUrl: src || '',
          advertiser: this.extractAdvertiserFromUrl(src || ''),
          extensions: [],
          isResponsive: true
        };
      }
      
      // For direct ad elements
      const text = await element.textContent();
      const computedStyle = await element.evaluate(el => {
        const style = window.getComputedStyle(el);
        return {
          width: style.width,
          height: style.height,
          backgroundColor: style.backgroundColor
        };
      });
      
      return {
        position,
        placement: 'display',
        title: 'Display Ad',
        description: text?.substring(0, 100) || 'Visual advertisement',
        displayUrl: 'display',
        finalUrl: '',
        advertiser: 'Unknown',
        extensions: [],
        isResponsive: parseInt(computedStyle.width) > 300
      };
    } catch (error) {
      console.warn('Failed to extract display ad:', error);
      return null;
    }
  }

  /**
   * Detect ad extensions
   */
  private async detectExtensions(element: any): Promise<string[]> {
    const extensions: string[] = [];
    
    try {
      // Check for sitelinks
      const sitelinks = await element.$$('.ads-sitelink, .sitelink');
      if (sitelinks.length > 0) extensions.push('Sitelinks');
      
      // Check for callouts
      const callouts = await element.$$('.ads-callout, .callout');
      if (callouts.length > 0) extensions.push('Callout');
      
      // Check for prices
      const prices = await element.$$('.ads-price, .price');
      if (prices.length > 0) extensions.push('Price');
      
      // Check for locations
      const locations = await element.$$('.ads-location, .location');
      if (locations.length > 0) extensions.push('Location');
      
    } catch (error) {
      // Silently fail extension detection
    }
    
    return extensions;
  }

  /**
   * Check if ad is responsive
   */
  private async isResponsiveAd(element: any): Promise<boolean> {
    try {
      const style = await element.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          display: computed.display,
          width: computed.width,
          maxWidth: computed.maxWidth
        };
      });
      
      return style.display.includes('flex') || 
             style.maxWidth === '100%' || 
             style.width.includes('%');
    } catch {
      return false;
    }
  }

  /**
   * Count organic search results
   */
  private async countOrganicResults(page: Page): Promise<number> {
    try {
      const organicElements = await page.$$('.g:not([data-text-ad="1"])');
      return organicElements.length;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate ad position statistics
   */
  private calculateAdPositions(ads: Ad[]): { [key: string]: number } {
    const positions: { [key: string]: number } = { top: 0, bottom: 0, side: 0 };
    
    ads.forEach(ad => {
      if (positions[ad.placement] !== undefined) {
        positions[ad.placement]++;
      }
    });
    
    return positions;
  }

  /**
   * Extract advertiser name from URL
   */
  private extractAdvertiserFromUrl(url: string): string {
    try {
      const domain = url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      const parts = domain.split('.');
      if (parts.length >= 2) {
        return parts[parts.length - 2].charAt(0).toUpperCase() + 
               parts[parts.length - 2].slice(1);
      }
      return domain;
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Get locale for country
   */
  private getLocaleForCountry(country: string): string {
    const locales: { [key: string]: string } = {
      US: 'en-US',
      DE: 'de-DE',
      FR: 'fr-FR',
      ES: 'es-ES',
      GB: 'en-GB',
      PL: 'pl-PL'
    };
    return locales[country] || 'en-US';
  }

  /**
   * Get language for country
   */
  private getLanguageForCountry(country: string): string {
    const languages: { [key: string]: string } = {
      US: 'en',
      DE: 'de',
      FR: 'fr',
      ES: 'es',
      GB: 'en',
      PL: 'pl'
    };
    return languages[country] || 'en';
  }

  /**
   * Get timezone for country
   */
  private getTimezoneForCountry(country: string): string {
    const timezones: { [key: string]: string } = {
      US: 'America/New_York',
      DE: 'Europe/Berlin',
      FR: 'Europe/Paris',
      ES: 'Europe/Madrid',
      GB: 'Europe/London',
      PL: 'Europe/Warsaw'
    };
    return timezones[country] || 'UTC';
  }

  /**
   * Cleanup browser instance
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}