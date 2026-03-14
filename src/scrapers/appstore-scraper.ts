/**
 * App Store Intelligence Scraper
 * ──────────────────────────────
 * Scrapes Apple App Store and Google Play Store through real 4G/5G
 * mobile carrier IPs for authentic app rankings, reviews, metadata,
 * and trending data.
 *
 * Mobile proxies are mandatory because:
 * - Google Play bans datacenter IPs after ~500-1K requests/day
 * - Apple geo-fences rankings by country + carrier
 * - Review ordering differs by location/device type
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface AppRanking {
  rank: number;
  appName: string;
  developer: string;
  appId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string | null;
  size: string | null;
  icon: string | null;
}

export interface AppDetail {
  appName: string;
  developer: string;
  appId: string;
  description: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string | null;
  size: string | null;
  icon: string | null;
  screenshots: string[];
  version: string | null;
  whatsNew: string | null;
  contentRating: string | null;
  installs: string | null;
  reviews: AppReview[];
}

export interface AppReview {
  author: string;
  rating: number;
  title: string | null;
  text: string;
  date: string | null;
  helpful: number;
}

export interface AppSearchResult {
  appName: string;
  developer: string;
  appId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  icon: string | null;
  description: string;
  category: string | null;
}

export interface TrendingApp {
  rank: number;
  appName: string;
  developer: string;
  appId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  icon: string | null;
  category: string | null;
  growthSignal: string | null;
}

// ─── CONSTANTS ──────────────────────────────────────

const SUPPORTED_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'];

const APPLE_COUNTRY_MAP: Record<string, string> = {
  US: 'us', DE: 'de', FR: 'fr', ES: 'es', GB: 'gb', PL: 'pl',
};

const GOOGLE_COUNTRY_MAP: Record<string, string> = {
  US: 'us', DE: 'de', FR: 'fr', ES: 'es', GB: 'gb', PL: 'pl',
};

const GOOGLE_LANG_MAP: Record<string, string> = {
  US: 'en', DE: 'de', FR: 'fr', ES: 'es', GB: 'en', PL: 'pl',
};

const APPLE_CATEGORY_MAP: Record<string, number> = {
  'all': 36,
  'games': 6014,
  'business': 6000,
  'education': 6017,
  'entertainment': 6016,
  'finance': 6015,
  'food-drink': 6023,
  'health-fitness': 6013,
  'lifestyle': 6012,
  'medical': 6020,
  'music': 6011,
  'navigation': 6010,
  'news': 6009,
  'photo-video': 6008,
  'productivity': 6007,
  'reference': 6006,
  'shopping': 6024,
  'social': 6005,
  'sports': 6004,
  'travel': 6003,
  'utilities': 6002,
  'weather': 6001,
};

const GOOGLE_CATEGORY_MAP: Record<string, string> = {
  'all': '',
  'games': 'GAME',
  'business': 'BUSINESS',
  'education': 'EDUCATION',
  'entertainment': 'ENTERTAINMENT',
  'finance': 'FINANCE',
  'food-drink': 'FOOD_AND_DRINK',
  'health-fitness': 'HEALTH_AND_FITNESS',
  'lifestyle': 'LIFESTYLE',
  'medical': 'MEDICAL',
  'music': 'MUSIC_AND_AUDIO',
  'navigation': 'MAPS_AND_NAVIGATION',
  'news': 'NEWS_AND_MAGAZINES',
  'photo-video': 'PHOTOGRAPHY',
  'productivity': 'PRODUCTIVITY',
  'reference': 'BOOKS_AND_REFERENCE',
  'shopping': 'SHOPPING',
  'social': 'SOCIAL',
  'sports': 'SPORTS',
  'travel': 'TRAVEL_AND_LOCAL',
  'utilities': 'TOOLS',
  'weather': 'WEATHER',
};

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
];

function getRandomUA(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

function validateCountry(country: string): string {
  const upper = country.toUpperCase();
  if (SUPPORTED_COUNTRIES.includes(upper)) return upper;
  return 'US';
}

// ─── HTML PARSING HELPERS ───────────────────────────

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&nbsp;/g, ' ');
}

function extractBetween(html: string, startMarker: string, endMarker: string): string | null {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;
  const afterStart = startIdx + startMarker.length;
  const endIdx = html.indexOf(endMarker, afterStart);
  if (endIdx === -1) return null;
  return html.slice(afterStart, endIdx);
}

function extractAllBetween(html: string, startMarker: string, endMarker: string): string[] {
  const results: string[] = [];
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const startIdx = html.indexOf(startMarker, searchFrom);
    if (startIdx === -1) break;
    const afterStart = startIdx + startMarker.length;
    const endIdx = html.indexOf(endMarker, afterStart);
    if (endIdx === -1) break;
    results.push(html.slice(afterStart, endIdx));
    searchFrom = endIdx + endMarker.length;
  }
  return results;
}

function extractText(html: string): string {
  return decodeEntities(
    html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  );
}

// ─── APPLE APP STORE ────────────────────────────────

async function appleFetch(url: string): Promise<string> {
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new Error(`Apple App Store returned ${response.status}`);
  }

  return response.text();
}

async function appleApiFetch(url: string): Promise<any> {
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new Error(`Apple API returned ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch top app rankings from Apple App Store using iTunes RSS feed.
 */
export async function getAppleRankings(
  category: string = 'all',
  country: string = 'US',
  limit: number = 50,
): Promise<AppRanking[]> {
  country = validateCountry(country);
  const cc = APPLE_COUNTRY_MAP[country] || 'us';
  const genreId = APPLE_CATEGORY_MAP[category.toLowerCase()] || APPLE_CATEGORY_MAP['all'];
  const safeLimit = Math.min(Math.max(limit, 1), 200);

  // Use iTunes RSS JSON feed for rankings
  const url = `https://rss.applemarketingtools.com/api/v2/${cc}/apps/top-free/${safeLimit}/apps.json`;

  const data = await appleApiFetch(url);
  const results: AppRanking[] = [];

  const entries = data?.feed?.results || [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const genres = entry.genres || [];
    const primaryGenre = genres[0]?.name || category;

    // If filtering by category, check genre match
    if (category.toLowerCase() !== 'all') {
      const categoryName = category.replace(/-/g, ' ').toLowerCase();
      const matchesCategory = genres.some((g: any) =>
        g.name?.toLowerCase().includes(categoryName) ||
        categoryName.includes(g.name?.toLowerCase() || '')
      );
      if (!matchesCategory && genreId !== APPLE_CATEGORY_MAP['all']) {
        continue;
      }
    }

    results.push({
      rank: results.length + 1,
      appName: entry.name || '',
      developer: entry.artistName || '',
      appId: entry.id || '',
      rating: null, // RSS feed doesn't include ratings
      ratingCount: null,
      price: 'Free',
      inAppPurchases: false,
      category: primaryGenre,
      lastUpdated: entry.releaseDate || null,
      size: null,
      icon: entry.artworkUrl100 || null,
    });
  }

  // Enrich top results with lookup API for ratings
  const enrichBatch = results.slice(0, Math.min(results.length, 20));
  if (enrichBatch.length > 0) {
    const ids = enrichBatch.map(r => r.appId).join(',');
    try {
      const lookupUrl = `https://itunes.apple.com/lookup?id=${ids}&country=${cc}`;
      const lookupData = await appleApiFetch(lookupUrl);
      const lookupResults = lookupData?.results || [];

      for (const lr of lookupResults) {
        const match = results.find(r => r.appId === String(lr.trackId));
        if (match) {
          match.rating = lr.averageUserRating ? Math.round(lr.averageUserRating * 10) / 10 : null;
          match.ratingCount = lr.userRatingCount || null;
          match.price = lr.formattedPrice || (lr.price === 0 ? 'Free' : `$${lr.price}`);
          match.inAppPurchases = (lr.features || []).includes('iosUniversal') || !!lr.isVppDeviceBasedLicensingEnabled;
          match.size = lr.fileSizeBytes ? formatBytes(parseInt(lr.fileSizeBytes)) : null;
          match.lastUpdated = lr.currentVersionReleaseDate?.split('T')[0] || match.lastUpdated;
          match.icon = lr.artworkUrl100 || match.icon;
        }
      }
    } catch (e) {
      console.error('[appstore] Failed to enrich Apple rankings with lookup API:', e);
    }
  }

  return results.slice(0, safeLimit);
}

/**
 * Get detailed app info from Apple App Store.
 */
export async function getAppleAppDetail(
  appId: string,
  country: string = 'US',
): Promise<AppDetail> {
  country = validateCountry(country);
  const cc = APPLE_COUNTRY_MAP[country] || 'us';

  const lookupUrl = `https://itunes.apple.com/lookup?id=${appId}&country=${cc}`;
  const data = await appleApiFetch(lookupUrl);
  const app = data?.results?.[0];

  if (!app) {
    throw new Error(`App not found: ${appId}`);
  }

  // Fetch reviews from Apple RSS
  const reviews = await getAppleReviews(appId, country);

  return {
    appName: app.trackName || '',
    developer: app.artistName || '',
    appId: String(app.trackId),
    description: (app.description || '').slice(0, 5000),
    rating: app.averageUserRating ? Math.round(app.averageUserRating * 10) / 10 : null,
    ratingCount: app.userRatingCount || null,
    price: app.formattedPrice || (app.price === 0 ? 'Free' : `$${app.price}`),
    inAppPurchases: Array.isArray(app.ipadScreenshotUrls), // heuristic
    category: app.primaryGenreName || '',
    lastUpdated: app.currentVersionReleaseDate?.split('T')[0] || null,
    size: app.fileSizeBytes ? formatBytes(parseInt(app.fileSizeBytes)) : null,
    icon: app.artworkUrl512 || app.artworkUrl100 || null,
    screenshots: (app.screenshotUrls || []).slice(0, 5),
    version: app.version || null,
    whatsNew: (app.releaseNotes || '').slice(0, 2000) || null,
    contentRating: app.contentAdvisoryRating || null,
    installs: null, // Apple doesn't expose download counts
    reviews,
  };
}

/**
 * Fetch recent reviews from Apple App Store.
 */
async function getAppleReviews(
  appId: string,
  country: string = 'US',
  limit: number = 10,
): Promise<AppReview[]> {
  const cc = APPLE_COUNTRY_MAP[country] || 'us';
  const url = `https://itunes.apple.com/rss/customerreviews/id=${appId}/sortBy=mostRecent/json?cc=${cc}`;

  try {
    const data = await appleApiFetch(url);
    const entries = data?.feed?.entry || [];
    const reviews: AppReview[] = [];

    for (const entry of entries.slice(0, limit)) {
      if (!entry?.content?.label) continue;
      reviews.push({
        author: entry?.author?.name?.label || 'Anonymous',
        rating: parseInt(entry?.['im:rating']?.label || '0') || 0,
        title: entry?.title?.label || null,
        text: (entry?.content?.label || '').slice(0, 2000),
        date: entry?.updated?.label?.split('T')[0] || null,
        helpful: parseInt(entry?.['im:voteSum']?.label || '0') || 0,
      });
    }

    return reviews;
  } catch (e) {
    console.error('[appstore] Failed to fetch Apple reviews:', e);
    return [];
  }
}

/**
 * Search Apple App Store.
 */
export async function searchAppleApps(
  query: string,
  country: string = 'US',
  limit: number = 25,
): Promise<AppSearchResult[]> {
  country = validateCountry(country);
  const cc = APPLE_COUNTRY_MAP[country] || 'us';
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const params = new URLSearchParams({
    term: query,
    country: cc,
    media: 'software',
    limit: String(safeLimit),
  });

  const url = `https://itunes.apple.com/search?${params}`;
  const data = await appleApiFetch(url);
  const results: AppSearchResult[] = [];

  for (const app of (data?.results || [])) {
    results.push({
      appName: app.trackName || '',
      developer: app.artistName || '',
      appId: String(app.trackId),
      rating: app.averageUserRating ? Math.round(app.averageUserRating * 10) / 10 : null,
      ratingCount: app.userRatingCount || null,
      price: app.formattedPrice || (app.price === 0 ? 'Free' : `$${app.price}`),
      icon: app.artworkUrl100 || null,
      description: (app.description || '').slice(0, 500),
      category: app.primaryGenreName || null,
    });
  }

  return results;
}

// ─── GOOGLE PLAY STORE ──────────────────────────────

async function googlePlayFetch(url: string): Promise<string> {
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new Error(`Google Play Store returned ${response.status}`);
  }

  return response.text();
}

/**
 * Fetch top app rankings from Google Play Store.
 */
export async function getGoogleRankings(
  category: string = 'all',
  country: string = 'US',
  limit: number = 50,
): Promise<AppRanking[]> {
  country = validateCountry(country);
  const gl = GOOGLE_COUNTRY_MAP[country] || 'us';
  const hl = GOOGLE_LANG_MAP[country] || 'en';
  const cat = GOOGLE_CATEGORY_MAP[category.toLowerCase()] || '';
  const safeLimit = Math.min(Math.max(limit, 1), 200);

  let url: string;
  if (cat) {
    url = `https://play.google.com/store/apps/category/${cat}/collection/cluster?clp=ogooCAEaHAoWcmVjc190b3BpY19vZTBhYl9tMXh6ZRAHGAMqAggB:S:ANO1ljJhDWY&gsr=CiuiCigIARocChZyZWNzX3RvcGljX29lMGFiX20xeHplEAcYAyoCCAE%3D:S:ANO1ljJ_Qmk&hl=${hl}&gl=${gl}`;
  } else {
    url = `https://play.google.com/store/apps/top?hl=${hl}&gl=${gl}`;
  }

  const html = await googlePlayFetch(url);
  return parseGooglePlayRankings(html, category, safeLimit);
}

/**
 * Parse Google Play Store HTML for app listings.
 */
function parseGooglePlayRankings(html: string, category: string, limit: number): AppRanking[] {
  const results: AppRanking[] = [];

  // Extract app cards from Google Play HTML
  // Google Play uses data attributes and specific class patterns
  const appLinkPattern = /href="\/store\/apps\/details\?id=([^"&]+)"/g;
  const appIds = new Set<string>();
  let match;

  while ((match = appLinkPattern.exec(html)) !== null) {
    appIds.add(match[1]);
  }

  // Extract structured data from script tags
  const scriptBlocks = extractAllBetween(html, 'AF_initDataCallback(', ');</script>');

  // Parse app info from the HTML structure
  // Google Play embeds JSON data in script tags
  for (const block of scriptBlocks) {
    try {
      // Look for app data arrays
      const dataMatch = block.match(/data:(\[[\s\S]*?\])\s*,\s*sideChannel/);
      if (!dataMatch) continue;

      const rawData = dataMatch[1];
      // Try to parse nested arrays for app data
      const parsed = JSON.parse(rawData);
      extractAppsFromGoogleData(parsed, results, category);
    } catch {
      // Parsing individual blocks may fail, continue
    }
  }

  // Fallback: parse from HTML patterns if script parsing didn't yield results
  if (results.length === 0) {
    parseGooglePlayHtmlFallback(html, results, category, appIds);
  }

  // Assign ranks
  for (let i = 0; i < results.length; i++) {
    results[i].rank = i + 1;
  }

  return results.slice(0, limit);
}

function extractAppsFromGoogleData(data: any, results: AppRanking[], category: string): void {
  if (!Array.isArray(data)) return;

  for (const item of data) {
    if (!Array.isArray(item)) {
      continue;
    }

    // Recurse into nested arrays looking for app data structures
    // Google Play data typically has: [appName, icon, [details...], appId, developer...]
    if (typeof item[0] === 'string' && item[0].length > 0 && typeof item[1] === 'string') {
      // Potential app entry
      const hasAppId = findStringPattern(item, /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/i);
      if (hasAppId) {
        try {
          const appName = findFirstString(item, 2);
          const developer = findDeveloperName(item);
          const rating = findRating(item);
          const icon = findIconUrl(item);

          if (appName && hasAppId) {
            results.push({
              rank: 0,
              appName,
              developer: developer || '',
              appId: hasAppId,
              rating,
              ratingCount: null,
              price: 'Free',
              inAppPurchases: false,
              category: category !== 'all' ? category : '',
              lastUpdated: null,
              size: null,
              icon,
            });
          }
        } catch {
          // Skip malformed entries
        }
      }
    }

    // Recurse
    if (Array.isArray(item) && item.length > 0) {
      extractAppsFromGoogleData(item, results, category);
    }
  }
}

function findStringPattern(arr: any, pattern: RegExp): string | null {
  if (typeof arr === 'string' && pattern.test(arr)) return arr;
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    const found = findStringPattern(item, pattern);
    if (found) return found;
  }
  return null;
}

function findFirstString(arr: any, minLength: number): string | null {
  if (typeof arr === 'string' && arr.length >= minLength && !arr.startsWith('http')) return arr;
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    const found = findFirstString(item, minLength);
    if (found) return found;
  }
  return null;
}

function findDeveloperName(arr: any): string | null {
  // Developer names are typically shorter strings that appear after app names
  if (!Array.isArray(arr)) return null;
  const strings = flattenStrings(arr).filter(s =>
    s.length > 1 && s.length < 100 && !s.startsWith('http') && !s.includes('.')
  );
  return strings.length > 1 ? strings[1] : null;
}

function findRating(arr: any): number | null {
  if (typeof arr === 'number' && arr > 0 && arr <= 5) return Math.round(arr * 10) / 10;
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    const found = findRating(item);
    if (found) return found;
  }
  return null;
}

function findIconUrl(arr: any): string | null {
  if (typeof arr === 'string' && arr.startsWith('https://play-lh.googleusercontent.com/')) return arr;
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    const found = findIconUrl(item);
    if (found) return found;
  }
  return null;
}

function flattenStrings(arr: any): string[] {
  const result: string[] = [];
  if (typeof arr === 'string') {
    result.push(arr);
  } else if (Array.isArray(arr)) {
    for (const item of arr) {
      result.push(...flattenStrings(item));
    }
  }
  return result;
}

function parseGooglePlayHtmlFallback(
  html: string,
  results: AppRanking[],
  category: string,
  appIds: Set<string>,
): void {
  // Extract app names near app ID links
  for (const appId of appIds) {
    if (results.length >= 200) break;

    // Find the context around the app ID mention
    const idIdx = html.indexOf(`id=${appId}`);
    if (idIdx === -1) continue;

    // Extract surrounding HTML (2KB window)
    const start = Math.max(0, idIdx - 1000);
    const end = Math.min(html.length, idIdx + 1000);
    const context = html.slice(start, end);

    // Try to extract app name from nearby text
    const nameMatch = context.match(/aria-label="([^"]+)"/);
    const altMatch = context.match(/alt="([^"]+)"/);
    const titleMatch = context.match(/title="([^"]+)"/);
    const appName = nameMatch?.[1] || altMatch?.[1] || titleMatch?.[1];

    if (!appName) continue;

    // Extract rating if present
    const ratingMatch = context.match(/(\d\.\d)\s*star/i) || context.match(/>(\d\.\d)</);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Extract icon
    const iconMatch = context.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/);

    // Avoid duplicates
    if (results.some(r => r.appId === appId)) continue;

    results.push({
      rank: 0,
      appName: decodeEntities(appName),
      developer: '',
      appId,
      rating,
      ratingCount: null,
      price: 'Free',
      inAppPurchases: false,
      category: category !== 'all' ? category : '',
      lastUpdated: null,
      size: null,
      icon: iconMatch?.[1] || null,
    });
  }
}

/**
 * Get detailed app info from Google Play Store.
 */
export async function getGoogleAppDetail(
  appId: string,
  country: string = 'US',
): Promise<AppDetail> {
  country = validateCountry(country);
  const gl = GOOGLE_COUNTRY_MAP[country] || 'us';
  const hl = GOOGLE_LANG_MAP[country] || 'en';

  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=${hl}&gl=${gl}`;
  const html = await googlePlayFetch(url);

  return parseGooglePlayDetail(html, appId);
}

function parseGooglePlayDetail(html: string, appId: string): AppDetail {
  // Extract from meta tags and structured HTML
  const ogTitle = extractBetween(html, 'property="og:title" content="', '"');
  const ogDesc = extractBetween(html, 'property="og:description" content="', '"');
  const ogImage = extractBetween(html, 'property="og:image" content="', '"');

  // Extract from schema.org JSON-LD
  let schemaData: any = null;
  const ldJson = extractBetween(html, '<script type="application/ld+json">', '</script>');
  if (ldJson) {
    try {
      schemaData = JSON.parse(ldJson);
    } catch { /* ignore */ }
  }

  // Extract rating
  const ratingMatch = html.match(/aria-label="Rated (\d\.?\d?) out of 5 stars"/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : (schemaData?.aggregateRating?.ratingValue ? parseFloat(schemaData.aggregateRating.ratingValue) : null);

  // Extract rating count
  const ratingCountMatch = html.match(/([\d,]+)\s*(?:reviews|ratings)/i);
  const ratingCount = ratingCountMatch ? parseInt(ratingCountMatch[1].replace(/,/g, '')) : (schemaData?.aggregateRating?.ratingCount ? parseInt(schemaData.aggregateRating.ratingCount) : null);

  // Extract installs
  const installsMatch = html.match(/([\d,]+[KMB]?\+?)\s*downloads/i) || html.match(/installs"[^>]*>([\d,]+[KMB]?\+?)/i);
  const installs = installsMatch?.[1] || null;

  // Extract developer
  const developerMatch = html.match(/href="\/store\/apps\/dev[^"]*"[^>]*>([^<]+)</) ||
    html.match(/"author"[^}]*"name"\s*:\s*"([^"]+)"/);
  const developer = developerMatch?.[1] || schemaData?.author?.name || '';

  // Extract content rating
  const contentRatingMatch = html.match(/content rating[^>]*>([^<]+)/i);
  const contentRating = contentRatingMatch?.[1]?.trim() || null;

  // Extract what's new
  const whatsNewSection = extractBetween(html, "What's new", '</section>') ||
    extractBetween(html, 'What&#39;s new', '</section>');
  const whatsNew = whatsNewSection ? extractText(whatsNewSection).slice(0, 2000) : null;

  // Extract version
  const versionMatch = html.match(/Current Version[^>]*>([^<]+)/) || html.match(/"softwareVersion"\s*:\s*"([^"]+)"/);
  const version = versionMatch?.[1]?.trim() || schemaData?.softwareVersion || null;

  // Extract size
  const sizeMatch = html.match(/Size[^>]*>([\d.]+\s*[KMGT]?B)/i);
  const size = sizeMatch?.[1] || null;

  // Extract last updated
  const updatedMatch = html.match(/Updated on[^>]*>([^<]+)/) || html.match(/"dateModified"\s*:\s*"([^"]+)"/);
  const lastUpdated = updatedMatch?.[1]?.trim() || null;

  // Extract screenshots
  const screenshotPattern = /src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]*=w\d+[^"]*)"/g;
  const screenshots: string[] = [];
  let ssMatch;
  while ((ssMatch = screenshotPattern.exec(html)) !== null && screenshots.length < 5) {
    if (!screenshots.includes(ssMatch[1])) {
      screenshots.push(ssMatch[1]);
    }
  }

  // Parse reviews from HTML
  const reviews = parseGooglePlayReviews(html);

  // Extract price
  const priceMatch = html.match(/itemprop="price" content="([^"]+)"/);
  const price = priceMatch?.[1] === '0' ? 'Free' : priceMatch?.[1] || 'Free';

  // Determine in-app purchases
  const hasIAP = html.includes('In-app purchases') || html.includes('in-app purchases');

  return {
    appName: decodeEntities(ogTitle || schemaData?.name || ''),
    developer: decodeEntities(developer),
    appId,
    description: decodeEntities((ogDesc || schemaData?.description || '').slice(0, 5000)),
    rating: rating ? Math.round(rating * 10) / 10 : null,
    ratingCount,
    price,
    inAppPurchases: hasIAP,
    category: schemaData?.applicationCategory || '',
    lastUpdated,
    size,
    icon: ogImage || null,
    screenshots,
    version,
    whatsNew,
    contentRating,
    installs,
    reviews,
  };
}

function parseGooglePlayReviews(html: string): AppReview[] {
  const reviews: AppReview[] = [];

  // Google Play embeds review data in script tags
  // Look for review blocks in HTML
  const reviewBlocks = extractAllBetween(html, 'jscontroller="H6eOGe"', '</div></div></div>');

  for (const block of reviewBlocks.slice(0, 10)) {
    const authorMatch = block.match(/class="[^"]*"[^>]*>([^<]+)<\/span>/);
    const ratingMatch = block.match(/aria-label="Rated (\d) stars out of five stars"/);
    const textMatch = block.match(/jsname="[^"]*"[^>]*>([^<]{10,})<\/span>/);
    const dateMatch = block.match(/(\w+ \d+, \d{4})/);

    if (textMatch) {
      reviews.push({
        author: authorMatch?.[1] || 'Anonymous',
        rating: ratingMatch ? parseInt(ratingMatch[1]) : 0,
        title: null,
        text: decodeEntities(textMatch[1]).slice(0, 2000),
        date: dateMatch?.[1] || null,
        helpful: 0,
      });
    }
  }

  return reviews;
}

/**
 * Search Google Play Store.
 */
export async function searchGoogleApps(
  query: string,
  country: string = 'US',
  limit: number = 25,
): Promise<AppSearchResult[]> {
  country = validateCountry(country);
  const gl = GOOGLE_COUNTRY_MAP[country] || 'us';
  const hl = GOOGLE_LANG_MAP[country] || 'en';
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const params = new URLSearchParams({
    q: query,
    c: 'apps',
    hl,
    gl,
  });

  const url = `https://play.google.com/store/search?${params}`;
  const html = await googlePlayFetch(url);

  return parseGooglePlaySearch(html, safeLimit);
}

function parseGooglePlaySearch(html: string, limit: number): AppSearchResult[] {
  const results: AppSearchResult[] = [];
  const appIds = new Set<string>();

  // Extract app links and surrounding context
  const appLinkPattern = /href="\/store\/apps\/details\?id=([^"&]+)"/g;
  let match;

  while ((match = appLinkPattern.exec(html)) !== null) {
    const appId = match[1];
    if (appIds.has(appId) || results.length >= limit) continue;
    appIds.add(appId);

    const start = Math.max(0, match.index - 1500);
    const end = Math.min(html.length, match.index + 1500);
    const context = html.slice(start, end);

    const nameMatch = context.match(/aria-label="([^"]+)"/) ||
      context.match(/title="([^"]+)"/) ||
      context.match(/alt="([^"]+)"/);
    const ratingMatch = context.match(/aria-label="Rated (\d\.?\d?)/) ||
      context.match(/>(\d\.\d)</);
    const iconMatch = context.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/);
    const descMatch = context.match(/class="[^"]*"[^>]*>([^<]{20,200})<\/span>/);

    const appName = nameMatch?.[1];
    if (!appName) continue;

    results.push({
      appName: decodeEntities(appName),
      developer: '',
      appId,
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      ratingCount: null,
      price: 'Free',
      icon: iconMatch?.[1] || null,
      description: descMatch ? decodeEntities(descMatch[1]) : '',
      category: null,
    });
  }

  return results;
}

// ─── UNIFIED PUBLIC API ─────────────────────────────

/**
 * Get app rankings from either store.
 */
export async function getRankings(
  store: 'apple' | 'google',
  category: string = 'all',
  country: string = 'US',
  limit: number = 50,
): Promise<AppRanking[]> {
  if (store === 'apple') {
    return getAppleRankings(category, country, limit);
  }
  return getGoogleRankings(category, country, limit);
}

/**
 * Get detailed app info from either store.
 */
export async function getAppDetail(
  store: 'apple' | 'google',
  appId: string,
  country: string = 'US',
): Promise<AppDetail> {
  if (store === 'apple') {
    return getAppleAppDetail(appId, country);
  }
  return getGoogleAppDetail(appId, country);
}

/**
 * Search apps in either store.
 */
export async function searchApps(
  store: 'apple' | 'google',
  query: string,
  country: string = 'US',
  limit: number = 25,
): Promise<AppSearchResult[]> {
  if (store === 'apple') {
    return searchAppleApps(query, country, limit);
  }
  return searchGoogleApps(query, country, limit);
}

/**
 * Get trending/new apps from either store.
 * Uses the top charts with "new" collection for trending apps.
 */
export async function getTrendingApps(
  store: 'apple' | 'google',
  country: string = 'US',
  limit: number = 25,
): Promise<TrendingApp[]> {
  country = validateCountry(country);

  if (store === 'apple') {
    return getAppleTrending(country, limit);
  }
  return getGoogleTrending(country, limit);
}

async function getAppleTrending(country: string, limit: number): Promise<TrendingApp[]> {
  const cc = APPLE_COUNTRY_MAP[country] || 'us';
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  // Use the "top free" feed to get current trending
  const url = `https://rss.applemarketingtools.com/api/v2/${cc}/apps/top-free/${safeLimit}/apps.json`;
  const data = await appleApiFetch(url);

  const entries = data?.feed?.results || [];
  const results: TrendingApp[] = [];

  for (let i = 0; i < Math.min(entries.length, safeLimit); i++) {
    const entry = entries[i];
    results.push({
      rank: i + 1,
      appName: entry.name || '',
      developer: entry.artistName || '',
      appId: entry.id || '',
      rating: null,
      ratingCount: null,
      price: 'Free',
      icon: entry.artworkUrl100 || null,
      category: entry.genres?.[0]?.name || null,
      growthSignal: i < 10 ? 'top-10' : i < 25 ? 'top-25' : 'charting',
    });
  }

  return results;
}

async function getGoogleTrending(country: string, limit: number): Promise<TrendingApp[]> {
  const gl = GOOGLE_COUNTRY_MAP[country] || 'us';
  const hl = GOOGLE_LANG_MAP[country] || 'en';
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const url = `https://play.google.com/store/apps/top?hl=${hl}&gl=${gl}`;
  const html = await googlePlayFetch(url);

  const rankings = parseGooglePlayRankings(html, 'all', safeLimit);

  return rankings.map((app, i) => ({
    rank: i + 1,
    appName: app.appName,
    developer: app.developer,
    appId: app.appId,
    rating: app.rating,
    ratingCount: app.ratingCount,
    price: app.price,
    icon: app.icon,
    category: app.category || null,
    growthSignal: i < 10 ? 'top-10' : i < 25 ? 'top-25' : 'charting',
  }));
}

// ─── UTILITY ────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
