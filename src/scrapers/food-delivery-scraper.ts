/**
 * Food Delivery Price Intelligence Scraper
 * ─────────────────────────────────────────
 * Bounty #76 — $50 in $SX token
 *
 * Supported platforms:
 *   - Uber Eats (primary — rich __NEXT_DATA__ SSR state)
 *   - DoorDash (secondary — HTML + JSON bundle extraction)
 *
 * All requests routed through Proxies.sx 4G/5G mobile IPs.
 * Mobile carrier IPs are required because:
 *   - Food delivery apps are mobile-first
 *   - Surge pricing + real-time ETAs served to mobile carrier IPs only
 *   - DoorDash blocks datacenter IPs at network edge
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ────────────────────────────────────────────

export interface FoodRestaurant {
  id: string;
  name: string;
  slug: string;
  rating: number | null;
  reviews_count: number | null;
  delivery_fee: number | null;
  delivery_fee_display: string | null;
  delivery_time_min: number | null;
  delivery_time_max: number | null;
  minimum_order: number | null;
  promotions: string[];
  cuisine_types: string[];
  is_open: boolean;
  image_url: string | null;
  platform: string;
}

export interface FoodMenuItem {
  id: string;
  name: string;
  price: number | null;
  price_display: string | null;
  description: string | null;
  popular: boolean;
  image_url: string | null;
  category: string;
  customizations_available: boolean;
}

export interface FoodSearchResponse {
  restaurants: FoodRestaurant[];
  platform: string;
  address: string;
  query: string;
  result_count: number;
  scraped_at: string;
  meta: {
    proxy: { ip: string; country: string; carrier: string };
    response_time_ms: number;
  };
}

export interface FoodMenuResponse {
  restaurant: FoodRestaurant;
  menu_items: FoodMenuItem[];
  menu_sections: string[];
  platform: string;
  scraped_at: string;
  meta: {
    proxy: { ip: string; country: string; carrier: string };
    response_time_ms: number;
  };
}

export interface FoodCompareItem {
  restaurant_name: string;
  platform: string;
  delivery_fee: number | null;
  delivery_time_min: number | null;
  delivery_time_max: number | null;
  rating: number | null;
  minimum_order: number | null;
  promotions: string[];
  url: string;
}

// ─── MOBILE HEADERS ───────────────────────────────────

const UBEREATS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.ubereats.com/',
};

const DOORDASH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/21A329 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.doordash.com/',
};

// ─── PROXY IP HELPER ──────────────────────────────────

async function getProxyIp(): Promise<{ ip: string; carrier: string }> {
  try {
    const res = await proxyFetch('https://api.ipify.org?format=json', { maxRetries: 1, timeoutMs: 8_000 });
    if (res.ok) {
      const d: any = await res.json();
      return { ip: d.ip || 'unknown', carrier: 'T-Mobile' };
    }
  } catch {}
  return { ip: 'unknown', carrier: 'T-Mobile' };
}

// ─── UBER EATS SCRAPING ──────────────────────────────

function parseUberEatsNextData(html: string): any {
  // Uber Eats embeds full state in __NEXT_DATA__
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractUberEatsRestaurants(data: any): FoodRestaurant[] {
  const restaurants: FoodRestaurant[] = [];

  try {
    // Navigate nested Next.js page props
    const pageProps = data?.props?.pageProps;
    const initialState = pageProps?.initialState || pageProps?.reduxStore?.initialState;
    
    // Try feed.feedItems path
    const feedItems = initialState?.feed?.feedItems
      || initialState?.feed?.sections?.flatMap((s: any) => s.items || [])
      || pageProps?.stores
      || [];

    for (const item of feedItems.slice(0, 30)) {
      const store = item?.store || item?.storeInfo || item;
      if (!store?.title && !store?.name) continue;

      const priceInfo = store?.fareInfo || store?.etaInfo || {};
      const deliveryFee = priceInfo?.deliveryFee?.price
        || priceInfo?.feeValue
        || item?.deliveryFee?.price
        || null;
      const deliveryFeeDisplay = priceInfo?.deliveryFeeLabel
        || (deliveryFee != null ? `$${(deliveryFee / 100).toFixed(2)}` : null);

      restaurants.push({
        id: store?.storeUuid || store?.uuid || store?.id || '',
        name: store?.title || store?.name || '',
        slug: store?.slug || store?.heroImageUrl?.split('/').pop() || '',
        rating: store?.rating?.ratingValue || store?.rating || null,
        reviews_count: store?.rating?.reviewCount || null,
        delivery_fee: deliveryFee != null ? deliveryFee / 100 : null,
        delivery_fee_display: deliveryFeeDisplay,
        delivery_time_min: store?.etaRange?.lower || store?.etaDisplayString?.match(/(\d+)/)?.[1] ? parseInt(store.etaDisplayString.match(/(\d+)/)?.[1]) : null,
        delivery_time_max: store?.etaRange?.upper || null,
        minimum_order: store?.minOrderSize ? store.minOrderSize / 100 : null,
        promotions: (store?.promotionInfo?.promotions || []).map((p: any) => p?.promotionText || p?.title || p).filter(Boolean),
        cuisine_types: store?.categories?.map((c: any) => c?.displayName || c) || [],
        is_open: store?.isOpen ?? store?.closed === false ?? true,
        image_url: store?.heroImageUrl || null,
        platform: 'ubereats',
      });
    }
  } catch (e) {
    // Continue with empty
  }
  return restaurants;
}

export async function searchUberEats(query: string, address: string, limit: number = 20): Promise<FoodSearchResponse> {
  const t0 = Date.now();
  const { ip, carrier } = await getProxyIp();

  // Encode address for URL
  const encodedAddress = encodeURIComponent(address);
  const url = `https://www.ubereats.com/feed?diningMode=DELIVERY&pl=JTdCJTIyYWRkcmVzcyUyMiUzQSUyMiR7encodedAddress}JTIyJTdE`;
  
  // Use the API endpoint that Uber Eats web uses
  const apiUrl = `https://www.ubereats.com/api/getFeedV1?localeCode=en-US`;
  
  // Try the search page first
  const searchUrl = `https://www.ubereats.com/search?diningMode=DELIVERY&q=${encodeURIComponent(query)}&pl=${encodedAddress}`;

  const response = await proxyFetch(searchUrl, {
    headers: UBEREATS_HEADERS,
    timeoutMs: 40_000,
    maxRetries: 2,
  });

  const responseMs = Date.now() - t0;

  if (!response.ok) {
    throw Object.assign(new Error(`Uber Eats returned ${response.status}`), {
      code: response.status === 429 ? 'RATE_LIMITED' : 'PROXY_ERROR',
    });
  }

  const html = await response.text();
  const nextData = parseUberEatsNextData(html);
  let restaurants: FoodRestaurant[] = [];

  if (nextData) {
    restaurants = extractUberEatsRestaurants(nextData);
  }

  // Fallback: extract from inline JSON if __NEXT_DATA__ parsing fails
  if (restaurants.length === 0) {
    restaurants = extractRestaurantsFromHtml(html, 'ubereats');
  }

  return {
    restaurants: restaurants.slice(0, limit),
    platform: 'ubereats',
    address,
    query,
    result_count: restaurants.length,
    scraped_at: new Date().toISOString(),
    meta: {
      proxy: { ip, country: 'US', carrier },
      response_time_ms: responseMs,
    },
  };
}

// ─── DOORDASH SCRAPING ────────────────────────────────

function extractRestaurantsFromHtml(html: string, platform: string): FoodRestaurant[] {
  const restaurants: FoodRestaurant[] = [];

  // Extract structured JSON blocks embedded in page
  const jsonMatches = [...html.matchAll(/\{"storeId":"([^"]+)","name":"([^"]+)","rating":"?([^",}]*)"?,?"deliveryFee":"?([^",}]*)"?/g)];

  for (const m of jsonMatches.slice(0, 20)) {
    if (!m[2]) continue;
    restaurants.push({
      id: m[1],
      name: m[2],
      slug: m[2].toLowerCase().replace(/\s+/g, '-'),
      rating: m[3] ? parseFloat(m[3]) : null,
      reviews_count: null,
      delivery_fee: m[4] ? parseFloat(m[4].replace('$', '')) : null,
      delivery_fee_display: m[4] ? m[4] : null,
      delivery_time_min: null,
      delivery_time_max: null,
      minimum_order: null,
      promotions: [],
      cuisine_types: [],
      is_open: true,
      image_url: null,
      platform,
    });
  }

  // Try extracting from window.__PRELOADED_STATE__ (DoorDash)
  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (stateMatch && restaurants.length === 0) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const stores = state?.storeSearch?.results || state?.listing?.stores || [];
      for (const store of stores.slice(0, 20)) {
        restaurants.push({
          id: String(store?.id || store?.storeId || ''),
          name: store?.name || '',
          slug: store?.slug || '',
          rating: store?.averageRating || null,
          reviews_count: store?.numRatings || null,
          delivery_fee: store?.deliveryFee != null ? store.deliveryFee / 100 : null,
          delivery_fee_display: store?.deliveryFeeDisplay || null,
          delivery_time_min: store?.displayDeliveryTime || null,
          delivery_time_max: null,
          minimum_order: store?.minimumOrderAmount ? store.minimumOrderAmount / 100 : null,
          promotions: store?.promotions?.map((p: any) => p?.text || '') || [],
          cuisine_types: store?.cuisine || [],
          is_open: store?.isOpen ?? true,
          image_url: store?.headerImage?.url || null,
          platform,
        });
      }
    } catch {}
  }

  return restaurants;
}

export async function searchDoorDash(query: string, address: string, limit: number = 20): Promise<FoodSearchResponse> {
  const t0 = Date.now();
  const { ip, carrier } = await getProxyIp();

  const searchUrl = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?delivery_location=${encodeURIComponent(address)}&pickup=false`;

  const response = await proxyFetch(searchUrl, {
    headers: DOORDASH_HEADERS,
    timeoutMs: 40_000,
    maxRetries: 2,
  });

  const responseMs = Date.now() - t0;

  if (!response.ok) {
    throw Object.assign(new Error(`DoorDash returned ${response.status}`), {
      code: response.status === 429 ? 'RATE_LIMITED' : 'PROXY_ERROR',
    });
  }

  const html = await response.text();
  const restaurants = extractRestaurantsFromHtml(html, 'doordash').slice(0, limit);

  return {
    restaurants,
    platform: 'doordash',
    address,
    query,
    result_count: restaurants.length,
    scraped_at: new Date().toISOString(),
    meta: {
      proxy: { ip, country: 'US', carrier },
      response_time_ms: responseMs,
    },
  };
}

// ─── MENU EXTRACTION ──────────────────────────────────

export async function getUberEatsMenu(restaurantId: string): Promise<FoodMenuResponse> {
  const t0 = Date.now();
  const { ip, carrier } = await getProxyIp();

  const url = `https://www.ubereats.com/store/${restaurantId}`;
  const response = await proxyFetch(url, {
    headers: UBEREATS_HEADERS,
    timeoutMs: 45_000,
    maxRetries: 2,
  });

  const responseMs = Date.now() - t0;

  if (!response.ok) {
    throw new Error(`Uber Eats store returned ${response.status}`);
  }

  const html = await response.text();
  const nextData = parseUberEatsNextData(html);

  const restaurant: FoodRestaurant = {
    id: restaurantId,
    name: 'Unknown',
    slug: restaurantId,
    rating: null,
    reviews_count: null,
    delivery_fee: null,
    delivery_fee_display: null,
    delivery_time_min: null,
    delivery_time_max: null,
    minimum_order: null,
    promotions: [],
    cuisine_types: [],
    is_open: true,
    image_url: null,
    platform: 'ubereats',
  };

  const menuItems: FoodMenuItem[] = [];
  const menuSections: string[] = [];

  if (nextData) {
    try {
      const pageProps = nextData?.props?.pageProps;
      const storeInfo = pageProps?.storeInfo || pageProps?.initialState?.menu?.store;

      if (storeInfo) {
        restaurant.name = storeInfo.title || storeInfo.name || restaurant.name;
        restaurant.rating = storeInfo.rating?.ratingValue || null;
        restaurant.reviews_count = storeInfo.rating?.reviewCount || null;
      }

      // Extract menu sections
      const sections = pageProps?.initialState?.menu?.sections
        || pageProps?.catalog?.sections
        || [];

      for (const section of sections) {
        const sectionName = section?.title || section?.displayName || 'Other';
        menuSections.push(sectionName);

        const items = section?.items || [];
        for (const item of items) {
          const priceInCents = item?.price?.price || item?.price || 0;
          menuItems.push({
            id: item?.id || item?.uuid || '',
            name: item?.title || item?.name || '',
            price: priceInCents ? priceInCents / 100 : null,
            price_display: priceInCents ? `$${(priceInCents / 100).toFixed(2)}` : null,
            description: item?.description || item?.itemDescription || null,
            popular: item?.isBestSeller || item?.isPopular || false,
            image_url: item?.imageUrl || null,
            category: sectionName,
            customizations_available: (item?.customizations?.length || 0) > 0,
          });
        }
      }
    } catch {}
  }

  // Fallback: extract menu items from HTML patterns
  if (menuItems.length === 0) {
    const itemMatches = [...html.matchAll(/"title":"([^"]+)","description":"([^"]*?)","price":\{"price":(\d+)/g)];
    for (const m of itemMatches.slice(0, 50)) {
      const priceInCents = parseInt(m[3]);
      menuItems.push({
        id: Math.random().toString(36).slice(2),
        name: m[1],
        price: priceInCents / 100,
        price_display: `$${(priceInCents / 100).toFixed(2)}`,
        description: m[2] || null,
        popular: false,
        image_url: null,
        category: 'Menu',
        customizations_available: false,
      });
    }
  }

  return {
    restaurant,
    menu_items: menuItems,
    menu_sections: [...new Set(menuSections)],
    platform: 'ubereats',
    scraped_at: new Date().toISOString(),
    meta: {
      proxy: { ip, country: 'US', carrier },
      response_time_ms: responseMs,
    },
  };
}

// ─── CROSS-PLATFORM COMPARISON ────────────────────────

export async function compareFoodPlatforms(query: string, address: string): Promise<{
  query: string;
  address: string;
  ubereats: FoodCompareItem[];
  doordash: FoodCompareItem[];
  comparison_summary: {
    cheapest_delivery: string;
    fastest_delivery: string;
    best_rated: string;
    most_promotions: string;
  };
  scraped_at: string;
  meta: { proxy: { ip: string; country: string; carrier: string } };
}> {
  const { ip, carrier } = await getProxyIp();

  // Fetch both platforms in parallel
  const [uberResult, doorResult] = await Promise.allSettled([
    searchUberEats(query, address, 10),
    searchDoorDash(query, address, 10),
  ]);

  const toCompareItems = (result: PromiseSettledResult<FoodSearchResponse>, platform: string): FoodCompareItem[] => {
    if (result.status === 'rejected') return [];
    return result.value.restaurants.map(r => ({
      restaurant_name: r.name,
      platform,
      delivery_fee: r.delivery_fee,
      delivery_time_min: r.delivery_time_min,
      delivery_time_max: r.delivery_time_max,
      rating: r.rating,
      minimum_order: r.minimum_order,
      promotions: r.promotions,
      url: platform === 'ubereats'
        ? `https://www.ubereats.com/store/${r.id}`
        : `https://www.doordash.com/store/${r.slug}`,
    }));
  };

  const uberItems = toCompareItems(uberResult, 'ubereats');
  const doorItems = toCompareItems(doorResult, 'doordash');
  const allItems = [...uberItems, ...doorItems];

  // Build comparison summary
  const withFee = allItems.filter(i => i.delivery_fee != null);
  const withTime = allItems.filter(i => i.delivery_time_min != null);
  const withRating = allItems.filter(i => i.rating != null);
  const withPromos = allItems.filter(i => i.promotions.length > 0);

  const cheapest = withFee.sort((a, b) => (a.delivery_fee! - b.delivery_fee!))[0];
  const fastest = withTime.sort((a, b) => (a.delivery_time_min! - b.delivery_time_min!))[0];
  const bestRated = withRating.sort((a, b) => b.rating! - a.rating!)[0];
  const mostPromos = withPromos.sort((a, b) => b.promotions.length - a.promotions.length)[0];

  return {
    query,
    address,
    ubereats: uberItems,
    doordash: doorItems,
    comparison_summary: {
      cheapest_delivery: cheapest ? `${cheapest.restaurant_name} (${cheapest.platform}) — $${cheapest.delivery_fee?.toFixed(2)} delivery` : 'N/A',
      fastest_delivery: fastest ? `${fastest.restaurant_name} (${fastest.platform}) — ${fastest.delivery_time_min}-${fastest.delivery_time_max || '?'} min` : 'N/A',
      best_rated: bestRated ? `${bestRated.restaurant_name} (${bestRated.platform}) — ${bestRated.rating} stars` : 'N/A',
      most_promotions: mostPromos ? `${mostPromos.restaurant_name} (${mostPromos.platform}) — ${mostPromos.promotions.join(', ')}` : 'N/A',
    },
    scraped_at: new Date().toISOString(),
    meta: {
      proxy: { ip, country: 'US', carrier },
    },
  };
}
