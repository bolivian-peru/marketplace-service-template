/**
 * Zillow Real Estate Intelligence Scraper (Bounty #79)
 * ────────────────────────────────────────────────────
 * Scrapes property listings, prices, Zestimates, and market data
 * from Zillow via mobile proxies.
 *
 * Zillow blocks datacenter/residential IPs aggressively.
 * Mobile carrier IPs work because Zillow's mobile app generates
 * massive legitimate mobile traffic.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface ZillowProperty {
  zpid: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number | null;
  zestimate: number | null;
  rentZestimate: number | null;
  status: string;
  details: {
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    lotSqft: number | null;
    yearBuilt: number | null;
    type: string;
    parking: string | null;
  };
  priceHistory: PriceEvent[];
  photos: string[];
  url: string;
  latitude: number | null;
  longitude: number | null;
  daysOnZillow: number | null;
  brokerName: string | null;
}

export interface PriceEvent {
  date: string;
  event: string;
  price: number | null;
  source: string;
}

export interface ZillowSearchResult {
  totalResults: number;
  listings: ZillowListing[];
}

export interface ZillowListing {
  zpid: string;
  address: string;
  price: number | null;
  zestimate: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string;
  status: string;
  url: string;
  imgSrc: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface MarketStats {
  zip: string;
  medianHomeValue: number | null;
  medianRent: number | null;
  totalListings: number;
  medianListPrice: number | null;
  avgPricePerSqft: number | null;
  inventoryCount: number;
}

// ─── CONSTANTS ──────────────────────────────────────

const ZILLOW_BASE = 'https://www.zillow.com';

function buildHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Cache-Control': 'no-cache',
  };
}

// ─── HELPERS ────────────────────────────────────────

function extractNextData(html: string): any | null {
  const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (match) {
    try { return JSON.parse(match.group(1)!); } catch {}
  }
  return null;
}

function parseSearchListing(item: any): ZillowListing {
  const homeInfo = item.hdpData?.homeInfo || {};
  return {
    zpid: String(item.zpid || homeInfo.zpid || ''),
    address: item.address || homeInfo.streetAddress || '',
    price: item.unformattedPrice || homeInfo.price || null,
    zestimate: homeInfo.zestimate || null,
    beds: item.beds ?? homeInfo.bedrooms ?? null,
    baths: item.baths ?? homeInfo.bathrooms ?? null,
    sqft: item.area || homeInfo.livingArea || null,
    type: homeInfo.homeType || item.propertyType || 'Unknown',
    status: item.statusText || homeInfo.homeStatus || 'Unknown',
    url: item.detailUrl ? `${ZILLOW_BASE}${item.detailUrl}` : '',
    imgSrc: item.imgSrc || null,
    latitude: homeInfo.latitude || item.latLong?.latitude || null,
    longitude: homeInfo.longitude || item.latLong?.longitude || null,
  };
}

function parsePropertyDetail(data: any): ZillowProperty {
  const prop = data.property || data;
  const address = prop.address || {};

  const priceHistory: PriceEvent[] = [];
  for (const event of prop.priceHistory || []) {
    priceHistory.push({
      date: event.date || event.time || '',
      event: event.event || event.priceChangeRate ? 'Price Change' : 'Unknown',
      price: event.price || null,
      source: event.source || 'Zillow',
    });
  }

  return {
    zpid: String(prop.zpid || ''),
    address: `${address.streetAddress || ''}, ${address.city || ''}, ${address.state || ''} ${address.zipcode || ''}`.trim(),
    city: address.city || '',
    state: address.state || '',
    zip: address.zipcode || '',
    price: prop.price || prop.listPrice || null,
    zestimate: prop.zestimate || null,
    rentZestimate: prop.rentZestimate || null,
    status: prop.homeStatus || prop.listingStatus || 'Unknown',
    details: {
      bedrooms: prop.bedrooms ?? null,
      bathrooms: prop.bathrooms ?? null,
      sqft: prop.livingArea || prop.livingAreaValue || null,
      lotSqft: prop.lotSize || prop.lotAreaValue || null,
      yearBuilt: prop.yearBuilt ?? null,
      type: prop.homeType || 'Unknown',
      parking: prop.parking ? `${prop.parking} spaces` : null,
    },
    priceHistory,
    photos: (prop.photos || prop.responsivePhotos || [])
      .slice(0, 10)
      .map((p: any) => p.url || p.mixedSources?.jpeg?.[0]?.url || '')
      .filter(Boolean),
    url: `${ZILLOW_BASE}/homedetails/${prop.zpid}_zpid/`,
    latitude: prop.latitude || address.latitude || null,
    longitude: prop.longitude || address.longitude || null,
    daysOnZillow: prop.daysOnZillow ?? null,
    brokerName: prop.brokerageName || prop.attributionInfo?.brokerName || null,
  };
}

// ─── SCRAPING FUNCTIONS ─────────────────────────────

/**
 * Search Zillow listings by location/ZIP with filters
 */
export async function searchListings(params: {
  location?: string;
  zip?: string;
  type?: 'for_sale' | 'for_rent' | 'sold';
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  propertyType?: string;
  limit?: number;
}): Promise<ZillowSearchResult> {
  const location = params.location || params.zip;
  if (!location) {
    throw new ZillowError('invalid_input', 'Location or ZIP code is required');
  }

  // Build Zillow search URL
  const statusPath = params.type === 'for_rent' ? 'for_rent' : params.type === 'sold' ? 'sold' : 'for_sale';
  const searchPath = encodeURIComponent(location.replace(/\s+/g, '-'));
  let url = `${ZILLOW_BASE}/homes/${statusPath}/${searchPath}/`;

  // Add filters as path segments
  const filters: string[] = [];
  if (params.minPrice) filters.push(`${params.minPrice}-_price`);
  if (params.maxPrice) filters.push(`_-${params.maxPrice}_price`);
  if (params.beds) filters.push(`${params.beds}-_beds`);
  if (filters.length) url += filters.join('/') + '/';

  console.log(`[ZILLOW] Searching: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(),
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    if (response.status === 403) throw new ZillowError('blocked', 'Zillow blocked this request');
    if (response.status === 429) throw new ZillowError('rate_limited', 'Zillow rate limited this IP');
    throw new ZillowError('scrape_failed', `Zillow returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.length < 5000) {
    throw new ZillowError('captcha_detected', 'Zillow CAPTCHA triggered');
  }

  const nextData = extractNextData(html);
  if (!nextData) {
    throw new ZillowError('scrape_failed', 'Could not extract listing data');
  }

  const searchState = nextData.props?.pageProps?.searchPageState;
  const cat1 = searchState?.cat1 || searchState?.cat2 || {};
  const results = cat1.searchResults?.listResults || cat1.searchResults?.mapResults || [];
  const totalCount = cat1.searchResults?.totalResultCount || results.length;

  const limit = params.limit || 20;
  const listings = results.slice(0, limit).map(parseSearchListing);

  return {
    totalResults: totalCount,
    listings,
  };
}

/**
 * Get detailed property info by zpid
 */
export async function getProperty(zpid: string): Promise<ZillowProperty> {
  if (!zpid) throw new ZillowError('invalid_input', 'zpid is required');

  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  console.log(`[ZILLOW] Fetching property: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(),
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    if (response.status === 404) throw new ZillowError('not_found', `Property ${zpid} not found`);
    if (response.status === 403) throw new ZillowError('blocked', 'Zillow blocked this request');
    throw new ZillowError('scrape_failed', `Zillow returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.length < 5000) {
    throw new ZillowError('captcha_detected', 'Zillow CAPTCHA triggered');
  }

  const nextData = extractNextData(html);
  if (!nextData) {
    // Try to extract from gdpData or inline JSON
    const gdpMatch = html.match(/window\.gdpData\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (gdpMatch) {
      try {
        const gdp = JSON.parse(gdpMatch[1]);
        return parsePropertyDetail(gdp);
      } catch {}
    }
    throw new ZillowError('scrape_failed', 'Could not extract property data');
  }

  // Navigate NEXT_DATA to find property details
  const pageProps = nextData.props?.pageProps;
  const propertyData = pageProps?.componentProps?.gdpClientCache
    ? JSON.parse(Object.values(pageProps.componentProps.gdpClientCache as Record<string, string>)[0] || '{}')
    : pageProps?.property || pageProps;

  const prop = propertyData?.property || propertyData;
  if (!prop?.zpid && !prop?.address) {
    throw new ZillowError('scrape_failed', 'Property data not found in page');
  }

  return parsePropertyDetail(prop);
}

/**
 * Get market stats for a ZIP code
 */
export async function getMarketStats(zip: string): Promise<MarketStats> {
  if (!zip || !/^\d{5}$/.test(zip)) {
    throw new ZillowError('invalid_input', 'Valid 5-digit ZIP code is required');
  }

  // Search listings in the ZIP to compute stats
  const result = await searchListings({ zip, type: 'for_sale', limit: 40 });

  const prices = result.listings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0)
    .sort((a, b) => a - b);

  const sqftPrices = result.listings
    .filter(l => l.price && l.sqft && l.sqft > 0)
    .map(l => l.price! / l.sqft!);

  const medianPrice = prices.length > 0
    ? prices[Math.floor(prices.length / 2)]
    : null;

  const avgPricePerSqft = sqftPrices.length > 0
    ? Math.round(sqftPrices.reduce((a, b) => a + b, 0) / sqftPrices.length)
    : null;

  const zestimates = result.listings
    .map(l => l.zestimate)
    .filter((z): z is number => z !== null && z > 0)
    .sort((a, b) => a - b);

  const medianHomeValue = zestimates.length > 0
    ? zestimates[Math.floor(zestimates.length / 2)]
    : medianPrice;

  return {
    zip,
    medianHomeValue,
    medianRent: null, // Would need a separate for_rent search
    totalListings: result.totalResults,
    medianListPrice: medianPrice,
    avgPricePerSqft,
    inventoryCount: result.totalResults,
  };
}

/**
 * Get comparable sales near a property
 */
export async function getComps(zpid: string, radius: string = '0.5mi'): Promise<ZillowListing[]> {
  // First get the property to find its location
  const property = await getProperty(zpid);

  if (!property.zip) {
    throw new ZillowError('scrape_failed', 'Could not determine property location for comps');
  }

  // Search for sold properties nearby
  const result = await searchListings({
    zip: property.zip,
    type: 'sold',
    limit: 10,
  });

  return result.listings;
}

// ─── ERROR CLASS ────────────────────────────────────

export class ZillowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ZillowError';
  }

  get httpStatus(): number {
    switch (this.code) {
      case 'captcha_detected': return 503;
      case 'rate_limited': return 503;
      case 'blocked': return 403;
      case 'not_found': return 404;
      case 'invalid_input': return 400;
      default: return 500;
    }
  }
}
