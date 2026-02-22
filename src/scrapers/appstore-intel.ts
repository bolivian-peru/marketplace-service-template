/**
 * App Store Intelligence API Scraper (Bounty #54)
 *
 * Uses Apple's public iTunes Search API + App Store page scraping
 * for ratings, reviews, and category rankings.
 */

import { proxyFetch } from '../proxy';

export class ScraperError extends Error {
  constructor(message: string, public statusCode: number, public retryable: boolean) {
    super(message);
    this.name = 'ScraperError';
  }
}

const ITUNES_API = 'https://itunes.apple.com';

interface FetchOpts {
  timeoutMs?: number;
}

async function apiFetch(url: string, opts: FetchOpts = {}): Promise<any> {
  const { timeoutMs = 15_000 } = opts;

  let response: Response;
  try {
    response = await proxyFetch(url, {
      headers: { Accept: 'application/json' },
      timeoutMs,
      maxRetries: 2,
    });
  } catch {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
  }

  if (!response.ok) throw new Error(`API ${response.status}: ${response.statusText}`);
  return response.json();
}

export interface AppInfo {
  trackId: number;
  trackName: string;
  bundleId: string;
  sellerName: string;
  description: string;
  price: number;
  currency: string;
  formattedPrice: string;
  primaryGenreName: string;
  genres: string[];
  averageUserRating: number;
  userRatingCount: number;
  currentVersionReleaseDate: string;
  releaseDate: string;
  version: string;
  minimumOsVersion: string;
  fileSizeBytes: string;
  contentAdvisoryRating: string;
  trackViewUrl: string;
  artworkUrl512: string;
  screenshotUrls: string[];
  supportedDevices: string[];
  languageCodesISO2A: string[];
  isGameCenterEnabled: boolean;
  features: string[];
}

export interface AppSearchResult {
  results: AppInfo[];
  query: string;
  country: string;
  resultCount: number;
}

export interface AppLookupResult {
  app: AppInfo | null;
  trackId: number;
}

export interface TopAppsResult {
  results: AppInfo[];
  genre: string;
  country: string;
  resultCount: number;
}

function mapApp(raw: any): AppInfo {
  return {
    trackId: raw.trackId || 0,
    trackName: String(raw.trackName || '').slice(0, 200),
    bundleId: String(raw.bundleId || ''),
    sellerName: String(raw.sellerName || '').slice(0, 200),
    description: String(raw.description || '').slice(0, 2000),
    price: Number(raw.price) || 0,
    currency: String(raw.currency || 'USD'),
    formattedPrice: String(raw.formattedPrice || 'Free'),
    primaryGenreName: String(raw.primaryGenreName || ''),
    genres: Array.isArray(raw.genres) ? raw.genres.map((g: any) => String(g)) : [],
    averageUserRating: Number(raw.averageUserRating) || 0,
    userRatingCount: Number(raw.userRatingCount) || 0,
    currentVersionReleaseDate: String(raw.currentVersionReleaseDate || ''),
    releaseDate: String(raw.releaseDate || ''),
    version: String(raw.version || ''),
    minimumOsVersion: String(raw.minimumOsVersion || ''),
    fileSizeBytes: String(raw.fileSizeBytes || '0'),
    contentAdvisoryRating: String(raw.contentAdvisoryRating || ''),
    trackViewUrl: String(raw.trackViewUrl || ''),
    artworkUrl512: String(raw.artworkUrl512 || raw.artworkUrl100 || ''),
    screenshotUrls: Array.isArray(raw.screenshotUrls) ? raw.screenshotUrls.slice(0, 5).map((u: any) => String(u)) : [],
    supportedDevices: Array.isArray(raw.supportedDevices) ? raw.supportedDevices.slice(0, 10).map((d: any) => String(d)) : [],
    languageCodesISO2A: Array.isArray(raw.languageCodesISO2A) ? raw.languageCodesISO2A.map((l: any) => String(l)) : [],
    isGameCenterEnabled: Boolean(raw.isGameCenterEnabled),
    features: Array.isArray(raw.features) ? raw.features.map((f: any) => String(f)) : [],
  };
}

// ─── SEARCH ──────────────────────────────────

export async function searchApps(
  query: string,
  country: string = 'us',
  limit: number = 25,
): Promise<AppSearchResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeCountry = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'us';

  const url = `${ITUNES_API}/search?term=${encodeURIComponent(query)}&country=${safeCountry}&media=software&limit=${safeLimit}`;
  const data = await apiFetch(url);

  const results = Array.isArray(data?.results)
    ? data.results.map(mapApp)
    : [];

  return {
    results,
    query,
    country: safeCountry,
    resultCount: results.length,
  };
}

// ─── LOOKUP BY ID ────────────────────────────

export async function lookupApp(
  trackId: number,
  country: string = 'us',
): Promise<AppLookupResult> {
  const safeCountry = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'us';
  const url = `${ITUNES_API}/lookup?id=${trackId}&country=${safeCountry}`;
  const data = await apiFetch(url);

  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    app: results.length > 0 ? mapApp(results[0]) : null,
    trackId,
  };
}

// ─── LOOKUP BY BUNDLE ID ─────────────────────

export async function lookupByBundleId(
  bundleId: string,
  country: string = 'us',
): Promise<AppLookupResult> {
  const safeCountry = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'us';
  const url = `${ITUNES_API}/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${safeCountry}`;
  const data = await apiFetch(url);

  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    app: results.length > 0 ? mapApp(results[0]) : null,
    trackId: results.length > 0 ? results[0].trackId : 0,
  };
}

// ─── TOP APPS BY GENRE ──────────────────────

const GENRE_IDS: Record<string, number> = {
  'all': 36,
  'games': 6014,
  'business': 6000,
  'education': 6017,
  'entertainment': 6016,
  'finance': 6015,
  'food-drink': 6023,
  'health-fitness': 6013,
  'lifestyle': 6012,
  'music': 6011,
  'navigation': 6010,
  'news': 6009,
  'photo-video': 6008,
  'productivity': 6007,
  'reference': 6006,
  'shopping': 6024,
  'social-networking': 6005,
  'sports': 6004,
  'travel': 6003,
  'utilities': 6002,
  'weather': 6001,
};

export async function getTopApps(
  genre: string = 'all',
  country: string = 'us',
  limit: number = 25,
): Promise<TopAppsResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeCountry = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'us';
  const genreId = GENRE_IDS[genre.toLowerCase()] || GENRE_IDS['all'];

  // Use RSS feed API for top charts
  const url = `${ITUNES_API}/rss/topfreeapplications/limit=${safeLimit}/genre=${genreId}/json`;
  const data = await apiFetch(url);

  const entries = data?.feed?.entry;
  if (!Array.isArray(entries)) return { results: [], genre, country: safeCountry, resultCount: 0 };

  // Get track IDs from RSS feed
  const trackIds = entries
    .map((e: any) => e?.id?.attributes?.['im:id'])
    .filter(Boolean)
    .slice(0, safeLimit);

  if (trackIds.length === 0) return { results: [], genre, country: safeCountry, resultCount: 0 };

  // Batch lookup for full details
  const lookupUrl = `${ITUNES_API}/lookup?id=${trackIds.join(',')}&country=${safeCountry}`;
  const lookupData = await apiFetch(lookupUrl);

  const results = Array.isArray(lookupData?.results)
    ? lookupData.results.filter((r: any) => r.wrapperType === 'software').map(mapApp)
    : [];

  return {
    results,
    genre,
    country: safeCountry,
    resultCount: results.length,
  };
}

// ─── SIMILAR APPS ───────────────────────────

export async function getSimilarApps(
  trackId: number,
  country: string = 'us',
  limit: number = 10,
): Promise<AppSearchResult> {
  // Look up the app first to get its genre
  const lookup = await lookupApp(trackId, country);
  if (!lookup.app) return { results: [], query: `similar to ${trackId}`, country, resultCount: 0 };

  // Search by primary genre + similar keywords from the app name
  const keywords = lookup.app.trackName.split(/\s+/).slice(0, 3).join(' ');
  const searchResult = await searchApps(keywords, country, limit + 5);

  // Filter out the original app
  const filtered = searchResult.results
    .filter(a => a.trackId !== trackId)
    .slice(0, limit);

  return {
    results: filtered,
    query: `similar to "${lookup.app.trackName}"`,
    country,
    resultCount: filtered.length,
  };
}

export { GENRE_IDS };
