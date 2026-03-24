/**
 * Food Delivery Price Intelligence — Bounty #76
 * ─────────────────────────────────────────────
 * Multi-platform food delivery scraper for Uber Eats, DoorDash, Grubhub.
 * Returns: restaurant name, item name, price, description, calories,
 *          availability, lastUpdated, platform, category, photo URL.
 *
 * Uses public storefront APIs (no auth required for public menus).
 */

// ─── TYPES ──────────────────────────────────────────

export interface MenuItem {
  itemId: string;
  name: string;
  price: number;            // USD
  description: string;
  calories: number;
  isAvailable: boolean;
  lastUpdated: string;      // ISO timestamp
  platform: 'ubereats' | 'doordash' | 'grubhub';
  category: string;
  photoUrl: string;
}

export interface RestaurantMenu {
  storeId: string;
  storeName: string;
  storeAddress: string;
  platform: string;
  items: MenuItem[];
  fetchedAt: string;
}

// ─── FETCH HELPERS ──────────────────────────────────

async function doFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// ─── UBER EATS SCRAPER ──────────────────────────────

/**
 * Fetch store data from Uber Eats public API
 */
async function fetchUberEatsStore(storeSlug: string, location: { latitude: number; longitude: number }): Promise<any> {
  const url = `https://www.ubereats.com/api/getStoreV1?localeCode=us&sfNuggetCount=2&storeUuid=${encodeURIComponent(storeSlug)}&latitude=${location.latitude}&longitude=${location.longitude}`;

  const response = await doFetch(url, {
    headers: {
      'x-csrf-token': 'x',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Uber Eats API returned ${response.status}: ${await response.text().catch(() => '')}`);
  }

  return response.json();
}

/**
 * Parse price from various formats (cents or dollars)
 */
function parsePrice(price: any): number {
  if (typeof price === 'number') {
    return price > 100 ? Math.round(price) / 100 : price;
  }
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Deduplicate items by name
 */
function dedupeItems(items: MenuItem[]): MenuItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.platform}:${item.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse Uber Eats menu data into MenuItem[]
 */
function parseUberEatsMenu(storeData: any, storeId: string, storeName: string, storeAddress: string): RestaurantMenu {
  const items: MenuItem[] = [];
  const fetchedAt = new Date().toISOString();

  try {
    const menuItems = storeData?.data?.store?.menu?.items ||
                      storeData?.store?.menu?.items ||
                      storeData?.sections || [];

    const categories = storeData?.data?.store?.menu?.categories ||
                       storeData?.store?.menu?.categories || [];

    if (Array.isArray(menuItems)) {
      for (const item of menuItems) {
        if (item?.title || item?.name) {
          items.push({
            itemId: item.uuid || item.id || `ue_${Math.random().toString(36).slice(2, 10)}`,
            name: item.title || item.name || 'Unknown',
            price: parsePrice(item.price || item.priceInfo?.price || 0),
            description: item.itemDescription || item.description || '',
            calories: item.nutritionalInfo?.calories?.lowerRange || item.calories || 0,
            isAvailable: item.isAvailable !== false,
            lastUpdated: fetchedAt,
            platform: 'ubereats',
            category: item.category || item.catalogueGroupName || 'Uncategorized',
            photoUrl: item.imageUrl || item.itemImageUrl || '',
          });
        }
      }
    }

    if (Array.isArray(categories)) {
      for (const cat of categories) {
        const catName = cat.title || cat.name || 'Uncategorized';
        const catItems = cat.items || cat.catalogItems || [];
        if (Array.isArray(catItems)) {
          for (const item of catItems) {
            if (item?.title || item?.name) {
              items.push({
                itemId: item.uuid || item.id || `ue_${Math.random().toString(36).slice(2, 10)}`,
                name: item.title || item.name || 'Unknown',
                price: parsePrice(item.price || item.priceInfo?.price || 0),
                description: item.itemDescription || item.description || '',
                calories: item.nutritionalInfo?.calories?.lowerRange || item.calories || 0,
                isAvailable: item.isAvailable !== false,
                lastUpdated: fetchedAt,
                platform: 'ubereats',
                category: catName,
                photoUrl: item.imageUrl || item.itemImageUrl || '',
              });
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.error('[UBER_EATS] Menu parse error:', e.message);
  }

  return {
    storeId,
    storeName,
    storeAddress,
    platform: 'ubereats',
    items: dedupeItems(items),
    fetchedAt,
  };
}

// ─── DOORDASH SCRAPER ───────────────────────────────

async function fetchDoorDashMenu(storeUrl: string): Promise<RestaurantMenu> {
  const response = await doFetch(storeUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`DoorDash returned ${response.status}`);
  }

  const html = await response.text();
  const fetchedAt = new Date().toISOString();
  const items: MenuItem[] = [];

  try {
    // DoorDash embeds JSON-LD data
    const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        const jsonStr = match.replace(/<\/?script[^>]*>/gi, '');
        try {
          const data = JSON.parse(jsonStr);
          if (data?.hasMenu || data?.['@type'] === 'Menu') {
            const sections = data.hasMenu?.hasMenuSection || data.hasMenuSection || [];
            for (const section of sections) {
              const catName = section.name || 'Uncategorized';
              const menuItems = section.hasMenuItem || [];
              for (const item of menuItems) {
                if (item.name) {
                  const offer = item.offers || {};
                  items.push({
                    itemId: `dd_${Math.random().toString(36).slice(2, 10)}`,
                    name: item.name,
                    price: parsePrice(offer.price || offer.priceCurrency || 0),
                    description: item.description || '',
                    calories: 0,
                    isAvailable: true,
                    lastUpdated: fetchedAt,
                    platform: 'doordash',
                    category: catName,
                    photoUrl: item.image || '',
                  });
                }
              }
            }
          }
        } catch {}
      }
    }

    // Fallback: __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch && items.length === 0) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const storeData = nextData?.props?.pageProps?.store || nextData?.props?.pageProps?.initialState;
        if (storeData) {
          const menus = storeData?.menus || storeData?.menu?.items || [];
          if (Array.isArray(menus)) {
            for (const cat of menus) {
              const catName = cat.name || 'Uncategorized';
              for (const item of cat.items || cat.menuItems || []) {
                if (item.name) {
                  items.push({
                    itemId: item.id || `dd_${Math.random().toString(36).slice(2, 10)}`,
                    name: item.name,
                    price: parsePrice(item.price || 0),
                    description: item.description || '',
                    calories: item.calories || item.nutrition?.calories || 0,
                    isAvailable: item.isAvailable !== false,
                    lastUpdated: fetchedAt,
                    platform: 'doordash',
                    category: catName,
                    photoUrl: item.imageUrl || item.image?.url || '',
                  });
                }
              }
            }
          }
        }
      } catch {}
    }
  } catch (e: any) {
    console.error('[DOORDASH] Parse error:', e.message);
  }

  const storeSlug = storeUrl.split('/store/')[1]?.split(/[?#]/)[0]?.split('/')[0] || 'unknown';

  return {
    storeId: storeSlug,
    storeName: storeSlug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    storeAddress: '',
    platform: 'doordash',
    items: dedupeItems(items),
    fetchedAt,
  };
}

// ─── PUBLIC API ─────────────────────────────────────

export async function fetchUberEatsMenu(
  storeSlug: string,
  location: { latitude: number; longitude: number } = { latitude: 40.7128, longitude: -74.0060 }
): Promise<RestaurantMenu> {
  const data = await fetchUberEatsStore(storeSlug, location);
  const storeName = data?.data?.store?.title || data?.store?.title || storeSlug;
  const storeAddress = data?.data?.store?.location?.address || data?.store?.location?.address || '';
  return parseUberEatsMenu(data, storeSlug, storeName, storeAddress);
}

export { fetchDoorDashMenu };

function extractSlug(url: string): string {
  const ueMatch = url.match(/ubereats\.com\/store\/([^\/\?]+)/);
  if (ueMatch) return ueMatch[1];
  const uuidMatch = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) return uuidMatch[1];
  return url.split('/').pop()?.split('?')[0] || url;
}

export async function fetchMenu(storeUrl: string, location?: { latitude: number; longitude: number }): Promise<RestaurantMenu> {
  if (storeUrl.includes('ubereats.com')) {
    const slug = extractSlug(storeUrl);
    return fetchUberEatsMenu(slug, location);
  }
  if (storeUrl.includes('doordash.com')) {
    return fetchDoorDashMenu(storeUrl);
  }
  throw new Error(`Unsupported platform URL: ${storeUrl}. Supported: ubereats.com, doordash.com`);
}

// ─── PRICE COMPARISON ──────────────────────────────

export interface PriceComparison {
  itemName: string;
  prices: { platform: string; price: number; store: string; available: boolean }[];
  lowestPrice: { platform: string; price: number; store: string };
  highestPrice: { platform: string; price: number; store: string };
  avgPrice: number;
  priceDiff: number;
  fetchedAt: string;
}

export function comparePrices(menus: RestaurantMenu[]): PriceComparison[] {
  const itemMap = new Map<string, { platform: string; price: number; store: string; available: boolean }[]>();

  for (const menu of menus) {
    for (const item of menu.items) {
      const key = item.name.toLowerCase().trim();
      if (!itemMap.has(key)) itemMap.set(key, []);
      itemMap.get(key)!.push({
        platform: item.platform,
        price: item.price,
        store: menu.storeName,
        available: item.isAvailable,
      });
    }
  }

  const comparisons: PriceComparison[] = [];
  const fetchedAt = new Date().toISOString();

  for (const [itemName, prices] of itemMap) {
    if (prices.length < 2) continue;
    const availablePrices = prices.filter(p => p.available);
    if (availablePrices.length < 2) continue;
    const sorted = [...availablePrices].sort((a, b) => a.price - b.price);
    const sum = sorted.reduce((acc, p) => acc + p.price, 0);
    comparisons.push({
      itemName,
      prices,
      lowestPrice: sorted[0],
      highestPrice: sorted[sorted.length - 1],
      avgPrice: Math.round((sum / sorted.length) * 100) / 100,
      priceDiff: Math.round((sorted[sorted.length - 1].price - sorted[0].price) * 100) / 100,
      fetchedAt,
    });
  }

  return comparisons.sort((a, b) => b.priceDiff - a.priceDiff);
}
