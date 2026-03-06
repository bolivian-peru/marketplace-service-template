/**
 * Facebook Marketplace Monitor API (Bounty #75)
 * ──────────────────────────────────────────────
 * Scrapes Facebook Marketplace listings via mobile carrier proxies.
 * Uses Facebook's internal GraphQL API (same as mobile app) with
 * mobile user-agent + carrier IP to bypass bot detection.
 *
 * Mobile proxies are REQUIRED: Facebook's trust model assigns the highest
 * trust to 4G/5G carrier IPs. Datacenter IPs are blocked immediately.
 * Even residential proxies get flagged under sustained scraping.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  location: string;
  condition: string | null;
  description: string | null;
  category: string | null;
  seller: {
    name: string;
    joined: string | null;
    rating: string | null;
    itemsSold: number | null;
  };
  images: string[];
  listingUrl: string;
  postedAt: string | null;
  isDeliveryAvailable: boolean;
}

export interface MarketplaceSearchResult {
  results: MarketplaceListing[];
  totalFound: number;
  cursor: string | null;
  location: string;
  searchQuery: string;
}

export interface MarketplaceCategory {
  id: string;
  name: string;
  icon: string | null;
  listingCount: number | null;
  url: string;
}

// ─── HELPERS ────────────────────────────────────────

const FB_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21C66 [FBAN/FBIOS;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/17.2;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]';

// Facebook's internal DTI tokens vary — these are stable public values
const FB_GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

// Location → latitude/longitude mapping for common US cities
const LOCATION_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  'new york': { lat: 40.7128, lng: -74.006, name: 'New York, NY' },
  'new york, ny': { lat: 40.7128, lng: -74.006, name: 'New York, NY' },
  'los angeles': { lat: 34.0522, lng: -118.2437, name: 'Los Angeles, CA' },
  'chicago': { lat: 41.8781, lng: -87.6298, name: 'Chicago, IL' },
  'houston': { lat: 29.7604, lng: -95.3698, name: 'Houston, TX' },
  'phoenix': { lat: 33.4484, lng: -112.074, name: 'Phoenix, AZ' },
  'philadelphia': { lat: 39.9526, lng: -75.1652, name: 'Philadelphia, PA' },
  'san antonio': { lat: 29.4241, lng: -98.4936, name: 'San Antonio, TX' },
  'san diego': { lat: 32.7157, lng: -117.1611, name: 'San Diego, CA' },
  'dallas': { lat: 32.7767, lng: -96.797, name: 'Dallas, TX' },
  'san francisco': { lat: 37.7749, lng: -122.4194, name: 'San Francisco, CA' },
  'austin': { lat: 30.2672, lng: -97.7431, name: 'Austin, TX' },
  'seattle': { lat: 47.6062, lng: -122.3321, name: 'Seattle, WA' },
  'miami': { lat: 25.7617, lng: -80.1918, name: 'Miami, FL' },
  'boston': { lat: 42.3601, lng: -71.0589, name: 'Boston, MA' },
};

function getCoords(location: string): { lat: number; lng: number; name: string } {
  const key = location.toLowerCase().trim();
  return LOCATION_COORDS[key] ?? { lat: 37.7749, lng: -122.4194, name: location };
}

function radiusToMeters(radiusStr: string): number {
  const m = radiusStr.match(/(\d+)(mi|km)?/i);
  if (!m) return 40000;
  const n = parseInt(m[1]);
  return m[2]?.toLowerCase() === 'km' ? n * 1000 : n * 1609;
}

function parsePriceText(text: string): number | null {
  if (!text) return null;
  const clean = text.replace(/[^0-9.]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ─── FACEBOOK GRAPHQL API ───────────────────────────

/**
 * Search Facebook Marketplace via their GraphQL API.
 * Uses the same endpoint the mobile FB app uses.
 */
async function graphqlMarketplaceSearch(
  query: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  minPrice?: number,
  maxPrice?: number,
  cursor?: string,
  limit: number = 24,
): Promise<{ items: any[]; cursor: string | null }> {
  const variables = JSON.stringify({
    buyLocation: { latitude: lat, longitude: lng },
    contextualData: null,
    count: limit,
    cursor: cursor ?? null,
    params: {
      commerce_search_and_reco_params: {
        commerce_boost_type: null,
        filter_location_latitude: lat,
        filter_location_longitude: lng,
        filter_price_lower_bound: minPrice ? minPrice * 100 : null,
        filter_price_upper_bound: maxPrice ? maxPrice * 100 : null,
        filter_radius_km: Math.round(radiusMeters / 1000),
        query,
        sort_by: 'CREATION_TIME',
      },
    },
    scale: 2,
    query,
    topicPageParams: {
      location: { latitude: lat, longitude: lng },
    },
  });

  const body = new URLSearchParams({
    av: '0',
    __user: '0',
    __a: '1',
    __req: '1',
    __hs: '19881.HYP:comet_pkg.2.1..2.1',
    dpr: '2',
    __ccg: 'EXCELLENT',
    __rev: '1019174539',
    __s: 'c9p39e:tn9c1o:wg0fj3',
    __hsi: '7448812345678901234',
    __comet_req: '15',
    fb_dtsg: '',
    jazoest: '',
    lsd: 'AVq-mZV3bJk',
    __spin_r: '1019174539',
    __spin_b: 'trunk',
    __spin_t: '1740000000',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'MarketplaceSearchContentContainerQuery',
    variables,
    server_timestamps: 'true',
    doc_id: '7041236395975617',
  });

  const resp = await proxyFetch(FB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': FB_MOBILE_UA,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.facebook.com',
      'Referer': `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`,
      'X-FB-Friendly-Name': 'MarketplaceSearchContentContainerQuery',
      'X-FB-LSD': 'AVq-mZV3bJk',
    },
    body: body.toString(),
    timeoutMs: 30000,
  });

  if (!resp.ok) {
    if (resp.status === 400) throw new Error('Facebook rejected the GraphQL request — may need fresh session tokens');
    if (resp.status === 429) throw new Error('Rate limited by Facebook — retry after 60 seconds');
    throw new Error(`Facebook GraphQL returned ${resp.status}`);
  }

  const text = await resp.text();

  // Facebook sometimes returns multiple JSON objects on separate lines
  const lines = text.split('\n').filter(l => l.trim().startsWith('{'));
  if (!lines.length) throw new Error('Empty response from Facebook GraphQL');

  let data: any;
  for (const line of lines) {
    try { data = JSON.parse(line); break; } catch { continue; }
  }
  if (!data) throw new Error('Failed to parse Facebook GraphQL response');

  if (data.errors) throw new Error(`Facebook GraphQL error: ${data.errors[0]?.message || 'unknown'}`);

  // Navigate response path
  const edges =
    data?.data?.marketplace_search?.feed_units?.edges ??
    data?.data?.viewer?.marketplace_feed_stories?.edges ??
    [];

  const cursor_next: string | null =
    data?.data?.marketplace_search?.feed_units?.page_info?.end_cursor ??
    data?.data?.viewer?.marketplace_feed_stories?.page_info?.end_cursor ??
    null;

  return { items: edges, cursor: cursor_next };
}

function parseGraphQLListing(edge: any): MarketplaceListing | null {
  try {
    const node = edge?.node?.listing ?? edge?.node ?? edge;
    if (!node?.id) return null;

    const id = String(node.id);
    const title = cleanText(node.marketplace_listing_title || node.name || '');
    const priceText = node.listing_price?.amount_with_offset_in_currency || node.listing_price?.formatted_amount || '';
    const price = parsePriceText(priceText);
    const currency = node.listing_price?.currency || 'USD';

    const loc =
      node.location?.reverse_geocode?.city_page?.display_name ||
      node.location?.reverse_geocode?.city ||
      node.location_text?.text ||
      '';

    const images: string[] = [];
    if (node.primary_listing_photo?.image?.uri) images.push(node.primary_listing_photo.image.uri);
    if (node.listing_photos) {
      for (const p of node.listing_photos) {
        if (p?.image?.uri) images.push(p.image.uri);
      }
    }

    const seller = node.marketplace_listing_seller || node.story?.comet_sections?.actor_photo?.story?.actors?.[0] || {};

    return {
      id,
      title,
      price,
      currency,
      location: cleanText(loc),
      condition: cleanText(node.condition_display_name?.text || node.condition || null),
      description: cleanText(node.redacted_description?.text || node.description?.text || null),
      category: cleanText(node.category_name || node.marketplace_listing_category?.name || null),
      seller: {
        name: cleanText(seller.name || seller.display_name || 'Private Seller'),
        joined: seller.marketplace_join_date || null,
        rating: seller.seller_rating ? String(seller.seller_rating) : null,
        itemsSold: seller.marketplace_items_sold_count ?? null,
      },
      images: images.slice(0, 5),
      listingUrl: `https://www.facebook.com/marketplace/item/${id}/`,
      postedAt: node.creation_time
        ? new Date(node.creation_time * 1000).toISOString()
        : node.listing_update_time
          ? new Date(node.listing_update_time * 1000).toISOString()
          : null,
      isDeliveryAvailable: node.delivery_types?.includes('SHIPPING') ?? false,
    };
  } catch {
    return null;
  }
}

// ─── FALLBACK: HTML SCRAPING ─────────────────────────

async function htmlMarketplaceSearch(
  query: string,
  location: string,
): Promise<{ items: MarketplaceListing[]; cursor: null }> {
  const url = `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`;

  const resp = await proxyFetch(url, {
    headers: {
      'User-Agent': FB_MOBILE_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
    timeoutMs: 30000,
  });

  if (resp.status === 302 || resp.status === 301) {
    throw new Error('Facebook redirected to login page — mobile proxy needed for auth-free access');
  }

  if (!resp.ok) throw new Error(`Facebook marketplace search returned ${resp.status}`);

  const html = await resp.text();

  // Extract JSON from __NEXT_DATA__ or window.__data__
  const jsonMatches = [
    html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/),
    html.match(/window\.__data\s*=\s*(\{[\s\S]*?\});/),
    html.match(/"marketplace_feed":\{[\s\S]*?\}/),
  ];

  // Try to extract embedded listing data from page JSON blobs
  const listingRegex = /"id":"(\d{15,18})".*?"marketplace_listing_title":"([^"]+)".*?"amount_with_offset_in_currency":"([^"]+)"/g;
  const items: MarketplaceListing[] = [];
  let match: RegExpExecArray | null;

  while ((match = listingRegex.exec(html)) !== null && items.length < 20) {
    items.push({
      id: match[1],
      title: cleanText(match[2]),
      price: parsePriceText(match[3]),
      currency: 'USD',
      location,
      condition: null,
      description: null,
      category: null,
      seller: { name: 'Private Seller', joined: null, rating: null, itemsSold: null },
      images: [],
      listingUrl: `https://www.facebook.com/marketplace/item/${match[1]}/`,
      postedAt: null,
      isDeliveryAvailable: false,
    });
  }

  return { items, cursor: null };
}

// ─── LISTING DETAIL ─────────────────────────────────

/**
 * Fetch individual listing details via OG meta tags (public endpoint).
 * Facebook's link preview data is accessible without auth.
 */
async function fetchListingDetail(listingId: string): Promise<MarketplaceListing | null> {
  const url = `https://www.facebook.com/marketplace/item/${listingId}/`;

  const resp = await proxyFetch(url, {
    headers: {
      'User-Agent': FB_MOBILE_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 25000,
  });

  if (!resp.ok) {
    if (resp.status === 404) throw new Error('Listing not found');
    throw new Error(`Facebook returned ${resp.status} for listing ${listingId}`);
  }

  const html = await resp.text();

  // Extract OG meta tags
  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || '';
  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] || '';
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '';

  // Extract structured data from JSON-LD if present
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let structured: any = null;
  if (jsonLd) {
    try { structured = JSON.parse(jsonLd[1]); } catch { /* skip */ }
  }

  // Price from structured data or OG description
  const priceMatch = ogDesc.match(/\$?([\d,]+)/);
  const price = priceMatch ? parsePriceText(priceMatch[1]) : null;

  const locationMatch = ogDesc.match(/(?:in|near|at)\s+([A-Z][a-z]+(?:,\s*[A-Z]{2})?)/);

  return {
    id: listingId,
    title: cleanText(ogTitle || structured?.name || ''),
    price: structured?.offers?.price ?? price,
    currency: structured?.offers?.priceCurrency || 'USD',
    location: cleanText(locationMatch?.[1] || structured?.offers?.availableAtOrFrom?.address?.addressLocality || ''),
    condition: structured?.itemCondition?.replace('https://schema.org/', '') || null,
    description: cleanText(ogDesc || structured?.description || ''),
    category: structured?.category || null,
    seller: {
      name: structured?.seller?.name || 'Private Seller',
      joined: null,
      rating: null,
      itemsSold: null,
    },
    images: ogImage ? [ogImage] : [],
    listingUrl: url,
    postedAt: structured?.datePosted || null,
    isDeliveryAvailable: false,
  };
}

// ─── CATEGORIES ─────────────────────────────────────

const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  { id: 'vehicles', name: 'Vehicles', icon: '🚗', listingCount: null, url: 'https://www.facebook.com/marketplace/category/vehicles/' },
  { id: 'electronics', name: 'Electronics', icon: '📱', listingCount: null, url: 'https://www.facebook.com/marketplace/category/electronics/' },
  { id: 'apparel', name: 'Clothing & Accessories', icon: '👗', listingCount: null, url: 'https://www.facebook.com/marketplace/category/apparel/' },
  { id: 'furniture', name: 'Furniture', icon: '🛋️', listingCount: null, url: 'https://www.facebook.com/marketplace/category/furniture/' },
  { id: 'home_goods', name: 'Home & Garden', icon: '🏡', listingCount: null, url: 'https://www.facebook.com/marketplace/category/home-goods/' },
  { id: 'sporting_goods', name: 'Sporting Goods', icon: '⚽', listingCount: null, url: 'https://www.facebook.com/marketplace/category/sporting-goods/' },
  { id: 'tools', name: 'Tools & Equipment', icon: '🔧', listingCount: null, url: 'https://www.facebook.com/marketplace/category/tools/' },
  { id: 'toys', name: 'Toys & Games', icon: '🎮', listingCount: null, url: 'https://www.facebook.com/marketplace/category/toys/' },
  { id: 'books', name: 'Books & Music', icon: '📚', listingCount: null, url: 'https://www.facebook.com/marketplace/category/books/' },
  { id: 'pets', name: 'Pet Supplies', icon: '🐾', listingCount: null, url: 'https://www.facebook.com/marketplace/category/pet-supplies/' },
  { id: 'baby_kids', name: 'Baby & Kids', icon: '👶', listingCount: null, url: 'https://www.facebook.com/marketplace/category/baby-kids/' },
  { id: 'jewelry', name: 'Jewelry', icon: '💍', listingCount: null, url: 'https://www.facebook.com/marketplace/category/jewelry/' },
  { id: 'bags', name: 'Bags & Luggage', icon: '👜', listingCount: null, url: 'https://www.facebook.com/marketplace/category/bags/' },
  { id: 'beauty', name: 'Health & Beauty', icon: '💄', listingCount: null, url: 'https://www.facebook.com/marketplace/category/health-beauty/' },
  { id: 'office', name: 'Office Supplies', icon: '📎', listingCount: null, url: 'https://www.facebook.com/marketplace/category/office-supplies/' },
  { id: 'free', name: 'Free Stuff', icon: '🆓', listingCount: null, url: 'https://www.facebook.com/marketplace/category/free/' },
  { id: 'antiques', name: 'Antiques & Collectibles', icon: '🏺', listingCount: null, url: 'https://www.facebook.com/marketplace/category/antiques/' },
  { id: 'musical', name: 'Musical Instruments', icon: '🎸', listingCount: null, url: 'https://www.facebook.com/marketplace/category/musical-instruments/' },
  { id: 'garden', name: 'Garden & Outdoor', icon: '🌱', listingCount: null, url: 'https://www.facebook.com/marketplace/category/garden/' },
  { id: 'classifieds', name: 'Classifieds', icon: '📋', listingCount: null, url: 'https://www.facebook.com/marketplace/category/classifieds/' },
];

// ─── PUBLIC API ─────────────────────────────────────

export interface SearchOptions {
  query: string;
  location: string;
  radius?: string;
  minPrice?: number;
  maxPrice?: number;
  cursor?: string;
  limit?: number;
}

export async function searchMarketplace(opts: SearchOptions): Promise<MarketplaceSearchResult> {
  const coords = getCoords(opts.location);
  const radiusM = radiusToMeters(opts.radius ?? '50mi');
  const limit = Math.min(opts.limit ?? 24, 50);

  let items: MarketplaceListing[] = [];
  let cursor: string | null = null;

  try {
    // Primary: GraphQL API (same endpoint as mobile app)
    const result = await graphqlMarketplaceSearch(
      opts.query, coords.lat, coords.lng, radiusM,
      opts.minPrice, opts.maxPrice, opts.cursor, limit,
    );
    items = result.items.map(parseGraphQLListing).filter(Boolean) as MarketplaceListing[];
    cursor = result.cursor;
  } catch (graphqlErr: any) {
    // Fallback: HTML scraping
    try {
      const fallback = await htmlMarketplaceSearch(opts.query, coords.name);
      items = fallback.items;
      cursor = null;
    } catch (htmlErr: any) {
      throw new Error(`Both search methods failed. GraphQL: ${graphqlErr.message}. HTML: ${htmlErr.message}`);
    }
  }

  return {
    results: items,
    totalFound: items.length,
    cursor,
    location: coords.name,
    searchQuery: opts.query,
  };
}

export async function getListingDetail(listingId: string): Promise<MarketplaceListing> {
  if (!/^\d{10,20}$/.test(listingId)) {
    throw new Error('Invalid listing ID: must be a numeric Facebook listing ID');
  }
  const listing = await fetchListingDetail(listingId);
  if (!listing) throw new Error('Failed to extract listing data');
  return listing;
}

export function getCategories(): MarketplaceCategory[] {
  return MARKETPLACE_CATEGORIES;
}

export async function getNewListings(
  query: string,
  location: string,
  sinceStr: string = '1h',
): Promise<MarketplaceListing[]> {
  // Parse "since" parameter: 1h, 30m, 2h, 24h, 1d
  const sinceMatch = sinceStr.match(/(\d+)(h|m|d)/i);
  const sinceMs = sinceMatch
    ? parseInt(sinceMatch[1]) * (sinceMatch[2].toLowerCase() === 'm' ? 60 : sinceMatch[2].toLowerCase() === 'd' ? 86400 : 3600) * 1000
    : 3600000;
  const sinceTs = Date.now() - sinceMs;

  // Fetch recent listings sorted by creation time
  const result = await searchMarketplace({ query, location, limit: 50 });

  // Filter by time if postedAt is available
  return result.results.filter(listing => {
    if (!listing.postedAt) return true; // include if no timestamp (can't filter)
    return new Date(listing.postedAt).getTime() >= sinceTs;
  });
}
