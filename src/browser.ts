/**
 * Browser Module - Playwright with Stealth Settings
 * ──────────────────────────────────────────────────
 * Antidetect browser configuration for Google SERP scraping
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { getProxy } from './proxy';

let browser: Browser | null = null;

export interface BrowserConfig {
  country?: string;
  useProxy?: boolean;
  headless?: boolean;
}

/**
 * Get or create browser instance with stealth settings
 */
export async function getBrowser(config: BrowserConfig = {}): Promise<Browser> {
  if (browser && browser.isConnected()) {
    return browser;
  }

  const proxy = config.useProxy !== false ? getProxy() : null;

  browser = await chromium.launch({
    headless: config.headless !== false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  return browser;
}

/**
 * Create a new page with stealth settings and mobile proxy
 */
export async function createStealthPage(config: BrowserConfig = {}): Promise<{ context: BrowserContext; page: Page }> {
  const browserInstance = await getBrowser(config);
  
  const proxy = config.useProxy !== false ? getProxy() : null;
  
  // Stealth user agents based on country
  const userAgents: Record<string, string> = {
    US: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    UK: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
    DE: 'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    FR: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  };

  const country = config.country || proxy?.country || 'US';
  const userAgent = userAgents[country] || userAgents.US;

  const contextOptions: any = {
    userAgent,
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: country === 'DE' ? 'de-DE' : country === 'FR' ? 'fr-FR' : country === 'UK' ? 'en-GB' : 'en-US',
    timezoneId: country === 'DE' ? 'Europe/Berlin' : country === 'FR' ? 'Europe/Paris' : country === 'UK' ? 'Europe/London' : 'America/New_York',
    geolocation: getGeoLocation(country),
    permissions: ['geolocation'],
  };

  // Add proxy if available
  if (proxy) {
    contextOptions.proxy = {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.user,
      password: proxy.pass,
    };
  }

  const context = await browserInstance.newContext(contextOptions);
  
  // Add stealth scripts to evade detection
  await context.addInitScript(() => {
    // Override webdriver detection
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    
    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    
    // Chrome specific overrides
    (window as any).chrome = {
      runtime: {},
    };
    
    // Permission API spoof
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as PermissionStatus) :
          originalQuery(parameters)
      );
    }
  });

  const page = await context.newPage();
  
  return { context, page };
}

function getGeoLocation(country: string): { latitude: number; longitude: number } {
  const locations: Record<string, { latitude: number; longitude: number }> = {
    US: { latitude: 40.7128, longitude: -74.0060 }, // NYC
    UK: { latitude: 51.5074, longitude: -0.1278 }, // London
    DE: { latitude: 52.5200, longitude: 13.4050 }, // Berlin
    FR: { latitude: 48.8566, longitude: 2.3522 }, // Paris
  };
  return locations[country] || locations.US;
}

/**
 * Close browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
