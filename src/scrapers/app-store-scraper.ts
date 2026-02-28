/**
 * App Store Intelligence Scraper
 * ──────────────────────────────
 * Extracts app data from Apple App Store (iTunes Search API + page scraping)
 * and Google Play Store (page scraping with embedded JSON parsing).
 * Self-contained: no imports from other project files.
 */

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface AppInfo {
  name: string;
  appId: string;
  store: 'apple' | 'google';
  developer: string;
  developerId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  free: boolean;
  icon: string;
  url: string;
  category: string;
  description: string;
  version: string;
  size: string;
  lastUpdated: string;
  contentRating: string;
  installs: string;
  screenshots: string[];
  permissions: string[];
  similarApps: string[];
}

export interface AppReview {
  author: string;
  rating: number;
  title: string;
  text: string;
  date: string;
  version: string;
  helpful: number;
}

export interface SearchResult {
  type: 'search';
  query: string;
  store: string;
  country: string;
  apps: AppInfo[];
  metadata: {
    totalResults: number;
    store: string;
    country: string;
    scrapedAt: string;
  };
}

export interface DetailsResult {
  type: 'details';
  app: AppInfo | null;
  metadata: {
    store: string;
    country: string;
    scrapedAt: string;
  };
}

export interface ChartsResult {
  type: 'charts';
  category: string;
  store: string;
  country: string;
  apps: AppInfo[];
  metadata: {
    totalResults: number;
    store: string;
    country: string;
    scrapedAt: string;
  };
}

export interface ReviewsResult {
  type: 'reviews';
  appId: string;
  store: string;
  country: string;
  reviews: AppReview[];
  metadata: {
    totalResults: number;
    store: string;
    country: string;
    scrapedAt: string;
  };
}

// ─── CONSTANTS ──────────────────────────────────────

const ITUNES_SEARCH_API = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP_API = 'https://itunes.apple.com/lookup';
const APPLE_RSS_BASE = 'https://rss.applemarketingtools.com/api/v2';
const GOOGLE_PLAY_BASE = 'https://play.google.com';
const GOOGLE_PLAY_SEARCH = 'https://play.google.com/store/search';
const GOOGLE_PLAY_DETAILS = 'https://play.google.com/store/apps/details';
const GOOGLE_PLAY_CHARTS = 'https://play.google.com/store/apps/top';

const DEFAULT_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Cache-Control': 'no-cache',
};

// ─── APPLE APP STORE HELPERS ────────────────────────

interface ITunesResult {
  trackId: number;
  trackName: string;
  bundleId: string;
  artistName: string;
  artistId: number;
  averageUserRating?: number;
  userRatingCount?: number;
  formattedPrice?: string;
  price?: number;
  artworkUrl512?: string;
  artworkUrl100?: string;
  trackViewUrl: string;
  primaryGenreName?: string;
  genres?: string[];
  description?: string;
  version?: string;
  fileSizeBytes?: string;
  currentVersionReleaseDate?: string;
  contentAdvisoryRating?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  releaseNotes?: string;
  minimumOsVersion?: string;
  languageCodesISO2A?: string[];
  sellerName?: string;
}

function parseITunesResult(item: ITunesResult): AppInfo {
  const sizeBytes = parseInt(item.fileSizeBytes || '0', 10);
  const sizeMB = sizeBytes > 0 ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` : 'Unknown';

  return {
    name: item.trackName || '',
    appId: item.bundleId || String(item.trackId),
    store: 'apple',
    developer: item.artistName || '',
    developerId: String(item.artistId || ''),
    rating: item.averageUserRating ?? null,
    ratingCount: item.userRatingCount ?? null,
    price: item.formattedPrice || (item.price === 0 ? 'Free' : `$${item.price}`),
    free: (item.price ?? 0) === 0,
    icon: item.artworkUrl512 || item.artworkUrl100 || '',
    url: item.trackViewUrl || '',
    category: item.primaryGenreName || (item.genres?.[0] ?? ''),
    description: item.description || '',
    version: item.version || '',
    size: sizeMB,
    lastUpdated: item.currentVersionReleaseDate || '',
    contentRating: item.contentAdvisoryRating || '',
    installs: '',
    screenshots: [...(item.screenshotUrls || []), ...(item.ipadScreenshotUrls || [])],
    permissions: [],
    similarApps: [],
  };
}

async function searchAppleApps(
  query: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<AppInfo[]> {
  const params = new URLSearchParams({
    term: query,
    country: country,
    media: 'software',
    limit: String(Math.min(limit, 200)),
    entity: 'software',
  });

  const url = `${ITUNES_SEARCH_API}?${params.toString()}`;
  const resp = await fetchFn(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (!resp.ok) {
    throw new Error(`iTunes Search API returned ${resp.status}`);
  }

  const data: any = await resp.json();
  const results: ITunesResult[] = data.results || [];

  return results
    .filter((r: any) => r.wrapperType === 'software' || r.trackName)
    .map(parseITunesResult);
}

async function getAppleAppDetails(
  appId: string,
  country: string,
  fetchFn: ProxyFetchFn,
): Promise<AppInfo | null> {
  // Try lookup by bundleId first, then by trackId
  const isBundleId = appId.includes('.');
  const params = new URLSearchParams({
    country: country,
    ...(isBundleId ? { bundleId: appId } : { id: appId }),
  });

  const url = `${ITUNES_LOOKUP_API}?${params.toString()}`;
  const resp = await fetchFn(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (!resp.ok) {
    throw new Error(`iTunes Lookup API returned ${resp.status}`);
  }

  const data: any = await resp.json();
  const results: ITunesResult[] = data.results || [];

  if (results.length === 0) return null;

  const app = parseITunesResult(results[0]);

  // Attempt to enrich with web page scraping for additional data
  try {
    const enriched = await scrapeAppleAppPage(app.url, fetchFn);
    if (enriched) {
      app.similarApps = enriched.similarApps || [];
      if (enriched.whatsNew) {
        (app as any).whatsNew = enriched.whatsNew;
      }
      if (enriched.privacyDetails) {
        (app as any).privacyDetails = enriched.privacyDetails;
      }
    }
  } catch {
    // Enrichment is optional — page scraping may fail
  }

  return app;
}

async function scrapeAppleAppPage(
  pageUrl: string,
  fetchFn: ProxyFetchFn,
): Promise<{ similarApps: string[]; whatsNew?: string; privacyDetails?: string[] } | null> {
  if (!pageUrl) return null;

  const resp = await fetchFn(pageUrl, {
    headers: DEFAULT_HEADERS,
    maxRetries: 1,
    timeoutMs: 25_000,
  });

  if (!resp.ok) return null;

  const html = await resp.text();
  const similarApps: string[] = [];
  const whatsNew = extractBetween(html, 'data-test-id="section-heading-whats-new"', '</section>');

  // Parse "Customers Also Bought" / similar app IDs
  const similarMatch = html.match(/also-bought[\s\S]*?<\/section>/i);
  if (similarMatch) {
    const idMatches = similarMatch[0].matchAll(/\/app\/[^/]+\/id(\d+)/g);
    for (const m of idMatches) {
      if (m[1] && !similarApps.includes(m[1])) {
        similarApps.push(m[1]);
      }
    }
  }

  // Parse privacy labels
  const privacyDetails: string[] = [];
  const privacySection = extractBetween(html, 'app-privacy', '</section>');
  if (privacySection) {
    const privacyItems = privacySection.matchAll(/privacy-type[^>]*>([^<]+)/g);
    for (const pi of privacyItems) {
      if (pi[1]) privacyDetails.push(pi[1].trim());
    }
  }

  return {
    similarApps,
    whatsNew: whatsNew ? stripHtml(whatsNew).trim().slice(0, 2000) : undefined,
    privacyDetails: privacyDetails.length > 0 ? privacyDetails : undefined,
  };
}

async function getAppleTopCharts(
  category: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<AppInfo[]> {
  // Use Apple Marketing Tools RSS feed for top charts
  const genre = mapCategoryToAppleGenre(category);
  const feedLimit = Math.min(limit, 100);
  const url = `${APPLE_RSS_BASE}/${country}/apps/top-free/${feedLimit}/apps.json` +
    (genre ? `?genre=${genre}` : '');

  const resp = await fetchFn(url, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (!resp.ok) {
    // Fallback: try without genre
    const fallbackUrl = `${APPLE_RSS_BASE}/${country}/apps/top-free/${feedLimit}/apps.json`;
    const fallbackResp = await fetchFn(fallbackUrl, {
      headers: { 'Accept': 'application/json' },
      maxRetries: 2,
      timeoutMs: 20_000,
    });
    if (!fallbackResp.ok) throw new Error(`Apple RSS feed returned ${fallbackResp.status}`);
    return parseAppleRssFeed(await fallbackResp.json());
  }

  return parseAppleRssFeed(await resp.json());
}

function parseAppleRssFeed(data: any): AppInfo[] {
  const feed = data?.feed;
  if (!feed?.results) return [];

  return feed.results.map((item: any) => ({
    name: item.name || '',
    appId: item.id || '',
    store: 'apple' as const,
    developer: item.artistName || '',
    developerId: item.artistId || '',
    rating: null,
    ratingCount: null,
    price: item.kind === 'apps' ? 'Free' : 'Unknown',
    free: true,
    icon: item.artworkUrl100 || '',
    url: item.url || '',
    category: item.genres?.[0]?.name || '',
    description: '',
    version: '',
    size: '',
    lastUpdated: item.releaseDate || '',
    contentRating: '',
    installs: '',
    screenshots: [],
    permissions: [],
    similarApps: [],
  }));
}

async function getAppleAppReviews(
  appId: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<AppReview[]> {
  // Look up the numeric ID if a bundle ID is provided
  let numericId = appId;
  if (appId.includes('.')) {
    const lookupUrl = `${ITUNES_LOOKUP_API}?bundleId=${encodeURIComponent(appId)}&country=${country}`;
    const lookupResp = await fetchFn(lookupUrl, {
      headers: { 'Accept': 'application/json' },
      maxRetries: 2,
      timeoutMs: 15_000,
    });
    if (lookupResp.ok) {
      const lookupData: any = await lookupResp.json();
      if (lookupData.results?.[0]?.trackId) {
        numericId = String(lookupData.results[0].trackId);
      }
    }
  }

  // Use the iTunes customer reviews RSS feed (JSON format)
  const reviewUrl = `https://itunes.apple.com/${country.toLowerCase()}/rss/customerreviews/id=${numericId}/sortBy=mostRecent/json`;
  const resp = await fetchFn(reviewUrl, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 2,
    timeoutMs: 20_000,
  });

  if (!resp.ok) {
    throw new Error(`Apple reviews feed returned ${resp.status}`);
  }

  const data: any = await resp.json();
  const entries = data?.feed?.entry;
  if (!Array.isArray(entries)) return [];

  const reviews: AppReview[] = [];
  for (const entry of entries) {
    // Skip the first entry if it is the app metadata
    if (entry?.['im:name']) continue;

    reviews.push({
      author: entry?.author?.name?.label || 'Anonymous',
      rating: parseInt(entry?.['im:rating']?.label || '0', 10),
      title: entry?.title?.label || '',
      text: entry?.content?.label || '',
      date: entry?.updated?.label || '',
      version: entry?.['im:version']?.label || '',
      helpful: parseInt(entry?.['im:voteSum']?.label || '0', 10),
    });

    if (reviews.length >= limit) break;
  }

  return reviews;
}

// ─── GOOGLE PLAY STORE HELPERS ──────────────────────

async function searchGooglePlayApps(
  query: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<AppInfo[]> {
  const params = new URLSearchParams({
    q: query,
    c: 'apps',
    gl: country,
    hl: 'en',
  });

  const url = `${GOOGLE_PLAY_SEARCH}?${params.toString()}`;
  const resp = await fetchFn(url, {
    headers: DEFAULT_HEADERS,
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!resp.ok) {
    throw new Error(`Google Play search returned ${resp.status}`);
  }

  const html = await resp.text();
  return parseGooglePlaySearchResults(html, limit);
}

function parseGooglePlaySearchResults(html: string, limit: number): AppInfo[] {
  const apps: AppInfo[] = [];

  // Google Play search results contain app cards with specific patterns
  // Extract app data from the HTML structure
  const appCardPattern = /href="\/store\/apps\/details\?id=([^"&]+)"/g;
  const packageIds: string[] = [];
  let match;

  while ((match = appCardPattern.exec(html)) !== null) {
    const pkgId = decodeURIComponent(match[1]);
    if (!packageIds.includes(pkgId)) {
      packageIds.push(pkgId);
    }
  }

  // For each app ID found, extract surrounding data from the HTML
  for (const pkgId of packageIds.slice(0, limit)) {
    const app = extractGooglePlayAppFromHtml(html, pkgId);
    if (app) apps.push(app);
  }

  return apps;
}

function extractGooglePlayAppFromHtml(html: string, packageId: string): AppInfo | null {
  // Find the section of HTML around this package ID
  const idx = html.indexOf(`id=${packageId}`);
  if (idx === -1) return null;

  // Extract a window of HTML around the match for context
  const start = Math.max(0, idx - 3000);
  const end = Math.min(html.length, idx + 5000);
  const section = html.substring(start, end);

  // Extract app name — usually in a span or div with specific attributes near the link
  const name = extractAppName(section, packageId);

  // Extract developer name
  const developer = extractDeveloper(section);

  // Extract rating
  const rating = extractRating(section);

  // Extract icon URL
  const icon = extractIcon(section);

  // Extract category from breadcrumb or category link
  const category = extractCategory(section);

  // Extract price info
  const priceText = extractPrice(section);
  const isFree = !priceText || priceText === 'Free' || priceText.includes('Install');

  return {
    name: name || packageId,
    appId: packageId,
    store: 'google',
    developer: developer || '',
    developerId: '',
    rating: rating,
    ratingCount: null,
    price: isFree ? 'Free' : (priceText || 'Unknown'),
    free: isFree,
    icon: icon || '',
    url: `${GOOGLE_PLAY_BASE}/store/apps/details?id=${packageId}`,
    category: category || '',
    description: '',
    version: '',
    size: '',
    lastUpdated: '',
    contentRating: '',
    installs: '',
    screenshots: [],
    permissions: [],
    similarApps: [],
  };
}

function extractAppName(section: string, _packageId: string): string {
  // Try multiple patterns to find app name
  // Pattern 1: Look for title text near the app link
  const titlePatterns = [
    /aria-label="([^"]+)"\s*[^>]*href="[^"]*id=\S+"/,
    /class="[^"]*[Tt]itle[^"]*"[^>]*>([^<]+)</,
    /data-item-title="([^"]+)"/,
  ];

  for (const pattern of titlePatterns) {
    const m = section.match(pattern);
    if (m?.[1] && m[1].length > 1 && m[1].length < 100) {
      return decodeHtmlEntities(m[1].trim());
    }
  }

  // Fallback: try AF_initDataCallback JSON embedded in page
  const jsonMatch = section.match(/"([^"]{2,80})"\s*,\s*\[\s*\[\s*"[^"]*"\s*,\s*"https:\/\/play-lh/);
  if (jsonMatch?.[1]) return jsonMatch[1];

  return '';
}

function extractDeveloper(section: string): string {
  const devPatterns = [
    /class="[^"]*[Dd]eveloper[^"]*"[^>]*>([^<]+)</,
    /\/store\/apps\/dev(?:eloper)?\?id=[^"]*"[^>]*>([^<]+)</,
    /class="[^"]*subtitle[^"]*"[^>]*>([^<]+)</,
  ];

  for (const pattern of devPatterns) {
    const m = section.match(pattern);
    if (m?.[1] && m[1].length > 1 && m[1].length < 100) {
      return decodeHtmlEntities(m[1].trim());
    }
  }
  return '';
}

function extractRating(section: string): number | null {
  const ratingPatterns = [
    /aria-label="Rated\s+([\d.]+)\s+(?:out of|stars)/i,
    /rating"[^>]*>([\d.]+)<\/div>/,
    />([\d.]+)\s*<svg[^>]*star/i,
    /star_rate[^>]*>\s*<\/i>\s*([\d.]+)/,
    /(\d\.\d)\s*star/i,
  ];

  for (const pattern of ratingPatterns) {
    const m = section.match(pattern);
    if (m?.[1]) {
      const val = parseFloat(m[1]);
      if (val >= 0 && val <= 5) return Math.round(val * 10) / 10;
    }
  }
  return null;
}

function extractIcon(section: string): string {
  const iconPatterns = [
    /src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"\s*[^>]*(?:alt|class="[^"]*[Ii]con)/,
    /srcset="(https:\/\/play-lh\.googleusercontent\.com\/[^\s"]+)/,
    /(https:\/\/play-lh\.googleusercontent\.com\/[^"'\s]+(?:=w\d+|=s\d+)[^"'\s]*)/,
  ];

  for (const pattern of iconPatterns) {
    const m = section.match(pattern);
    if (m?.[1]) return m[1];
  }
  return '';
}

function extractCategory(section: string): string {
  const catPatterns = [
    /\/store\/apps\/category\/([A-Z_]+)/,
    /data-category="([^"]+)"/,
    /class="[^"]*[Cc]ategory[^"]*"[^>]*>([^<]+)</,
  ];

  for (const pattern of catPatterns) {
    const m = section.match(pattern);
    if (m?.[1]) {
      return formatGoogleCategory(m[1].trim());
    }
  }
  return '';
}

function extractPrice(section: string): string {
  const pricePatterns = [
    /class="[^"]*[Pp]rice[^"]*"[^>]*>([^<]+)</,
    /\$(\d+\.?\d*)/,
    />(Free|Install)<\//i,
  ];

  for (const pattern of pricePatterns) {
    const m = section.match(pattern);
    if (m?.[1] || m?.[0]) return (m[1] || m[0]).trim();
  }
  return '';
}

function formatGoogleCategory(raw: string): string {
  const categoryMap: Record<string, string> = {
    'GAME': 'Games', 'GAME_ACTION': 'Action Games', 'GAME_ADVENTURE': 'Adventure Games',
    'GAME_ARCADE': 'Arcade Games', 'GAME_BOARD': 'Board Games', 'GAME_CARD': 'Card Games',
    'GAME_CASINO': 'Casino Games', 'GAME_CASUAL': 'Casual Games', 'GAME_EDUCATIONAL': 'Educational Games',
    'GAME_MUSIC': 'Music Games', 'GAME_PUZZLE': 'Puzzle Games', 'GAME_RACING': 'Racing Games',
    'GAME_ROLE_PLAYING': 'Role Playing Games', 'GAME_SIMULATION': 'Simulation Games',
    'GAME_SPORTS': 'Sports Games', 'GAME_STRATEGY': 'Strategy Games', 'GAME_TRIVIA': 'Trivia Games',
    'GAME_WORD': 'Word Games',
    'APPLICATION': 'Apps', 'ART_AND_DESIGN': 'Art & Design', 'AUTO_AND_VEHICLES': 'Auto & Vehicles',
    'BEAUTY': 'Beauty', 'BOOKS_AND_REFERENCE': 'Books & Reference', 'BUSINESS': 'Business',
    'COMICS': 'Comics', 'COMMUNICATION': 'Communication', 'DATING': 'Dating',
    'EDUCATION': 'Education', 'ENTERTAINMENT': 'Entertainment', 'EVENTS': 'Events',
    'FINANCE': 'Finance', 'FOOD_AND_DRINK': 'Food & Drink', 'HEALTH_AND_FITNESS': 'Health & Fitness',
    'HOUSE_AND_HOME': 'House & Home', 'LIBRARIES_AND_DEMO': 'Libraries & Demo',
    'LIFESTYLE': 'Lifestyle', 'MAPS_AND_NAVIGATION': 'Maps & Navigation', 'MEDICAL': 'Medical',
    'MUSIC_AND_AUDIO': 'Music & Audio', 'NEWS_AND_MAGAZINES': 'News & Magazines',
    'PARENTING': 'Parenting', 'PERSONALIZATION': 'Personalization', 'PHOTOGRAPHY': 'Photography',
    'PRODUCTIVITY': 'Productivity', 'SHOPPING': 'Shopping', 'SOCIAL': 'Social',
    'SPORTS': 'Sports', 'TOOLS': 'Tools', 'TRAVEL_AND_LOCAL': 'Travel & Local',
    'VIDEO_PLAYERS': 'Video Players', 'WEATHER': 'Weather',
  };
  return categoryMap[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function getGooglePlayAppDetails(
  appId: string,
  country: string,
  fetchFn: ProxyFetchFn,
): Promise<AppInfo | null> {
  const params = new URLSearchParams({
    id: appId,
    gl: country,
    hl: 'en',
  });

  const url = `${GOOGLE_PLAY_DETAILS}?${params.toString()}`;
  const resp = await fetchFn(url, {
    headers: DEFAULT_HEADERS,
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`Google Play details page returned ${resp.status}`);
  }

  const html = await resp.text();
  return parseGooglePlayDetailsPage(html, appId);
}

function parseGooglePlayDetailsPage(html: string, appId: string): AppInfo | null {
  // Extract app name from <title> or og:title
  const name = extractMetaContent(html, 'og:title') ||
    extractBetween(html, '<title>', '</title>')?.replace(' - Apps on Google Play', '').trim() || '';

  // Extract description from meta or page content
  const description = extractMetaContent(html, 'og:description') ||
    extractMetaContent(html, 'description') || '';

  // Extract developer name
  const developerMatch = html.match(/href="\/store\/apps\/dev(?:eloper)?\?id=[^"]*"[^>]*>([^<]+)/);
  const developer = developerMatch ? decodeHtmlEntities(developerMatch[1].trim()) : '';

  // Extract icon
  const icon = extractMetaContent(html, 'og:image') || '';

  // Extract rating from the page
  const ratingMatch = html.match(/aria-label="Rated\s+([\d.]+)\s+out/i) ||
    html.match(/itemprop="ratingValue"\s+content="([\d.]+)"/) ||
    html.match(/>([\d.]+)<\/div>\s*<div[^>]*>\s*star/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  // Extract rating count
  const ratingCountMatch = html.match(/itemprop="ratingCount"\s+content="(\d+)"/) ||
    html.match(/([\d,]+)\s+(?:reviews|ratings)/i);
  const ratingCount = ratingCountMatch
    ? parseInt(ratingCountMatch[1].replace(/,/g, ''), 10)
    : null;

  // Extract install count
  const installsMatch = html.match(/([\d,]+\+?)\s+downloads/i) ||
    html.match(/itemprop="numDownloads"\s+content="([^"]+)"/) ||
    html.match(/([\d.]+[KMBT]?\+?)\s*(?:downloads|installs)/i);
  const installs = installsMatch ? installsMatch[1].trim() : '';

  // Extract version info from "Additional Information" section
  const versionMatch = html.match(/Current Version[^<]*<\/div>\s*<(?:div|span)[^>]*>([^<]+)/) ||
    html.match(/versionName[^:]*:\s*"([^"]+)"/);
  const version = versionMatch ? versionMatch[1].trim() : '';

  // Extract size
  const sizeMatch = html.match(/Size[^<]*<\/div>\s*<(?:div|span)[^>]*>([^<]+)/) ||
    html.match(/"(\d+\.?\d*\s*[KMGT]?B)"/i);
  const size = sizeMatch ? sizeMatch[1].trim() : '';

  // Extract last updated date
  const updatedMatch = html.match(/Updated on[^<]*<\/div>\s*<(?:div|span)[^>]*>([^<]+)/) ||
    html.match(/Updated[^<]*<\/div>\s*<(?:div|span)[^>]*>([A-Z][a-z]+\s+\d+,\s+\d{4})/);
  const lastUpdated = updatedMatch ? updatedMatch[1].trim() : '';

  // Extract content rating
  const contentMatch = html.match(/Content Rating[^<]*<\/div>\s*<(?:div|span)[^>]*>([^<]+)/) ||
    html.match(/itemprop="contentRating"\s+content="([^"]+)"/);
  const contentRating = contentMatch ? contentMatch[1].trim() : '';

  // Extract category
  const categoryMatch = html.match(/itemprop="genre"\s+content="([^"]+)"/) ||
    html.match(/href="\/store\/apps\/category\/([^"]+)"/);
  const category = categoryMatch
    ? (categoryMatch[1].includes('/') ? '' : formatGoogleCategory(categoryMatch[1].trim()))
    : '';

  // Extract screenshots
  const screenshots: string[] = [];
  const screenshotPattern = /src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"\s*[^>]*(?:alt="Screenshot|class="[^"]*screenshot)/gi;
  let ssMatch;
  while ((ssMatch = screenshotPattern.exec(html)) !== null) {
    if (ssMatch[1] && !screenshots.includes(ssMatch[1])) {
      screenshots.push(ssMatch[1]);
    }
  }

  // Also grab image URLs from srcset attributes
  const srcsetPattern = /srcset="(https:\/\/play-lh\.googleusercontent\.com\/[^\s"]+)/g;
  while ((ssMatch = srcsetPattern.exec(html)) !== null) {
    if (ssMatch[1] && !screenshots.includes(ssMatch[1]) && screenshots.length < 10) {
      screenshots.push(ssMatch[1]);
    }
  }

  // Extract permissions from the data layer
  const permissions: string[] = [];
  const permPattern = /android\.permission\.([A-Z_]+)/g;
  let permMatch;
  while ((permMatch = permPattern.exec(html)) !== null) {
    const perm = permMatch[1].replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    if (!permissions.includes(perm)) permissions.push(perm);
  }

  // Extract similar apps
  const similarApps: string[] = [];
  const similarSection = html.match(/Similar apps[\s\S]*?<\/section>/i);
  if (similarSection) {
    const simPattern = /\/store\/apps\/details\?id=([^"&]+)/g;
    let simMatch;
    while ((simMatch = simPattern.exec(similarSection[0])) !== null) {
      const simId = decodeURIComponent(simMatch[1]);
      if (simId !== appId && !similarApps.includes(simId)) {
        similarApps.push(simId);
      }
    }
  }

  // Extract price
  const priceMatch = html.match(/itemprop="price"\s+content="([^"]+)"/) ||
    html.match(/class="[^"]*[Pp]rice[^"]*"[^>]*>([^<]+)/);
  const priceStr = priceMatch ? priceMatch[1].trim() : 'Free';
  const isFree = priceStr === '0' || priceStr.toLowerCase() === 'free' || priceStr === 'Install';

  return {
    name,
    appId,
    store: 'google',
    developer,
    developerId: '',
    rating: rating !== null ? Math.round(rating * 10) / 10 : null,
    ratingCount,
    price: isFree ? 'Free' : priceStr,
    free: isFree,
    icon,
    url: `${GOOGLE_PLAY_BASE}/store/apps/details?id=${appId}`,
    category,
    description: description.slice(0, 2000),
    version,
    size,
    lastUpdated,
    contentRating,
    installs,
    screenshots: screenshots.slice(0, 10),
    permissions: permissions.slice(0, 30),
    similarApps: similarApps.slice(0, 20),
  };
}

async function getGooglePlayTopCharts(
  category: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<AppInfo[]> {
  const googleCategory = mapCategoryToGooglePlay(category);
  const params = new URLSearchParams({
    gl: country,
    hl: 'en',
  });
  if (googleCategory) params.set('category', googleCategory);

  const url = `${GOOGLE_PLAY_CHARTS}?${params.toString()}`;
  const resp = await fetchFn(url, {
    headers: DEFAULT_HEADERS,
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!resp.ok) {
    throw new Error(`Google Play top charts returned ${resp.status}`);
  }

  const html = await resp.text();
  return parseGooglePlaySearchResults(html, limit);
}

async function getGooglePlayReviews(
  appId: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<AppReview[]> {
  // Fetch the app details page which contains initial reviews
  const params = new URLSearchParams({
    id: appId,
    gl: country,
    hl: 'en',
    showAllReviews: 'true',
  });

  const url = `${GOOGLE_PLAY_DETAILS}?${params.toString()}`;
  const resp = await fetchFn(url, {
    headers: DEFAULT_HEADERS,
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!resp.ok) {
    throw new Error(`Google Play reviews page returned ${resp.status}`);
  }

  const html = await resp.text();
  return parseGooglePlayReviews(html, limit);
}

function parseGooglePlayReviews(html: string, limit: number): AppReview[] {
  const reviews: AppReview[] = [];

  // Google Play embeds review data in the page HTML
  // Reviews are typically in structures with specific class patterns

  // Method 1: Extract from embedded JSON data (AF_initDataCallback)
  const dataCallbacks = html.matchAll(/AF_initDataCallback\(\{[^}]*key:\s*'ds:(\d+)'[\s\S]*?data:([\s\S]*?)\}\);/g);
  for (const cb of dataCallbacks) {
    try {
      const _keyIndex = cb[1];
      const jsonStr = cb[2].trim();
      // Try to find review-like arrays in the callback data
      const _reviewArrays = jsonStr.matchAll(/\[\s*"[^"]{1,60}"\s*,\s*null\s*,\s*(\d)\s*,\s*"([^"]*)"[\s\S]*?\]/g);
      // Processing of AF_initDataCallback is best-effort
    } catch {
      // JSON parsing from AF_initDataCallback can be fragile
    }
  }

  // Method 2: Extract from HTML structure
  // Reviews typically have a specific structure with author, rating stars, text
  const reviewBlocks = html.matchAll(
    /(?:class="[^"]*[Rr]eview[^"]*"[^>]*>)([\s\S]*?)(?=class="[^"]*[Rr]eview[^"]*"|<\/section|$)/g,
  );

  for (const block of reviewBlocks) {
    if (reviews.length >= limit) break;
    const content = block[1] || '';

    // Extract author
    const authorMatch = content.match(/class="[^"]*author[^"]*"[^>]*>([^<]+)/) ||
      content.match(/<span[^>]*>([^<]{2,40})<\/span>\s*<\/div>\s*<div[^>]*>\s*(?:<div[^>]*>)?\s*<span[^>]*aria-label="Rated/);
    const author = authorMatch ? decodeHtmlEntities(authorMatch[1].trim()) : '';

    // Extract rating
    const ratingMatch = content.match(/aria-label="Rated\s+(\d)\s+(?:star|out)/i) ||
      content.match(/star_rate[^<]*<\/i>\s*(\d)/);
    const reviewRating = ratingMatch ? parseInt(ratingMatch[1], 10) : 0;

    // Extract review text
    const textMatch = content.match(/class="[^"]*review-body[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/) ||
      content.match(/<span[^>]*>([\s\S]{20,}?)<\/span>\s*(?:<\/div>|<button)/);
    const text = textMatch ? stripHtml(textMatch[1]).trim() : '';

    // Extract date
    const dateMatch = content.match(/(\w+\s+\d{1,2},\s+\d{4})/) ||
      content.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const date = dateMatch ? dateMatch[1] : '';

    // Extract helpful count
    const helpfulMatch = content.match(/(\d+)\s+(?:people|users)\s+found\s+this\s+(?:helpful|review)/i);
    const helpful = helpfulMatch ? parseInt(helpfulMatch[1], 10) : 0;

    if (author || text) {
      reviews.push({
        author: author || 'Anonymous',
        rating: reviewRating,
        title: '',
        text: text.slice(0, 2000),
        date,
        version: '',
        helpful,
      });
    }
  }

  // Method 3: Regex fallback for simpler patterns in script tags
  if (reviews.length === 0) {
    const scriptPattern = /\["([^"]{2,40})"\s*,\s*null\s*,\s*"?(\d)"?\s*,\s*"([^"]+)"\s*,\s*\[?\s*(\d+)/g;
    let sMatch;
    while ((sMatch = scriptPattern.exec(html)) !== null && reviews.length < limit) {
      reviews.push({
        author: sMatch[1],
        rating: parseInt(sMatch[2], 10),
        title: '',
        text: sMatch[3].slice(0, 2000),
        date: '',
        version: '',
        helpful: parseInt(sMatch[4], 10) || 0,
      });
    }
  }

  return reviews;
}

// ─── UTILITY FUNCTIONS ──────────────────────────────

function extractBetween(html: string, startMarker: string, endMarker: string): string | null {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;
  const afterStart = startIdx + startMarker.length;
  const endIdx = html.indexOf(endMarker, afterStart);
  if (endIdx === -1) return null;
  return html.substring(afterStart, endIdx);
}

function extractMetaContent(html: string, property: string): string {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escapeRegex(property)}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${escapeRegex(property)}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapeRegex(property)}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return decodeHtmlEntities(m[1]);
  }
  return '';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function mapCategoryToAppleGenre(category: string): string {
  if (!category) return '';
  const genreMap: Record<string, string> = {
    'games': '6014', 'business': '6000', 'education': '6017',
    'entertainment': '6016', 'finance': '6015', 'food': '6023',
    'health': '6013', 'lifestyle': '6012', 'medical': '6020',
    'music': '6011', 'navigation': '6010', 'news': '6009',
    'photo': '6008', 'productivity': '6007', 'reference': '6006',
    'shopping': '6024', 'social': '6005', 'sports': '6004',
    'travel': '6003', 'utilities': '6002', 'weather': '6001',
    'books': '6018', 'developer': '6026',
  };
  return genreMap[category.toLowerCase()] || '';
}

function mapCategoryToGooglePlay(category: string): string {
  if (!category) return '';
  const catMap: Record<string, string> = {
    'games': 'GAME', 'business': 'BUSINESS', 'education': 'EDUCATION',
    'entertainment': 'ENTERTAINMENT', 'finance': 'FINANCE', 'food': 'FOOD_AND_DRINK',
    'health': 'HEALTH_AND_FITNESS', 'lifestyle': 'LIFESTYLE', 'medical': 'MEDICAL',
    'music': 'MUSIC_AND_AUDIO', 'navigation': 'MAPS_AND_NAVIGATION', 'news': 'NEWS_AND_MAGAZINES',
    'photo': 'PHOTOGRAPHY', 'productivity': 'PRODUCTIVITY', 'shopping': 'SHOPPING',
    'social': 'SOCIAL', 'sports': 'SPORTS', 'travel': 'TRAVEL_AND_LOCAL',
    'utilities': 'TOOLS', 'weather': 'WEATHER', 'books': 'BOOKS_AND_REFERENCE',
    'communication': 'COMMUNICATION', 'dating': 'DATING', 'art': 'ART_AND_DESIGN',
    'auto': 'AUTO_AND_VEHICLES', 'beauty': 'BEAUTY', 'comics': 'COMICS',
    'events': 'EVENTS', 'parenting': 'PARENTING', 'personalization': 'PERSONALIZATION',
    'video': 'VIDEO_PLAYERS',
  };
  return catMap[category.toLowerCase()] || '';
}

// ─── EXPORTED API FUNCTIONS ─────────────────────────

export async function searchApps(
  query: string,
  store: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<SearchResult> {
  const allApps: AppInfo[] = [];

  if (store === 'apple' || store === 'both') {
    try {
      const appleApps = await searchAppleApps(query, country, limit, fetchFn);
      allApps.push(...appleApps);
    } catch (err: any) {
      if (store === 'apple') throw err;
      // In "both" mode, continue if one store fails
    }
  }

  if (store === 'google' || store === 'both') {
    try {
      const googleApps = await searchGooglePlayApps(query, country, limit, fetchFn);
      allApps.push(...googleApps);
    } catch (err: any) {
      if (store === 'google') throw err;
    }
  }

  // Deduplicate by appId + store
  const seen = new Set<string>();
  const uniqueApps = allApps.filter(app => {
    const key = `${app.store}:${app.appId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    type: 'search',
    query,
    store,
    country,
    apps: uniqueApps.slice(0, limit),
    metadata: {
      totalResults: uniqueApps.length,
      store,
      country,
      scrapedAt: new Date().toISOString(),
    },
  };
}

export async function getAppDetails(
  appId: string,
  store: string,
  country: string,
  fetchFn: ProxyFetchFn,
): Promise<DetailsResult> {
  let app: AppInfo | null = null;

  // Determine store from appId format if store is "both"
  const isLikelyApple = appId.includes('.') || /^\d{9,}$/.test(appId);
  const isLikelyGoogle = appId.includes('.') && !/^\d+$/.test(appId);

  if (store === 'apple' || (store === 'both' && isLikelyApple)) {
    try {
      app = await getAppleAppDetails(appId, country, fetchFn);
    } catch {
      // Try Google if Apple fails in "both" mode
    }
  }

  if (!app && (store === 'google' || store === 'both' || isLikelyGoogle)) {
    try {
      app = await getGooglePlayAppDetails(appId, country, fetchFn);
    } catch {
      // Will return null if both fail
    }
  }

  // If store is "both" and we have not tried the other one yet, try it
  if (!app && store === 'both') {
    try {
      if (isLikelyApple) {
        app = await getGooglePlayAppDetails(appId, country, fetchFn);
      } else {
        app = await getAppleAppDetails(appId, country, fetchFn);
      }
    } catch {
      // Return null
    }
  }

  return {
    type: 'details',
    app,
    metadata: {
      store: app?.store || store,
      country,
      scrapedAt: new Date().toISOString(),
    },
  };
}

export async function getTopCharts(
  category: string,
  store: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<ChartsResult> {
  const allApps: AppInfo[] = [];

  if (store === 'apple' || store === 'both') {
    try {
      const appleApps = await getAppleTopCharts(category, country, limit, fetchFn);
      allApps.push(...appleApps);
    } catch (err: any) {
      if (store === 'apple') throw err;
    }
  }

  if (store === 'google' || store === 'both') {
    try {
      const googleApps = await getGooglePlayTopCharts(category, country, limit, fetchFn);
      allApps.push(...googleApps);
    } catch (err: any) {
      if (store === 'google') throw err;
    }
  }

  return {
    type: 'charts',
    category: category || 'all',
    store,
    country,
    apps: allApps.slice(0, limit),
    metadata: {
      totalResults: allApps.length,
      store,
      country,
      scrapedAt: new Date().toISOString(),
    },
  };
}

export async function getAppReviews(
  appId: string,
  store: string,
  country: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<ReviewsResult> {
  const allReviews: AppReview[] = [];

  const isLikelyApple = /^\d{9,}$/.test(appId);
  const isLikelyGoogle = appId.includes('.') && !/^\d+$/.test(appId);

  if (store === 'apple' || (store === 'both' && !isLikelyGoogle)) {
    try {
      const appleReviews = await getAppleAppReviews(appId, country, limit, fetchFn);
      allReviews.push(...appleReviews);
    } catch (err: any) {
      if (store === 'apple') throw err;
    }
  }

  if (store === 'google' || (store === 'both' && !isLikelyApple) || store === 'both') {
    try {
      const googleReviews = await getGooglePlayReviews(appId, country, limit, fetchFn);
      allReviews.push(...googleReviews);
    } catch (err: any) {
      if (store === 'google') throw err;
    }
  }

  return {
    type: 'reviews',
    appId,
    store,
    country,
    reviews: allReviews.slice(0, limit),
    metadata: {
      totalResults: allReviews.length,
      store,
      country,
      scrapedAt: new Date().toISOString(),
    },
  };
}