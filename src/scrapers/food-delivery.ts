/**
 * Food Delivery Price Intelligence Scraper
 * Supports: Uber Eats (primary), DoorDash (secondary)
 * Routes all requests through Proxies.sx mobile proxies
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface Restaurant {
  id: string;
  name: string;
  rating: number | null;
  reviews_count: number | null;
  delivery_fee: number | null;
  delivery_time_min: number | null;
  delivery_time_max: number | null;
  minimum_order: number | null;
  promotions: string[];
  image_url: string | null;
  platform: string;
}

export interface MenuItem {
  name: string;
  price: number | null;
  description: string | null;
  popular: boolean;
  image_url: string | null;
  category: string | null;
}

export interface RestaurantMenu {
  restaurant: Restaurant;
  menu_items: MenuItem[];
  platform: string;
  scraped_at: string;
}

export interface SearchResult {
  restaurants: Restaurant[];
  query: string;
  address: string;
  platform: string;
  total: number;
  scraped_at: string;
}

export interface CompareResult {
  query: string;
  address: string;
  platforms: {
    ubereats?: Restaurant[];
    doordash?: Restaurant[];
  };
  cheapest_delivery: string | null;
  scraped_at: string;
}

// ─── UBER EATS SCRAPER ──────────────────────────────

const UBEREATS_FEED_URL = 'https://www.ubereats.com/api/getFeedV1';
const UBEREATS_STORE_URL = 'https://www.ubereats.com/api/getStoreV1';

function uberEatsHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'x-csrf-token': 'x',
    'Referer': 'https://www.ubereats.com/',
    'Origin': 'https://www.ubereats.com',
    'Content-Type': 'application/json',
    'x-uber-analytics-session-token': '',
  };
}

function parseDeliveryTime(timeStr: string | undefined): { min: number | null; max: number | null } {
  if (!timeStr) return { min: null, max: null };
  const match = timeStr.match(/(\d+)[-–](\d+)/);
  if (match) return { min: parseInt(match[1]), max: parseInt(match[2]) };
  const single = timeStr.match(/(\d+)/);
  if (single) return { min: parseInt(single[1]), max: parseInt(single[1]) };
  return { min: null, max: null };
}

function parsePrice(priceStr: string | undefined | null): number | null {
  if (!priceStr) return null;
  const match = priceStr.replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

export async function searchUberEats(query: string, address: string, limit = 10): Promise<Restaurant[]> {
  // Use Uber Eats location-based feed API
  const payload = {
    cacheKey: '',
    feedSessionId: '',
    feedTypes: ['FEED_TYPE_FOOD'],
    pageInfo: { offset: 0, pageSize: limit },
    query,
    userQuery: query,
  };

  try {
    const response = await proxyFetch(UBEREATS_FEED_URL, {
      method: 'POST',
      headers: {
        ...uberEatsHeaders(),
        'x-uber-analytics-correlation-id': Math.random().toString(36).substring(2),
      },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      // Fallback to HTML scraping
      return await searchUberEatsHTML(query, address, limit);
    }

    const data = await response.json() as any;
    const stores = data?.data?.feedItems || [];

    return stores
      .filter((item: any) => item?.type === 'STORE' || item?.store)
      .slice(0, limit)
      .map((item: any): Restaurant => {
        const store = item?.store || item;
        const delivery = store?.fareInfo?.serviceFee || null;
        const time = parseDeliveryTime(store?.etaRange?.text);
        return {
          id: store?.storeUuid || store?.uuid || '',
          name: store?.title?.text || store?.name || 'Unknown',
          rating: store?.rating?.ratingValue ?? null,
          reviews_count: store?.rating?.reviewCount ?? null,
          delivery_fee: delivery ? parsePrice(delivery) : 0,
          delivery_time_min: time.min,
          delivery_time_max: time.max,
          minimum_order: parsePrice(store?.minBasketSize?.text),
          promotions: (store?.promotionInfo?.storePromotions || []).map((p: any) => p?.text || '').filter(Boolean),
          image_url: store?.heroImageUrl || store?.image?.url || null,
          platform: 'ubereats',
        };
      });
  } catch {
    return await searchUberEatsHTML(query, address, limit);
  }
}

async function searchUberEatsHTML(query: string, address: string, limit: number): Promise<Restaurant[]> {
  const url = `https://www.ubereats.com/search?diningMode=DELIVERY&pl=JTdCJTIyYWRkcmVzcyUyMiUzQSUyMiR7YWRkcmVzc30lMjIlN0Q%3D&q=${encodeURIComponent(query)}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 25_000,
    maxRetries: 2,
  });

  const html = await response.text();

  // Extract __REDUX_STATE__ or window.__DATA__
  const stateMatch = html.match(/"stores"\s*:\s*(\[.*?\])/s) ||
                     html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;/s);

  if (!stateMatch) {
    // Parse basic HTML cards
    return parseUberEatsHTMLCards(html, limit);
  }

  try {
    const stores = JSON.parse(stateMatch[1]);
    return stores.slice(0, limit).map((store: any): Restaurant => ({
      id: store?.uuid || store?.id || '',
      name: store?.title || store?.name || 'Unknown',
      rating: store?.rating ?? null,
      reviews_count: store?.reviewCount ?? null,
      delivery_fee: parsePrice(store?.deliveryFee),
      delivery_time_min: store?.etaMin ?? null,
      delivery_time_max: store?.etaMax ?? null,
      minimum_order: parsePrice(store?.minBasketSize),
      promotions: [],
      image_url: store?.heroImageUrl || null,
      platform: 'ubereats',
    }));
  } catch {
    return parseUberEatsHTMLCards(html, limit);
  }
}

function parseUberEatsHTMLCards(html: string, limit: number): Restaurant[] {
  const restaurants: Restaurant[] = [];

  // Match restaurant name patterns in Uber Eats HTML
  const namePattern = /"title"\s*:\s*\{"text"\s*:\s*"([^"]+)"/g;
  const ratingPattern = /"ratingValue"\s*:\s*([\d.]+)/g;
  const etaPattern = /"displayString"\s*:\s*"(\d+[-–]\d+)\s*min"/g;

  const names: string[] = [];
  let m;
  while ((m = namePattern.exec(html)) !== null && names.length < limit) {
    names.push(m[1]);
  }

  const ratings: number[] = [];
  while ((m = ratingPattern.exec(html)) !== null) {
    ratings.push(parseFloat(m[1]));
  }

  const etas: string[] = [];
  while ((m = etaPattern.exec(html)) !== null) {
    etas.push(m[1]);
  }

  for (let i = 0; i < Math.min(names.length, limit); i++) {
    const time = parseDeliveryTime(etas[i]);
    restaurants.push({
      id: `ue-${i}`,
      name: names[i],
      rating: ratings[i] ?? null,
      reviews_count: null,
      delivery_fee: null,
      delivery_time_min: time.min,
      delivery_time_max: time.max,
      minimum_order: null,
      promotions: [],
      image_url: null,
      platform: 'ubereats',
    });
  }

  return restaurants;
}

// ─── DOORDASH SCRAPER ───────────────────────────────

export async function searchDoorDash(query: string, address: string, limit = 10): Promise<Restaurant[]> {
  const url = `https://www.doordash.com/graphql/getStoreFeeds?operation=getStoreFeeds`;

  const payload = {
    operationName: 'getStoreFeeds',
    query: `query getStoreFeeds($input: StoreFeedsInput!) {
      getStoreFeeds(input: $input) {
        stores {
          id name averageRating numRatings deliveryFeeDetails { originalFee }
          deliveryMinutes { min max } minimumOrderValue priceRange
          coverImgUrl
        }
      }
    }`,
    variables: {
      input: {
        filterOptions: { searchQuery: query },
        offset: 0,
        limit,
      },
    },
  };

  try {
    const response = await proxyFetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://www.doordash.com',
        'Referer': 'https://www.doordash.com/',
      },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
      maxRetries: 2,
    });

    if (!response.ok) return await searchDoorDashHTML(query, address, limit);

    const data = await response.json() as any;
    const stores = data?.data?.getStoreFeeds?.stores || [];

    return stores.slice(0, limit).map((store: any): Restaurant => ({
      id: store?.id?.toString() || '',
      name: store?.name || 'Unknown',
      rating: store?.averageRating ?? null,
      reviews_count: store?.numRatings ?? null,
      delivery_fee: store?.deliveryFeeDetails?.originalFee != null
        ? store.deliveryFeeDetails.originalFee / 100
        : null,
      delivery_time_min: store?.deliveryMinutes?.min ?? null,
      delivery_time_max: store?.deliveryMinutes?.max ?? null,
      minimum_order: store?.minimumOrderValue != null ? store.minimumOrderValue / 100 : null,
      promotions: [],
      image_url: store?.coverImgUrl || null,
      platform: 'doordash',
    }));
  } catch {
    return await searchDoorDashHTML(query, address, limit);
  }
}

async function searchDoorDashHTML(query: string, _address: string, limit: number): Promise<Restaurant[]> {
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Accept': 'text/html',
    },
    timeoutMs: 25_000,
    maxRetries: 2,
  });

  const html = await response.text();

  // Try to parse Next.js __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const stores = nextData?.props?.pageProps?.stores ||
                     nextData?.props?.pageProps?.searchResults?.stores || [];
      return stores.slice(0, limit).map((store: any): Restaurant => ({
        id: store?.id?.toString() || '',
        name: store?.name || 'Unknown',
        rating: store?.averageRating ?? null,
        reviews_count: store?.numRatings ?? null,
        delivery_fee: null,
        delivery_time_min: store?.deliveryMinutes?.min ?? null,
        delivery_time_max: store?.deliveryMinutes?.max ?? null,
        minimum_order: null,
        promotions: [],
        image_url: store?.coverImgUrl || null,
        platform: 'doordash',
      }));
    } catch { /* fall through */ }
  }

  // Regex fallback
  const restaurants: Restaurant[] = [];
  const namePattern = /"name"\s*:\s*"([^"]{3,60})"/g;
  const names: string[] = [];
  let m;
  while ((m = namePattern.exec(html)) !== null && names.length < limit) {
    if (!names.includes(m[1])) names.push(m[1]);
  }

  for (let i = 0; i < names.length; i++) {
    restaurants.push({
      id: `dd-${i}`,
      name: names[i],
      rating: null,
      reviews_count: null,
      delivery_fee: null,
      delivery_time_min: null,
      delivery_time_max: null,
      minimum_order: null,
      promotions: [],
      image_url: null,
      platform: 'doordash',
    });
  }

  return restaurants;
}

// ─── MENU SCRAPER ───────────────────────────────────

export async function scrapeUberEatsMenu(restaurantId: string): Promise<MenuItem[]> {
  const url = `https://www.ubereats.com/store/${restaurantId}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 25_000,
    maxRetries: 2,
  });

  const html = await response.text();

  // Extract menu items from __REDUX_STATE__ or JSON-LD
  const menuItems: MenuItem[] = [];

  // Try JSON-LD structured data
  const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1]);
      if (jsonData['@type'] === 'Restaurant' && jsonData.hasMenu) {
        const menus = jsonData.hasMenu?.hasMenuSection || [];
        for (const section of menus) {
          const category = section?.name || null;
          for (const item of section?.hasMenuItem || []) {
            menuItems.push({
              name: item?.name || 'Unknown',
              price: parsePrice(item?.offers?.price?.toString()),
              description: item?.description || null,
              popular: false,
              image_url: item?.image || null,
              category,
            });
          }
        }
      }
    } catch { /* skip */ }
  }

  if (menuItems.length > 0) return menuItems;

  // Regex fallback: extract item name+price pairs
  const itemPattern = /"title"\s*:\s*\{"text"\s*:\s*"([^"]+)"[^}]*\}.*?"price"\s*:\s*\{"text"\s*:\s*"([^"]+)"/gs;
  let m;
  while ((m = itemPattern.exec(html)) !== null && menuItems.length < 50) {
    menuItems.push({
      name: m[1],
      price: parsePrice(m[2]),
      description: null,
      popular: false,
      image_url: null,
      category: null,
    });
  }

  return menuItems;
}
