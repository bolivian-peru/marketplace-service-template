/**
 * Food Delivery Price Intelligence Scraper (Bounty #76)
 * ─────────────────────────────────────────────────────
 * Scrapes food delivery platforms (DoorDash, Uber Eats, Grubhub)
 * for restaurant data, menu pricing, delivery fees, and ratings.
 * Uses mobile proxy to access platform search and detail pages.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface FoodRestaurant {
  id: string;
  name: string;
  cuisine: string[];
  rating: number | null;
  review_count: number | null;
  price_level: string | null;
  delivery_fee: number | null;
  delivery_time_min: number | null;
  delivery_time_max: number | null;
  distance_miles: number | null;
  address: string | null;
  image_url: string | null;
  platform: string;
  url: string;
  is_promoted: boolean;
  offers: string[];
}

export interface MenuItem {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
  image_url: string | null;
  popular: boolean;
  calories: number | null;
}

export interface RestaurantDetail extends FoodRestaurant {
  description: string | null;
  phone: string | null;
  hours: Record<string, string>;
  menu_categories: string[];
  menu_items: MenuItem[];
  service_fee_pct: number | null;
  small_order_fee: number | null;
  min_order: number | null;
  accepts_pickup: boolean;
  dash_pass_eligible: boolean;
}

export interface PriceComparison {
  item_name: string;
  restaurant_name: string;
  prices: {
    platform: string;
    price: number | null;
    delivery_fee: number | null;
    service_fee_pct: number | null;
    estimated_total: number | null;
    delivery_time_min: number | null;
    url: string;
  }[];
  best_value: string | null;
  price_spread: number | null;
}

export interface DeliveryFeeAnalysis {
  location: string;
  platform: string;
  restaurants_sampled: number;
  avg_delivery_fee: number | null;
  median_delivery_fee: number | null;
  min_delivery_fee: number | null;
  max_delivery_fee: number | null;
  free_delivery_pct: number | null;
  fee_distribution: {
    free: number;
    under_3: number;
    range_3_5: number;
    range_5_8: number;
    over_8: number;
  };
  avg_service_fee_pct: number | null;
  avg_small_order_fee: number | null;
}

export interface RatingAggregation {
  restaurant_name: string;
  ratings: {
    platform: string;
    rating: number | null;
    review_count: number | null;
    url: string;
  }[];
  avg_rating: number | null;
  total_reviews: number;
  best_rated_platform: string | null;
}

// ─── HELPERS ────────────────────────────────────────

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBetween(html: string, start: string, end: string): string | null {
  const i = html.indexOf(start);
  if (i === -1) return null;
  const j = html.indexOf(end, i + start.length);
  if (j === -1) return null;
  return html.slice(i + start.length, j).trim();
}

function parsePrice(text: string): number | null {
  const match = text.match(/\$?([\d]+\.?\d{0,2})/);
  return match ? parseFloat(match[1]) : null;
}

function parseDeliveryTime(text: string): { min: number | null; max: number | null } {
  // "25-35 min" or "30 min" or "25–40 min"
  const rangeMatch = text.match(/(\d+)\s*[-–]\s*(\d+)\s*min/i);
  if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
  const singleMatch = text.match(/(\d+)\s*min/i);
  if (singleMatch) return { min: parseInt(singleMatch[1]), max: parseInt(singleMatch[1]) };
  return { min: null, max: null };
}

async function fetchPage(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 25_000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      ...headers,
    },
  });

  if (!response.ok) {
    if (response.status === 403) throw new Error(`Platform blocked the request (403). Proxy IP may be flagged.`);
    throw new Error(`Platform returned ${response.status}`);
  }

  return response.text();
}

// ─── DOORDASH SCRAPER ───────────────────────────────

const DOORDASH_BASE = 'https://www.doordash.com';

function parseDoorDashResults(html: string): FoodRestaurant[] {
  const restaurants: FoodRestaurant[] = [];

  // DoorDash embeds store data in __NEXT_DATA__ or script tags
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const stores = nextData?.props?.pageProps?.ssrStoreList?.storeList ||
                     nextData?.props?.pageProps?.stores ||
                     nextData?.props?.pageProps?.initialState?.searchFeed?.storeList ||
                     [];
      for (const store of stores) {
        const s = store.store || store;
        if (!s.name && !s.storeName) continue;
        restaurants.push({
          id: String(s.id || s.storeId || ''),
          name: s.name || s.storeName || '',
          cuisine: (s.displayTags || s.tags || s.cuisines || []).slice(0, 5),
          rating: s.averageRating || s.rating || null,
          review_count: s.numRatings || s.numberOfRatings || null,
          price_level: s.priceRange || null,
          delivery_fee: s.deliveryFee?.unitAmount ? s.deliveryFee.unitAmount / 100 : (s.deliveryFee || null),
          delivery_time_min: s.displayDeliveryTime?.min || s.asapMinDeliveryDuration || null,
          delivery_time_max: s.displayDeliveryTime?.max || s.asapMaxDeliveryDuration || null,
          distance_miles: s.distanceFromConsumer || null,
          address: s.address?.street || s.formattedAddress || null,
          image_url: s.headerImgUrl || s.coverImgUrl || null,
          platform: 'doordash',
          url: `${DOORDASH_BASE}/store/${s.slug || s.id || ''}`,
          is_promoted: s.isSponsored || s.isPromoted || false,
          offers: extractDoorDashOffers(s),
        });
      }
    } catch { /* fall through to HTML parsing */ }
  }

  // Fallback: parse from HTML store cards
  if (restaurants.length === 0) {
    const cards = html.split('data-testid="StoreCard"');
    for (let i = 1; i < cards.length; i++) {
      const card = cards[i].slice(0, 4000);

      const nameMatch = card.match(/class="[^"]*StoreCard[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)/);
      const name = nameMatch ? cleanText(nameMatch[1]) : '';

      const linkMatch = card.match(/href="\/store\/([^"?]+)/);
      const slug = linkMatch ? linkMatch[1] : '';
      const id = slug;

      let rating: number | null = null;
      const ratingMatch = card.match(/([\d.]+)\s*(?:\(|★|star)/i);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      let reviewCount: number | null = null;
      const reviewMatch = card.match(/\((\d[\d,]*)\+?\s*rating/i);
      if (reviewMatch) reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));

      let deliveryFee: number | null = null;
      const feeMatch = card.match(/\$(\d+\.?\d*)\s*delivery/i);
      if (feeMatch) deliveryFee = parseFloat(feeMatch[1]);
      if (card.toLowerCase().includes('free delivery') || card.toLowerCase().includes('$0 delivery')) {
        deliveryFee = 0;
      }

      const timeText = card.match(/(\d+[-–]\d+\s*min|\d+\s*min)/i);
      const time = timeText ? parseDeliveryTime(timeText[1]) : { min: null, max: null };

      const cuisineMatch = card.match(/class="[^"]*tag[^"]*"[^>]*>([^<]+)/gi);
      const cuisine = cuisineMatch
        ? cuisineMatch.map(m => cleanText(m.replace(/class="[^"]*"[^>]*>/i, ''))).filter(Boolean)
        : [];

      const imgMatch = card.match(/src="(https:\/\/[^"]*doordash[^"]*\.(?:jpg|jpeg|png|webp))/i);
      const imageUrl = imgMatch ? imgMatch[1] : null;

      if (name || slug) {
        restaurants.push({
          id,
          name,
          cuisine,
          rating,
          review_count: reviewCount,
          price_level: null,
          delivery_fee: deliveryFee,
          delivery_time_min: time.min,
          delivery_time_max: time.max,
          distance_miles: null,
          address: null,
          image_url: imageUrl,
          platform: 'doordash',
          url: `${DOORDASH_BASE}/store/${slug}`,
          is_promoted: card.toLowerCase().includes('sponsored'),
          offers: [],
        });
      }
    }
  }

  return restaurants;
}

function extractDoorDashOffers(store: any): string[] {
  const offers: string[] = [];
  if (store.promotionInfo?.promoText) offers.push(store.promotionInfo.promoText);
  if (store.deliveryFee?.unitAmount === 0 || store.deliveryFee === 0) offers.push('Free delivery');
  if (store.isDashPassEligible) offers.push('DashPass eligible');
  return offers;
}

// ─── UBER EATS SCRAPER ─────────────────────────────

const UBEREATS_BASE = 'https://www.ubereats.com';

function parseUberEatsResults(html: string): FoodRestaurant[] {
  const restaurants: FoodRestaurant[] = [];

  // Uber Eats uses __REDUX_STATE__ or embedded JSON in script tags
  const stateMatch = html.match(/"feedItems"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (stateMatch) {
    try {
      const items = JSON.parse(stateMatch[1]);
      for (const item of items) {
        const store = item?.store || item?.storePayload || item;
        if (!store.title && !store.name) continue;
        restaurants.push({
          id: String(store.uuid || store.storeUuid || store.id || ''),
          name: store.title || store.name || '',
          cuisine: (store.categories || store.tags || []).map((c: any) => typeof c === 'string' ? c : c.name).slice(0, 5),
          rating: store.rating?.ratingValue || store.averageRating || null,
          review_count: store.rating?.reviewCount || store.reviewCount || null,
          price_level: store.priceBucket ? '$'.repeat(store.priceBucket) : null,
          delivery_fee: store.fareInfo?.deliveryFee?.amount ? store.fareInfo.deliveryFee.amount / 100 : null,
          delivery_time_min: store.etaRange?.min || null,
          delivery_time_max: store.etaRange?.max || null,
          distance_miles: null,
          address: store.location?.address || null,
          image_url: store.heroImageUrl || store.imageUrl || null,
          platform: 'ubereats',
          url: `${UBEREATS_BASE}/store/${store.slug || store.uuid || ''}`,
          is_promoted: store.isSponsored || false,
          offers: store.promotionInfo ? [store.promotionInfo.text || 'Promotion available'] : [],
        });
      }
    } catch { /* fall through */ }
  }

  // Fallback HTML parsing
  if (restaurants.length === 0) {
    // Look for store card links
    const storeLinks = html.matchAll(/href="\/store\/([^"?]+)"[^>]*>[\s\S]*?<\/a>/gi);
    const seen = new Set<string>();

    for (const match of storeLinks) {
      const slug = match[1];
      if (seen.has(slug)) continue;
      seen.add(slug);

      const cardHtml = match[0].slice(0, 3000);

      // Name from the card
      const nameMatch = cardHtml.match(/<h3[^>]*>([^<]+)/i) || cardHtml.match(/>([^<]{3,60})</);
      const name = nameMatch ? cleanText(nameMatch[1]) : slug.replace(/-/g, ' ');

      let rating: number | null = null;
      const ratingMatch = cardHtml.match(/([\d.]+)\s*(?:\(|★)/);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      let deliveryFee: number | null = null;
      const feeMatch = cardHtml.match(/\$(\d+\.?\d*)\s*(?:Delivery|Fee)/i);
      if (feeMatch) deliveryFee = parseFloat(feeMatch[1]);
      if (cardHtml.toLowerCase().includes('free delivery')) deliveryFee = 0;

      const timeText = cardHtml.match(/(\d+[-–]\d+\s*min|\d+\s*min)/i);
      const time = timeText ? parseDeliveryTime(timeText[1]) : { min: null, max: null };

      restaurants.push({
        id: slug,
        name,
        cuisine: [],
        rating,
        review_count: null,
        price_level: null,
        delivery_fee: deliveryFee,
        delivery_time_min: time.min,
        delivery_time_max: time.max,
        distance_miles: null,
        address: null,
        image_url: null,
        platform: 'ubereats',
        url: `${UBEREATS_BASE}/store/${slug}`,
        is_promoted: cardHtml.toLowerCase().includes('sponsored'),
        offers: [],
      });
    }
  }

  return restaurants;
}

// ─── GRUBHUB SCRAPER ────────────────────────────────

const GRUBHUB_BASE = 'https://www.grubhub.com';

function parseGrubhubResults(html: string): FoodRestaurant[] {
  const restaurants: FoodRestaurant[] = [];

  // Grubhub uses __NEXT_DATA__ for SSR
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const results = data?.props?.pageProps?.searchData?.results ||
                      data?.props?.pageProps?.restaurants ||
                      [];
      for (const r of results) {
        const rest = r.restaurant || r;
        if (!rest.name) continue;
        restaurants.push({
          id: String(rest.restaurant_id || rest.id || ''),
          name: rest.name || '',
          cuisine: (rest.cuisines || rest.tags || []).slice(0, 5),
          rating: rest.rating?.rating_value || rest.overall_rating || null,
          review_count: rest.rating?.rating_count || rest.ratings_count || null,
          price_level: rest.price_rating ? '$'.repeat(rest.price_rating) : null,
          delivery_fee: rest.delivery_fee?.price ? rest.delivery_fee.price / 100 : null,
          delivery_time_min: rest.delivery_time_estimate?.min || rest.estimated_delivery_time || null,
          delivery_time_max: rest.delivery_time_estimate?.max || null,
          distance_miles: rest.distance || null,
          address: rest.address?.street_address || null,
          image_url: rest.logo || rest.media_image?.base_url || null,
          platform: 'grubhub',
          url: `${GRUBHUB_BASE}/restaurant/${rest.slug || rest.restaurant_id || ''}`,
          is_promoted: rest.is_promoted || false,
          offers: rest.promotions ? rest.promotions.map((p: any) => p.description || 'Promo') : [],
        });
      }
    } catch { /* fall through */ }
  }

  // Fallback HTML parsing
  if (restaurants.length === 0) {
    const cards = html.split('data-testid="restaurant-card"');
    for (let i = 1; i < cards.length; i++) {
      const card = cards[i].slice(0, 3000);

      const nameMatch = card.match(/<h3[^>]*>([^<]+)/i) || card.match(/class="[^"]*name[^"]*"[^>]*>([^<]+)/i);
      const name = nameMatch ? cleanText(nameMatch[1]) : '';

      const linkMatch = card.match(/href="\/restaurant\/([^"?]+)/);
      const slug = linkMatch ? linkMatch[1] : '';

      let rating: number | null = null;
      const ratingMatch = card.match(/([\d.]+)\s*(?:\(|★|star)/i);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      let deliveryFee: number | null = null;
      const feeMatch = card.match(/\$(\d+\.?\d*)\s*delivery/i);
      if (feeMatch) deliveryFee = parseFloat(feeMatch[1]);
      if (card.toLowerCase().includes('free delivery') || card.toLowerCase().includes('$0 delivery')) {
        deliveryFee = 0;
      }

      const timeText = card.match(/(\d+[-–]\d+\s*min|\d+\s*min)/i);
      const time = timeText ? parseDeliveryTime(timeText[1]) : { min: null, max: null };

      if (name || slug) {
        restaurants.push({
          id: slug,
          name,
          cuisine: [],
          rating,
          review_count: null,
          price_level: null,
          delivery_fee: deliveryFee,
          delivery_time_min: time.min,
          delivery_time_max: time.max,
          distance_miles: null,
          address: null,
          image_url: null,
          platform: 'grubhub',
          url: `${GRUBHUB_BASE}/restaurant/${slug}`,
          is_promoted: card.toLowerCase().includes('sponsored'),
          offers: [],
        });
      }
    }
  }

  return restaurants;
}

// ─── MENU SCRAPER ───────────────────────────────────

function parseMenuItems(html: string, platform: string): MenuItem[] {
  const items: MenuItem[] = [];

  // Try JSON data first (common for all platforms)
  const menuJsonMatch = html.match(/"menu(?:Items|Categories)"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (menuJsonMatch) {
    try {
      const menuData = JSON.parse(menuJsonMatch[1]);
      for (const category of menuData) {
        const catName = category.name || category.title || 'Menu';
        const catItems = category.items || category.menuItems || [category];
        for (const item of catItems) {
          if (!item.name && !item.title) continue;
          items.push({
            name: item.name || item.title || '',
            description: (item.description || item.itemDescription || '').slice(0, 500) || null,
            price: item.price?.unitAmount ? item.price.unitAmount / 100 :
                   item.price?.amount ? item.price.amount / 100 :
                   (typeof item.price === 'number' ? item.price : null),
            category: catName,
            image_url: item.imageUrl || item.image?.url || null,
            popular: item.isPopular || item.isFeatured || false,
            calories: item.nutritionalInfo?.calories || item.calories || null,
          });
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: parse from HTML item cards
  if (items.length === 0) {
    const itemCards = html.split(/data-testid="(?:menu-item|store-item|item-card)"/i);
    let currentCategory = 'Menu';

    for (let i = 1; i < itemCards.length && items.length < 100; i++) {
      const card = itemCards[i].slice(0, 2000);

      // Check for category header
      const catMatch = card.match(/<h[23][^>]*>([^<]+)/);
      if (catMatch && !card.includes('$')) {
        currentCategory = cleanText(catMatch[1]);
        continue;
      }

      const nameMatch = card.match(/class="[^"]*item-?name[^"]*"[^>]*>([^<]+)/i) ||
                         card.match(/<span[^>]*>([^<]{3,60})<\/span>/);
      const name = nameMatch ? cleanText(nameMatch[1]) : '';

      const descMatch = card.match(/class="[^"]*description[^"]*"[^>]*>([^<]+)/i);
      const description = descMatch ? cleanText(descMatch[1]).slice(0, 500) : null;

      let price: number | null = null;
      const priceMatch = card.match(/\$(\d+\.?\d{0,2})/);
      if (priceMatch) price = parseFloat(priceMatch[1]);

      const imgMatch = card.match(/src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
      const imageUrl = imgMatch ? imgMatch[1] : null;

      const popular = card.toLowerCase().includes('popular') || card.toLowerCase().includes('featured');

      let calories: number | null = null;
      const calMatch = card.match(/(\d+)\s*cal/i);
      if (calMatch) calories = parseInt(calMatch[1]);

      if (name && price !== null) {
        items.push({ name, description, price, category: currentCategory, image_url: imageUrl, popular, calories });
      }
    }
  }

  return items;
}

// ─── EXPORTED FUNCTIONS ─────────────────────────────

/**
 * Search restaurants by location and optional cuisine filter.
 * Scrapes DoorDash, Uber Eats, and Grubhub in parallel.
 */
export async function searchRestaurants(
  location: string,
  cuisine?: string,
  platforms: string[] = ['doordash', 'ubereats', 'grubhub'],
  limit: number = 20,
): Promise<FoodRestaurant[]> {
  const allResults: FoodRestaurant[] = [];
  const encodedLocation = encodeURIComponent(location);
  const cuisineQuery = cuisine ? encodeURIComponent(cuisine) : '';

  const scrapers: Promise<FoodRestaurant[]>[] = [];

  if (platforms.includes('doordash')) {
    const ddUrl = cuisineQuery
      ? `${DOORDASH_BASE}/cuisine/${cuisineQuery}/near-me?location=${encodedLocation}`
      : `${DOORDASH_BASE}/food-delivery/${encodedLocation}`;
    scrapers.push(
      fetchPage(ddUrl).then(parseDoorDashResults).catch(() => [])
    );
  }

  if (platforms.includes('ubereats')) {
    const ueUrl = cuisineQuery
      ? `${UBEREATS_BASE}/category/${cuisineQuery}?diningMode=DELIVERY&pl=JTdCJTIyYWRkcmVzcyUyMiUzQSUyMiR7bG9jYXRpb259JTIyJTdE`
      : `${UBEREATS_BASE}/near-me/food-delivery?diningMode=DELIVERY&pl=${encodedLocation}`;
    scrapers.push(
      fetchPage(ueUrl).then(parseUberEatsResults).catch(() => [])
    );
  }

  if (platforms.includes('grubhub')) {
    const ghUrl = cuisineQuery
      ? `${GRUBHUB_BASE}/delivery/${cuisineQuery}/${encodedLocation}`
      : `${GRUBHUB_BASE}/delivery/food/${encodedLocation}`;
    scrapers.push(
      fetchPage(ghUrl).then(parseGrubhubResults).catch(() => [])
    );
  }

  const results = await Promise.allSettled(scrapers);
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value);
    }
  }

  return allResults.slice(0, limit);
}

/**
 * Get detailed restaurant info including menu items.
 */
export async function getRestaurantDetail(
  platform: string,
  storeId: string,
): Promise<RestaurantDetail> {
  let url: string;
  let basePlatform: string;

  switch (platform.toLowerCase()) {
    case 'doordash':
      url = `${DOORDASH_BASE}/store/${storeId}`;
      basePlatform = 'doordash';
      break;
    case 'ubereats':
      url = `${UBEREATS_BASE}/store/${storeId}`;
      basePlatform = 'ubereats';
      break;
    case 'grubhub':
      url = `${GRUBHUB_BASE}/restaurant/${storeId}`;
      basePlatform = 'grubhub';
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}. Use doordash, ubereats, or grubhub.`);
  }

  const html = await fetchPage(url);

  // Extract restaurant name
  const titleMatch = html.match(/<h1[^>]*>([^<]+)/i);
  const name = titleMatch ? cleanText(titleMatch[1]) : storeId.replace(/-/g, ' ');

  // Description
  const descMatch = html.match(/class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i) ||
                    html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  const description = descMatch ? cleanText(descMatch[1]).slice(0, 1000) : null;

  // Rating
  let rating: number | null = null;
  const ratingMatch = html.match(/([\d.]+)\s*(?:star|\(|★)/i);
  if (ratingMatch) rating = parseFloat(ratingMatch[1]);

  // Review count
  let reviewCount: number | null = null;
  const rcMatch = html.match(/(\d[\d,]*)\+?\s*(?:rating|review)/i);
  if (rcMatch) reviewCount = parseInt(rcMatch[1].replace(/,/g, ''));

  // Price level
  const priceLevelMatch = html.match(/(\${1,4})\s*·/);
  const priceLevel = priceLevelMatch ? priceLevelMatch[1] : null;

  // Delivery fee
  let deliveryFee: number | null = null;
  const feeMatch = html.match(/\$(\d+\.?\d*)\s*delivery\s*fee/i);
  if (feeMatch) deliveryFee = parseFloat(feeMatch[1]);
  if (html.toLowerCase().includes('free delivery')) deliveryFee = 0;

  // Delivery time
  const timeMatch = html.match(/(\d+[-–]\d+\s*min|\d+\s*min)/i);
  const time = timeMatch ? parseDeliveryTime(timeMatch[1]) : { min: null, max: null };

  // Cuisine
  const cuisineTags: string[] = [];
  const tagMatches = html.matchAll(/class="[^"]*tag[^"]*"[^>]*>([^<]{2,30})<\/(?:span|a|div)/gi);
  for (const tm of tagMatches) {
    const tag = cleanText(tm[1]);
    if (tag && !cuisineTags.includes(tag)) cuisineTags.push(tag);
  }

  // Address
  const addressMatch = html.match(/class="[^"]*address[^"]*"[^>]*>([^<]+)/i) ||
                       html.match(/<address[^>]*>([^<]+)/i);
  const address = addressMatch ? cleanText(addressMatch[1]) : null;

  // Phone
  const phoneMatch = html.match(/tel:([+\d()-\s]+)/);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;

  // Hours
  const hours: Record<string, string> = {};
  const hoursMatches = html.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[:\s]*([\d:]+\s*(?:AM|PM)\s*[-–]\s*[\d:]+\s*(?:AM|PM))/gi);
  for (const hm of hoursMatches) {
    hours[hm[1]] = hm[2].trim();
  }

  // Menu items
  const menuItems = parseMenuItems(html, basePlatform);
  const menuCategories = [...new Set(menuItems.map(m => m.category))];

  // Service fee
  let serviceFee: number | null = null;
  const sfMatch = html.match(/(\d+\.?\d*)%?\s*service\s*fee/i);
  if (sfMatch) serviceFee = parseFloat(sfMatch[1]);

  // Small order fee
  let smallOrderFee: number | null = null;
  const soMatch = html.match(/\$(\d+\.?\d*)\s*small\s*order/i);
  if (soMatch) smallOrderFee = parseFloat(soMatch[1]);

  // Min order
  let minOrder: number | null = null;
  const moMatch = html.match(/\$(\d+\.?\d*)\s*(?:minimum|min\.?\s*order)/i);
  if (moMatch) minOrder = parseFloat(moMatch[1]);

  // Pickup
  const acceptsPickup = html.toLowerCase().includes('pickup') || html.toLowerCase().includes('pick up');

  // DashPass / subscription eligibility
  const dashPassEligible = html.toLowerCase().includes('dashpass') ||
                           html.toLowerCase().includes('uber one') ||
                           html.toLowerCase().includes('grubhub+');

  return {
    id: storeId,
    name,
    cuisine: cuisineTags.slice(0, 10),
    rating,
    review_count: reviewCount,
    price_level: priceLevel,
    delivery_fee: deliveryFee,
    delivery_time_min: time.min,
    delivery_time_max: time.max,
    distance_miles: null,
    address,
    image_url: null,
    platform: basePlatform,
    url,
    is_promoted: false,
    offers: [],
    description,
    phone,
    hours,
    menu_categories: menuCategories,
    menu_items: menuItems.slice(0, 100),
    service_fee_pct: serviceFee,
    small_order_fee: smallOrderFee,
    min_order: minOrder,
    accepts_pickup: acceptsPickup,
    dash_pass_eligible: dashPassEligible,
  };
}

/**
 * Compare prices for a menu item across delivery platforms.
 * Searches each platform for the restaurant and finds matching items.
 */
export async function comparePrices(
  restaurant: string,
  location: string,
  itemName?: string,
): Promise<PriceComparison[]> {
  const platforms = ['doordash', 'ubereats', 'grubhub'];
  const comparisons: PriceComparison[] = [];

  // Search each platform for the restaurant
  const searchPromises = platforms.map(async (platform) => {
    try {
      const results = await searchRestaurants(location, undefined, [platform], 10);
      // Find best match by name
      const match = results.find(r =>
        r.name.toLowerCase().includes(restaurant.toLowerCase()) ||
        restaurant.toLowerCase().includes(r.name.toLowerCase())
      );
      if (!match) return null;

      // Get detail with menu
      const detail = await getRestaurantDetail(platform, match.id);
      return { platform, detail, restaurant: match };
    } catch {
      return null;
    }
  });

  const detailResults = await Promise.allSettled(searchPromises);
  const validResults = detailResults
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  if (validResults.length === 0) {
    return comparisons;
  }

  // If itemName specified, find that item across platforms
  // Otherwise compare top popular items
  const itemsToCompare: string[] = [];
  if (itemName) {
    itemsToCompare.push(itemName);
  } else {
    // Collect popular / first items from each platform
    for (const result of validResults) {
      const popular = result.detail.menu_items
        .filter((m: MenuItem) => m.popular)
        .slice(0, 3);
      const first = result.detail.menu_items.slice(0, 3);
      for (const item of [...popular, ...first]) {
        if (!itemsToCompare.includes(item.name)) {
          itemsToCompare.push(item.name);
        }
      }
    }
  }

  for (const targetItem of itemsToCompare.slice(0, 10)) {
    const comparison: PriceComparison = {
      item_name: targetItem,
      restaurant_name: restaurant,
      prices: [],
      best_value: null,
      price_spread: null,
    };

    for (const result of validResults) {
      // Find matching menu item (fuzzy match)
      const menuItem = result.detail.menu_items.find((m: MenuItem) =>
        m.name.toLowerCase().includes(targetItem.toLowerCase()) ||
        targetItem.toLowerCase().includes(m.name.toLowerCase())
      );

      const itemPrice = menuItem?.price || null;
      const deliveryFee = result.restaurant.delivery_fee;
      const serviceFee = result.detail.service_fee_pct;

      let estimatedTotal: number | null = null;
      if (itemPrice !== null) {
        let total = itemPrice;
        if (deliveryFee !== null) total += deliveryFee;
        if (serviceFee !== null) total += (itemPrice * serviceFee / 100);
        estimatedTotal = Math.round(total * 100) / 100;
      }

      comparison.prices.push({
        platform: result.platform,
        price: itemPrice,
        delivery_fee: deliveryFee,
        service_fee_pct: serviceFee,
        estimated_total: estimatedTotal,
        delivery_time_min: result.restaurant.delivery_time_min,
        url: result.detail.url,
      });
    }

    // Determine best value
    const validPrices = comparison.prices.filter(p => p.estimated_total !== null);
    if (validPrices.length > 0) {
      validPrices.sort((a, b) => (a.estimated_total || 999) - (b.estimated_total || 999));
      comparison.best_value = validPrices[0].platform;
      if (validPrices.length > 1) {
        comparison.price_spread = Math.round(
          ((validPrices[validPrices.length - 1].estimated_total! - validPrices[0].estimated_total!) * 100)
        ) / 100;
      }
    }

    if (comparison.prices.length > 0) {
      comparisons.push(comparison);
    }
  }

  return comparisons;
}

/**
 * Analyze delivery fees across restaurants in a location.
 */
export async function analyzeDeliveryFees(
  location: string,
  platform: string = 'doordash',
): Promise<DeliveryFeeAnalysis> {
  const restaurants = await searchRestaurants(location, undefined, [platform], 50);

  const fees = restaurants
    .map(r => r.delivery_fee)
    .filter((f): f is number => f !== null);

  const sortedFees = [...fees].sort((a, b) => a - b);

  const avg = fees.length > 0
    ? Math.round((fees.reduce((a, b) => a + b, 0) / fees.length) * 100) / 100
    : null;

  const median = sortedFees.length > 0
    ? sortedFees[Math.floor(sortedFees.length / 2)]
    : null;

  const freeDeliveryCount = fees.filter(f => f === 0).length;
  const freeDeliveryPct = fees.length > 0
    ? Math.round((freeDeliveryCount / fees.length) * 100)
    : null;

  return {
    location,
    platform,
    restaurants_sampled: restaurants.length,
    avg_delivery_fee: avg,
    median_delivery_fee: median,
    min_delivery_fee: sortedFees.length > 0 ? sortedFees[0] : null,
    max_delivery_fee: sortedFees.length > 0 ? sortedFees[sortedFees.length - 1] : null,
    free_delivery_pct: freeDeliveryPct,
    fee_distribution: {
      free: fees.filter(f => f === 0).length,
      under_3: fees.filter(f => f > 0 && f < 3).length,
      range_3_5: fees.filter(f => f >= 3 && f < 5).length,
      range_5_8: fees.filter(f => f >= 5 && f < 8).length,
      over_8: fees.filter(f => f >= 8).length,
    },
    avg_service_fee_pct: null, // Would require detail page scraping
    avg_small_order_fee: null,
  };
}

/**
 * Aggregate ratings for a restaurant across platforms.
 */
export async function aggregateRatings(
  restaurant: string,
  location: string,
): Promise<RatingAggregation> {
  const platforms = ['doordash', 'ubereats', 'grubhub'];
  const ratings: RatingAggregation['ratings'] = [];

  const searchPromises = platforms.map(async (platform) => {
    try {
      const results = await searchRestaurants(location, undefined, [platform], 15);
      const match = results.find(r =>
        r.name.toLowerCase().includes(restaurant.toLowerCase()) ||
        restaurant.toLowerCase().includes(r.name.toLowerCase())
      );
      if (match) {
        return {
          platform,
          rating: match.rating,
          review_count: match.review_count,
          url: match.url,
        };
      }
      return null;
    } catch {
      return null;
    }
  });

  const results = await Promise.allSettled(searchPromises);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      ratings.push(result.value);
    }
  }

  const validRatings = ratings.filter(r => r.rating !== null);
  const avgRating = validRatings.length > 0
    ? Math.round((validRatings.reduce((sum, r) => sum + r.rating!, 0) / validRatings.length) * 10) / 10
    : null;

  const totalReviews = ratings.reduce((sum, r) => sum + (r.review_count || 0), 0);

  let bestRatedPlatform: string | null = null;
  if (validRatings.length > 0) {
    validRatings.sort((a, b) => b.rating! - a.rating!);
    bestRatedPlatform = validRatings[0].platform;
  }

  return {
    restaurant_name: restaurant,
    ratings,
    avg_rating: avgRating,
    total_reviews: totalReviews,
    best_rated_platform: bestRatedPlatform,
  };
}
