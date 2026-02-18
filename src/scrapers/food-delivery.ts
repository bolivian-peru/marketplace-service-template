/**
 * Food Delivery Price Intelligence Scraper
 * Extracts restaurant menus, prices, fees from Uber Eats / DoorDash / Grubhub
 */

import { proxyFetch, getProxy } from '../proxy';

export interface FoodRestaurant {
  id: string;
  name: string;
  rating: number;
  reviews_count: number;
  delivery_fee: number;
  delivery_time_min: number;
  delivery_time_max: number;
  minimum_order: number | null;
  promotions: string[];
  cuisine: string[];
  image_url: string | null;
  url: string;
  platform: string;
}

export interface FoodMenuItem {
  name: string;
  price: number;
  description: string;
  popular: boolean;
  category: string;
  image_url: string | null;
}

const FOOD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function parseUberEatsSearchState(html: string): any {
  const stateMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (stateMatch) {
    try { return JSON.parse(stateMatch[1]); } catch {}
  }
  return null;
}

export async function searchRestaurants(
  query: string,
  address: string,
  platform = 'ubereats',
): Promise<FoodRestaurant[]> {
  const searchUrl = `https://www.ubereats.com/search?q=${encodeURIComponent(query)}&pl=${encodeURIComponent(address)}`;

  const response = await proxyFetch(searchUrl, {
    headers: FOOD_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) throw new Error(`Food search failed: ${response.status}`);

  const html = await response.text();
  const results: FoodRestaurant[] = [];

  // Parse Uber Eats NEXT_DATA
  const nextData = parseUberEatsSearchState(html);
  if (nextData?.props?.pageProps?.searchResults) {
    for (const item of nextData.props.pageProps.searchResults) {
      const store = item.store || item;
      results.push({
        id: store.storeUuid || store.uuid || '',
        name: store.title || store.name || '',
        rating: store.rating?.ratingValue ?? 0,
        reviews_count: store.rating?.reviewCount ?? 0,
        delivery_fee: store.deliveryFee?.amount ?? 0,
        delivery_time_min: store.etaRange?.min ?? 0,
        delivery_time_max: store.etaRange?.max ?? 0,
        minimum_order: null,
        promotions: store.promotions?.map((p: any) => p.text || p.title) || [],
        cuisine: store.categories?.map((c: any) => c.name || c) || [],
        image_url: store.heroImageUrl || store.imageUrl || null,
        url: store.storeUuid ? `https://www.ubereats.com/store/${store.storeUuid}` : '',
        platform: 'ubereats',
      });
    }
  } else {
    // Regex fallback
    const storeRegex = /"title":"([^"]+)"[^}]*"storeUuid":"([^"]+)"/g;
    let match;
    while ((match = storeRegex.exec(html)) !== null) {
      results.push({
        id: match[2], name: match[1], rating: 0, reviews_count: 0,
        delivery_fee: 0, delivery_time_min: 0, delivery_time_max: 0,
        minimum_order: null, promotions: [], cuisine: [], image_url: null,
        url: `https://www.ubereats.com/store/${match[2]}`, platform: 'ubereats',
      });
    }
  }

  return results.slice(0, 20);
}

export async function getRestaurantDetails(
  restaurantId: string,
  platform = 'ubereats',
): Promise<{ restaurant: FoodRestaurant; menu: FoodMenuItem[] }> {
  const url = `https://www.ubereats.com/store/${restaurantId}`;

  const response = await proxyFetch(url, {
    headers: FOOD_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) throw new Error(`Restaurant fetch failed: ${response.status}`);

  const html = await response.text();
  const nextData = parseUberEatsSearchState(html);
  const menu: FoodMenuItem[] = [];
  let restaurant: FoodRestaurant = {
    id: restaurantId, name: '', rating: 0, reviews_count: 0,
    delivery_fee: 0, delivery_time_min: 0, delivery_time_max: 0,
    minimum_order: null, promotions: [], cuisine: [], image_url: null,
    url, platform,
  };

  if (nextData?.props?.pageProps?.storeInfo) {
    const store = nextData.props.pageProps.storeInfo;
    restaurant = {
      id: restaurantId,
      name: store.title || '',
      rating: store.rating?.ratingValue ?? 0,
      reviews_count: store.rating?.reviewCount ?? 0,
      delivery_fee: store.deliveryFee?.amount ?? 0,
      delivery_time_min: store.etaRange?.min ?? 0,
      delivery_time_max: store.etaRange?.max ?? 0,
      minimum_order: store.minimumOrderAmount?.amount ?? null,
      promotions: store.promotions?.map((p: any) => p.text) || [],
      cuisine: store.categories?.map((c: any) => c.name || c) || [],
      image_url: store.heroImageUrl || null,
      url, platform,
    };
  }

  if (nextData?.props?.pageProps?.catalogSectionsMap) {
    const sections = Object.values(nextData.props.pageProps.catalogSectionsMap) as any[];
    for (const section of sections) {
      const sectionName = section.title || 'Other';
      for (const item of (section.items || section.catalogItems || [])) {
        menu.push({
          name: item.title || item.name || '',
          price: item.price?.amount ?? item.priceAmount ?? 0,
          description: item.itemDescription || item.description || '',
          popular: item.isPopular || false,
          category: sectionName,
          image_url: item.imageUrl || null,
        });
      }
    }
  }

  return { restaurant, menu };
}

export async function getMenu(
  restaurantId: string,
  platform = 'ubereats',
): Promise<FoodMenuItem[]> {
  const { menu } = await getRestaurantDetails(restaurantId, platform);
  return menu;
}

export async function comparePrices(
  query: string,
  address: string,
): Promise<{ ubereats: FoodRestaurant[]; doordash: FoodRestaurant[] }> {
  const ueResults = await searchRestaurants(query, address, 'ubereats');

  // DoorDash search
  let ddResults: FoodRestaurant[] = [];
  try {
    const ddUrl = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?pickup=false`;
    const ddResponse = await proxyFetch(ddUrl, {
      headers: FOOD_HEADERS,
      maxRetries: 2,
      timeoutMs: 30000,
      followRedirects: true,
    });
    if (ddResponse.ok) {
      const ddHtml = await ddResponse.text();
      const ddRegex = /"name":"([^"]+)"[^}]*"id":(\d+)[^}]*"displayDeliveryFee":"([^"]+)"/g;
      let m;
      while ((m = ddRegex.exec(ddHtml)) !== null) {
        ddResults.push({
          id: m[2], name: m[1], rating: 0, reviews_count: 0,
          delivery_fee: parseFloat(m[3].replace(/[^\d.]/g, '')) || 0,
          delivery_time_min: 0, delivery_time_max: 0,
          minimum_order: null, promotions: [], cuisine: [], image_url: null,
          url: `https://www.doordash.com/store/${m[2]}`, platform: 'doordash',
        });
      }
    }
  } catch {}

  return { ubereats: ueResults, doordash: ddResults.slice(0, 20) };
}
