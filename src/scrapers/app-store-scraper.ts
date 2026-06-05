/**
 * App Store Intelligence Scraper
 * ──────────────────────────────
 * Scrapes Apple App Store and Google Play Store via mobile proxy.
 * Uses iTunes RSS/Search API + Google Play HTML scraping.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ─────────────────────────────────────────────

export interface AppListing {
  rank?: number;
  appName: string;
  developer: string;
  appId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string;
  size: string;
  icon: string;
  description?: string;
  version?: string;
  minAge?: string;
  languages?: string[];
  compatibility?: string;
  url: string;
}

export interface AppRankingsResult {
  type: 'rankings';
  store: 'apple' | 'google';
  category: string;
  country: string;
  timestamp: string;
  rankings: AppListing[];
  metadata: { totalRanked: number; scrapedAt: string };
}

export interface AppSearchResult {
  type: 'search';
  store: 'apple' | 'google';
  query: string;
  country: string;
  timestamp: string;
  results: AppListing[];
  metadata: { totalFound: number; scrapedAt: string };
}

export interface AppDetailResult {
  type: 'app';
  store: 'apple' | 'google';
  appId: string;
  country: string;
  timestamp: string;
  app: AppListing;
  recentReviews?: AppReview[];
  metadata: { scrapedAt: string };
}

export interface AppReview {
  rating: number;
  title: string;
  text: string;
  date: string;
  reviewer: string;
}

export interface AppTrendingResult {
  type: 'trending';
  store: 'apple' | 'google';
  country: string;
  timestamp: string;
  apps: AppListing[];
  metadata: { totalFound: number; scrapedAt: string };
}

// ─── COUNTRY MAPPING ──────────────────────────────────

const COUNTRY_MAP: Record<string, string> = {
  US: 'us', DE: 'de', FR: 'fr', ES: 'es', GB: 'gb', PL: 'pl',
};

// ─── APPLE APP STORE (via iTunes API) ──────────────────

const ITUNES_BASE = 'https://itunes.apple.com';
const ITUNES_RSS_BASE = 'https://itunes.apple.com/rss';

/**
 * Map App Store category name to iTunes feed type
 */
function appleCategoryFeed(category: string): string {
  const cat = category.toLowerCase();
  const feeds: Record<string, string> = {
    games: 'topfreegames',
    apps: 'topfreeapplications',
    grossing: 'topgrossingapplications',
    paid: 'toppaidapplications',
    music: 'topfreemusic',
    social: 'topfreesocialnetworking',
    productivity: 'topfreeproductivity',
    weather: 'topfreeweather',
    education: 'topfreeeducation',
    finance: 'topfreefinance',
    health: 'topfreehealthcarefitness',
    travel: 'topfreetravel',
    books: 'topfreebooks',
    business: 'topfreebusiness',
    entertainment: 'topfreeentertainment',
    shopping: 'topfreeshopping',
    sports: 'topfreesports',
    news: 'topfreenews',
    photo: 'topfreephotographyvideography',
    reference: 'topfreereference',
    developer: 'topfreedevelopertools',
    lifestyle: 'topfreeneses',
    food: 'topfreefooddrink',
    magazine: 'topfreemagazinesnewspapers',
    medical: 'topfreemedical',
    navigation: 'topfreenavigation',
  };
  return feeds[cat] || 'topfreeapplications';
}

/**
 * Scrape Apple App Store rankings via iTunes RSS feed
 */
export async function scrapeAppleRankings(
  category: string = 'apps',
  country: string = 'US',
  limit: number = 50
): Promise<AppListing[]> {
  const cc = (COUNTRY_MAP[country] || country).toLowerCase();
  const feed = appleCategoryFeed(category);
  
  const url = `${ITUNES_RSS_BASE}/${cc}/rss/${feed}/limit=${Math.min(limit, 200)}/json`;
  
  const res = await proxyFetch(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20000,
  });
  
  if (!res.ok) {
    throw new Error(`Apple RSS feed returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
  
  const data = await res.json();
  const entries = data?.feed?.entry || [];
  
  return entries.map((entry: any, idx: number): AppListing => {
    const id = entry.id?.attributes?.['im:id'] || entry.id?.label?.split('/id')[1]?.split('?')[0] || '';
    const name = entry['im:name']?.label || '';
    const developer = entry['im:artist']?.label || '';
    const rating = entry['im:rating']?.label 
      ? parseFloat(entry['im:rating'].label) 
      : (entry.rating ? parseFloat(entry.rating) : null);
    const ratingCount = entry['im:ratingCount']?.label
      ? parseInt(entry['im:ratingCount'].label) 
      : (entry.userRatingCount ? parseInt(entry.userRatingCount) : null);
    const priceEntry = entry['im:price'] || {};
    const price = priceEntry.label || 'Free';
    const hasIap = priceEntry.attributes?.hasInAppPurchases === 'true' || 
                   (entry.attributes?.hasInAppPurchases === 'true') || false;
    const categoryEntry = entry.category?.attributes || {};
    const appCategory = categoryEntry.label || categoryEntry.term || category || 'Apps';
    const releaseDate = entry['im:releaseDate']?.label?.split('T')[0] || '';
    const sizeStr = entry['im:size']?.label || '';
    const sizeMB = sizeStr ? (parseInt(sizeStr) / (1024 * 1024)).toFixed(0) + ' MB' : '';
    const icon = entry['im:image']?.[entry['im:image'].length - 1]?.label || '';
    
    return {
      rank: idx + 1,
      appName: name,
      developer: developer,
      appId: id || name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      rating,
      ratingCount,
      price,
      inAppPurchases: hasIap,
      category: appCategory,
      lastUpdated: releaseDate,
      size: sizeMB,
      icon,
      url: `https://apps.apple.com/${cc}/app/id${id}`,
    };
  });
}

/**
 * Search Apple App Store via iTunes Search API
 */
export async function searchAppleStore(
  query: string,
  country: string = 'US',
  limit: number = 25
): Promise<AppListing[]> {
  const cc = (COUNTRY_MAP[country] || country).toLowerCase();
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&country=${cc}&entity=software&limit=${Math.min(limit, 200)}`;
  
  const res = await proxyFetch(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20000,
  });
  
  if (!res.ok) {
    throw new Error(`iTunes search returned ${res.status}`);
  }
  
  const data = await res.json();
  const results = data?.results || [];
  
  return results.map((app: any): AppListing => ({
    appName: app.trackName || app.trackCensoredName || '',
    developer: app.artistName || '',
    appId: String(app.trackId || app.bundleId || ''),
    rating: app.averageUserRating || null,
    ratingCount: app.userRatingCount || null,
    price: app.price != null && app.price > 0 ? `$${app.price}` : 'Free',
    inAppPurchases: app.isVppDeviceBasedLicensingEnabled !== undefined ? false : false,
    category: app.primaryGenreName || app.genres?.[0] || 'Apps',
    lastUpdated: app.currentVersionReleaseDate?.split('T')[0] || app.releaseDate?.split('T')[0] || '',
    size: app.fileSizeBytes ? (parseInt(app.fileSizeBytes) / (1024 * 1024)).toFixed(0) + ' MB' : '',
    icon: app.artworkUrl512 || app.artworkUrl100 || app.artworkUrl60 || '',
    description: app.description || '',
    version: app.version || '',
    minAge: app.trackContentRating || '',
    languages: app.languageCodesISO2A || [],
    compatibility: app.supportedDevices?.[0] || '',
    url: app.trackViewUrl || `https://apps.apple.com/${cc}/app/id${app.trackId}`,
  }));
}

/**
 * Get Apple App Store app details via iTunes Lookup API
 */
export async function getAppleAppDetails(
  appId: string,
  country: string = 'US'
): Promise<AppListing> {
  const cc = (COUNTRY_MAP[country] || country).toLowerCase();
  const url = `${ITUNES_BASE}/lookup?id=${appId}&country=${cc}`;
  
  const res = await proxyFetch(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20000,
  });
  
  const data = await res.json();
  const app = data?.results?.[0];
  
  if (!app) throw new Error(`App not found: ${appId}`);
  
  return {
    appName: app.trackName || '',
    developer: app.artistName || '',
    appId: String(app.trackId || appId),
    rating: app.averageUserRating || null,
    ratingCount: app.userRatingCount || null,
    price: app.price != null && app.price > 0 ? `$${app.price}` : 'Free',
    inAppPurchases: false,
    category: app.primaryGenreName || 'Apps',
    lastUpdated: app.currentVersionReleaseDate?.split('T')[0] || '',
    size: app.fileSizeBytes ? (parseInt(app.fileSizeBytes) / (1024 * 1024)).toFixed(0) + ' MB' : '',
    icon: app.artworkUrl512 || '',
    description: app.description || '',
    version: app.version || '',
    minAge: app.trackContentRating || '',
    languages: app.languageCodesISO2A || [],
    url: app.trackViewUrl || `https://apps.apple.com/${cc}/app/id${appId}`,
  };
}

/**
 * Scrape Apple App Store reviews (via RSS feed)
 */
export async function getAppleAppReviews(
  appId: string,
  country: string = 'US',
  limit: number = 50
): Promise<AppReview[]> {
  const cc = (COUNTRY_MAP[country] || country).toLowerCase();
  const url = `${ITUNES_BASE}/${cc}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
  
  const res = await proxyFetch(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20000,
  });
  
  if (!res.ok) return [];
  
  const data = await res.json();
  const entries = data?.feed?.entry || [];
  
  return entries
    .filter((e: any) => e['im:name']?.label !== 'CustomerReviews')
    .slice(0, limit)
    .map((entry: any): AppReview => ({
      rating: parseInt(entry['im:rating']?.label || '0'),
      title: entry.title?.label || '',
      text: entry.content?.label?.[0]?.text || entry.content?.label || '',
      date: entry.updated?.label?.split('T')[0] || entry['im:date']?.label?.split('T')[0] || '',
      reviewer: entry.author?.name?.label || 'Anonymous',
    }));
}

// ─── GOOGLE PLAY STORE (via HTML scraping) ─────────────

/**
 * Scrape Google Play Store top charts
 */
export async function scrapeGooglePlayRankings(
  category: string = 'apps',
  country: string = 'US',
  limit: number = 50
): Promise<AppListing[]> {
  const cc = country.toUpperCase();
  const cat = category === 'games' ? 'GAME' : (category === 'grossing' ? 'GROSSING' : 'TOP_FREE');
  
  const url = `https://play.google.com/store/apps/category/${cat}/collection/topgrossing?hl=en&gl=${cc}`;
  
  const res = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 30000,
  });
  
  if (!res.ok) {
    throw new Error(`Google Play returned ${res.status}`);
  }
  
  const html = await res.text();
  return parseGooglePlayHtml(html, limit, cc);
}

/**
 * Search Google Play Store
 */
export async function searchGooglePlay(
  query: string,
  country: string = 'US'
): Promise<AppListing[]> {
  const cc = country.toUpperCase();
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=${cc}`;
  
  const res = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 30000,
  });
  
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(`Google Play rate limited. Try a different proxy IP.`);
    }
    throw new Error(`Google Play search returned ${res.status}`);
  }
  
  const html = await res.text();
  return parseGooglePlayHtml(html, 50, cc);
}

/**
 * Get Google Play Store app details
 */
export async function getGooglePlayAppDetails(
  appId: string,
  country: string = 'US'
): Promise<AppListing> {
  const cc = country.toUpperCase();
  const url = `https://play.google.com/store/apps/details?id=${appId}&hl=en&gl=${cc}`;
  
  const res = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 30000,
  });
  
  if (!res.ok) {
    throw new Error(`Google Play app details returned ${res.status}`);
  }
  
  const html = await res.text();
  return parseGooglePlayAppDetail(html, appId, cc);
}

/**
 * Parse Google Play Store HTML to extract app listings
 */
function parseGooglePlayHtml(html: string, limit: number, country: string): AppListing[] {
  const apps: AppListing[] = [];
  
  // Strategy 1: Extract from embedded JSON data (AF_initDataCallback)
  const dataCallbackRegex = /AF_initDataCallback\s*\(\s*\{[^}]*data:\s*(\[[\s\S]*?])\s*[^}]*}\s*\)/g;
  let match;
  
  while ((match = dataCallbackRegex.exec(html)) !== null) {
    try {
      const rawJson = match[1].replace(/,\s*([\]}])/g, '$1'); // Fix trailing commas
      const data = JSON.parse(rawJson);
      const extracted = extractAppsFromNestedArray(data, new Set<string>());
      for (const app of extracted) {
        if (!apps.some(a => a.appId === app.appId)) {
          apps.push(app);
        }
      }
    } catch {}
  }
  
  // Strategy 2: Look for card-like structures with package names
  const cardRegex = /href="\/store\/apps\/details\?id=([^"]+)"[^>]*>[\s\S]*?<[^>]*alt="([^"]*)"[^>]*>[\s\S]*?<[^>]*class="[^"]*(?:pxu|w7U)\w*"[^>]*>([^<]*)</g;
  let cardMatch;
  let rank = apps.length + 1;
  
  while ((cardMatch = cardRegex.exec(html)) !== null && apps.length < limit) {
    const pkgName = cardMatch[1];
    const name = cardMatch[2] || '';
    const developer = cardMatch[3] || '';
    
    if (pkgName && name && !apps.some(a => a.appId === pkgName)) {
      apps.push({
        rank: rank++,
        appName: name,
        developer: developer.trim(),
        appId: pkgName,
        rating: null,
        ratingCount: null,
        price: 'Free',
        inAppPurchases: false,
        category: 'Apps',
        lastUpdated: '',
        size: '',
        icon: '',
        url: `https://play.google.com/store/apps/details?id=${pkgName}`,
      });
    }
  }
  
  // Strategy 3: Extract from script tags with JSON-LD
  const jsonLdRegex = /<script type="application\/ld\+json">([^<]+)<\/script>/g;
  
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonLd = JSON.parse(match[1]);
      const items = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      
      for (const item of items) {
        if (item['@type'] === 'MobileApp' && item.name) {
          const pkgName = item.applicationId || '';
          if (pkgName && !apps.some(a => a.appId === pkgName)) {
            apps.push({
              appName: item.name,
              developer: item.author?.name || item.author?.url || '',
              appId: pkgName,
              rating: item.aggregateRating?.ratingValue 
                ? parseFloat(item.aggregateRating.ratingValue) : null,
              ratingCount: item.aggregateRating?.ratingCount
                ? parseInt(item.aggregateRating.ratingCount) : null,
              price: item.offers?.price === '0' ? 'Free' : 
                     item.offers?.price ? `$${item.offers.price}` : 'Free',
              inAppPurchases: false,
              category: item.applicationCategory || 'Apps',
              lastUpdated: item.dateModified?.split('T')[0] || '',
              size: item.fileSize || '',
              icon: item.image || '',
              url: item.url || `https://play.google.com/store/apps/details?id=${pkgName}`,
            });
          }
        }
      }
    } catch {}
  }
  
  return apps.slice(0, limit);
}

/**
 * Recursively extract app data from Google Play's nested data arrays
 */
function extractAppsFromNestedArray(arr: any[], seen: Set<string>): AppListing[] {
  const apps: AppListing[] = [];
  
  function walk(item: any, depth: number = 0): void {
    if (depth > 10 || !item) return;
    
    if (Array.isArray(item)) {
      for (const sub of item) walk(sub, depth + 1);
    } else if (typeof item === 'object') {
      // Look for package name pattern
      if (item.packageName || item.docid) {
        const id = item.packageName || item.docid || '';
        if (id && !seen.has(id)) {
          seen.add(id);
          apps.push({
            appName: item.title || item.name || '',
            developer: item.creator || item.author || item.developer || '',
            appId: id,
            rating: item.score || item.averageRating || null,
            ratingCount: item.ratings || item.userRatingCount || null,
            price: item.priceFormatted || (item.price === 0 ? 'Free' : `$${item.price}`),
            inAppPurchases: (item.containsIap || item.bundle) || false,
            category: item.category || item.genre || 'Apps',
            lastUpdated: item.lastUpdatedTime || item.lastUpdated || '',
            size: item.installationSize || item.size || '',
            icon: item.thumbnail || item.icon || item.image || '',
            url: `https://play.google.com/store/apps/details?id=${id}`,
          });
        }
      }
      
      for (const val of Object.values(item)) {
        walk(val, depth + 1);
      }
    }
  }
  
  walk(arr);
  return apps;
}

/**
 * Parse Google Play app detail page HTML
 */
function parseGooglePlayAppDetail(html: string, appId: string, country: string): AppListing {
  const app: AppListing = {
    appName: '',
    developer: '',
    appId,
    rating: null,
    ratingCount: null,
    price: 'Free',
    inAppPurchases: false,
    category: 'Apps',
    lastUpdated: '',
    size: '',
    icon: '',
    url: `https://play.google.com/store/apps/details?id=${appId}`,
  };
  
  // Extract name from JSON-LD or meta tags
  const nameMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  if (nameMatch) {
    try {
      const jsonLd = JSON.parse(nameMatch[1]);
      const item = Array.isArray(jsonLd) ? jsonLd.find((i: any) => i['@type'] === 'MobileApp') : jsonLd;
      
      if (item) {
        app.appName = item.name || app.appName;
        app.developer = item.author?.name || item.author?.url || app.developer;
        app.rating = item.aggregateRating?.ratingValue 
          ? parseFloat(item.aggregateRating.ratingValue) : app.rating;
        app.ratingCount = item.aggregateRating?.ratingCount
          ? parseInt(item.aggregateRating.ratingCount) : app.ratingCount;
        app.price = item.offers?.price === '0' ? 'Free' : 
                     item.offers?.price ? `$${item.offers.price}` : app.price;
        app.category = item.applicationCategory || app.category;
        app.lastUpdated = item.dateModified?.split('T')[0] || app.lastUpdated;
        app.size = item.fileSize || app.size;
        app.icon = item.image || app.icon;
      }
    } catch {}
  }
  
  // Extract from meta tags / other HTML patterns
  if (!app.appName) {
    const metaTitle = html.match(/<title>([^<]+)<\/title>/);
    if (metaTitle) {
      app.appName = metaTitle[1].replace(/- Apps on Google Play/i, '').trim();
    }
  }
  
  const metaRating = html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/);
  if (metaRating) app.rating = parseFloat(metaRating[1]);
  
  const metaRatingCount = html.match(/itemprop="ratingCount"[^>]*content="([^"]+)"/);
  if (metaRatingCount) app.ratingCount = parseInt(metaRatingCount[1]);
  
  const metaPrice = html.match(/itemprop="price"[^>]*content="([^"]+)"/);
  if (metaPrice) {
    app.price = metaPrice[1] === '0' ? 'Free' : `$${metaPrice[1]}`;
  }
  
  // Extract update date
  const updateMatch = html.match(/Updated[^:]*:\s*([^<]+)/i) || 
                      html.match(/dateModified[^"]*"[^"]*"content="([^"]+)"/);
  if (updateMatch) {
    app.lastUpdated = updateMatch[1].trim().split('T')[0];
  }
  
  return app;
}
