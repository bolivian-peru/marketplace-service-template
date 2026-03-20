/**
 * App Store Intelligence API — Scraper (Bounty #54)
 * ──────────────────────────────────────────────────
 * Scrapes Apple App Store + Google Play Store rankings,
 * app details, reviews, and search results via mobile proxies.
 */

import { proxyFetch, getProxy, getProxyExitIp } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface AppRanking {
  rank: number;
  appName: string;
  developer: string;
  appId: string;
  rating: number;
  ratingCount: number;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string;
  size: string;
  icon: string;
}

export interface AppDetail {
  appName: string;
  developer: string;
  appId: string;
  rating: number;
  ratingCount: number;
  price: string;
  description: string;
  version: string;
  lastUpdated: string;
  size: string;
  category: string;
  contentRating: string;
  icon: string;
  screenshots: string[];
  inAppPurchases: boolean;
  installs?: string;
}

export interface AppReview {
  author: string;
  rating: number;
  title: string;
  text: string;
  date: string;
  helpful: number;
}

export interface AppStoreResult {
  type: string;
  store: string;
  country: string;
  timestamp: string;
  rankings?: AppRanking[];
  app?: AppDetail;
  reviews?: AppReview[];
  searchResults?: AppRanking[];
  trending?: AppRanking[];
  metadata: {
    totalResults?: number;
    scrapedAt: string;
    query?: string;
    category?: string;
  };
  proxy: { country: string; carrier: string; type: string; ip?: string };
}

// ─── COUNTRY CODES ──────────────────────────────────

const APPLE_COUNTRY_CODES: Record<string, string> = {
  US: 'us', DE: 'de', FR: 'fr', ES: 'es', GB: 'gb', PL: 'pl',
  JP: 'jp', CA: 'ca', AU: 'au', BR: 'br', IN: 'in', KR: 'kr',
};

const PLAY_COUNTRY_CODES: Record<string, string> = {
  US: 'us', DE: 'de', FR: 'fr', ES: 'es', GB: 'gb', PL: 'pl',
  JP: 'jp', CA: 'ca', AU: 'au', BR: 'br', IN: 'in', KR: 'kr',
};

const APPLE_GENRE_IDS: Record<string, number> = {
  games: 6014, entertainment: 6016, education: 6017, photo: 6008,
  utilities: 6002, social: 6005, music: 6011, productivity: 6007,
  health: 6013, finance: 6015, business: 6000, news: 6009,
  sports: 6004, travel: 6003, food: 6023, shopping: 6024,
  weather: 6001, reference: 6006, navigation: 6010, lifestyle: 6012,
};

// ─── APPLE APP STORE SCRAPING ───────────────────────

export async function scrapeAppleRankings(
  category: string,
  country: string = 'US',
  limit: number = 50,
): Promise<AppRanking[]> {
  const cc = APPLE_COUNTRY_CODES[country.toUpperCase()] || 'us';
  const genreId = APPLE_GENRE_IDS[category.toLowerCase()] || 6014;

  // Apple RSS feed for top free apps by category
  const url = `https://rss.applemarketingtools.com/api/v2/${cc}/apps/top-free/${limit}/apps.json`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 20_000 });
    if (!res.ok) {
      // Fallback: iTunes Search API
      return await scrapeAppleRankingsViaSearch(category, country, limit);
    }

    const data = await res.json() as any;
    const feed = data.feed?.results || [];

    return feed.map((app: any, idx: number) => ({
      rank: idx + 1,
      appName: app.name || '',
      developer: app.artistName || '',
      appId: app.id || '',
      rating: 0, // RSS feed doesn't include ratings
      ratingCount: 0,
      price: 'Free',
      inAppPurchases: true,
      category: app.genres?.[0]?.name || category,
      lastUpdated: app.releaseDate || '',
      size: '',
      icon: app.artworkUrl100 || '',
    }));
  } catch (e) {
    console.error('[APPLE] Rankings error:', e);
    return scrapeAppleRankingsViaSearch(category, country, limit);
  }
}

async function scrapeAppleRankingsViaSearch(
  category: string,
  country: string,
  limit: number,
): Promise<AppRanking[]> {
  const cc = APPLE_COUNTRY_CODES[country.toUpperCase()] || 'us';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(category)}&country=${cc}&entity=software&limit=${Math.min(limit, 50)}`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 20_000 });
    const data = await res.json() as any;
    const results = data.results || [];

    return results.map((app: any, idx: number) => ({
      rank: idx + 1,
      appName: app.trackName || '',
      developer: app.artistName || '',
      appId: String(app.trackId || ''),
      rating: app.averageUserRating || 0,
      ratingCount: app.userRatingCount || 0,
      price: app.formattedPrice || 'Free',
      inAppPurchases: (app.features || []).includes('iosUniversal'),
      category: app.primaryGenreName || category,
      lastUpdated: app.currentVersionReleaseDate || '',
      size: app.fileSizeBytes ? `${Math.round(parseInt(app.fileSizeBytes) / 1048576)} MB` : '',
      icon: app.artworkUrl512 || app.artworkUrl100 || '',
    }));
  } catch (e) {
    console.error('[APPLE] Search fallback error:', e);
    return [];
  }
}

export async function scrapeAppleAppDetails(appId: string, country: string = 'US'): Promise<AppDetail | null> {
  const cc = APPLE_COUNTRY_CODES[country.toUpperCase()] || 'us';
  const url = `https://itunes.apple.com/lookup?id=${appId}&country=${cc}`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 20_000 });
    const data = await res.json() as any;
    const app = data.results?.[0];
    if (!app) return null;

    return {
      appName: app.trackName || '',
      developer: app.artistName || '',
      appId: String(app.trackId || ''),
      rating: app.averageUserRating || 0,
      ratingCount: app.userRatingCount || 0,
      price: app.formattedPrice || 'Free',
      description: app.description || '',
      version: app.version || '',
      lastUpdated: app.currentVersionReleaseDate || '',
      size: app.fileSizeBytes ? `${Math.round(parseInt(app.fileSizeBytes) / 1048576)} MB` : '',
      category: app.primaryGenreName || '',
      contentRating: app.contentAdvisoryRating || '',
      icon: app.artworkUrl512 || app.artworkUrl100 || '',
      screenshots: app.screenshotUrls || [],
      inAppPurchases: (app.features || []).includes('iosUniversal'),
    };
  } catch (e) {
    console.error('[APPLE] App details error:', e);
    return null;
  }
}

export async function scrapeAppleSearch(
  query: string,
  country: string = 'US',
  limit: number = 25,
): Promise<AppRanking[]> {
  const cc = APPLE_COUNTRY_CODES[country.toUpperCase()] || 'us';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${cc}&entity=software&limit=${Math.min(limit, 50)}`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 20_000 });
    const data = await res.json() as any;
    const results = data.results || [];

    return results.map((app: any, idx: number) => ({
      rank: idx + 1,
      appName: app.trackName || '',
      developer: app.artistName || '',
      appId: String(app.trackId || ''),
      rating: app.averageUserRating || 0,
      ratingCount: app.userRatingCount || 0,
      price: app.formattedPrice || 'Free',
      inAppPurchases: (app.features || []).includes('iosUniversal'),
      category: app.primaryGenreName || '',
      lastUpdated: app.currentVersionReleaseDate || '',
      size: app.fileSizeBytes ? `${Math.round(parseInt(app.fileSizeBytes) / 1048576)} MB` : '',
      icon: app.artworkUrl512 || app.artworkUrl100 || '',
    }));
  } catch (e) {
    console.error('[APPLE] Search error:', e);
    return [];
  }
}

// ─── GOOGLE PLAY STORE SCRAPING ─────────────────────

export async function scrapePlayStoreSearch(
  query: string,
  country: string = 'US',
  limit: number = 25,
): Promise<AppRanking[]> {
  const lang = country === 'DE' ? 'de' : country === 'FR' ? 'fr' : country === 'ES' ? 'es' : 'en';
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=${lang}&gl=${country.toLowerCase()}`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 25_000 });
    const html = await res.text();
    return parsePlayStoreResults(html, limit);
  } catch (e) {
    console.error('[PLAY] Search error:', e);
    return [];
  }
}

export async function scrapePlayStoreApp(
  appId: string,
  country: string = 'US',
): Promise<AppDetail | null> {
  const lang = country === 'DE' ? 'de' : country === 'FR' ? 'fr' : country === 'ES' ? 'es' : 'en';
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=${lang}&gl=${country.toLowerCase()}`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 25_000 });
    const html = await res.text();
    return parsePlayStoreDetail(html, appId);
  } catch (e) {
    console.error('[PLAY] App details error:', e);
    return null;
  }
}

export async function scrapePlayStoreRankings(
  category: string,
  country: string = 'US',
  limit: number = 50,
): Promise<AppRanking[]> {
  // Google Play top charts page
  const lang = country === 'DE' ? 'de' : country === 'FR' ? 'fr' : country === 'ES' ? 'es' : 'en';
  const cat = category.toUpperCase();
  const catMap: Record<string, string> = {
    GAMES: 'GAME', ENTERTAINMENT: 'ENTERTAINMENT', EDUCATION: 'EDUCATION',
    SOCIAL: 'SOCIAL', MUSIC: 'MUSIC_AND_AUDIO', PRODUCTIVITY: 'PRODUCTIVITY',
    HEALTH: 'HEALTH_AND_FITNESS', FINANCE: 'FINANCE', BUSINESS: 'BUSINESS',
    NEWS: 'NEWS_AND_MAGAZINES', SPORTS: 'SPORTS', TRAVEL: 'TRAVEL_AND_LOCAL',
    FOOD: 'FOOD_AND_DRINK', SHOPPING: 'SHOPPING', PHOTO: 'PHOTOGRAPHY',
    UTILITIES: 'TOOLS', WEATHER: 'WEATHER', LIFESTYLE: 'LIFESTYLE',
  };
  const playCategory = catMap[cat] || 'GAME';
  const url = `https://play.google.com/store/apps/top/category/${playCategory}?hl=${lang}&gl=${country.toLowerCase()}`;

  try {
    const res = await proxyFetch(url, { timeoutMs: 25_000 });
    const html = await res.text();
    return parsePlayStoreResults(html, limit);
  } catch (e) {
    console.error('[PLAY] Rankings error:', e);
    // Fallback to search
    return scrapePlayStoreSearch(category, country, limit);
  }
}

// ─── PLAY STORE HTML PARSERS ────────────────────────

function parsePlayStoreResults(html: string, limit: number): AppRanking[] {
  const apps: AppRanking[] = [];

  // Extract app IDs from store links
  const appIdMatches = html.match(/\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/g) || [];
  const seen = new Set<string>();

  for (const match of appIdMatches) {
    const appId = match.replace('/store/apps/details?id=', '');
    if (seen.has(appId) || apps.length >= limit) continue;
    seen.add(appId);

    // Try to extract app name near the app ID reference
    const nameRegex = new RegExp(`${appId.replace(/\./g, '\\.')}[^"]*"[^>]*>([^<]+)`, 'i');
    const nameMatch = html.match(nameRegex);

    apps.push({
      rank: apps.length + 1,
      appName: nameMatch?.[1] || appId,
      developer: '',
      appId,
      rating: 0,
      ratingCount: 0,
      price: 'Free',
      inAppPurchases: true,
      category: '',
      lastUpdated: '',
      size: '',
      icon: '',
    });
  }

  return apps;
}

function parsePlayStoreDetail(html: string, appId: string): AppDetail | null {
  // Extract structured data from JSON-LD or meta tags
  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
  const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);

  // Try to extract rating
  const ratingMatch = html.match(/content="(\d\.\d)" itemprop="ratingValue"/);
  const ratingCountMatch = html.match(/content="(\d+)" itemprop="ratingCount"/);
  const installsMatch = html.match(/([\d,]+\+?) downloads/i) || html.match(/([\d,]+\+?) installs/i);

  // Try JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let jsonLd: any = null;
  if (jsonLdMatch) {
    try { jsonLd = JSON.parse(jsonLdMatch[1]); } catch {}
  }

  return {
    appName: titleMatch?.[1]?.replace(' - Apps on Google Play', '') || jsonLd?.name || appId,
    developer: jsonLd?.author?.name || '',
    appId,
    rating: parseFloat(ratingMatch?.[1] || jsonLd?.aggregateRating?.ratingValue || '0'),
    ratingCount: parseInt(ratingCountMatch?.[1] || jsonLd?.aggregateRating?.ratingCount || '0'),
    price: jsonLd?.offers?.price === '0' ? 'Free' : `$${jsonLd?.offers?.price || '0'}`,
    description: descMatch?.[1] || jsonLd?.description || '',
    version: '',
    lastUpdated: '',
    size: '',
    category: jsonLd?.applicationCategory || '',
    contentRating: jsonLd?.contentRating || '',
    icon: imgMatch?.[1] || '',
    screenshots: [],
    inAppPurchases: html.includes('In-app purchases') || html.includes('Offers in-app purchases'),
    installs: installsMatch?.[1] || undefined,
  };
}

// ─── TRENDING / NEW APPS ────────────────────────────

export async function scrapeTrendingApps(
  store: string,
  country: string = 'US',
): Promise<AppRanking[]> {
  if (store === 'apple') {
    // Apple RSS for new apps
    const cc = APPLE_COUNTRY_CODES[country.toUpperCase()] || 'us';
    const url = `https://rss.applemarketingtools.com/api/v2/${cc}/apps/top-free/25/apps.json`;
    try {
      const res = await proxyFetch(url, { timeoutMs: 20_000 });
      const data = await res.json() as any;
      return (data.feed?.results || []).map((app: any, idx: number) => ({
        rank: idx + 1,
        appName: app.name || '',
        developer: app.artistName || '',
        appId: app.id || '',
        rating: 0,
        ratingCount: 0,
        price: 'Free',
        inAppPurchases: true,
        category: app.genres?.[0]?.name || '',
        lastUpdated: app.releaseDate || '',
        size: '',
        icon: app.artworkUrl100 || '',
      }));
    } catch {
      return [];
    }
  } else {
    return scrapePlayStoreSearch('trending apps', country, 25);
  }
}
