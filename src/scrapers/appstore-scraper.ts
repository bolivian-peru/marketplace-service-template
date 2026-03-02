/**
 * App Store Intelligence Scraper (Bounty #54)
 * ────────────────────────────────────────────
 * Scrapes app rankings, details, reviews, and search from
 * Apple App Store + Google Play Store via mobile proxy.
 *
 * Apple: iTunes RSS feeds + Lookup API + Customer Reviews RSS
 * Google: HTML scraping of Play Store pages via mobile proxy
 *
 * Endpoints:
 *   type=rankings  — Top apps by category and country
 *   type=app       — App details + recent reviews
 *   type=search    — Search apps by keyword
 *   type=trending  — New/trending apps
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

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
  appId: string;
  appName: string;
  developer: string;
  description: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string | null;
  size: string | null;
  version: string | null;
  icon: string | null;
  screenshots: string[];
  contentRating: string | null;
  reviews: AppReview[];
}

export interface AppReview {
  author: string;
  rating: number;
  title: string | null;
  text: string;
  date: string | null;
}

export interface AppSearchResult {
  appName: string;
  developer: string;
  appId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  icon: string | null;
  category: string | null;
}

export interface RankingsResult {
  type: 'rankings';
  store: string;
  category: string;
  country: string;
  timestamp: string;
  rankings: AppRanking[];
  metadata: { totalRanked: number; scrapedAt: string };
}

export interface AppDetailResult {
  type: 'app';
  store: string;
  appId: string;
  country: string;
  timestamp: string;
  app: AppDetail;
  metadata: { scrapedAt: string };
}

export interface SearchResultData {
  type: 'search';
  store: string;
  query: string;
  country: string;
  timestamp: string;
  results: AppSearchResult[];
  metadata: { totalResults: number; scrapedAt: string };
}

export interface TrendingResult {
  type: 'trending';
  store: string;
  country: string;
  timestamp: string;
  trending: AppRanking[];
  metadata: { totalRanked: number; scrapedAt: string };
}

// ─── CATEGORY MAPPINGS ──────────────────────────────

const APPLE_GENRES: Record<string, number> = {
  games: 6014, social: 6005, photo: 6008, entertainment: 6016,
  music: 6011, productivity: 6007, finance: 6015, health: 6013,
  education: 6017, shopping: 6024, food: 6023, travel: 6003,
  news: 6009, business: 6000, utilities: 6002, lifestyle: 6012,
  weather: 6001, books: 6018, sports: 6004, medical: 6020,
  navigation: 6010, reference: 6006,
};

const GPLAY_CATEGORIES: Record<string, string> = {
  games: 'GAME', social: 'SOCIAL', photo: 'PHOTOGRAPHY',
  entertainment: 'ENTERTAINMENT', music: 'MUSIC_AND_AUDIO',
  productivity: 'PRODUCTIVITY', finance: 'FINANCE',
  health: 'HEALTH_AND_FITNESS', education: 'EDUCATION',
  shopping: 'SHOPPING', food: 'FOOD_AND_DRINK',
  travel: 'TRAVEL_AND_LOCAL', news: 'NEWS_AND_MAGAZINES',
  business: 'BUSINESS', utilities: 'TOOLS', lifestyle: 'LIFESTYLE',
  weather: 'WEATHER', books: 'BOOKS_AND_REFERENCE', sports: 'SPORTS',
  communication: 'COMMUNICATION',
};

const LANG_MAP: Record<string, string> = {
  US: 'en', DE: 'de', FR: 'fr', ES: 'es', GB: 'en', PL: 'pl',
};

export const SUPPORTED_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'];

export const VALID_CATEGORIES = Object.keys(APPLE_GENRES);

// ─── APPLE APP STORE ────────────────────────────────

export async function fetchAppleRankings(category: string, country: string): Promise<RankingsResult> {
  const cc = country.toLowerCase();
  const genreId = APPLE_GENRES[category.toLowerCase()];

  let url = `https://itunes.apple.com/${cc}/rss/topfreeapplications/limit=50/json`;
  if (genreId) {
    url = `https://itunes.apple.com/${cc}/rss/topfreeapplications/limit=50/genre=${genreId}/json`;
  }

  const resp = await proxyFetch(url, { timeoutMs: 20_000 });
  if (!resp.ok) throw new Error(`Apple RSS returned ${resp.status}`);

  const data = await resp.json() as any;
  const entries = data?.feed?.entry || [];

  let rankings: AppRanking[] = entries.map((e: any, i: number) => {
    const priceAttrs = e['im:price']?.attributes || {};
    return {
      rank: i + 1,
      appName: e['im:name']?.label || '',
      developer: e['im:artist']?.label || '',
      appId: e.id?.attributes?.['im:id'] || '',
      rating: null,
      ratingCount: null,
      price: priceAttrs.amount === '0.00000' ? 'Free' : `$${priceAttrs.amount}`,
      inAppPurchases: false,
      category: e.category?.attributes?.label || category,
      lastUpdated: e['im:releaseDate']?.label || null,
      size: null,
      icon: e['im:image']?.[2]?.label || null,
    };
  });

  rankings = await enrichAppleApps(rankings, cc);

  const now = new Date().toISOString();
  return {
    type: 'rankings',
    store: 'apple',
    category,
    country,
    timestamp: now,
    rankings,
    metadata: { totalRanked: rankings.length, scrapedAt: now },
  };
}

async function enrichAppleApps(apps: AppRanking[], cc: string): Promise<AppRanking[]> {
  const ids = apps.map(a => a.appId).filter(Boolean).slice(0, 50);
  if (!ids.length) return apps;

  try {
    const url = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${cc}`;
    const resp = await proxyFetch(url, { timeoutMs: 15_000 });
    if (!resp.ok) return apps;

    const data = await resp.json() as any;
    const lookup = new Map<string, any>();
    for (const r of (data?.results || [])) {
      lookup.set(String(r.trackId), r);
    }

    return apps.map(app => {
      const d = lookup.get(app.appId);
      if (!d) return app;
      return {
        ...app,
        rating: d.averageUserRating ? Math.round(d.averageUserRating * 10) / 10 : null,
        ratingCount: d.userRatingCount || null,
        price: d.formattedPrice || app.price,
        inAppPurchases: (d.features || []).includes('iosUniversal') && d.formattedPrice === 'Free',
        size: d.fileSizeBytes ? `${Math.round(parseInt(d.fileSizeBytes) / 1_048_576)} MB` : null,
        lastUpdated: d.currentVersionReleaseDate?.split('T')[0] || app.lastUpdated,
        category: d.primaryGenreName || app.category,
        icon: d.artworkUrl512 || d.artworkUrl100 || app.icon,
      };
    });
  } catch {
    return apps;
  }
}

export async function fetchAppleAppDetail(appId: string, country: string): Promise<AppDetailResult> {
  const cc = country.toLowerCase();
  const url = `https://itunes.apple.com/lookup?id=${appId}&country=${cc}`;

  const resp = await proxyFetch(url, { timeoutMs: 15_000 });
  if (!resp.ok) throw new Error(`iTunes Lookup returned ${resp.status}`);

  const data = await resp.json() as any;
  const results = data?.results || [];
  if (!results.length) throw new Error(`App not found: ${appId}`);

  const a = results[0];
  const reviews = await fetchAppleReviews(appId, cc);

  const now = new Date().toISOString();
  return {
    type: 'app',
    store: 'apple',
    appId: String(a.trackId),
    country,
    timestamp: now,
    app: {
      appId: String(a.trackId),
      appName: a.trackName || '',
      developer: a.artistName || '',
      description: a.description || '',
      rating: a.averageUserRating ? Math.round(a.averageUserRating * 10) / 10 : null,
      ratingCount: a.userRatingCount || null,
      price: a.formattedPrice || 'Free',
      inAppPurchases: Array.isArray(a.inAppPurchasePriceRange),
      category: a.primaryGenreName || '',
      lastUpdated: a.currentVersionReleaseDate?.split('T')[0] || null,
      size: a.fileSizeBytes ? `${Math.round(parseInt(a.fileSizeBytes) / 1_048_576)} MB` : null,
      version: a.version || null,
      icon: a.artworkUrl512 || a.artworkUrl100 || null,
      screenshots: a.screenshotUrls || [],
      contentRating: a.contentAdvisoryRating || null,
      reviews,
    },
    metadata: { scrapedAt: now },
  };
}

async function fetchAppleReviews(appId: string, cc: string): Promise<AppReview[]> {
  try {
    const url = `https://itunes.apple.com/${cc}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
    const resp = await proxyFetch(url, { timeoutMs: 15_000 });
    if (!resp.ok) return [];

    const data = await resp.json() as any;
    const entries = (data?.feed?.entry || []).filter((e: any) => e['im:rating']);

    return entries.slice(0, 10).map((e: any): AppReview => ({
      author: e.author?.name?.label || 'Anonymous',
      rating: parseInt(e['im:rating']?.label || '0'),
      title: e.title?.label || null,
      text: e.content?.label || '',
      date: e.updated?.label || null,
    }));
  } catch {
    return [];
  }
}

export async function searchAppleApps(query: string, country: string): Promise<SearchResultData> {
  const cc = country.toLowerCase();
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${cc}&entity=software&limit=50`;

  const resp = await proxyFetch(url, { timeoutMs: 15_000 });
  if (!resp.ok) throw new Error(`iTunes Search returned ${resp.status}`);

  const data = await resp.json() as any;
  const results = (data?.results || []).map((a: any): AppSearchResult => ({
    appName: a.trackName || '',
    developer: a.artistName || '',
    appId: String(a.trackId),
    rating: a.averageUserRating ? Math.round(a.averageUserRating * 10) / 10 : null,
    ratingCount: a.userRatingCount || null,
    price: a.formattedPrice || 'Free',
    icon: a.artworkUrl512 || a.artworkUrl100 || null,
    category: a.primaryGenreName || null,
  }));

  const now = new Date().toISOString();
  return {
    type: 'search',
    store: 'apple',
    query,
    country,
    timestamp: now,
    results,
    metadata: { totalResults: results.length, scrapedAt: now },
  };
}

export async function fetchAppleTrending(country: string): Promise<TrendingResult> {
  const cc = country.toLowerCase();
  let url = `https://itunes.apple.com/${cc}/rss/newfreeapplications/limit=50/json`;

  let resp = await proxyFetch(url, { timeoutMs: 20_000 });
  if (!resp.ok) {
    // Fallback to top free if "new" feed unavailable
    url = `https://itunes.apple.com/${cc}/rss/topfreeapplications/limit=50/json`;
    resp = await proxyFetch(url, { timeoutMs: 20_000 });
  }
  if (!resp.ok) throw new Error(`Apple trending returned ${resp.status}`);

  const data = await resp.json() as any;
  const entries = data?.feed?.entry || [];

  let trending: AppRanking[] = entries.map((e: any, i: number) => {
    const priceAttrs = e['im:price']?.attributes || {};
    return {
      rank: i + 1,
      appName: e['im:name']?.label || '',
      developer: e['im:artist']?.label || '',
      appId: e.id?.attributes?.['im:id'] || '',
      rating: null,
      ratingCount: null,
      price: priceAttrs.amount === '0.00000' ? 'Free' : `$${priceAttrs.amount}`,
      inAppPurchases: false,
      category: e.category?.attributes?.label || 'New',
      lastUpdated: e['im:releaseDate']?.label || null,
      size: null,
      icon: e['im:image']?.[2]?.label || null,
    };
  });

  trending = await enrichAppleApps(trending, cc);

  const now = new Date().toISOString();
  return {
    type: 'trending',
    store: 'apple',
    country,
    timestamp: now,
    trending,
    metadata: { totalRanked: trending.length, scrapedAt: now },
  };
}

// ─── GOOGLE PLAY STORE ──────────────────────────────

async function fetchGPlayHtml(url: string): Promise<string> {
  const resp = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 25_000,
  });
  if (!resp.ok) throw new Error(`Google Play returned ${resp.status}`);
  return resp.text();
}

function extractPackageIds(html: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const pattern = /\/store\/apps\/details\?id=([a-zA-Z][a-zA-Z0-9._]+)/g;

  let m;
  while ((m = pattern.exec(html)) !== null) {
    const id = m[1];
    if (!seen.has(id) && id.includes('.')) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function getContextAround(html: string, needle: string, chars: number): string | null {
  const idx = html.indexOf(needle);
  if (idx === -1) return null;
  return html.substring(
    Math.max(0, idx - chars),
    Math.min(html.length, idx + needle.length + chars),
  );
}

function parseGPlayCards(html: string, category: string): AppRanking[] {
  const pkgIds = extractPackageIds(html);
  const rankings: AppRanking[] = [];

  for (let i = 0; i < Math.min(pkgIds.length, 50); i++) {
    const pkg = pkgIds[i];
    const ctx = getContextAround(html, pkg, 800);

    let appName = pkg;
    let developer = '';
    let rating: number | null = null;
    let icon: string | null = null;

    if (ctx) {
      const nameM = ctx.match(/alt="([^"]{2,80})"/i) ||
                    ctx.match(/aria-label="([^"]{2,80})"/i) ||
                    ctx.match(/title="([^"]{2,80})"/i);
      if (nameM) appName = decodeHtmlEntities(nameM[1]);

      const devM = ctx.match(/\/store\/apps\/dev[^"]*"[^>]*>([^<]+)/);
      if (devM) developer = decodeHtmlEntities(devM[1]);

      const rM = ctx.match(/(\d\.\d)\s*star/i) || ctx.match(/>(\d\.\d)</);
      if (rM) rating = parseFloat(rM[1]);

      const iconM = ctx.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/);
      if (iconM) icon = iconM[1];
    }

    rankings.push({
      rank: i + 1,
      appName,
      developer,
      appId: pkg,
      rating,
      ratingCount: null,
      price: 'Free',
      inAppPurchases: false,
      category,
      lastUpdated: null,
      size: null,
      icon,
    });
  }
  return rankings;
}

export async function fetchGPlayRankings(category: string, country: string): Promise<RankingsResult> {
  const hl = LANG_MAP[country] || 'en';
  const catSlug = GPLAY_CATEGORIES[category.toLowerCase()];

  let url: string;
  if (catSlug) {
    url = `https://play.google.com/store/apps/category/${catSlug}?hl=${hl}&gl=${country}`;
  } else {
    url = `https://play.google.com/store/apps/top?hl=${hl}&gl=${country}`;
  }

  const html = await fetchGPlayHtml(url);
  const rankings = parseGPlayCards(html, category);

  const now = new Date().toISOString();
  return {
    type: 'rankings',
    store: 'google',
    category,
    country,
    timestamp: now,
    rankings,
    metadata: { totalRanked: rankings.length, scrapedAt: now },
  };
}

function extractGPlayDetailFromHtml(html: string, appId: string): Partial<AppDetail> {
  const detail: Partial<AppDetail> = { appId };

  // og:title
  const titleM = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                 html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
  if (titleM) detail.appName = decodeHtmlEntities(titleM[1]);

  // og:description
  const descM = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
                html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/i);
  if (descM) detail.description = decodeHtmlEntities(descM[1]);

  // og:image
  const imgM = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
               html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
  if (imgM) detail.icon = imgM[1];

  // Rating from structured data or aria-label
  const ratingM = html.match(/Rated\s+(\d\.?\d?)\s+stars/i) ||
                  html.match(/"ratingValue":\s*"?(\d\.?\d?)"?/);
  if (ratingM) detail.rating = parseFloat(ratingM[1]);

  // Rating count
  const countM = html.match(/"ratingCount":\s*"?(\d+)"?/) ||
                 html.match(/"reviewCount":\s*"?(\d+)"?/) ||
                 html.match(/(\d{1,3}(?:,\d{3})*)\s*reviews/i);
  if (countM) detail.ratingCount = parseInt(countM[1].replace(/,/g, ''));

  // Developer
  const devM = html.match(/\/store\/apps\/dev[^"]*"[^>]*>([^<]+)/);
  if (devM) detail.developer = decodeHtmlEntities(devM[1]);

  // Category from breadcrumbs
  const catM = html.match(/\/store\/apps\/category\/([A-Z_]+)/);
  if (catM) {
    detail.category = catM[1].replace(/_/g, ' ').toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // Price
  const priceM = html.match(/itemprop="price"\s+content="([^"]+)"/i) ||
                 html.match(/"price":\s*"([^"]+)"/);
  detail.price = (priceM && priceM[1] !== '0') ? priceM[1] : 'Free';

  // Content rating
  const crM = html.match(/"contentRating":\s*"([^"]+)"/) ||
              html.match(/Rated for\s+([^<"]+)/i);
  if (crM) detail.contentRating = crM[1];

  // Version
  const verM = html.match(/Current Version[\s\S]*?>([^<]+)</) ||
               html.match(/"softwareVersion":\s*"([^"]+)"/);
  if (verM) detail.version = verM[1].trim();

  // Last updated
  const updM = html.match(/Updated on[\s\S]*?>([^<]+)</) ||
               html.match(/"datePublished":\s*"([^"]+)"/);
  if (updM) detail.lastUpdated = updM[1].trim();

  // Screenshots
  detail.screenshots = [];
  const ssPattern = /srcset="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/g;
  let ssm;
  while ((ssm = ssPattern.exec(html)) !== null && detail.screenshots!.length < 5) {
    detail.screenshots!.push(ssm[1].split(' ')[0]);
  }

  // In-app purchases
  detail.inAppPurchases = /In-app\s+purchases/i.test(html) || /Offers\s+in-app/i.test(html);

  // Size
  const sizeM = html.match(/(\d+(?:\.\d+)?\s*[KMG]B)/i);
  if (sizeM) detail.size = sizeM[1];

  return detail;
}

function extractGPlayReviews(html: string): AppReview[] {
  const reviews: AppReview[] = [];

  // Google Play embeds reviews with star ratings in aria-label and text nearby
  const reviewPattern = /aria-label="Rated\s+(\d)\s+stars[^"]*"[\s\S]{0,2000}?review-body[^>]*>[\s\S]*?<span[^>]*>([^<]{5,500})<\/span>/g;
  let m;
  while ((m = reviewPattern.exec(html)) !== null && reviews.length < 10) {
    const text = decodeHtmlEntities(m[2].trim());
    if (text.length > 5 && !text.includes('class=')) {
      reviews.push({
        author: 'Google Play User',
        rating: parseInt(m[1]),
        title: null,
        text,
        date: null,
      });
    }
  }

  // Fallback: simpler pattern matching
  if (reviews.length === 0) {
    const simplePattern = /Rated\s+(\d)\s+stars[\s\S]{0,500}?<span[^>]*>([^<]{10,500})<\/span>/g;
    while ((m = simplePattern.exec(html)) !== null && reviews.length < 10) {
      const text = decodeHtmlEntities(m[2].trim());
      if (!text.includes('class=') && !text.includes('style=') && !text.includes('href=')) {
        reviews.push({
          author: 'Google Play User',
          rating: parseInt(m[1]),
          title: null,
          text,
          date: null,
        });
      }
    }
  }

  return reviews;
}

export async function fetchGPlayAppDetail(appId: string, country: string): Promise<AppDetailResult> {
  const hl = LANG_MAP[country] || 'en';
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=${hl}&gl=${country}`;

  const html = await fetchGPlayHtml(url);
  const detail = extractGPlayDetailFromHtml(html, appId);
  const reviews = extractGPlayReviews(html);

  const now = new Date().toISOString();
  return {
    type: 'app',
    store: 'google',
    appId,
    country,
    timestamp: now,
    app: {
      appId,
      appName: detail.appName || appId,
      developer: detail.developer || '',
      description: detail.description || '',
      rating: detail.rating || null,
      ratingCount: detail.ratingCount || null,
      price: detail.price || 'Free',
      inAppPurchases: detail.inAppPurchases || false,
      category: detail.category || '',
      lastUpdated: detail.lastUpdated || null,
      size: detail.size || null,
      version: detail.version || null,
      icon: detail.icon || null,
      screenshots: detail.screenshots || [],
      contentRating: detail.contentRating || null,
      reviews,
    },
    metadata: { scrapedAt: now },
  };
}

export async function searchGPlayApps(query: string, country: string): Promise<SearchResultData> {
  const hl = LANG_MAP[country] || 'en';
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=${hl}&gl=${country}`;

  const html = await fetchGPlayHtml(url);
  const pkgIds = extractPackageIds(html);

  const results: AppSearchResult[] = [];
  for (let i = 0; i < Math.min(pkgIds.length, 50); i++) {
    const pkg = pkgIds[i];
    const ctx = getContextAround(html, pkg, 800);

    let appName = pkg;
    let developer = '';
    let rating: number | null = null;
    let icon: string | null = null;

    if (ctx) {
      const nameM = ctx.match(/alt="([^"]{2,80})"/i) ||
                    ctx.match(/title="([^"]{2,80})"/i);
      if (nameM) appName = decodeHtmlEntities(nameM[1]);

      const devM = ctx.match(/\/store\/apps\/dev[^"]*"[^>]*>([^<]+)/);
      if (devM) developer = decodeHtmlEntities(devM[1]);

      const rM = ctx.match(/(\d\.\d)\s*star/i) || ctx.match(/>(\d\.\d)</);
      if (rM) rating = parseFloat(rM[1]);

      const iconM = ctx.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/);
      if (iconM) icon = iconM[1];
    }

    results.push({
      appName,
      developer,
      appId: pkg,
      rating,
      ratingCount: null,
      price: 'Free',
      icon,
      category: null,
    });
  }

  const now = new Date().toISOString();
  return {
    type: 'search',
    store: 'google',
    query,
    country,
    timestamp: now,
    results,
    metadata: { totalResults: results.length, scrapedAt: now },
  };
}

export async function fetchGPlayTrending(country: string): Promise<TrendingResult> {
  const hl = LANG_MAP[country] || 'en';

  let html: string;
  try {
    html = await fetchGPlayHtml(`https://play.google.com/store/apps/new?hl=${hl}&gl=${country}`);
  } catch {
    // Fallback to top charts if new page unavailable
    html = await fetchGPlayHtml(`https://play.google.com/store/apps/top?hl=${hl}&gl=${country}`);
  }

  const trending = parseGPlayCards(html, 'New');

  const now = new Date().toISOString();
  return {
    type: 'trending',
    store: 'google',
    country,
    timestamp: now,
    trending,
    metadata: { totalRanked: trending.length, scrapedAt: now },
  };
}
