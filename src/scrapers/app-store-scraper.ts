/**
 * App Store Intelligence Scraper
 * ─────────────────────────────
 * Scrapes Apple App Store and Google Play Store for:
 * - Rankings by category and country
 * - App details + reviews
 * - Search results
 * - Trending / new apps
 *
 * Uses Proxies.sx mobile proxy infrastructure to bypass geo-blocking
 * and datacenter IP restrictions.
 */

import { proxyFetch } from '../proxy';
import type {
  AppStoreApp,
  AppStoreRankingsResponse,
  AppStoreSearchResponse,
  AppStoreTrendingResponse,
  AppStoreReviewsResponse,
} from '../types';

// ─── APP STORE (Apple iTunes) ─────────────────────────

/**
 * Fetch Apple App Store rankings (top charts) for a category and country
 * Uses the iTunes Search API / RSS feeds for rankings
 */
export async function scrapeAppleRankings(
  category: string,
  country: string = 'US',
  limit: number = 50
): Promise<{ apps: AppStoreApp[]; genreId: string }> {
  // Map category names to Apple genre IDs
  const categoryMap: Record<string, string> = {
    games: '6014',
    social: '0',
    entertainment: '0',
    productivity: '0',
    utilities: '0',
    lifestyle: '0',
    music: '0',
    video: '0',
    news: '0',
    books: '0',
    finance: '0',
    health: '0',
    sports: '0',
    food: '0',
  };

  const genreId = categoryMap[category.toLowerCase()] || '0';

  // Apple RSS feed for top free apps by genre/country
  const rssUrl = `https://rss.applemarketingtools.com/api/v2/${country.toLowerCase()}/25/apps/${genreId}/free/all.json`;

  const apps: AppStoreApp[] = [];

  try {
    const response = await proxyFetch(rssUrl, {
      timeoutMs: 30_000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });

    if (response.ok) {
      const data: any = await response.json();
      const feed = data?.feed;

      if (feed?.results && Array.isArray(feed.results)) {
        for (const entry of feed.results.slice(0, limit)) {
          apps.push({
            appName: entry.name || 'Unknown',
            developer: entry.artistName || entry.artistId?.toString() || 'Unknown',
            appId: entry.id || entry.trackId?.toString() || '',
            rating: entry.averageUserRating ? parseFloat(entry.averageUserRating) : null,
            ratingCount: entry.userRatingCount || null,
            price: entry.price ? `$${entry.price}` : 'Free',
            inAppPurchases: entry.isVppDeviceBasedLicensingEnabled || false,
            category: entry.genres?.[0] || category,
            lastUpdated: entry.releaseDate || null,
            size: null, // Not available in RSS
            icon: entry.artworkUrl100 || entry.artworkUrl60 || null,
            store: 'apple',
            country,
          });
        }
      }
    }
  } catch (err) {
    console.log(`[AppStore] Apple RSS failed: ${err}`);
  }

  // Fallback: try iTunes Search API
  if (apps.length === 0) {
    return scrapeAppleSearchAPI(category, country, limit);
  }

  return { apps, genreId };
}

/**
 * Fallback using iTunes Search API for app data
 */
async function scrapeAppleSearchAPI(
  query: string,
  country: string = 'US',
  limit: number = 50
): Promise<{ apps: AppStoreApp[]; genreId: string }> {
  const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&media=software&limit=${limit}`;

  const apps: AppStoreApp[] = [];

  try {
    const response = await proxyFetch(searchUrl, {
      timeoutMs: 30_000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      },
    });

    if (response.ok) {
      const data: any = await response.json();

      if (data.results && Array.isArray(data.results)) {
        for (const entry of data.results) {
          apps.push({
            appName: entry.trackName || entry.collectionName || 'Unknown',
            developer: entry.artistName || 'Unknown',
            appId: entry.trackId?.toString() || entry.collectionId?.toString() || '',
            rating: entry.averageUserRating ? parseFloat(entry.averageUserRating) : null,
            ratingCount: entry.userRatingCount || null,
            price: entry.price ? `$${entry.price}` : 'Free',
            inAppPurchases: entry.isVppDeviceBasedLicensingEnabled || entry.hasInAppPurchases || false,
            category: entry.primaryGenreName || entry.genres?.[0] || null,
            lastUpdated: entry.currentVersionReleaseDate || entry.releaseDate || null,
            size: entry.fileSizeBytes ? `${Math.round(parseInt(entry.fileSizeBytes) / 1024 / 1024)} MB` : null,
            icon: entry.artworkUrl100 || entry.artworkUrl60 || null,
            store: 'apple',
            country,
          });
        }
      }
    }
  } catch (err) {
    console.log(`[AppStore] Apple Search API failed: ${err}`);
  }

  return { apps, genreId: '0' };
}

/**
 * Scrape Apple App Store search results
 */
export async function scrapeAppleSearch(
  query: string,
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  const { apps } = await scrapeAppleSearchAPI(query, country, limit);
  return apps;
}

// ─── GOOGLE PLAY STORE ────────────────────────────────

/**
 * Fetch Google Play Store rankings (top charts) for a category and country
 * Google Play Store page scraping with mobile proxy
 */
export async function scrapeGooglePlayRankings(
  category: string,
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  const apps: AppStoreApp[] = [];

  // Category mapping for Google Play
  const categoryMap: Record<string, string> = {
    games: 'GAME',
    social: 'SOCIAL',
    entertainment: 'ENTERTAINMENT',
    productivity: 'PRODUCTIVITY',
    utilities: 'UTILITIES',
    lifestyle: 'LIFESTYLE',
    music: 'MUSIC',
    video: 'VIDEO',
    news: 'NEWS',
    books: 'BOOKS',
    finance: 'FINANCE',
    health: 'HEALTH',
    sports: 'SPORTS',
    food: 'FOOD_AND_DRINK',
  };

  const gpcategory = categoryMap[category.toLowerCase()] || 'GAME';

  // Use Google Play web interface via proxy
  const url = `https://play.google.com/store/apps/top/category/${gpcategory}?hl=en_US&gl=${country}`;

  try {
    const response = await proxyFetch(url, {
      timeoutMs: 45_000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });

    if (response.ok) {
      const html = await response.text();
      const extracted = extractGooglePlayAppsFromHtml(html, 'google', country);
      apps.push(...extracted.slice(0, limit));
    }
  } catch (err) {
    console.log(`[AppStore] Google Play rankings failed: ${err}`);
  }

  // Fallback: try Google Play chart URL
  if (apps.length === 0) {
    const chartUrl = `https://play.google.com/store/apps/category/${gpcategory}?hl=en_US&gl=${country}`;
    try {
      const response = await proxyFetch(chartUrl, {
        timeoutMs: 45_000,
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/537.36',
        },
      });

      if (response.ok) {
        const html = await response.text();
        const extracted = extractGooglePlayAppsFromHtml(html, 'google', country);
        apps.push(...extracted.slice(0, limit));
      }
    } catch (err) {
      console.log(`[AppStore] Google Play chart fallback failed: ${err}`);
    }
  }

  return apps;
}

/**
 * Scrape Google Play Store search results
 */
export async function scrapeGooglePlaySearch(
  query: string,
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  const apps: AppStoreApp[] = [];
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en_US&gl=${country}`;

  try {
    const response = await proxyFetch(url, {
      timeoutMs: 45_000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });

    if (response.ok) {
      const html = await response.text();
      const extracted = extractGooglePlayAppsFromHtml(html, 'google', country);
      apps.push(...extracted.slice(0, limit));
    }
  } catch (err) {
    console.log(`[AppStore] Google Play search failed: ${err}`);
  }

  return apps;
}

/**
 * Scrape Google Play trending/new apps
 */
export async function scrapeGooglePlayTrending(
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  const apps: AppStoreApp[] = [];
  const url = `https://play.google.com/store/apps?hl=en_US&gl=${country}`;

  try {
    const response = await proxyFetch(url, {
      timeoutMs: 45_000,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });

    if (response.ok) {
      const html = await response.text();
      const extracted = extractGooglePlayAppsFromHtml(html, 'google', country);
      apps.push(...extracted.slice(0, limit));
    }
  } catch (err) {
    console.log(`[AppStore] Google Play trending failed: ${err}`);
  }

  return apps;
}

// ─── HTML PARSING HELPERS ─────────────────────────────

/**
 * Extract app data from Google Play Store HTML
 */
function extractGooglePlayAppsFromHtml(
  html: string,
  store: 'google' | 'apple',
  country: string
): AppStoreApp[] {
  const apps: AppStoreApp[] = [];
  const seen = new Set<string>();

  // Strategy 1: Extract from JSON data embedded in the page
  const jsonPattern = /"title":"([^"]+)","subtitle":"([^"]*)","mainCategory":"([^"]*)".*?"rating":(\d+\.?\d*).*?"reviews":(\d+).*?"price":"([^"]*)"/gs;
  let match;

  while ((match = jsonPattern.exec(html)) !== null) {
    const appName = decodeHtml(match[1]);
    const developer = decodeHtml(match[2]);
    const category = decodeHtml(match[3]);
    const rating = parseFloat(match[4]);
    const reviewCount = parseInt(match[5]);
    const price = decodeHtml(match[6]);

    if (appName && !seen.has(appName.toLowerCase())) {
      seen.add(appName.toLowerCase());
      apps.push({
        appName,
        developer,
        appId: '',
        rating: isNaN(rating) ? null : rating,
        ratingCount: isNaN(reviewCount) ? null : reviewCount,
        price: price === '0' ? 'Free' : price,
        inAppPurchases: false,
        category,
        lastUpdated: null,
        size: null,
        icon: null,
        store,
        country,
      });
    }
  }

  // Strategy 2: Extract from script data arrays
  const scriptPattern = /\]\],null,\["([^"]+)"]]/g;
  while ((match = scriptPattern.exec(html)) !== null) {
    const name = decodeHtml(match[1]);
    if (name && name.length > 2 && name.length < 100 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      apps.push({
        appName: name,
        developer: '',
        appId: '',
        rating: null,
        ratingCount: null,
        price: 'Free',
        inAppPurchases: false,
        category: '',
        lastUpdated: null,
        size: null,
        icon: null,
        store,
        country,
      });
    }
  }

  // Strategy 3: Extract from DOM-like patterns (app cards)
  const cardPattern = /class="["'][^"']*ULeU3b[^"']*["'][^>]*>[\s]*<div[^>]*class="[ "'][^"']*dCVoN[^"']*["'][^>]*>.*?aria-label="([^"]{3,100})"[^>]*>[\s\S]*?(?:<span[^>]*class="[ "'][^"']*Ell.[^"']*["'][^>]*>([^<]{2,50})<\/span>)?/gi;

  while ((match = cardPattern.exec(html)) !== null) {
    const name = decodeHtml(match[1].trim());
    const developer = match[2] ? decodeHtml(match[2].trim()) : '';

    if (name && !seen.has(name.toLowerCase()) && name.length > 2 && name.length < 100) {
      seen.add(name.toLowerCase());

      // Find context for this app
      const nameIndex = html.indexOf(`"${name}"`) !== -1 ? html.indexOf(`"${name}"`) : 0;
      const context = html.substring(Math.max(0, nameIndex - 200), nameIndex + 500);

      // Extract rating
      let rating: number | null = null;
      const ratingMatch = context.match(/(\d+\.?\d*)\s*(?:star|\/5)/);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
        if (rating < 1 || rating > 5) rating = null;
      }

      // Extract review count
      let reviewCount: number | null = null;
      const reviewMatch = context.match(/([\d,]+)\s*(?:review|ratings?)/i);
      if (reviewMatch) {
        reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
      }

      apps.push({
        appName: name,
        developer,
        appId: '',
        rating,
        ratingCount: reviewCount,
        price: 'Free',
        inAppPurchases: false,
        category: '',
        lastUpdated: null,
        size: null,
        icon: null,
        store,
        country,
      });
    }
  }

  return apps;
}

/**
 * Decode HTML entities
 */
function decodeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\u[\dA-Fa-f]{4}/g, (match) => String.fromCharCode(parseInt(match.slice(2), 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ─── UNIFIED API FUNCTIONS ────────────────────────────

/**
 * Get app rankings for a store/category/country
 */
export async function getAppRankings(
  store: 'apple' | 'google',
  category: string,
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  if (store === 'apple') {
    const { apps } = await scrapeAppleRankings(category, country, limit);
    return apps;
  } else {
    return scrapeGooglePlayRankings(category, country, limit);
  }
}

/**
 * Search apps on a store
 */
export async function searchApps(
  store: 'apple' | 'google',
  query: string,
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  if (store === 'apple') {
    return scrapeAppleSearch(query, country, limit);
  } else {
    return scrapeGooglePlaySearch(query, country, limit);
  }
}

/**
 * Get trending apps
 */
export async function getTrendingApps(
  store: 'apple' | 'google',
  country: string = 'US',
  limit: number = 50
): Promise<AppStoreApp[]> {
  if (store === 'apple') {
    const { apps } = await scrapeAppleRankings('games', country, limit);
    return apps;
  } else {
    return scrapeGooglePlayTrending(country, limit);
  }
}
