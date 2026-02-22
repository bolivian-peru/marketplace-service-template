/**
 * Food Delivery Price Intelligence Scraper (Bounty #76)
 *
 * Scrapes food delivery platforms for restaurant/price data.
 * Primary source: Yelp public JSON snippets (no auth required).
 * Secondary: DoorDash public GraphQL, Grubhub web API.
 *
 * Functions:
 *   searchRestaurants(query, location, limit?)
 *   getPopularRestaurants(location, limit?)
 *   searchByCuisine(cuisine, location, limit?)
 *   getPriceIntelligence(location, cuisine?, limit?)
 */

import { proxyFetch } from '../proxy';

export class ScraperError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

// ─── FETCH HELPER ────────────────────────────

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

interface FetchOpts {
  timeoutMs?: number;
  maxRetries?: number;
  accept?: string;
}

async function deliveryFetch(url: string, opts: FetchOpts = {}): Promise<any> {
  const { maxRetries = 2, timeoutMs = 20_000, accept = 'application/json' } = opts;
  let lastErr: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      let response: Response;
      try {
        response = await proxyFetch(url, {
          headers: {
            'User-Agent': MOBILE_UA,
            Accept: accept,
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeoutMs,
          maxRetries: 0,
        });
      } catch {
        // Fallback to direct fetch if proxy not configured
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        response = await fetch(url, {
          headers: {
            'User-Agent': MOBILE_UA,
            Accept: accept,
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: ctrl.signal,
        });
        clearTimeout(t);
      }

      if (response.status === 429) {
        if (i === maxRetries) throw new ScraperError('Rate limited', 429, true);
        const retryAfter = parseInt(response.headers.get('retry-after') || '5');
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (response.status === 403) throw new ScraperError('Access blocked (403)', 403, false);
      if (!response.ok) throw new ScraperError(`API ${response.status}: ${response.statusText}`, response.status, true);

      const text = await response.text();
      if (text.includes('captcha') || text.includes('challenge')) {
        throw new ScraperError('CAPTCHA challenge detected', 503, true);
      }
      try { return JSON.parse(text); }
      catch { throw new ScraperError('Invalid JSON response', 502, true); }
    } catch (e: any) {
      lastErr = e;
      if (e instanceof ScraperError) throw e;
      if (i < maxRetries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr ?? new ScraperError('Delivery fetch failed after retries', 502, true);
}

async function deliveryFetchPost(
  url: string,
  body: any,
  opts: FetchOpts = {},
): Promise<any> {
  const { maxRetries = 2, timeoutMs = 20_000, accept = 'application/json' } = opts;
  let lastErr: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      let response: Response;
      const headers: Record<string, string> = {
        'User-Agent': MOBILE_UA,
        Accept: accept,
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
      };

      try {
        response = await proxyFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          timeoutMs,
          maxRetries: 0,
        });
      } catch {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(t);
      }

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5');
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`API ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (e: any) {
      lastErr = e;
      if (i < maxRetries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr ?? new Error('Delivery POST fetch failed');
}

// ─── TYPES ───────────────────────────────────

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  city: string;
  rating: number;
  reviewCount: number;
  priceLevel: string;
  cuisine: string[];
  deliveryFee: number;
  deliveryTime: string;
  minimumOrder: number;
  isOpen: boolean;
  imageUrl: string;
  url: string;
  source: string;
  lat: number;
  lng: number;
}

export interface MenuItem {
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  popular: boolean;
}

export interface RestaurantSearchResult {
  restaurants: Restaurant[];
  query: string;
  location: string;
  resultCount: number;
}

export interface PriceComparisonResult {
  query: string;
  location: string;
  avgDeliveryFee: number;
  avgRating: number;
  priceDistribution: Record<string, number>;
  restaurants: Restaurant[];
  resultCount: number;
}

// ─── YELP (PRIMARY SOURCE) ──────────────────

const YELP_SNIPPET_URL = 'https://www.yelp.com/search/snippet';

function mapYelpBusiness(raw: any): Restaurant {
  const biz = raw.searchResult?.business || raw.bizId ? raw : raw;
  const bizData = biz.searchResult?.business || biz;

  const name = String(bizData.name || bizData.bizName || '').slice(0, 200);
  const id = String(bizData.encId || bizData.id || bizData.bizId || '');
  const alias = String(bizData.alias || bizData.businessUrl || '');

  // Location data
  const location = bizData.formattedAddress || bizData.addressLines || '';
  const address = Array.isArray(location) ? location.join(', ') : String(location || '');
  const city = String(
    bizData.neighborhoods?.[0] ||
    bizData.city ||
    bizData.serviceArea?.displayText ||
    '',
  );

  // Rating & reviews
  const rating = Number(bizData.rating) || Number(bizData.reviewScore) || 0;
  const reviewCount = Number(bizData.reviewCount) || Number(bizData.numReviews) || 0;

  // Price level
  const priceRange = bizData.priceRange || bizData.price || '';
  const priceLevel = typeof priceRange === 'string' ? priceRange : '$'.repeat(Number(priceRange) || 0);

  // Cuisine categories
  const categories: string[] = [];
  if (Array.isArray(bizData.categories)) {
    for (const cat of bizData.categories) {
      const title = typeof cat === 'string' ? cat : cat?.title || cat?.alias || '';
      if (title) categories.push(String(title).slice(0, 50));
    }
  }

  // Delivery info
  const deliveryFee = extractDeliveryFee(bizData);
  const deliveryTime = extractDeliveryTime(bizData);

  // Coordinates
  const lat = Number(bizData.coordinates?.latitude || bizData.latitude || 0);
  const lng = Number(bizData.coordinates?.longitude || bizData.longitude || 0);

  // Image
  const imageUrl = String(
    bizData.photoUrl || bizData.mainPhotoUrl || bizData.photos?.[0] || '',
  ).slice(0, 1024);

  // URL
  const url = alias
    ? `https://www.yelp.com/biz/${alias}`
    : id
      ? `https://www.yelp.com/biz/${id}`
      : '';

  // Open status
  const isOpen = bizData.isOpen !== false && bizData.isClosed !== true;

  return {
    id,
    name,
    address,
    city,
    rating: Math.round(rating * 10) / 10,
    reviewCount,
    priceLevel: priceLevel || '$',
    cuisine: categories.length > 0 ? categories : ['Restaurant'],
    deliveryFee,
    deliveryTime,
    minimumOrder: 0,
    isOpen,
    imageUrl,
    url,
    source: 'yelp',
    lat,
    lng,
  };
}

function extractDeliveryFee(biz: any): number {
  // Yelp sometimes includes delivery partner info
  if (biz.deliveryFee) return Number(biz.deliveryFee) || 0;
  if (biz.serviceFee) return Number(biz.serviceFee) || 0;

  // Check transaction types or service offerings
  const transactionTypes = biz.transactions || biz.servicePricing || [];
  if (Array.isArray(transactionTypes)) {
    for (const t of transactionTypes) {
      if (typeof t === 'object' && t.fee) return Number(t.fee) || 0;
    }
  }

  return 0;
}

function extractDeliveryTime(biz: any): string {
  if (biz.deliveryTime) return String(biz.deliveryTime);
  if (biz.estimatedDeliveryTime) return String(biz.estimatedDeliveryTime);

  // Estimate based on distance or return default
  const transactions = biz.transactions || [];
  const hasDelivery = Array.isArray(transactions)
    ? transactions.some(
        (t: any) =>
          (typeof t === 'string' && t === 'delivery') ||
          (typeof t === 'object' && t.type === 'delivery'),
      )
    : false;

  return hasDelivery ? '30-45 min' : '25-40 min';
}

function extractYelpResults(data: any): any[] {
  // Yelp snippet responses can have various structures
  const results: any[] = [];

  // Try searchPageProps path
  const searchResults =
    data?.searchPageProps?.mainContentComponentsListProps ||
    data?.searchPageProps?.searchMapProps?.mapState?.markers ||
    data?.mainContentComponentsListProps ||
    [];

  if (Array.isArray(searchResults)) {
    for (const item of searchResults) {
      if (item?.searchResultBusiness || item?.bizId || item?.business) {
        results.push(item);
      }
      // Nested in hover card or similar
      if (item?.searchResult?.business) {
        results.push(item);
      }
    }
  }

  // Try direct search results path
  if (results.length === 0 && data?.searchPageProps?.searchResultsProps?.searchResults) {
    const sr = data.searchPageProps.searchResultsProps.searchResults;
    if (Array.isArray(sr)) {
      for (const item of sr) {
        if (item?.searchResultBusiness || item?.bizId || item?.business) {
          results.push(item);
        }
      }
    }
  }

  // Try legacy path
  if (results.length === 0 && data?.searchResults) {
    const sr = data.searchResults;
    if (Array.isArray(sr)) {
      results.push(...sr.filter((r: any) => r?.business || r?.bizId || r?.name));
    }
  }

  // Try organic results path
  if (results.length === 0 && data?.organicResults) {
    const or = data.organicResults;
    if (Array.isArray(or)) {
      results.push(...or.filter((r: any) => r?.business || r?.bizId || r?.name));
    }
  }

  return results;
}

async function searchYelp(
  query: string,
  location: string,
  limit: number,
  attrs: string = 'RestaurantsDelivery',
): Promise<Restaurant[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const params = new URLSearchParams({
    find_desc: `restaurants ${query}`.trim(),
    find_loc: location,
    cflt: 'restaurants',
    start: '0',
  });
  if (attrs) params.set('attrs', attrs);

  const url = `${YELP_SNIPPET_URL}?${params.toString()}`;
  const data = await deliveryFetch(url, {
    accept: 'application/json, text/javascript, */*; q=0.01',
  });

  const rawResults = extractYelpResults(data);
  return rawResults.slice(0, safeLimit).map(mapYelpBusiness);
}

// ─── DOORDASH (SECONDARY SOURCE) ────────────

const DOORDASH_GQL = 'https://www.doordash.com/graphql';

function mapDoorDashStore(raw: any): Restaurant {
  const store = raw.store || raw;

  const name = String(store.name || '').slice(0, 200);
  const id = String(store.id || store.storeId || '');

  // Address
  const addr = store.address || store.displayAddress || {};
  const address = typeof addr === 'string'
    ? addr
    : [addr.street, addr.city, addr.state].filter(Boolean).join(', ');
  const city = String(addr.city || addr.submarket || '');

  // Rating
  const rating = Number(store.averageRating || store.rating || 0);
  const reviewCount = Number(store.numRatings || store.numberOfRatings || 0);

  // Price
  const priceRange = store.priceRange || store.displayPriceRange || '';
  const priceLevel = typeof priceRange === 'number' ? '$'.repeat(priceRange) : String(priceRange || '$');

  // Categories/tags
  const cuisine: string[] = [];
  if (Array.isArray(store.tags)) {
    for (const tag of store.tags) {
      const t = typeof tag === 'string' ? tag : tag?.name || tag?.title || '';
      if (t) cuisine.push(String(t).slice(0, 50));
    }
  }
  if (Array.isArray(store.categories)) {
    for (const cat of store.categories) {
      const c = typeof cat === 'string' ? cat : cat?.name || cat?.title || '';
      if (c && !cuisine.includes(c)) cuisine.push(String(c).slice(0, 50));
    }
  }

  // Delivery info
  const deliveryFee = Number(store.deliveryFee?.unitAmount || store.deliveryFee || 0) / 100 || 0;
  const minEta = Number(store.deliveryMinutes?.min || store.estimatedDeliveryTime || 0);
  const maxEta = Number(store.deliveryMinutes?.max || 0);
  const deliveryTime = maxEta > 0 ? `${minEta}-${maxEta} min` : minEta > 0 ? `${minEta} min` : '30-45 min';
  const minimumOrder = Number(store.orderMinimum?.unitAmount || store.minimumSubtotal || 0) / 100 || 0;

  // Image
  const imageUrl = String(store.headerImgUrl || store.coverSquareImgUrl || store.coverImgUrl || '').slice(0, 1024);

  // URL
  const slug = store.slug || store.storeName?.toLowerCase().replace(/\s+/g, '-') || id;
  const url = `https://www.doordash.com/store/${slug}-${id}/`;

  // Coordinates
  const lat = Number(store.address?.lat || store.lat || 0);
  const lng = Number(store.address?.lng || store.lng || 0);

  return {
    id,
    name,
    address,
    city,
    rating: Math.round(rating * 10) / 10,
    reviewCount,
    priceLevel: priceLevel || '$',
    cuisine: cuisine.length > 0 ? cuisine : ['Restaurant'],
    deliveryFee: Math.round(deliveryFee * 100) / 100,
    deliveryTime,
    minimumOrder: Math.round(minimumOrder * 100) / 100,
    isOpen: store.isOpen !== false && store.isClosed !== true,
    imageUrl,
    url,
    source: 'doordash',
    lat,
    lng,
  };
}

async function searchDoorDash(
  query: string,
  location: string,
  limit: number,
): Promise<Restaurant[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const gqlBody = {
    operationName: 'SearchStoresQuery',
    variables: {
      searchTerm: query,
      numStores: safeLimit,
      sortOrder: 'RELEVANCE',
      location: location,
    },
    query: `query SearchStoresQuery($searchTerm: String!, $numStores: Int, $sortOrder: String, $location: String) {
      search(searchTerm: $searchTerm, numStores: $numStores, sortOrder: $sortOrder, location: $location) {
        stores {
          id
          name
          averageRating
          numRatings
          priceRange
          deliveryFee { unitAmount }
          deliveryMinutes { min max }
          orderMinimum { unitAmount }
          headerImgUrl
          coverSquareImgUrl
          tags { name }
          address { street city state lat lng }
          isOpen
          slug
        }
      }
    }`,
  };

  try {
    const data = await deliveryFetchPost(DOORDASH_GQL, gqlBody);

    const stores = data?.data?.search?.stores;
    if (!Array.isArray(stores)) return [];

    return stores.slice(0, safeLimit).map(mapDoorDashStore);
  } catch {
    // DoorDash GraphQL might reject unauthenticated requests
    return [];
  }
}

// ─── GRUBHUB (TERTIARY SOURCE) ──────────────

const GRUBHUB_API = 'https://api-gtm.grubhub.com/restaurants/search';

function mapGrubhubRestaurant(raw: any): Restaurant {
  const rest = raw.restaurant || raw;

  const name = String(rest.name || '').slice(0, 200);
  const id = String(rest.restaurant_id || rest.id || '');

  // Address
  const addr = rest.address || {};
  const address = [addr.street_address, addr.locality, addr.region]
    .filter(Boolean)
    .join(', ');
  const city = String(addr.locality || addr.city || '');

  // Rating
  const rating = Number(rest.ratings?.overall?.rating || rest.rating || 0);
  const reviewCount = Number(rest.ratings?.overall?.count || rest.reviewCount || 0);

  // Price
  const priceLevel = '$'.repeat(Number(rest.price_rating || 1));

  // Cuisine
  const cuisine: string[] = [];
  if (Array.isArray(rest.cuisines)) {
    for (const c of rest.cuisines) {
      const name = typeof c === 'string' ? c : c?.name || '';
      if (name) cuisine.push(String(name).slice(0, 50));
    }
  }

  // Delivery
  const deliveryFee = Number(rest.delivery_fee?.price || rest.delivery_fee || 0) / 100 || 0;
  const minTime = Number(rest.delivery_time_estimate?.min || rest.estimated_delivery_time || 0);
  const maxTime = Number(rest.delivery_time_estimate?.max || 0);
  const deliveryTime = maxTime > 0 ? `${minTime}-${maxTime} min` : minTime > 0 ? `${minTime} min` : '35-50 min';
  const minimumOrder = Number(rest.delivery_minimum?.price || rest.order_minimum || 0) / 100 || 0;

  // Image
  const imageUrl = String(rest.logo || rest.media_image?.base_url || '').slice(0, 1024);

  // URL
  const slug = rest.restaurant_url || rest.slug || '';
  const url = slug ? `https://www.grubhub.com/restaurant/${slug}` : `https://www.grubhub.com/restaurant/${id}`;

  // Coordinates
  const lat = Number(rest.address?.latitude || rest.latitude || 0);
  const lng = Number(rest.address?.longitude || rest.longitude || 0);

  return {
    id,
    name,
    address,
    city,
    rating: Math.round(rating * 10) / 10,
    reviewCount,
    priceLevel: priceLevel || '$',
    cuisine: cuisine.length > 0 ? cuisine : ['Restaurant'],
    deliveryFee: Math.round(deliveryFee * 100) / 100,
    deliveryTime,
    minimumOrder: Math.round(minimumOrder * 100) / 100,
    isOpen: rest.available !== false && rest.is_open !== false,
    imageUrl,
    url,
    source: 'grubhub',
    lat,
    lng,
  };
}

async function searchGrubhub(
  query: string,
  location: string,
  limit: number,
): Promise<Restaurant[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const params = new URLSearchParams({
    orderMethod: 'delivery',
    locationMode: 'DELIVERY',
    facetSet: 'umamiV6',
    pageSize: String(safeLimit),
    hideHat498: 'true',
    searchMetrics: 'true',
    queryText: query,
    location: location,
    variationId: 'default',
    sortSetId: 'umamiv3',
  });

  try {
    const url = `${GRUBHUB_API}?${params.toString()}`;
    const data = await deliveryFetch(url);

    const results = data?.search_result?.results || data?.results || [];
    if (!Array.isArray(results)) return [];

    return results.slice(0, safeLimit).map(mapGrubhubRestaurant);
  } catch {
    // Grubhub may reject without proper auth
    return [];
  }
}

// ─── AGGREGATED FUNCTIONS ───────────────────

/**
 * Search restaurants by query and location across multiple platforms.
 * Yelp is the primary source; DoorDash and Grubhub are secondary.
 */
export async function searchRestaurants(
  query: string,
  location: string,
  limit: number = 25,
): Promise<RestaurantSearchResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const perSource = Math.ceil(safeLimit / 3);

  const [yelp, doordash, grubhub] = await Promise.allSettled([
    searchYelp(query, location, perSource),
    searchDoorDash(query, location, perSource),
    searchGrubhub(query, location, perSource),
  ]);

  const restaurants: Restaurant[] = [];
  if (yelp.status === 'fulfilled') restaurants.push(...yelp.value);
  if (doordash.status === 'fulfilled') restaurants.push(...doordash.value);
  if (grubhub.status === 'fulfilled') restaurants.push(...grubhub.value);

  // Sort by rating descending, then review count
  restaurants.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);

  return {
    restaurants: restaurants.slice(0, safeLimit),
    query,
    location,
    resultCount: restaurants.length,
  };
}

/**
 * Get popular/trending restaurants in a location.
 * Searches for "popular restaurants" with delivery filter.
 */
export async function getPopularRestaurants(
  location: string,
  limit: number = 25,
): Promise<RestaurantSearchResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const perSource = Math.ceil(safeLimit / 3);

  const [yelp, doordash, grubhub] = await Promise.allSettled([
    searchYelp('popular', location, perSource),
    searchDoorDash('popular', location, perSource),
    searchGrubhub('popular', location, perSource),
  ]);

  const restaurants: Restaurant[] = [];
  if (yelp.status === 'fulfilled') restaurants.push(...yelp.value);
  if (doordash.status === 'fulfilled') restaurants.push(...doordash.value);
  if (grubhub.status === 'fulfilled') restaurants.push(...grubhub.value);

  // Sort by review count descending (popularity proxy)
  restaurants.sort((a, b) => b.reviewCount - a.reviewCount || b.rating - a.rating);

  return {
    restaurants: restaurants.slice(0, safeLimit),
    query: 'popular',
    location,
    resultCount: restaurants.length,
  };
}

/**
 * Search by cuisine type (e.g., "pizza", "sushi", "mexican").
 */
export async function searchByCuisine(
  cuisine: string,
  location: string,
  limit: number = 25,
): Promise<RestaurantSearchResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const perSource = Math.ceil(safeLimit / 3);

  const [yelp, doordash, grubhub] = await Promise.allSettled([
    searchYelp(cuisine, location, perSource),
    searchDoorDash(cuisine, location, perSource),
    searchGrubhub(cuisine, location, perSource),
  ]);

  const restaurants: Restaurant[] = [];
  if (yelp.status === 'fulfilled') restaurants.push(...yelp.value);
  if (doordash.status === 'fulfilled') restaurants.push(...doordash.value);
  if (grubhub.status === 'fulfilled') restaurants.push(...grubhub.value);

  restaurants.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);

  return {
    restaurants: restaurants.slice(0, safeLimit),
    query: cuisine,
    location,
    resultCount: restaurants.length,
  };
}

/**
 * Price comparison/analysis for a location.
 * Aggregates delivery fees, ratings, and price level distribution.
 */
export async function getPriceIntelligence(
  location: string,
  cuisine?: string,
  limit: number = 25,
): Promise<PriceComparisonResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const query = cuisine || 'restaurants';

  // Fetch from all sources
  const result = await searchRestaurants(query, location, safeLimit);
  const restaurants = result.restaurants;

  // Calculate analytics
  const totalDeliveryFees = restaurants.reduce((sum, r) => sum + r.deliveryFee, 0);
  const avgDeliveryFee =
    restaurants.length > 0
      ? Math.round((totalDeliveryFees / restaurants.length) * 100) / 100
      : 0;

  const totalRatings = restaurants.reduce((sum, r) => sum + r.rating, 0);
  const avgRating =
    restaurants.length > 0
      ? Math.round((totalRatings / restaurants.length) * 10) / 10
      : 0;

  // Price distribution
  const priceDistribution: Record<string, number> = {
    $: 0,
    $$: 0,
    $$$: 0,
    $$$$: 0,
  };
  for (const r of restaurants) {
    const normalized = normalizePriceLevel(r.priceLevel);
    priceDistribution[normalized] = (priceDistribution[normalized] || 0) + 1;
  }

  return {
    query,
    location,
    avgDeliveryFee,
    avgRating,
    priceDistribution,
    restaurants,
    resultCount: restaurants.length,
  };
}

function normalizePriceLevel(price: string): string {
  const dollars = (price.match(/\$/g) || []).length;
  if (dollars >= 4) return '$$$$';
  if (dollars === 3) return '$$$';
  if (dollars === 2) return '$$';
  return '$';
}
