import { proxyFetch } from '../proxy';

export type AppStoreName = 'apple' | 'google';

export const SUPPORTED_APP_COUNTRIES = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'] as const;

type SupportedCountry = typeof SUPPORTED_APP_COUNTRIES[number];

export interface AppRankingItem {
  rank: number;
  appName: string;
  developer: string | null;
  appId: string;
  rating: number | null;
  ratingCount: number | null;
  price: string;
  inAppPurchases: boolean | null;
  category: string | null;
  lastUpdated: string | null;
  size: string | null;
  icon: string | null;
}

export interface AppReview {
  rating: number | null;
  title: string;
  text: string;
  date: string | null;
  reviewer: string | null;
}

export interface AppStoreResult {
  type: 'rankings' | 'app' | 'search' | 'trending';
  store: AppStoreName;
  country: SupportedCountry;
  timestamp: string;
  category?: string;
  query?: string;
  appId?: string;
  rankings?: AppRankingItem[];
  app?: AppRankingItem;
  reviews?: AppReview[];
  results?: AppRankingItem[];
  metadata: {
    totalRanked?: number;
    totalResults?: number;
    scrapedAt: string;
    source: string;
  };
}

const APPLE_GENRE_MAP: Record<string, string> = {
  games: '6014',
  business: '6000',
  finance: '6015',
  health: '6013',
  lifestyle: '6012',
  productivity: '6007',
  social: '6005',
  travel: '6003',
  utilities: '6002',
};

const GOOGLE_CATEGORY_MAP: Record<string, string> = {
  games: 'GAME',
  business: 'BUSINESS',
  finance: 'FINANCE',
  health: 'HEALTH_AND_FITNESS',
  lifestyle: 'LIFESTYLE',
  productivity: 'PRODUCTIVITY',
  social: 'SOCIAL',
  travel: 'TRAVEL_AND_LOCAL',
  utilities: 'TOOLS',
};

function ensureCountry(country: string): SupportedCountry {
  const normalized = country.trim().toUpperCase();
  if (!SUPPORTED_APP_COUNTRIES.includes(normalized as SupportedCountry)) {
    throw new Error(`Unsupported country: ${country}. Supported countries: ${SUPPORTED_APP_COUNTRIES.join(', ')}`);
  }
  return normalized as SupportedCountry;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,_\s]/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseTextMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && typeof match[1] === 'string' && match[1].trim().length > 0) {
      return decodeHtml(match[1].trim());
    }
  }
  return null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizePrice(value: unknown): string {
  if (typeof value === 'number') return value <= 0 ? 'Free' : `$${value.toFixed(2)}`;
  if (typeof value === 'string') {
    if (value.trim().length === 0) return 'Unknown';
    const asNum = toNumber(value);
    if (asNum === null) return value;
    return asNum <= 0 ? 'Free' : `$${asNum.toFixed(2)}`;
  }
  return 'Unknown';
}

async function fetchAppleLookupByIds(country: SupportedCountry, ids: string[]): Promise<Map<string, any>> {
  if (ids.length === 0) return new Map();

  const lookupUrl = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${country}&entity=software`;
  const response = await proxyFetch(lookupUrl, {
    timeoutMs: 25_000,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) return new Map();
  const payload = await response.json() as { results?: any[] };
  const results = Array.isArray(payload?.results) ? payload.results : [];

  const map = new Map<string, any>();
  for (const row of results) {
    if (row && typeof row.trackId !== 'undefined') {
      map.set(String(row.trackId), row);
      if (typeof row.bundleId === 'string') {
        map.set(row.bundleId, row);
      }
    }
  }

  return map;
}

async function fetchAppleReviews(trackId: string, country: SupportedCountry, limit = 10): Promise<AppReview[]> {
  const countryLower = country.toLowerCase();
  const url = `https://itunes.apple.com/${countryLower}/rss/customerreviews/id=${encodeURIComponent(trackId)}/sortBy=mostRecent/json`;

  try {
    const response = await proxyFetch(url, {
      timeoutMs: 25_000,
      headers: { Accept: 'application/json' },
      maxRetries: 1,
    });

    if (!response.ok) return [];
    const payload = await response.json() as any;
    const entries = Array.isArray(payload?.feed?.entry) ? payload.feed.entry.slice(1) : [];

    return entries.slice(0, limit).map((entry: any) => ({
      rating: toNumber(entry?.['im:rating']?.label),
      title: typeof entry?.title?.label === 'string' ? entry.title.label : 'Untitled',
      text: typeof entry?.content?.label === 'string' ? entry.content.label : '',
      date: typeof entry?.updated?.label === 'string' ? entry.updated.label : null,
      reviewer: typeof entry?.author?.name?.label === 'string' ? entry.author.name.label : null,
    }));
  } catch {
    return [];
  }
}

async function appleRankings(category: string, country: SupportedCountry, limit: number): Promise<AppStoreResult> {
  const genre = APPLE_GENRE_MAP[category.toLowerCase()] || APPLE_GENRE_MAP.games;
  const url = `https://itunes.apple.com/${country.toLowerCase()}/rss/topfreeapplications/limit=${limit}/genre=${genre}/json`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Apple rankings fetch failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as any;
  const entries = Array.isArray(payload?.feed?.entry) ? payload.feed.entry : [];

  const ids = entries
    .map((entry: any) => String(entry?.id?.attributes?.['im:id'] || ''))
    .filter((id: string) => id.length > 0)
    .slice(0, Math.min(limit, 50));

  const lookup = await fetchAppleLookupByIds(country, ids);

  const rankings: AppRankingItem[] = entries.slice(0, limit).map((entry: any, idx: number) => {
    const trackId = String(entry?.id?.attributes?.['im:id'] || '');
    const lookedUp = lookup.get(trackId);

    return {
      rank: idx + 1,
      appName: typeof entry?.['im:name']?.label === 'string' ? entry['im:name'].label : 'Unknown App',
      developer: typeof entry?.['im:artist']?.label === 'string' ? entry['im:artist'].label : null,
      appId: (lookedUp?.bundleId as string | undefined) || trackId,
      rating: toNumber(lookedUp?.averageUserRating),
      ratingCount: toNumber(lookedUp?.userRatingCount),
      price: normalizePrice(lookedUp?.price ?? entry?.['im:price']?.attributes?.amount),
      inAppPurchases: typeof lookedUp?.features === 'string'
        ? lookedUp.features.toLowerCase().includes('in-app')
        : null,
      category: typeof entry?.category?.attributes?.label === 'string' ? entry.category.attributes.label : null,
      lastUpdated: typeof lookedUp?.currentVersionReleaseDate === 'string' ? lookedUp.currentVersionReleaseDate : null,
      size: lookedUp?.fileSizeBytes ? `${Math.round(Number(lookedUp.fileSizeBytes) / (1024 * 1024))} MB` : null,
      icon: typeof entry?.['im:image']?.[2]?.label === 'string'
        ? entry['im:image'][2].label
        : (typeof lookedUp?.artworkUrl512 === 'string' ? lookedUp.artworkUrl512 : null),
    };
  });

  return {
    type: 'rankings',
    store: 'apple',
    country,
    category,
    timestamp: new Date().toISOString(),
    rankings,
    metadata: {
      totalRanked: rankings.length,
      scrapedAt: new Date().toISOString(),
      source: 'itunes-rss+lookup',
    },
  };
}

async function appleSearch(query: string, country: SupportedCountry, limit: number): Promise<AppStoreResult> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&entity=software&limit=${limit}`;

  const response = await proxyFetch(url, {
    timeoutMs: 25_000,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Apple search failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { results?: any[] };
  const rows = Array.isArray(payload?.results) ? payload.results : [];

  const results: AppRankingItem[] = rows.map((row, idx) => ({
    rank: idx + 1,
    appName: typeof row?.trackName === 'string' ? row.trackName : 'Unknown App',
    developer: typeof row?.sellerName === 'string' ? row.sellerName : null,
    appId: typeof row?.bundleId === 'string' ? row.bundleId : String(row?.trackId || ''),
    rating: toNumber(row?.averageUserRating),
    ratingCount: toNumber(row?.userRatingCount),
    price: normalizePrice(row?.price),
    inAppPurchases: Array.isArray(row?.features) ? row.features.some((f: unknown) => String(f).toLowerCase().includes('in-app')) : null,
    category: typeof row?.primaryGenreName === 'string' ? row.primaryGenreName : null,
    lastUpdated: typeof row?.currentVersionReleaseDate === 'string' ? row.currentVersionReleaseDate : null,
    size: typeof row?.fileSizeBytes === 'string' ? `${Math.round(Number(row.fileSizeBytes) / (1024 * 1024))} MB` : null,
    icon: typeof row?.artworkUrl512 === 'string' ? row.artworkUrl512 : null,
  }));

  return {
    type: 'search',
    store: 'apple',
    country,
    query,
    timestamp: new Date().toISOString(),
    results,
    metadata: {
      totalResults: results.length,
      scrapedAt: new Date().toISOString(),
      source: 'itunes-search',
    },
  };
}

async function appleApp(appId: string, country: SupportedCountry): Promise<AppStoreResult> {
  const byBundleUrl = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(appId)}&country=${country}`;
  let response = await proxyFetch(byBundleUrl, {
    timeoutMs: 25_000,
    headers: { Accept: 'application/json' },
    maxRetries: 1,
  });

  if (!response.ok) {
    throw new Error(`Apple app lookup failed: HTTP ${response.status}`);
  }

  let payload = await response.json() as { results?: any[] };
  let row = Array.isArray(payload?.results) && payload.results.length > 0 ? payload.results[0] : null;

  if (!row && /^\d+$/.test(appId)) {
    const byTrackUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${country}`;
    response = await proxyFetch(byTrackUrl, {
      timeoutMs: 25_000,
      headers: { Accept: 'application/json' },
      maxRetries: 1,
    });

    if (response.ok) {
      payload = await response.json() as { results?: any[] };
      row = Array.isArray(payload?.results) && payload.results.length > 0 ? payload.results[0] : null;
    }
  }

  if (!row) {
    throw new Error(`Apple app not found for appId=${appId}`);
  }

  const trackId = String(row.trackId || appId);
  const reviews = await fetchAppleReviews(trackId, country, 10);

  const app: AppRankingItem = {
    rank: 1,
    appName: typeof row.trackName === 'string' ? row.trackName : 'Unknown App',
    developer: typeof row.sellerName === 'string' ? row.sellerName : null,
    appId: typeof row.bundleId === 'string' ? row.bundleId : trackId,
    rating: toNumber(row.averageUserRating),
    ratingCount: toNumber(row.userRatingCount),
    price: normalizePrice(row.price),
    inAppPurchases: Array.isArray(row.features) ? row.features.some((f: unknown) => String(f).toLowerCase().includes('in-app')) : null,
    category: typeof row.primaryGenreName === 'string' ? row.primaryGenreName : null,
    lastUpdated: typeof row.currentVersionReleaseDate === 'string' ? row.currentVersionReleaseDate : null,
    size: typeof row.fileSizeBytes === 'string' ? `${Math.round(Number(row.fileSizeBytes) / (1024 * 1024))} MB` : null,
    icon: typeof row.artworkUrl512 === 'string' ? row.artworkUrl512 : null,
  };

  return {
    type: 'app',
    store: 'apple',
    country,
    appId,
    timestamp: new Date().toISOString(),
    app,
    reviews,
    metadata: {
      scrapedAt: new Date().toISOString(),
      source: 'itunes-lookup+reviews',
    },
  };
}

function parseGoogleCards(html: string, categoryLabel?: string): AppRankingItem[] {
  const cards = Array.from(html.matchAll(/\/store\/apps\/details\?id=([A-Za-z0-9._-]+)[\s\S]{0,220}?aria-label="([^"]+)"[\s\S]{0,400}?(?:\/store\/apps\/dev\?id=[^"]+">([^<]+)<)?/g));
  const output: AppRankingItem[] = [];

  for (const [idx, card] of cards.entries()) {
    const appId = card[1];
    const rawLabel = decodeHtml(card[2]);
    const developer = card[3] ? decodeHtml(card[3]) : null;

    const appName = rawLabel
      .replace(/^Install\s+/i, '')
      .replace(/^Download\s+/i, '')
      .replace(/\s+on\s+Google\s+Play.*$/i, '')
      .trim() || appId;

    output.push({
      rank: idx + 1,
      appName,
      developer,
      appId,
      rating: null,
      ratingCount: null,
      price: 'Free',
      inAppPurchases: null,
      category: categoryLabel || null,
      lastUpdated: null,
      size: null,
      icon: null,
    });
  }

  // Deduplicate by app id while preserving order.
  const deduped = new Map<string, AppRankingItem>();
  for (const item of output) {
    if (!deduped.has(item.appId)) {
      deduped.set(item.appId, item);
    }
  }

  return Array.from(deduped.values());
}

async function googleRankings(category: string, country: SupportedCountry, limit: number, type: 'rankings' | 'trending'): Promise<AppStoreResult> {
  const categoryCode = GOOGLE_CATEGORY_MAP[category.toLowerCase()] || GOOGLE_CATEGORY_MAP.games;
  const collection = type === 'trending' ? 'topselling_new_free' : 'topselling_free';
  const url = `https://play.google.com/store/apps/collection/${collection}?hl=en&gl=${country}&category=${categoryCode}`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    headers: { Accept: 'text/html' },
  });

  if (!response.ok) {
    throw new Error(`Google ${type} fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rankings = parseGoogleCards(html, category).slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  return {
    type,
    store: 'google',
    country,
    category,
    timestamp: new Date().toISOString(),
    rankings,
    metadata: {
      totalRanked: rankings.length,
      scrapedAt: new Date().toISOString(),
      source: `google-play-${collection}`,
    },
  };
}

async function googleSearch(query: string, country: SupportedCountry, limit: number): Promise<AppStoreResult> {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=${country}`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    headers: { Accept: 'text/html' },
  });

  if (!response.ok) {
    throw new Error(`Google search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = parseGoogleCards(html).slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  return {
    type: 'search',
    store: 'google',
    country,
    query,
    timestamp: new Date().toISOString(),
    results,
    metadata: {
      totalResults: results.length,
      scrapedAt: new Date().toISOString(),
      source: 'google-play-search',
    },
  };
}

async function googleApp(appId: string, country: SupportedCountry): Promise<AppStoreResult> {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=${country}`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    headers: { Accept: 'text/html' },
  });

  if (!response.ok) {
    throw new Error(`Google app detail fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();

  const name = parseTextMatch(html, [
    /<h1[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i,
    /"name"\s*:\s*"([^"]+)"/i,
  ]) || appId;

  const developer = parseTextMatch(html, [
    /\/store\/apps\/dev\?id=[^"']+["'][^>]*>([^<]+)<\/a>/i,
    /"author"\s*:\s*\[\{"@type":"Organization","name":"([^"]+)"/i,
  ]);

  const category = parseTextMatch(html, [
    /\/store\/apps\/category\/([A-Z_]+)["']/i,
  ]);

  const ratingRaw = parseTextMatch(html, [
    /itemprop="ratingValue"\s+content="([0-9.]+)"/i,
    /"ratingValue"\s*:\s*"([0-9.]+)"/i,
  ]);

  const ratingCountRaw = parseTextMatch(html, [
    /itemprop="ratingCount"\s+content="([0-9,\.]+)"/i,
    /"ratingCount"\s*:\s*"([0-9,\.]+)"/i,
  ]);

  const icon = parseTextMatch(html, [
    /itemprop="image"\s+content="([^"]+)"/i,
    /<img[^>]+src="([^"]+)"[^>]+alt="[^"]*"[^>]*>/i,
  ]);

  const updated = parseTextMatch(html, [
    /Updated on<\/div>\s*<div[^>]*><span[^>]*>([^<]+)<\/span>/i,
  ]);

  const size = parseTextMatch(html, [
    /Size<\/div>\s*<div[^>]*><span[^>]*>([^<]+)<\/span>/i,
  ]);

  const app: AppRankingItem = {
    rank: 1,
    appName: name,
    developer,
    appId,
    rating: toNumber(ratingRaw),
    ratingCount: toNumber(ratingCountRaw),
    price: 'Free',
    inAppPurchases: /In-app purchases/i.test(html),
    category: category ? category.replace(/_/g, ' ') : null,
    lastUpdated: updated,
    size,
    icon,
  };

  return {
    type: 'app',
    store: 'google',
    country,
    appId,
    timestamp: new Date().toISOString(),
    app,
    reviews: [],
    metadata: {
      scrapedAt: new Date().toISOString(),
      source: 'google-play-details',
    },
  };
}

export async function getAppStoreData(params: {
  type: 'rankings' | 'app' | 'search' | 'trending';
  store: AppStoreName;
  country: string;
  category?: string;
  query?: string;
  appId?: string;
  limit?: number;
}): Promise<AppStoreResult> {
  const country = ensureCountry(params.country);
  const category = (params.category || 'games').trim().toLowerCase();
  const limit = Math.max(1, Math.min(params.limit || 20, 50));

  if (params.store === 'apple') {
    if (params.type === 'rankings') return appleRankings(category, country, limit);
    if (params.type === 'trending') {
      const ranking = await appleRankings(category, country, limit);
      return { ...ranking, type: 'trending' };
    }
    if (params.type === 'search') {
      if (!params.query) throw new Error('Missing query parameter for Apple search');
      return appleSearch(params.query, country, limit);
    }
    if (params.type === 'app') {
      if (!params.appId) throw new Error('Missing appId parameter for Apple app details');
      return appleApp(params.appId, country);
    }
  }

  if (params.store === 'google') {
    if (params.type === 'rankings') return googleRankings(category, country, limit, 'rankings');
    if (params.type === 'trending') return googleRankings(category, country, limit, 'trending');
    if (params.type === 'search') {
      if (!params.query) throw new Error('Missing query parameter for Google search');
      return googleSearch(params.query, country, limit);
    }
    if (params.type === 'app') {
      if (!params.appId) throw new Error('Missing appId parameter for Google app details');
      return googleApp(params.appId, country);
    }
  }

  throw new Error(`Unsupported app intelligence request: type=${params.type} store=${params.store}`);
}
