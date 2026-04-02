/**
 * Zillow Real Estate Intelligence Scraper
 * Puppeteer-based scraper optimized for Zillow's PerimeterX protection
 * Uses stealth plugin + mobile headers + Proxies.sx mobile carrier IPs
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import { getProxy } from '../proxy';

puppeteer.use(StealthPlugin());

export interface PriceHistoryEvent {
  date: string;
  event: string;
  price: number;
}

export interface PropertyDetails {
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  lot_sqft?: number;
  year_built?: number;
  type: string;
  status: string;
}

export interface NeighborhoodData {
  walk_score?: number;
  transit_score?: number;
  median_home_value?: number;
  median_rent?: number;
}

export interface ZillowProperty {
  zpid: string;
  address: string;
  price: number | null;
  zestimate: number | null;
  price_history: PriceHistoryEvent[];
  details: PropertyDetails;
  neighborhood: NeighborhoodData;
  photos: string[];
  proxyCountry?: string;
  timestamp: string;
}

/**
 * Detect if Zillow blocked us with a PerimeterX challenge or Access Denied page
 */
function detectBlockedPage(pageContent: string, pageTitle: string): boolean {
  const blockedIndicators = [
    'Access Denied',
    'Verify you are a human',
    'Challenge',
    'perimeterx',
    'bot_detected',
    '403',
    '429',
  ];

  const combined = (pageContent + pageTitle).toLowerCase();
  return blockedIndicators.some(indicator => combined.includes(indicator.toLowerCase()));
}

/**
 * Extract JSON data from the page source
 * Tries multiple extraction strategies: __NEXT_DATA__, _u_s_, and API response patterns
 */
async function extractJsonData(page: Page): Promise<any> {
  const pageContent = await page.content();

  // Strategy 1: Extract __NEXT_DATA__ (Next.js global state)
  try {
    const nextDataMatch = pageContent.match(/window\.__NEXT_DATA__\s*=\s*({.+?});/);
    if (nextDataMatch) {
      const nextData = JSON.parse(nextDataMatch[1]);
      return nextData;
    }
  } catch (e) {
    console.log('[ZILLOW] __NEXT_DATA__ extraction failed, trying alternatives...');
  }

  // Strategy 2: Extract _u_s_ (Zillow's custom state)
  try {
    const uuSMatch = pageContent.match(/window\._u_s_\s*=\s*({.+?});/);
    if (uuSMatch) {
      const uuS = JSON.parse(uuSMatch[1]);
      return uuS;
    }
  } catch (e) {
    console.log('[ZILLOW] _u_s_ extraction failed');
  }

  // Strategy 3: Execute JavaScript directly on the page to access globals
  try {
    const data = await page.evaluate(() => {
      return {
        nextData: (window as any).__NEXT_DATA__,
        uuS: (window as any)._u_s_,
        propertyData: (window as any).__propertyData__,
      };
    });
    return data;
  } catch (e) {
    console.log('[ZILLOW] JavaScript extraction failed');
  }

  return null;
}

/**
 * Parse property data from Zillow's page data
 */
function parsePropertyData(data: any, url: string): Partial<ZillowProperty> {
  const result: Partial<ZillowProperty> = {
    zpid: '',
    address: '',
    price: null,
    zestimate: null,
    price_history: [],
    details: {
      bedrooms: 0,
      bathrooms: 0,
      sqft: 0,
      type: 'Unknown',
      status: 'Unknown',
    },
    neighborhood: {},
    photos: [],
  };

  // Extract ZPID from URL
  const zpidMatch = url.match(/(\d+)_zpid/);
  if (zpidMatch) result.zpid = zpidMatch[1];

  if (!data) return result;

  // Navigate through Next.js props structure
  try {
    const props = data?.props?.pageProps || data?.pageProps || {};

    // Extract basic property info
    if (props.property) {
      const prop = props.property;
      result.address = prop.address || prop.streetAddress || '';
      result.price = prop.price || prop.listPrice || null;
      result.zestimate = prop.zestimate?.amount || prop.zestimate || null;
      result.details = {
        bedrooms: prop.bedrooms || 0,
        bathrooms: prop.bathrooms || 0,
        sqft: prop.livingArea || prop.sqft || 0,
        lot_sqft: prop.lotSize || undefined,
        year_built: prop.yearBuilt || undefined,
        type: prop.homeType || 'Unknown',
        status: prop.listingStatus || prop.status || 'Unknown',
      };
    }

    // Extract price history
    if (props.priceHistory && Array.isArray(props.priceHistory)) {
      result.price_history = props.priceHistory.map((item: any) => ({
        date: item.date || item.eventDate || '',
        event: item.eventLabel || item.event || '',
        price: item.price || 0,
      }));
    }

    // Extract neighborhood data
    if (props.neighborhood) {
      const neighborhood = props.neighborhood;
      result.neighborhood = {
        walk_score: neighborhood.walkScore || undefined,
        transit_score: neighborhood.transitScore || undefined,
        median_home_value: neighborhood.medianHomeValue || undefined,
        median_rent: neighborhood.medianRent || undefined,
      };
    }

    // Extract photos
    if (props.photos && Array.isArray(props.photos)) {
      result.photos = props.photos
        .slice(0, 20)
        .map((photo: any) => photo.url || photo.src || '')
        .filter((url: string) => url);
    }
  } catch (e) {
    console.log('[ZILLOW] Error parsing property data:', e);
  }

  return result;
}

/**
 * Scrape a Zillow property page
 */
export async function scrapeZillow(url: string): Promise<ZillowProperty> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  if (!url.includes('zillow.com')) {
    throw new Error('Invalid URL: must be a Zillow property URL');
  }

  try {
    const proxy = getProxy();

    browser = (await puppeteer.launch({
      headless: true,
      args: [
        `--proxy-server=${proxy.host}:${proxy.port}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    })) as Browser;

    page = await browser.newPage();

    // Authenticate the mobile proxy (required for credentials)
    await page.authenticate({
      username: proxy.user,
      password: proxy.pass,
    });

    // Set mobile user agent to avoid PerimeterX blocks
    const mobileUserAgent =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

    await page.setUserAgent(mobileUserAgent);

    // Set viewport to mobile dimensions
    await page.setViewport({ width: 390, height: 844 });

    // Set mobile-specific headers to evade bot detection
    await page.setExtraHTTPHeaders({
      'User-Agent': mobileUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Sec-Ch-Ua': '"Not_A Brand";v="99", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?1',
      'Sec-Ch-Ua-Platform': '"iOS"',
    });

    // Navigate to the property page
    console.log(`[ZILLOW] Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    // Wait for dynamic content to load
    await new Promise(r => setTimeout(r, 3000));

    // Check if we hit an access denied / bot challenge page
    const pageTitle = await page.title();
    const pageContent = await page.content();

    if (detectBlockedPage(pageContent, pageTitle)) {
      throw new Error('Zillow blocked the request (PerimeterX challenge or Access Denied detected)');
    }

    // Extract JSON data from the page
    const jsonData = await extractJsonData(page);

    if (!jsonData) {
      console.warn('[ZILLOW] Could not extract JSON data from page');
    }

    // Parse the extracted data
    const propertyData = parsePropertyData(jsonData, url);

    // DEBUG: Log extracted data snippet for verification
    console.log('[ZILLOW] ✓ Extraction Success:');
    console.log(`  Address: ${propertyData.address}`);
    console.log(`  Price: $${propertyData.price?.toLocaleString() || 'N/A'}`);
    console.log(`  Zestimate: $${propertyData.zestimate?.toLocaleString() || 'N/A'}`);
    console.log(`  Bedrooms: ${propertyData.details?.bedrooms || 0}`);
    console.log(`  Bathrooms: ${propertyData.details?.bathrooms || 0}`);
    console.log(`  Sqft: ${propertyData.details?.sqft?.toLocaleString() || 'N/A'}`);
    console.log(`  Price History Events: ${propertyData.price_history?.length || 0}`);
    console.log(`  Photos: ${propertyData.photos?.length || 0}`);

    return {
      zpid: propertyData.zpid || '',
      address: propertyData.address || '',
      price: propertyData.price || null,
      zestimate: propertyData.zestimate || null,
      price_history: propertyData.price_history || [],
      details: propertyData.details || {
        bedrooms: 0,
        bathrooms: 0,
        sqft: 0,
        type: 'Unknown',
        status: 'Unknown',
      },
      neighborhood: propertyData.neighborhood || {},
      photos: propertyData.photos || [],
      proxyCountry: proxy.country,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[ZILLOW]', error.message);

    // Provide specific error messages for common failure modes
    if (error.message.includes('PerimeterX') || error.message.includes('Access Denied')) {
      throw new Error('Zillow blocked the request (mobile proxy may be flagged or IP rate-limited)');
    }

    throw new Error(`Failed to scrape Zillow property: ${error.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
