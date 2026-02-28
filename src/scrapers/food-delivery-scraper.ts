/**
 * Food Delivery Price Intelligence Scraper
 * ─────────────────────────────────────────
 * Cross-platform scraping for DoorDash, Uber Eats, and Grubhub.
 * Extracts restaurant listings, menu items, and pricing data.
 *
 * Strategies per platform:
 *   - DoorDash:  __NEXT_DATA__ JSON, JSON-LD, meta tags, structured DOM
 *   - Uber Eats: embedded JSON state, JSON-LD, meta tags, DOM parsing
 *   - Grubhub:   __NEXT_DATA__, JSON-LD, meta/OG tags, DOM extraction
 */

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (url: string, options?: any) => Promise<Response>;

export interface Restaurant {
  name: string;
  platform: 'doordash' | 'ubereats' | 'grubhub';
  rating: number | null;
  reviewCount: number | null;
  deliveryFee: string | null;
  deliveryTime: string | null;
  priceRange: string | null;
  cuisine: string[];
  url: string;
  address: string | null;
  imageUrl: string | null;
  isOpen: boolean | null;
}

export interface MenuItem {
  name: string;
  price: number | null;
  formattedPrice: string | null;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  popular: boolean;
}

export interface MenuResult {
  restaurant: string;
  platform: string;
  url: string;
  items: MenuItem[];
  categories: string[];
  scrapedAt: string;
}

export interface SearchResponse {
  type: 'search';
  query: string;
  location: string;
  restaurants: Restaurant[];
  metadata: {
    totalResults: number;
    platforms: string[];
    scrapedAt: string;
  };
}

export interface MenuResponse {
  type: 'menu';
  restaurant: string;
  platform: string;
  url: string;
  menu: {
    items: MenuItem[];
    categories: string[];
  };
  metadata: {
    totalItems: number;
    scrapedAt: string;
  };
}

export interface CompareResponse {
  type: 'compare';
  query: string;
  location: string;
  comparison: {
    restaurants: Restaurant[];
    summary: {
      averageDeliveryFee: string | null;
      cheapestPlatform: string | null;
      fastestDelivery: string | null;
      highestRated: string | null;
    };
  };
  metadata: {
    totalResults: number;
    platforms: string[];
    scrapedAt: string;
  };
}

// ─── CONSTANTS ──────────────────────────────────────

const DOORDASH_SEARCH_URL = 'https://www.doordash.com/food-delivery';
const DOORDASH_STORE_BASE = 'https://www.doordash.com/store';
const UBEREATS_SEARCH_URL = 'https://www.ubereats.com/search';
const UBEREATS_FEED_URL = 'https://www.ubereats.com/category';
const GRUBHUB_SEARCH_URL = 'https://www.grubhub.com/search';
const GRUBHUB_RESTAURANT_BASE = 'https://www.grubhub.com/restaurant';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

// ─── HTML UTILITY HELPERS ───────────────────────────

/**
 * Decode common HTML entities to plain text.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

/**
 * Strip all HTML tags, returning plain text.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Extract content of a meta tag by name or property.
 */
function extractMeta(html: string, attr: string, value: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escapeRegex(value)}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escapeRegex(value)}["']`, 'i'),
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) return decodeHtmlEntities(m[1]);
  }
  return null;
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract all JSON-LD blocks from HTML.
 */
function extractJsonLd(html: string): any[] {
  const results: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else {
        results.push(parsed);
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  return results;
}

/**
 * Extract __NEXT_DATA__ embedded JSON from Next.js pages.
 */
function extractNextData(html: string): any | null {
  const re = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = html.match(re);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Extract embedded JSON objects from script tags matching a pattern.
 */
function extractEmbeddedJson(html: string, marker: string): any[] {
  const results: any[] = [];
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    const inner = script.replace(/<\/?script[^>]*>/gi, '');
    if (!inner.includes(marker)) continue;
    const idx = inner.indexOf(marker);
    const afterMarker = inner.slice(idx);
    const jsonStart = afterMarker.search(/[{\[]/);
    if (jsonStart === -1) continue;
    const snippet = afterMarker.slice(jsonStart);
    for (const endChar of ['}', ']']) {
      let depth = 0;
      const openChar = endChar === '}' ? '{' : '[';
      if (snippet[0] !== openChar) continue;
      for (let i = 0; i < snippet.length && i < 50000; i++) {
        if (snippet[i] === openChar) depth++;
        else if (snippet[i] === endChar) depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(snippet.slice(0, i + 1));
            results.push(parsed);
          } catch {
            // not valid JSON at this boundary
          }
          break;
        }
      }
    }
  }
  return results;
}

/**
 * Parse a price string like "$12.99" to a number.
 */
function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Format a number as USD price string.
 */
function formatPrice(amount: number | null): string | null {
  if (amount === null || isNaN(amount)) return null;
  return `$${amount.toFixed(2)}`;
}

/**
 * Detect which food delivery platform a URL belongs to.
 */
function detectPlatform(url: string): 'doordash' | 'ubereats' | 'grubhub' | null {
  const lower = url.toLowerCase();
  if (lower.includes('doordash.com')) return 'doordash';
  if (lower.includes('ubereats.com')) return 'ubereats';
  if (lower.includes('grubhub.com')) return 'grubhub';
  return null;
}

// ─── DOORDASH SCRAPING ──────────────────────────────

/**
 * Build DoorDash search URL for a location.
 */
function buildDoorDashSearchUrl(query: string, location: string): string {
  const locationSlug = location.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (query) {
    return `${DOORDASH_SEARCH_URL}/${locationSlug}-restaurants/?query=${encodeURIComponent(query)}`;
  }
  return `${DOORDASH_SEARCH_URL}/${locationSlug}-restaurants/`;
}

/**
 * Parse DoorDash search results from HTML.
 * Strategy 1: __NEXT_DATA__ embedded JSON
 * Strategy 2: JSON-LD structured data
 * Strategy 3: Embedded React/Redux state
 * Strategy 4: DOM card extraction
 * Strategy 5: Store link extraction
 */
function parseDoorDashSearchResults(html: string, searchUrl: string): Restaurant[] {
  const restaurants: Restaurant[] = [];

  // Strategy 1: __NEXT_DATA__ (Next.js server-rendered state)
  const nextData = extractNextData(html);
  if (nextData?.props?.pageProps) {
    const pageProps = nextData.props.pageProps;
    const stores = pageProps.stores || pageProps.storeList || pageProps.searchResults?.stores || [];
    for (const store of stores) {
      if (!store.name) continue;
      restaurants.push({
        name: decodeHtmlEntities(store.name),
        platform: 'doordash',
        rating: typeof store.averageRating === 'number' ? store.averageRating : parseFloat(store.averageRating) || null,
        reviewCount: typeof store.numRatings === 'number' ? store.numRatings : parseInt(store.numRatings) || null,
        deliveryFee: store.deliveryFee != null ? `$${(store.deliveryFee / 100).toFixed(2)}` : store.headerText || null,
        deliveryTime: store.displayDeliveryTime || store.deliveryTime || null,
        priceRange: store.priceRange || store.priceRangeDisplayString || null,
        cuisine: Array.isArray(store.tags) ? store.tags.map((t: any) => typeof t === 'string' ? t : t.name).filter(Boolean) : [],
        url: store.url ? `https://www.doordash.com${store.url}` : `${DOORDASH_STORE_BASE}/${store.id || ''}`,
        address: store.address?.street || store.displayAddress || null,
        imageUrl: store.headerImgUrl || store.coverSquareImgUrl || null,
        isOpen: store.isOpen ?? (store.statusType === 'open' ? true : null),
      });
    }
  }

  // Strategy 2: JSON-LD (Restaurant schema)
  if (restaurants.length === 0) {
    const jsonLdBlocks = extractJsonLd(html);
    for (const ld of jsonLdBlocks) {
      if (ld['@type'] === 'Restaurant' || ld['@type'] === 'FoodEstablishment') {
        restaurants.push({
          name: decodeHtmlEntities(ld.name || ''),
          platform: 'doordash',
          rating: ld.aggregateRating?.ratingValue ? parseFloat(ld.aggregateRating.ratingValue) : null,
          reviewCount: ld.aggregateRating?.reviewCount ? parseInt(ld.aggregateRating.reviewCount) : null,
          deliveryFee: null,
          deliveryTime: null,
          priceRange: ld.priceRange || null,
          cuisine: ld.servesCuisine ? (Array.isArray(ld.servesCuisine) ? ld.servesCuisine : [ld.servesCuisine]) : [],
          url: ld.url || searchUrl,
          address: ld.address ? `${ld.address.streetAddress || ''}, ${ld.address.addressLocality || ''}`.trim().replace(/^,\s*/, '') : null,
          imageUrl: ld.image?.url || ld.image || null,
          isOpen: null,
        });
      }
      // ItemList with restaurants
      if (ld['@type'] === 'ItemList' && Array.isArray(ld.itemListElement)) {
        for (const item of ld.itemListElement) {
          const el = item.item || item;
          if (!el.name) continue;
          restaurants.push({
            name: decodeHtmlEntities(el.name),
            platform: 'doordash',
            rating: el.aggregateRating?.ratingValue ? parseFloat(el.aggregateRating.ratingValue) : null,
            reviewCount: el.aggregateRating?.reviewCount ? parseInt(el.aggregateRating.reviewCount) : null,
            deliveryFee: null,
            deliveryTime: null,
            priceRange: el.priceRange || null,
            cuisine: el.servesCuisine ? (Array.isArray(el.servesCuisine) ? el.servesCuisine : [el.servesCuisine]) : [],
            url: el.url || searchUrl,
            address: el.address?.streetAddress || null,
            imageUrl: el.image?.url || el.image || null,
            isOpen: null,
          });
        }
      }
    }
  }

  // Strategy 3: Embedded React/Redux state
  if (restaurants.length === 0) {
    const embeddedStores = extractEmbeddedJson(html, 'storeSearchResult');
    for (const data of embeddedStores) {
      const storesList = data?.storeSearchResult?.stores || data?.stores || [];
      for (const store of (Array.isArray(storesList) ? storesList : [])) {
        if (!store.name) continue;
        restaurants.push({
          name: decodeHtmlEntities(store.name),
          platform: 'doordash',
          rating: store.averageRating ?? null,
          reviewCount: store.numRatings ?? null,
          deliveryFee: store.deliveryFee != null ? formatPrice(store.deliveryFee / 100) : null,
          deliveryTime: store.displayDeliveryTime || null,
          priceRange: store.priceRange || null,
          cuisine: [],
          url: store.url ? `https://www.doordash.com${store.url}` : searchUrl,
          address: store.displayAddress || null,
          imageUrl: store.headerImgUrl || null,
          isOpen: store.isOpen ?? null,
        });
      }
    }
  }

  // Strategy 4: Regex-based DOM card extraction
  if (restaurants.length === 0) {
    const cardPattern = /data-store-id=["'](\d+)["'][^>]*>[\s\S]*?<(?:h[2-4]|span|a)[^>]*>([^<]{2,60})<\/(?:h[2-4]|span|a)>/gi;
    let cardMatch: RegExpExecArray | null;
    while ((cardMatch = cardPattern.exec(html)) !== null) {
      const storeId = cardMatch[1];
      const name = decodeHtmlEntities(cardMatch[2].trim());
      if (!name || name.length < 2) continue;

      const nearby = html.slice(Math.max(0, cardMatch.index - 200), cardMatch.index + 500);
      const ratingMatch = nearby.match(/(\d\.\d)\s*(?:★|star|rating)/i);
      const deliveryFeeMatch = nearby.match(/\$(\d+\.\d{2})\s*(?:delivery|fee)/i);
      const deliveryTimeMatch = nearby.match(/(\d+[-–]\d+)\s*min/i);

      restaurants.push({
        name,
        platform: 'doordash',
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: null,
        deliveryFee: deliveryFeeMatch ? `$${deliveryFeeMatch[1]}` : null,
        deliveryTime: deliveryTimeMatch ? `${deliveryTimeMatch[1]} min` : null,
        priceRange: null,
        cuisine: [],
        url: `${DOORDASH_STORE_BASE}/${storeId}`,
        address: null,
        imageUrl: null,
        isOpen: null,
      });
    }
  }

  // Strategy 5: Generic link + title extraction for DoorDash store URLs
  if (restaurants.length === 0) {
    const storeLinks = /href=["'](\/store\/[^"']+)["'][^>]*>[\s\S]*?<[^>]*class=["'][^"']*(?:name|title)[^"']*["'][^>]*>([^<]+)</gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = storeLinks.exec(html)) !== null) {
      const storePath = linkMatch[1];
      const name = decodeHtmlEntities(linkMatch[2].trim());
      if (!name || name.length < 2) continue;
      restaurants.push({
        name,
        platform: 'doordash',
        rating: null,
        reviewCount: null,
        deliveryFee: null,
        deliveryTime: null,
        priceRange: null,
        cuisine: [],
        url: `https://www.doordash.com${storePath}`,
        address: null,
        imageUrl: null,
        isOpen: null,
      });
    }
  }

  return deduplicateRestaurants(restaurants);
}

/**
 * Parse DoorDash store/menu page for menu items.
 */
function parseDoorDashMenu(html: string, url: string): MenuResult {
  const items: MenuItem[] = [];
  const categories = new Set<string>();
  let restaurantName = '';

  restaurantName = extractMeta(html, 'property', 'og:title') || '';
  if (!restaurantName) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
    restaurantName = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s*[-|].*$/, '') : '';
  }

  // Strategy 1: __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData?.props?.pageProps) {
    const pageProps = nextData.props.pageProps;
    const menuData = pageProps.menu || pageProps.storeMenu || pageProps.initialMenuData;
    if (menuData) {
      const menuCategories = menuData.categories || menuData.menuCategories || [];
      for (const cat of menuCategories) {
        const catName = cat.name || cat.title || 'Uncategorized';
        categories.add(catName);
        const catItems = cat.items || cat.menuItems || [];
        for (const item of catItems) {
          if (!item.name) continue;
          const price = item.price != null ? item.price / 100 : parsePrice(item.displayPrice);
          items.push({
            name: decodeHtmlEntities(item.name),
            price,
            formattedPrice: formatPrice(price),
            description: item.description ? decodeHtmlEntities(item.description) : null,
            category: catName,
            imageUrl: item.imageUrl || item.imgUrl || null,
            popular: item.isPopular || item.popular || false,
          });
        }
      }
    }
    // Alternate structure: flat items array
    const flatItems = pageProps.menuItems || pageProps.items || [];
    if (items.length === 0 && flatItems.length > 0) {
      for (const item of flatItems) {
        if (!item.name) continue;
        const price = item.price != null ? item.price / 100 : parsePrice(item.displayPrice);
        const catName = item.categoryName || item.category || 'Menu';
        categories.add(catName);
        items.push({
          name: decodeHtmlEntities(item.name),
          price,
          formattedPrice: formatPrice(price),
          description: item.description ? decodeHtmlEntities(item.description) : null,
          category: catName,
          imageUrl: item.imageUrl || null,
          popular: item.isPopular || false,
        });
      }
    }
    if (!restaurantName && pageProps.storeName) {
      restaurantName = pageProps.storeName;
    }
  }

  // Strategy 2: JSON-LD Menu schema
  if (items.length === 0) {
    const jsonLdBlocks = extractJsonLd(html);
    for (const ld of jsonLdBlocks) {
      if (ld['@type'] === 'Restaurant' || ld['@type'] === 'FoodEstablishment') {
        if (!restaurantName && ld.name) restaurantName = ld.name;
        if (ld.hasMenu?.hasMenuSection) {
          const sections = Array.isArray(ld.hasMenu.hasMenuSection) ? ld.hasMenu.hasMenuSection : [ld.hasMenu.hasMenuSection];
          for (const section of sections) {
            const sectionName = section.name || 'Menu';
            categories.add(sectionName);
            const menuItems = section.hasMenuItem ? (Array.isArray(section.hasMenuItem) ? section.hasMenuItem : [section.hasMenuItem]) : [];
            for (const mi of menuItems) {
              if (!mi.name) continue;
              const price = mi.offers?.price ? parseFloat(mi.offers.price) : parsePrice(mi.offers?.priceCurrency === 'USD' ? mi.offers?.price : null);
              items.push({
                name: decodeHtmlEntities(mi.name),
                price,
                formattedPrice: formatPrice(price),
                description: mi.description ? decodeHtmlEntities(mi.description) : null,
                category: sectionName,
                imageUrl: mi.image || null,
                popular: false,
              });
            }
          }
        }
      }
      // Direct Menu schema
      if (ld['@type'] === 'Menu' && ld.hasMenuSection) {
        const sections = Array.isArray(ld.hasMenuSection) ? ld.hasMenuSection : [ld.hasMenuSection];
        for (const section of sections) {
          const sectionName = section.name || 'Menu';
          categories.add(sectionName);
          const menuItems = section.hasMenuItem ? (Array.isArray(section.hasMenuItem) ? section.hasMenuItem : [section.hasMenuItem]) : [];
          for (const mi of menuItems) {
            if (!mi.name) continue;
            const price = mi.offers?.price ? parseFloat(mi.offers.price) : null;
            items.push({
              name: decodeHtmlEntities(mi.name),
              price,
              formattedPrice: formatPrice(price),
              description: mi.description ? decodeHtmlEntities(mi.description) : null,
              category: sectionName,
              imageUrl: mi.image || null,
              popular: false,
            });
          }
        }
      }
    }
  }

  // Strategy 3: Embedded menu JSON in script tags
  if (items.length === 0) {
    const menuJsonBlocks = extractEmbeddedJson(html, 'menuCategories');
    for (const data of menuJsonBlocks) {
      const cats = data.menuCategories || data.categories || [];
      for (const cat of (Array.isArray(cats) ? cats : [])) {
        const catName = cat.name || cat.title || 'Menu';
        categories.add(catName);
        for (const item of (cat.items || cat.menuItems || [])) {
          if (!item.name) continue;
          const price = item.price != null ? item.price / 100 : parsePrice(item.displayPrice);
          items.push({
            name: decodeHtmlEntities(item.name),
            price,
            formattedPrice: formatPrice(price),
            description: item.description ? decodeHtmlEntities(item.description) : null,
            category: catName,
            imageUrl: item.imageUrl || null,
            popular: item.isPopular || false,
          });
        }
      }
    }
  }

  // Strategy 4: DOM-based extraction for item cards
  if (items.length === 0) {
    const itemPattern = /<[^>]*class=["'][^"']*(?:item|menu|product)[^"']*["'][^>]*>[\s\S]*?<[^>]*>([^<]{2,80})<\/[^>]*>[\s\S]*?\$(\d+\.\d{2})/gi;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemPattern.exec(html)) !== null) {
      const name = decodeHtmlEntities(itemMatch[1].trim());
      const price = parseFloat(itemMatch[2]);
      if (!name || name.length < 2 || isNaN(price)) continue;
      items.push({
        name,
        price,
        formattedPrice: `$${price.toFixed(2)}`,
        description: null,
        category: null,
        imageUrl: null,
        popular: false,
      });
    }
  }

  return {
    restaurant: restaurantName || 'Unknown Restaurant',
    platform: 'doordash',
    url,
    items: deduplicateMenuItems(items),
    categories: Array.from(categories),
    scrapedAt: new Date().toISOString(),
  };
}

// ─── UBER EATS SCRAPING ────────────────────────────

/**
 * Build Uber Eats search URL.
 */
function buildUberEatsSearchUrl(query: string, location: string): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('pl', 'JTdCJTIyYWRkcmVzcyUyMiUzQSUyMiUyMiU3RA==');
  return `${UBEREATS_SEARCH_URL}?${params.toString()}&diningMode=DELIVERY`;
}

/**
 * Parse Uber Eats search results from HTML.
 */
function parseUberEatsSearchResults(html: string, searchUrl: string): Restaurant[] {
  const restaurants: Restaurant[] = [];

  // Strategy 1: Embedded JSON state (React/Redux)
  const stateBlocks = extractEmbeddedJson(html, 'feedItems');
  for (const data of stateBlocks) {
    const feedItems = data.feedItems || data.data?.feedItems || [];
    for (const feed of (Array.isArray(feedItems) ? feedItems : [])) {
      const store = feed.store || feed.storeInfo || feed;
      if (!store.name && !store.title) continue;
      restaurants.push({
        name: decodeHtmlEntities(store.name || store.title),
        platform: 'ubereats',
        rating: store.rating?.ratingValue ? parseFloat(store.rating.ratingValue) : (store.rating ? parseFloat(store.rating) : null),
        reviewCount: store.rating?.reviewCount ? parseInt(store.rating.reviewCount) : null,
        deliveryFee: store.deliveryFee?.text || store.deliveryFeeText || null,
        deliveryTime: store.etaRange?.text || store.deliveryTime || null,
        priceRange: store.priceBucket || store.priceRange || null,
        cuisine: store.cuisineList || store.categories || [],
        url: store.actionUrl ? `https://www.ubereats.com${store.actionUrl}` : searchUrl,
        address: store.location?.address || store.address || null,
        imageUrl: store.heroImageUrl || store.imageUrl || null,
        isOpen: store.isOpen ?? null,
      });
    }
  }

  // Strategy 2: JSON-LD
  if (restaurants.length === 0) {
    const jsonLdBlocks = extractJsonLd(html);
    for (const ld of jsonLdBlocks) {
      if (ld['@type'] === 'Restaurant' || ld['@type'] === 'FoodEstablishment' || ld['@type'] === 'LocalBusiness') {
        restaurants.push({
          name: decodeHtmlEntities(ld.name || ''),
          platform: 'ubereats',
          rating: ld.aggregateRating?.ratingValue ? parseFloat(ld.aggregateRating.ratingValue) : null,
          reviewCount: ld.aggregateRating?.reviewCount ? parseInt(ld.aggregateRating.reviewCount) : null,
          deliveryFee: null,
          deliveryTime: null,
          priceRange: ld.priceRange || null,
          cuisine: ld.servesCuisine ? (Array.isArray(ld.servesCuisine) ? ld.servesCuisine : [ld.servesCuisine]) : [],
          url: ld.url || searchUrl,
          address: ld.address?.streetAddress || null,
          imageUrl: ld.image?.url || ld.image || null,
          isOpen: null,
        });
      }
      // ItemList for search results
      if (ld['@type'] === 'ItemList' && Array.isArray(ld.itemListElement)) {
        for (const item of ld.itemListElement) {
          const el = item.item || item;
          if (!el.name) continue;
          restaurants.push({
            name: decodeHtmlEntities(el.name),
            platform: 'ubereats',
            rating: el.aggregateRating?.ratingValue ? parseFloat(el.aggregateRating.ratingValue) : null,
            reviewCount: el.aggregateRating?.reviewCount ? parseInt(el.aggregateRating.reviewCount) : null,
            deliveryFee: null,
            deliveryTime: null,
            priceRange: el.priceRange || null,
            cuisine: [],
            url: el.url || searchUrl,
            address: null,
            imageUrl: el.image || null,
            isOpen: null,
          });
        }
      }
    }
  }

  // Strategy 3: Meta tags for individual store page
  if (restaurants.length === 0) {
    const ogTitle = extractMeta(html, 'property', 'og:title');
    if (ogTitle && ogTitle.toLowerCase().includes('delivery')) {
      const name = ogTitle.replace(/\s*[|\-–].*$/, '').replace(/\s*delivery.*$/i, '').trim();
      if (name.length >= 2) {
        const ogDesc = extractMeta(html, 'property', 'og:description') || '';
        const ratingMatch = ogDesc.match(/(\d\.\d)\s*(?:★|star|rating)/i);
        restaurants.push({
          name: decodeHtmlEntities(name),
          platform: 'ubereats',
          rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
          reviewCount: null,
          deliveryFee: null,
          deliveryTime: null,
          priceRange: null,
          cuisine: [],
          url: searchUrl,
          address: null,
          imageUrl: extractMeta(html, 'property', 'og:image'),
          isOpen: null,
        });
      }
    }
  }

  // Strategy 4: DOM link pattern extraction
  if (restaurants.length === 0) {
    const storeLinks = /href=["'](\/store\/[^"'?]+)[^"']*["'][^>]*>[\s\S]*?(?:<[^>]*>)*\s*([^<]{2,60})\s*<\//gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = storeLinks.exec(html)) !== null) {
      const storePath = linkMatch[1];
      const name = decodeHtmlEntities(linkMatch[2].trim());
      if (!name || name.length < 2 || /^\d+$/.test(name)) continue;
      const context = html.slice(Math.max(0, linkMatch.index - 100), linkMatch.index + 600);
      const ratingMatch = context.match(/(\d\.\d)\s/);
      const feeMatch = context.match(/\$(\d+\.\d{2})\s*(?:delivery|fee)/i);
      const timeMatch = context.match(/(\d+[-–]\d+)\s*min/i);

      restaurants.push({
        name,
        platform: 'ubereats',
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: null,
        deliveryFee: feeMatch ? `$${feeMatch[1]}` : null,
        deliveryTime: timeMatch ? `${timeMatch[1]} min` : null,
        priceRange: null,
        cuisine: [],
        url: `https://www.ubereats.com${storePath}`,
        address: null,
        imageUrl: null,
        isOpen: null,
      });
    }
  }

  return deduplicateRestaurants(restaurants);
}

/**
 * Parse Uber Eats restaurant/menu page for menu items.
 */
function parseUberEatsMenu(html: string, url: string): MenuResult {
  const items: MenuItem[] = [];
  const categories = new Set<string>();
  let restaurantName = '';

  restaurantName = extractMeta(html, 'property', 'og:title')?.replace(/\s*[|\-–].*$/, '').replace(/\s*delivery.*$/i, '').trim() || '';
  if (!restaurantName) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
    restaurantName = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s*[-|].*$/, '') : '';
  }

  // Strategy 1: Embedded state JSON
  const menuBlocks = extractEmbeddedJson(html, 'menuSections');
  for (const data of menuBlocks) {
    const sections = data.menuSections || data.sections || [];
    for (const section of (Array.isArray(sections) ? sections : [])) {
      const catName = section.title || section.name || 'Menu';
      categories.add(catName);
      for (const item of (section.items || section.itemList || [])) {
        if (!item.title && !item.name) continue;
        const price = item.price != null ? item.price / 100 : parsePrice(item.priceString || item.formattedPrice);
        items.push({
          name: decodeHtmlEntities(item.title || item.name),
          price,
          formattedPrice: formatPrice(price),
          description: item.description ? decodeHtmlEntities(item.description) : null,
          category: catName,
          imageUrl: item.imageUrl || item.image || null,
          popular: item.isPopular || item.isBestSeller || false,
        });
      }
    }
  }

  // Strategy 2: JSON-LD Menu
  if (items.length === 0) {
    const jsonLdBlocks = extractJsonLd(html);
    for (const ld of jsonLdBlocks) {
      if (ld['@type'] === 'Restaurant' && ld.hasMenu) {
        if (!restaurantName && ld.name) restaurantName = ld.name;
        const sections = ld.hasMenu.hasMenuSection;
        if (sections) {
          for (const section of (Array.isArray(sections) ? sections : [sections])) {
            const catName = section.name || 'Menu';
            categories.add(catName);
            const menuItems = section.hasMenuItem ? (Array.isArray(section.hasMenuItem) ? section.hasMenuItem : [section.hasMenuItem]) : [];
            for (const mi of menuItems) {
              if (!mi.name) continue;
              const price = mi.offers?.price ? parseFloat(mi.offers.price) : null;
              items.push({
                name: decodeHtmlEntities(mi.name),
                price,
                formattedPrice: formatPrice(price),
                description: mi.description ? decodeHtmlEntities(mi.description) : null,
                category: catName,
                imageUrl: mi.image || null,
                popular: false,
              });
            }
          }
        }
      }
    }
  }

  // Strategy 3: Embedded item data in script tags
  if (items.length === 0) {
    const itemBlocks = extractEmbeddedJson(html, 'catalogItems');
    for (const data of itemBlocks) {
      const catalogItems = data.catalogItems || data.items || {};
      const itemMap = typeof catalogItems === 'object' && !Array.isArray(catalogItems) ? Object.values(catalogItems) : catalogItems;
      for (const item of (Array.isArray(itemMap) ? itemMap : [])) {
        if (!(item as any).title && !(item as any).name) continue;
        const price = (item as any).price != null ? (item as any).price / 100 : parsePrice((item as any).priceString);
        items.push({
          name: decodeHtmlEntities((item as any).title || (item as any).name || ''),
          price,
          formattedPrice: formatPrice(price),
          description: (item as any).description ? decodeHtmlEntities((item as any).description) : null,
          category: (item as any).categoryTitle || (item as any).sectionTitle || null,
          imageUrl: (item as any).imageUrl || null,
          popular: (item as any).isPopular || false,
        });
        if ((item as any).categoryTitle) categories.add((item as any).categoryTitle);
      }
    }
  }

  // Strategy 4: DOM-based menu item extraction
  if (items.length === 0) {
    const itemPattern = /(?:<[^>]*class=["'][^"']*(?:menu-item|product-card|catalog-item)[^"']*["'][^>]*>[\s\S]*?)?<[^>]*>([^<]{2,80})<\/[^>]*>\s*(?:<[^>]*>)*\s*\$(\d+\.\d{2})/gi;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemPattern.exec(html)) !== null) {
      const name = decodeHtmlEntities(itemMatch[1].trim());
      const price = parseFloat(itemMatch[2]);
      if (!name || name.length < 2 || isNaN(price)) continue;
      items.push({
        name,
        price,
        formattedPrice: `$${price.toFixed(2)}`,
        description: null,
        category: null,
        imageUrl: null,
        popular: false,
      });
    }
  }

  return {
    restaurant: restaurantName || 'Unknown Restaurant',
    platform: 'ubereats',
    url,
    items: deduplicateMenuItems(items),
    categories: Array.from(categories),
    scrapedAt: new Date().toISOString(),
  };
}

// ─── GRUBHUB SCRAPING ──────────────────────────────

/**
 * Build Grubhub search URL.
 */
function buildGrubhubSearchUrl(query: string, location: string): string {
  const params = new URLSearchParams();
  if (query) params.set('queryText', query);
  params.set('orderMethod', 'delivery');
  params.set('locationMode', 'DELIVERY');
  params.set('locationText', location);
  return `${GRUBHUB_SEARCH_URL}?${params.toString()}`;
}

/**
 * Parse Grubhub search results from HTML.
 */
function parseGrubhubSearchResults(html: string, searchUrl: string): Restaurant[] {
  const restaurants: Restaurant[] = [];

  // Strategy 1: __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData?.props?.pageProps) {
    const pageProps = nextData.props.pageProps;
    const results = pageProps.searchResults?.results || pageProps.restaurants || pageProps.data?.results || [];
    for (const r of (Array.isArray(results) ? results : [])) {
      const restaurant = r.restaurant || r;
      if (!restaurant.name) continue;
      restaurants.push({
        name: decodeHtmlEntities(restaurant.name),
        platform: 'grubhub',
        rating: restaurant.rating?.overall != null ? parseFloat(restaurant.rating.overall) : (restaurant.rating ? parseFloat(restaurant.rating) : null),
        reviewCount: restaurant.rating?.count ?? restaurant.reviewCount ?? null,
        deliveryFee: restaurant.delivery?.fee?.text || restaurant.deliveryFee || null,
        deliveryTime: restaurant.delivery?.time?.text || restaurant.deliveryTimeEstimate || restaurant.estimatedDeliveryTime || null,
        priceRange: restaurant.priceRating ? '$'.repeat(restaurant.priceRating) : restaurant.priceRange || null,
        cuisine: restaurant.cuisines || restaurant.cuisineList || [],
        url: restaurant.restaurantUrl ? `https://www.grubhub.com${restaurant.restaurantUrl}` : (restaurant.url || searchUrl),
        address: restaurant.address?.streetAddress || restaurant.displayAddress || null,
        imageUrl: restaurant.logo || restaurant.mediaImage?.url || null,
        isOpen: restaurant.isOpen ?? restaurant.available ?? null,
      });
    }
  }

  // Strategy 2: JSON-LD
  if (restaurants.length === 0) {
    const jsonLdBlocks = extractJsonLd(html);
    for (const ld of jsonLdBlocks) {
      if (ld['@type'] === 'Restaurant' || ld['@type'] === 'FoodEstablishment') {
        restaurants.push({
          name: decodeHtmlEntities(ld.name || ''),
          platform: 'grubhub',
          rating: ld.aggregateRating?.ratingValue ? parseFloat(ld.aggregateRating.ratingValue) : null,
          reviewCount: ld.aggregateRating?.reviewCount ? parseInt(ld.aggregateRating.reviewCount) : null,
          deliveryFee: null,
          deliveryTime: null,
          priceRange: ld.priceRange || null,
          cuisine: ld.servesCuisine ? (Array.isArray(ld.servesCuisine) ? ld.servesCuisine : [ld.servesCuisine]) : [],
          url: ld.url || searchUrl,
          address: ld.address?.streetAddress || null,
          imageUrl: ld.image?.url || ld.image || null,
          isOpen: null,
        });
      }
      if (ld['@type'] === 'ItemList' && Array.isArray(ld.itemListElement)) {
        for (const item of ld.itemListElement) {
          const el = item.item || item;
          if (!el.name) continue;
          restaurants.push({
            name: decodeHtmlEntities(el.name),
            platform: 'grubhub',
            rating: el.aggregateRating?.ratingValue ? parseFloat(el.aggregateRating.ratingValue) : null,
            reviewCount: el.aggregateRating?.reviewCount ? parseInt(el.aggregateRating.reviewCount) : null,
            deliveryFee: null,
            deliveryTime: null,
            priceRange: null,
            cuisine: [],
            url: el.url || searchUrl,
            address: null,
            imageUrl: el.image || null,
            isOpen: null,
          });
        }
      }
    }
  }

  // Strategy 3: Embedded search results JSON
  if (restaurants.length === 0) {
    const searchBlocks = extractEmbeddedJson(html, 'search_result');
    for (const data of searchBlocks) {
      const results = data.search_result?.results || data.results || [];
      for (const r of (Array.isArray(results) ? results : [])) {
        if (!r.name) continue;
        restaurants.push({
          name: decodeHtmlEntities(r.name),
          platform: 'grubhub',
          rating: r.ratings?.overall ?? null,
          reviewCount: r.ratings?.count ?? null,
          deliveryFee: r.delivery_fee ? `$${(r.delivery_fee / 100).toFixed(2)}` : null,
          deliveryTime: r.delivery_time_estimate || null,
          priceRange: r.price_rating ? '$'.repeat(r.price_rating) : null,
          cuisine: r.cuisines || [],
          url: r.restaurant_url ? `https://www.grubhub.com${r.restaurant_url}` : searchUrl,
          address: r.address?.street_address || null,
          imageUrl: r.logo || null,
          isOpen: r.available ?? null,
        });
      }
    }
  }

  // Strategy 4: Meta tags / OG data
  if (restaurants.length === 0) {
    const ogTitle = extractMeta(html, 'property', 'og:title');
    if (ogTitle && (ogTitle.toLowerCase().includes('delivery') || ogTitle.toLowerCase().includes('food'))) {
      const name = ogTitle.replace(/\s*[|\-–].*$/, '').replace(/\s*delivery.*$/i, '').trim();
      if (name.length >= 2) {
        restaurants.push({
          name: decodeHtmlEntities(name),
          platform: 'grubhub',
          rating: null,
          reviewCount: null,
          deliveryFee: null,
          deliveryTime: null,
          priceRange: null,
          cuisine: [],
          url: searchUrl,
          address: null,
          imageUrl: extractMeta(html, 'property', 'og:image'),
          isOpen: null,
        });
      }
    }
  }

  // Strategy 5: DOM-based restaurant card extraction
  if (restaurants.length === 0) {
    const cardPattern = /href=["'](\/restaurant\/[^"'?]+)[^"']*["'][^>]*>[\s\S]*?<[^>]*>([^<]{2,60})<\//gi;
    let cardMatch: RegExpExecArray | null;
    while ((cardMatch = cardPattern.exec(html)) !== null) {
      const path = cardMatch[1];
      const name = decodeHtmlEntities(cardMatch[2].trim());
      if (!name || name.length < 2 || /^\d+$/.test(name)) continue;

      const context = html.slice(Math.max(0, cardMatch.index - 100), cardMatch.index + 600);
      const ratingMatch = context.match(/(\d\.\d)\s/);
      const feeMatch = context.match(/\$(\d+\.\d{2})\s*(?:delivery|fee)/i);
      const timeMatch = context.match(/(\d+[-–]\d+)\s*min/i);

      restaurants.push({
        name,
        platform: 'grubhub',
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: null,
        deliveryFee: feeMatch ? `$${feeMatch[1]}` : null,
        deliveryTime: timeMatch ? `${timeMatch[1]} min` : null,
        priceRange: null,
        cuisine: [],
        url: `https://www.grubhub.com${path}`,
        address: null,
        imageUrl: null,
        isOpen: null,
      });
    }
  }

  return deduplicateRestaurants(restaurants);
}

/**
 * Parse Grubhub restaurant/menu page for menu items.
 */
function parseGrubhubMenu(html: string, url: string): MenuResult {
  const items: MenuItem[] = [];
  const categories = new Set<string>();
  let restaurantName = '';

  restaurantName = extractMeta(html, 'property', 'og:title')?.replace(/\s*[|\-–].*$/, '').replace(/\s*delivery.*$/i, '').trim() || '';
  if (!restaurantName) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
    restaurantName = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s*[-|].*$/, '') : '';
  }

  // Strategy 1: __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData?.props?.pageProps) {
    const pageProps = nextData.props.pageProps;
    const menuData = pageProps.restaurant?.menu || pageProps.menu || pageProps.menuData;
    if (menuData) {
      const menuCategories = menuData.menu_category_list || menuData.categories || menuData.menuSections || [];
      for (const cat of menuCategories) {
        const catName = cat.name || cat.category_name || 'Menu';
        categories.add(catName);
        const catItems = cat.menu_item_list || cat.items || cat.menuItems || [];
        for (const item of catItems) {
          if (!item.name && !item.menu_item_name) continue;
          const priceVal = item.price?.amount != null
            ? item.price.amount / 100
            : item.price != null
              ? (typeof item.price === 'number' ? item.price / 100 : parsePrice(String(item.price)))
              : parsePrice(item.displayPrice);
          items.push({
            name: decodeHtmlEntities(item.name || item.menu_item_name),
            price: priceVal,
            formattedPrice: formatPrice(priceVal),
            description: item.description || item.menu_item_description ? decodeHtmlEntities(item.description || item.menu_item_description) : null,
            category: catName,
            imageUrl: item.media_image?.url || item.imageUrl || null,
            popular: item.popular || item.isPopular || false,
          });
        }
      }
    }
    if (!restaurantName && pageProps.restaurant?.name) {
      restaurantName = pageProps.restaurant.name;
    }
  }

  // Strategy 2: JSON-LD
  if (items.length === 0) {
    const jsonLdBlocks = extractJsonLd(html);
    for (const ld of jsonLdBlocks) {
      if ((ld['@type'] === 'Restaurant' || ld['@type'] === 'FoodEstablishment') && ld.hasMenu) {
        if (!restaurantName && ld.name) restaurantName = ld.name;
        const sections = ld.hasMenu.hasMenuSection;
        if (sections) {
          for (const section of (Array.isArray(sections) ? sections : [sections])) {
            const catName = section.name || 'Menu';
            categories.add(catName);
            const menuItems = section.hasMenuItem ? (Array.isArray(section.hasMenuItem) ? section.hasMenuItem : [section.hasMenuItem]) : [];
            for (const mi of menuItems) {
              if (!mi.name) continue;
              const price = mi.offers?.price ? parseFloat(mi.offers.price) : null;
              items.push({
                name: decodeHtmlEntities(mi.name),
                price,
                formattedPrice: formatPrice(price),
                description: mi.description ? decodeHtmlEntities(mi.description) : null,
                category: catName,
                imageUrl: mi.image || null,
                popular: false,
              });
            }
          }
        }
      }
    }
  }

  // Strategy 3: Embedded menu JSON
  if (items.length === 0) {
    const menuBlocks = extractEmbeddedJson(html, 'menu_category_list');
    for (const data of menuBlocks) {
      const cats = data.menu_category_list || [];
      for (const cat of (Array.isArray(cats) ? cats : [])) {
        const catName = cat.name || cat.category_name || 'Menu';
        categories.add(catName);
        for (const item of (cat.menu_item_list || [])) {
          if (!item.name && !item.menu_item_name) continue;
          const priceVal = item.price?.amount != null ? item.price.amount / 100 : parsePrice(item.displayPrice);
          items.push({
            name: decodeHtmlEntities(item.name || item.menu_item_name),
            price: priceVal,
            formattedPrice: formatPrice(priceVal),
            description: item.description ? decodeHtmlEntities(item.description) : null,
            category: catName,
            imageUrl: item.media_image?.url || null,
            popular: item.popular || false,
          });
        }
      }
    }
  }

  // Strategy 4: DOM price extraction
  if (items.length === 0) {
    const itemPattern = /<[^>]*class=["'][^"']*(?:menuItem|menu-item|item-name)[^"']*["'][^>]*>[\s\S]*?<[^>]*>([^<]{2,80})<\/[^>]*>[\s\S]*?\$(\d+\.\d{2})/gi;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemPattern.exec(html)) !== null) {
      const name = decodeHtmlEntities(itemMatch[1].trim());
      const price = parseFloat(itemMatch[2]);
      if (!name || name.length < 2 || isNaN(price)) continue;
      items.push({
        name,
        price,
        formattedPrice: `$${price.toFixed(2)}`,
        description: null,
        category: null,
        imageUrl: null,
        popular: false,
      });
    }
  }

  return {
    restaurant: restaurantName || 'Unknown Restaurant',
    platform: 'grubhub',
    url,
    items: deduplicateMenuItems(items),
    categories: Array.from(categories),
    scrapedAt: new Date().toISOString(),
  };
}

// ─── DEDUPLICATION HELPERS ──────────────────────────

/**
 * Remove duplicate restaurants by name + platform.
 */
function deduplicateRestaurants(restaurants: Restaurant[]): Restaurant[] {
  const seen = new Set<string>();
  return restaurants.filter((r) => {
    const key = `${r.platform}:${r.name.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Remove duplicate menu items by name.
 */
function deduplicateMenuItems(items: MenuItem[]): MenuItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── COMPARISON ANALYTICS ───────────────────────────

/**
 * Compute comparison summary across platforms.
 */
function computeComparisonSummary(restaurants: Restaurant[]): CompareResponse['comparison']['summary'] {
  const fees: { platform: string; fee: number }[] = [];
  const times: { platform: string; time: number }[] = [];
  const ratings: { platform: string; name: string; rating: number }[] = [];

  for (const r of restaurants) {
    if (r.deliveryFee) {
      const fee = parsePrice(r.deliveryFee);
      if (fee !== null) fees.push({ platform: r.platform, fee });
    }
    if (r.deliveryTime) {
      const timeMatch = r.deliveryTime.match(/(\d+)/);
      if (timeMatch) times.push({ platform: r.platform, time: parseInt(timeMatch[1]) });
    }
    if (r.rating !== null) {
      ratings.push({ platform: r.platform, name: r.name, rating: r.rating });
    }
  }

  const avgFee = fees.length > 0 ? fees.reduce((s, f) => s + f.fee, 0) / fees.length : null;

  let cheapestPlatform: string | null = null;
  if (fees.length > 0) {
    const platformFees: Record<string, number[]> = {};
    for (const f of fees) {
      if (!platformFees[f.platform]) platformFees[f.platform] = [];
      platformFees[f.platform].push(f.fee);
    }
    let minAvg = Infinity;
    for (const [platform, feeList] of Object.entries(platformFees)) {
      const avg = feeList.reduce((s, v) => s + v, 0) / feeList.length;
      if (avg < minAvg) {
        minAvg = avg;
        cheapestPlatform = platform;
      }
    }
  }

  let fastestDelivery: string | null = null;
  if (times.length > 0) {
    const fastest = times.reduce((min, t) => t.time < min.time ? t : min, times[0]);
    fastestDelivery = fastest.platform;
  }

  let highestRated: string | null = null;
  if (ratings.length > 0) {
    const best = ratings.reduce((max, r) => r.rating > max.rating ? r : max, ratings[0]);
    highestRated = `${best.name} (${best.platform}) — ${best.rating}`;
  }

  return {
    averageDeliveryFee: avgFee !== null ? formatPrice(avgFee) : null,
    cheapestPlatform,
    fastestDelivery,
    highestRated,
  };
}

// ─── EXPORTED API FUNCTIONS ─────────────────────────

/**
 * Search restaurants across DoorDash, Uber Eats, and Grubhub.
 */
export async function searchRestaurants(
  query: string,
  location: string,
  fetchFn: ProxyFetchFn,
): Promise<SearchResponse> {
  const platforms = ['doordash', 'ubereats', 'grubhub'] as const;
  const allRestaurants: Restaurant[] = [];
  const activePlatforms: string[] = [];

  const urls: Record<string, string> = {
    doordash: buildDoorDashSearchUrl(query, location),
    ubereats: buildUberEatsSearchUrl(query, location),
    grubhub: buildGrubhubSearchUrl(query, location),
  };

  const fetchPromises = platforms.map(async (platform) => {
    try {
      const response = await fetchFn(urls[platform], {
        headers: { ...COMMON_HEADERS, Referer: `https://www.${platform === 'ubereats' ? 'ubereats' : platform}.com/` },
        maxRetries: 2,
        timeoutMs: 25_000,
      });
      if (!response.ok) return { platform, html: null };
      const html = await response.text();
      return { platform, html };
    } catch {
      return { platform, html: null };
    }
  });

  const results = await Promise.all(fetchPromises);

  for (const { platform, html } of results) {
    if (!html) continue;
    activePlatforms.push(platform);

    let parsed: Restaurant[] = [];
    switch (platform) {
      case 'doordash':
        parsed = parseDoorDashSearchResults(html, urls.doordash);
        break;
      case 'ubereats':
        parsed = parseUberEatsSearchResults(html, urls.ubereats);
        break;
      case 'grubhub':
        parsed = parseGrubhubSearchResults(html, urls.grubhub);
        break;
    }
    allRestaurants.push(...parsed);
  }

  return {
    type: 'search',
    query,
    location,
    restaurants: allRestaurants,
    metadata: {
      totalResults: allRestaurants.length,
      platforms: activePlatforms,
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Get menu items and prices from a specific restaurant URL.
 */
export async function getMenuPrices(
  url: string,
  fetchFn: ProxyFetchFn,
): Promise<MenuResponse> {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error(`Unsupported platform URL: ${url}. Supported: doordash.com, ubereats.com, grubhub.com`);
  }

  const response = await fetchFn(url, {
    headers: { ...COMMON_HEADERS, Referer: `https://www.${platform === 'ubereats' ? 'ubereats' : platform}.com/` },
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch menu page: HTTP ${response.status} from ${platform}`);
  }

  const html = await response.text();

  let menuResult: MenuResult;
  switch (platform) {
    case 'doordash':
      menuResult = parseDoorDashMenu(html, url);
      break;
    case 'ubereats':
      menuResult = parseUberEatsMenu(html, url);
      break;
    case 'grubhub':
      menuResult = parseGrubhubMenu(html, url);
      break;
  }

  return {
    type: 'menu',
    restaurant: menuResult.restaurant,
    platform: menuResult.platform,
    url: menuResult.url,
    menu: {
      items: menuResult.items,
      categories: menuResult.categories,
    },
    metadata: {
      totalItems: menuResult.items.length,
      scrapedAt: menuResult.scrapedAt,
    },
  };
}

/**
 * Compare restaurant prices and delivery info across platforms.
 */
export async function comparePrices(
  query: string,
  location: string,
  fetchFn: ProxyFetchFn,
): Promise<CompareResponse> {
  const searchResult = await searchRestaurants(query, location, fetchFn);
  const summary = computeComparisonSummary(searchResult.restaurants);

  return {
    type: 'compare',
    query,
    location,
    comparison: {
      restaurants: searchResult.restaurants,
      summary,
    },
    metadata: {
      totalResults: searchResult.restaurants.length,
      platforms: searchResult.metadata.platforms,
      scrapedAt: new Date().toISOString(),
    },
  };
}