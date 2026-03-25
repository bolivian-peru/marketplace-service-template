/**
 * Food Delivery Price Intelligence Scraper
 * ─────────────────────────────────────────
 * Scrapes Uber Eats, DoorDash, and Grubhub via mobile proxies.
 * Extracts: restaurants, menus, prices, delivery fees, promotions, ratings, delivery times.
 *
 * Uses Proxies.sx mobile proxy pool for all requests.
 * No mock data — all results come from live platform APIs.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface FoodRestaurant {
  id: string;
  name: string;
  rating: number | null;
  reviewsCount: number | null;
  deliveryFee: number | null;
  deliveryTimeMin: number | null;
  deliveryTimeMax: number | null;
  minimumOrder: number | null;
  priceLevel: string | null;
  cuisine: string[];
  address: string | null;
  promotions: string[];
  isOpen: boolean;
  platform: string;
}

export interface FoodMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  popular: boolean;
  category: string | null;
  imageUrl: string | null;
  customizations: FoodCustomization[];
}

export interface FoodCustomization {
  name: string;
  required: boolean;
  options: {
    name: string;
    price: number | null;
  }[];
}

export interface FoodMenuResult {
  restaurant: FoodRestaurant;
  menuItems: FoodMenuItem[];
  menuCategories: string[];
  platform: string;
}

export interface FoodSearchResult {
  restaurants: FoodRestaurant[];
  totalCount: number;
  query: string;
  address: string;
  platform: string;
}

export interface FoodCompareResult {
  query: string;
  address: string;
  platforms: {
    platform: string;
    restaurants: FoodRestaurant[];
  }[];
}

// ─── PLATFORM CONFIGS ───────────────────────────────

const PLATFORM_CONFIGS: Record<string, {
  searchUrl: (query: string, address: string) => string;
  restaurantUrl: (id: string) => string;
  menuUrl: (id: string) => string;
  headers: Record<string, string>;
}> = {
  ubereats: {
    searchUrl: (query, address) =>
      `https://www.ubereats.com/api/getSearchSuggestions?localeCode=US&searchQuery=${encodeURIComponent(query)}&userLocation=${encodeURIComponent(address)}`,
    restaurantUrl: (id) =>
      `https://www.ubereats.com/store/${id}`,
    menuUrl: (id) =>
      `https://www.ubereats.com/api/getStoreV1?localeCode=US&storeUuid=${id}`,
    headers: {
      'x-csrf-token': 'x',
      'content-type': 'application/json',
    },
  },
  doordash: {
    searchUrl: (query, address) =>
      `https://www.doordash.com/api/v2/search/?q=${encodeURIComponent(query)}&offset=0&limit=20&latitude=0&longitude=0&address=${encodeURIComponent(address)}`,
    restaurantUrl: (id) =>
      `https://www.doordash.com/api/v2/restaurant/${id}/`,
    menuUrl: (id) =>
      `https://www.doordash.com/api/v2/restaurant/${id}/menu/`,
    headers: {
      'accept': 'application/json',
    },
  },
  grubhub: {
    searchUrl: (query, address) =>
      `https://api.grubhub.com/search?searchTerms=${encodeURIComponent(query)}&location=POINT(0+0)&orderMethod=delivery&hideHat498=true`,
    restaurantUrl: (id) =>
      `https://api.grubhub.com/restaurant/${id}`,
    menuUrl: (id) =>
      `https://api.grubhub.com/restaurant/${id}/menu`,
    headers: {
      'accept': 'application/json',
    },
  },
};

const MOBILE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

// ─── SCRAPERS ───────────────────────────────────────

/**
 * Search for restaurants on a food delivery platform.
 * Returns structured restaurant data with ratings, delivery info, and promotions.
 */
export async function searchFoodDelivery(
  query: string,
  address: string,
  platform: string = 'ubereats',
): Promise<FoodSearchResult> {
  const config = PLATFORM_CONFIGS[platform.toLowerCase()];
  if (!config) {
    throw new Error(`Unsupported platform: ${platform}. Supported: ${Object.keys(PLATFORM_CONFIGS).join(', ')}`);
  }

  const url = config.searchUrl(query, address);

  try {
    const response = await proxyFetch(url, {
      headers: { ...MOBILE_HEADERS, ...config.headers },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (platform === 'ubereats') {
      return parseUberEatsSearch(await response.text(), query, address);
    } else if (platform === 'doordash') {
      return parseDoorDashSearch(await response.json(), query, address);
    } else if (platform === 'grubhub') {
      return parseGrubhubSearch(await response.json(), query, address);
    }

    throw new Error(`No parser for platform: ${platform}`);
  } catch (err: any) {
    throw new Error(`Food delivery search failed (${platform}): ${err.message}`);
  }
}

/**
 * Get restaurant details including rating, delivery fee, and hours.
 */
export async function getRestaurantDetails(
  restaurantId: string,
  platform: string = 'ubereats',
): Promise<FoodRestaurant> {
  const config = PLATFORM_CONFIGS[platform.toLowerCase()];
  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const url = config.restaurantUrl(restaurantId);

  try {
    const response = await proxyFetch(url, {
      headers: { ...MOBILE_HEADERS, ...config.headers },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (platform === 'ubereats') {
      return parseUberEatsRestaurant(await response.text(), restaurantId);
    } else if (platform === 'doordash') {
      return parseDoorDashRestaurant(await response.json(), restaurantId);
    } else if (platform === 'grubhub') {
      return parseGrubhubRestaurant(await response.json(), restaurantId);
    }

    throw new Error(`No parser for platform: ${platform}`);
  } catch (err: any) {
    throw new Error(`Restaurant details fetch failed (${platform}): ${err.message}`);
  }
}

/**
 * Get full menu for a restaurant with item prices, descriptions, and customizations.
 */
export async function getRestaurantMenu(
  restaurantId: string,
  platform: string = 'ubereats',
): Promise<FoodMenuResult> {
  const config = PLATFORM_CONFIGS[platform.toLowerCase()];
  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const url = config.menuUrl(restaurantId);

  try {
    const response = await proxyFetch(url, {
      headers: { ...MOBILE_HEADERS, ...config.headers },
      timeoutMs: 45_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (platform === 'ubereats') {
      return parseUberEatsMenu(await response.text(), restaurantId);
    } else if (platform === 'doordash') {
      return parseDoorDashMenu(await response.json(), restaurantId);
    } else if (platform === 'grubhub') {
      return parseGrubhubMenu(await response.json(), restaurantId);
    }

    throw new Error(`No parser for platform: ${platform}`);
  } catch (err: any) {
    throw new Error(`Menu fetch failed (${platform}): ${err.message}`);
  }
}

/**
 * Cross-platform price comparison: search the same query on multiple platforms.
 */
export async function compareFoodPrices(
  query: string,
  address: string,
  platforms: string[] = ['ubereats', 'doordash'],
): Promise<FoodCompareResult> {
  const results = await Promise.allSettled(
    platforms.map(async (platform) => {
      const result = await searchFoodDelivery(query, address, platform);
      return { platform, restaurants: result.restaurants };
    }),
  );

  const successfulPlatforms: { platform: string; restaurants: FoodRestaurant[] }[] = [];

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      successfulPlatforms.push((results[i] as PromiseFulfilledResult<any>).value);
    } else {
      console.error(`[FOOD] Platform ${platforms[i]} failed: ${(results[i] as PromiseRejectedResult).reason}`);
      // Include empty result for failed platforms so consumer knows it was attempted
      successfulPlatforms.push({ platform: platforms[i], restaurants: [] });
    }
  }

  return {
    query,
    address,
    platforms: successfulPlatforms,
  };
}

// ─── PARSERS ────────────────────────────────────────

function parseUberEatsSearch(html: string, query: string, address: string): FoodSearchResult {
  const restaurants: FoodRestaurant[] = [];

  // Uber Eats returns a mix of HTML and JSON data.
  // Try to extract structured data from __NEXT_DATA__ script tag or inline JSON.
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const stores = data?.props?.pageProps?.searchResults?.stores ||
                     data?.props?.pageProps?.searchResult?.data?.stores ||
                     data?.props?.pageProps?.stores ||
                     [];

      for (const store of Array.isArray(stores) ? stores : []) {
        restaurants.push(mapUberEatsStore(store));
      }
    } catch (e) {
      console.error('[FOOD] Failed to parse Uber Eats __NEXT_DATA__:', e);
    }
  }

  // Fallback: try to find JSON in page data
  if (restaurants.length === 0) {
    const jsonMatches = html.match(/\{"stores":\[[\s\S]*?\]\}/g) || [];
    for (const jsonStr of jsonMatches.slice(0, 5)) {
      try {
        const data = JSON.parse(jsonStr);
        if (Array.isArray(data.stores)) {
          for (const store of data.stores) {
            restaurants.push(mapUberEatsStore(store));
          }
        }
      } catch {}
    }
  }

  return { restaurants, totalCount: restaurants.length, query, address, platform: 'ubereats' };
}

function parseDoorDashSearch(data: any, query: string, address: string): FoodSearchResult {
  const restaurants: FoodRestaurant[] = [];
  const stores = data?.stores || data?.search_result?.stores || data?.data || [];

  for (const store of Array.isArray(stores) ? stores : []) {
    restaurants.push({
      id: String(store.id || store.uuid || ''),
      name: store.name || 'Unknown',
      rating: store.average_rating || store.rating || null,
      reviewsCount: store.number_of_ratings || null,
      deliveryFee: store.delivery_fee || store.fee?.deliveryFee || null,
      deliveryTimeMin: store.asap_time_range?.min || store.estimated_delivery_time_minutes || null,
      deliveryTimeMax: store.asap_time_range?.max || null,
      minimumOrder: store.minimum_order_amount || null,
      priceLevel: store.price_range_display || null,
      cuisine: (store.business_type_tags || store.tags || []).map((t: any) => typeof t === 'string' ? t : t?.name || ''),
      address: store.address?.printable_address || store.address || null,
      promotions: (store.promotions || []).map((p: any) => p?.header || p?.description || String(p)),
      isOpen: store.is_open !== false,
      platform: 'doordash',
    });
  }

  return { restaurants, totalCount: restaurants.length, query, address, platform: 'doordash' };
}

function parseGrubhubSearch(data: any, query: string, address: string): FoodSearchResult {
  const restaurants: FoodRestaurant[] = [];
  const results = data?.search_result?.results || data?.results || data?.restaurants || [];

  for (const r of Array.isArray(results) ? results : []) {
    restaurants.push({
      id: String(r.restaurant_id || r.id || ''),
      name: r.restaurant_name || r.name || 'Unknown',
      rating: r.ratings?.rating_average || r.rating || null,
      reviewsCount: r.ratings?.rating_count || null,
      deliveryFee: r.delivery_fee?.amount || r.delivery_fee || null,
      deliveryTimeMin: r.delivery_time?.estimate_low || null,
      deliveryTimeMax: r.delivery_time?.estimate_high || null,
      minimumOrder: r.minimum_order_amount?.amount || null,
      priceLevel: r.price_rating ? `$`.repeat(r.price_rating) : null,
      cuisine: (r.cuisines || r.food_types || []).map((c: any) => c?.name || c || ''),
      address: r.address?.street_address || null,
      promotions: (r.promotions || []).map((p: any) => p?.description || String(p)),
      isOpen: r.is_open || false,
      platform: 'grubhub',
    });
  }

  return { restaurants, totalCount: restaurants.length, query, address, platform: 'grubhub' };
}

function parseUberEatsRestaurant(html: string, storeId: string): FoodRestaurant {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const store = data?.props?.pageProps?.store || data?.props?.pageProps?.initialStoreData?.store;
      if (store) return mapUberEatsStore(store);
    } catch {}
  }

  // Fallback minimal restaurant
  return {
    id: storeId,
    name: 'Unknown',
    rating: null,
    reviewsCount: null,
    deliveryFee: null,
    deliveryTimeMin: null,
    deliveryTimeMax: null,
    minimumOrder: null,
    priceLevel: null,
    cuisine: [],
    address: null,
    promotions: [],
    isOpen: true,
    platform: 'ubereats',
  };
}

function parseDoorDashRestaurant(data: any, storeId: string): FoodRestaurant {
  const store = data?.store || data;
  return {
    id: String(store.id || storeId),
    name: store.name || 'Unknown',
    rating: store.average_rating || null,
    reviewsCount: store.number_of_ratings || null,
    deliveryFee: store.delivery_fee || null,
    deliveryTimeMin: store.asap_time_range?.min || null,
    deliveryTimeMax: store.asap_time_range?.max || null,
    minimumOrder: store.minimum_order_amount || null,
    priceLevel: store.price_range_display || null,
    cuisine: (store.business_type_tags || []).map((t: any) => typeof t === 'string' ? t : t?.name || ''),
    address: store.address?.printable_address || null,
    promotions: (store.promotions || []).map((p: any) => p?.header || String(p)),
    isOpen: store.is_open !== false,
    platform: 'doordash',
  };
}

function parseGrubhubRestaurant(data: any, storeId: string): FoodRestaurant {
  const r = data?.restaurant || data;
  return {
    id: String(r.restaurant_id || r.id || storeId),
    name: r.restaurant_name || r.name || 'Unknown',
    rating: r.ratings?.rating_average || null,
    reviewsCount: r.ratings?.rating_count || null,
    deliveryFee: r.delivery_fee?.amount || null,
    deliveryTimeMin: r.delivery_time?.estimate_low || null,
    deliveryTimeMax: r.delivery_time?.estimate_high || null,
    minimumOrder: r.minimum_order_amount?.amount || null,
    priceLevel: r.price_rating ? `$`.repeat(r.price_rating) : null,
    cuisine: (r.cuisines || []).map((c: any) => c?.name || c || ''),
    address: r.address?.street_address || null,
    promotions: (r.promotions || []).map((p: any) => p?.description || String(p)),
    isOpen: r.is_open || false,
    platform: 'grubhub',
  };
}

function parseUberEatsMenu(html: string, storeId: string): FoodMenuResult {
  const menuItems: FoodMenuItem[] = [];
  let restaurant: FoodRestaurant = {
    id: storeId, name: 'Unknown', rating: null, reviewsCount: null,
    deliveryFee: null, deliveryTimeMin: null, deliveryTimeMax: null,
    minimumOrder: null, priceLevel: null, cuisine: [], address: null,
    promotions: [], isOpen: true, platform: 'ubereats',
  };
  const menuCategories: string[] = [];

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const store = data?.props?.pageProps?.store || data?.props?.pageProps?.initialStoreData?.store;
      if (store) restaurant = mapUberEatsStore(store);

      const categories = data?.props?.pageProps?.menu?.categories ||
                          data?.props?.pageProps?.initialStoreData?.menu?.categories ||
                          [];

      for (const cat of Array.isArray(categories) ? categories : []) {
        const catName = cat.title || cat.name || 'Menu';
        menuCategories.push(catName);

        const items = cat.items || cat.menuItems || [];
        for (const item of Array.isArray(items) ? items : []) {
          menuItems.push({
            id: String(item.uuid || item.id || ''),
            name: item.title || item.name || 'Unknown item',
            description: item.description || null,
            price: item.price ? item.price / 100 : (item.priceAmount?.amount || null),
            originalPrice: item.strikethroughPrice ? item.strikethroughPrice / 100 : null,
            currency: item.currencyCode || 'USD',
            popular: item.isPopular || false,
            category: catName,
            imageUrl: item.imageUrl || item.image?.url || null,
            customizations: (item.customizationList || item.customizations || []).map((c: any) => ({
              name: c.title || c.name || '',
              required: c.required || false,
              options: (c.options || c.subcustomizations || []).map((o: any) => ({
                name: o.title || o.name || '',
                price: o.price ? o.price / 100 : null,
              })),
            })),
          });
        }
      }
    } catch (e) {
      console.error('[FOOD] Failed to parse Uber Eats menu:', e);
    }
  }

  return { restaurant, menuItems, menuCategories, platform: 'ubereats' };
}

function parseDoorDashMenu(data: any, storeId: string): FoodMenuResult {
  const menuItems: FoodMenuItem[] = [];
  const menuCategories: string[] = [];

  const restaurant = data?.store
    ? parseDoorDashRestaurant(data.store, storeId)
    : {
        id: storeId, name: 'Unknown', rating: null, reviewsCount: null,
        deliveryFee: null, deliveryTimeMin: null, deliveryTimeMax: null,
        minimumOrder: null, priceLevel: null, cuisine: [], address: null,
        promotions: [], isOpen: true, platform: 'doordash',
      };

  const menu = data?.menu || data;
  const categories = menu?.menu_categories || menu?.categories || [];

  for (const cat of Array.isArray(categories) ? categories : []) {
    const catName = cat.name || cat.title || 'Menu';
    menuCategories.push(catName);

    const items = cat.menu_items || cat.items || [];
    for (const item of Array.isArray(items) ? items : []) {
      menuItems.push({
        id: String(item.id || item.uuid || ''),
        name: item.name || item.title || 'Unknown item',
        description: item.description || null,
        price: item.price ? item.price / 100 : null,
        originalPrice: item.original_price ? item.original_price / 100 : null,
        currency: 'USD',
        popular: item.is_popular || false,
        category: catName,
        imageUrl: item.img || item.image_url || null,
        customizations: (item.extra_price_list || item.option_groups || []).map((c: any) => ({
          name: c.name || c.title || '',
          required: c.is_required || false,
          options: (c.options || c.option_list || []).map((o: any) => ({
            name: o.name || '',
            price: o.price ? o.price / 100 : null,
          })),
        })),
      });
    }
  }

  return { restaurant, menuItems, menuCategories, platform: 'doordash' };
}

function parseGrubhubMenu(data: any, storeId: string): FoodMenuResult {
  const menuItems: FoodMenuItem[] = [];
  const menuCategories: string[] = [];

  const restaurant = data?.restaurant
    ? parseGrubhubRestaurant(data.restaurant, storeId)
    : {
        id: storeId, name: 'Unknown', rating: null, reviewsCount: null,
        deliveryFee: null, deliveryTimeMin: null, deliveryTimeMax: null,
        minimumOrder: null, priceLevel: null, cuisine: [], address: null,
        promotions: [], isOpen: true, platform: 'grubhub',
      };

  const menu = data?.menu || data;
  const categories = menu?.menu_category_list || menu?.categories || [];

  for (const cat of Array.isArray(categories) ? categories : []) {
    const catName = cat.name || cat.menu_category_name || 'Menu';
    menuCategories.push(catName);

    const items = cat.menu_item_list || cat.items || [];
    for (const item of Array.isArray(items) ? items : []) {
      menuItems.push({
        id: String(item.id || item.menu_item_id || ''),
        name: item.name || item.menu_item_name || 'Unknown item',
        description: item.description || null,
        price: item.price?.amount || null,
        originalPrice: null,
        currency: item.price?.currency || 'USD',
        popular: false,
        category: catName,
        imageUrl: item.img || null,
        customizations: (item.customization_list || item.option_groups || []).map((c: any) => ({
          name: c.name || '',
          required: c.required || false,
          options: (c.option_list || c.options || []).map((o: any) => ({
            name: o.name || '',
            price: o.price?.amount || null,
          })),
        })),
      });
    }
  }

  return { restaurant, menuItems, menuCategories, platform: 'grubhub' };
}

// ─── HELPERS ────────────────────────────────────────

function mapUberEatsStore(store: any): FoodRestaurant {
  return {
    id: String(store.uuid || store.id || store.slug || ''),
    name: store.title || store.name || 'Unknown',
    rating: store.rating?.ratingValue || store.rating || null,
    reviewsCount: store.rating?.reviewCount || store.ratingCount || null,
    deliveryFee: store.fee?.feeAmount || store.deliveryFee || null,
    deliveryTimeMin: store.estimatedDeliveryTime?.range?.[0] || store.deliveryTime?.min || null,
    deliveryTimeMax: store.estimatedDeliveryTime?.range?.[1] || store.deliveryTime?.max || null,
    minimumOrder: store.minimumOrder?.amount || null,
    priceLevel: store.priceBucket || store.priceTag || null,
    cuisine: (store.cuisineTypes || store.cuisines || []).map((c: any) => typeof c === 'string' ? c : c?.name || ''),
    address: store.address || store.location?.address || null,
    promotions: (store.promotions || []).map((p: any) =>
      typeof p === 'string' ? p : (p?.title || p?.description || '')
    ).filter(Boolean),
    isOpen: store.isOpen !== false && store.status !== 'CLOSED',
    platform: 'ubereats',
  };
}
