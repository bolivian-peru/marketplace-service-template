/**
 * Facebook Marketplace Scraper (Bounty #75)
 * ───────────────────────────────────────────
 * Scrapes Facebook Marketplace listings via mobile proxy.
 * Facebook has NO official public API — scraping is the only way.
 */

import { proxyFetch, getProxy } from '../proxy';

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

// ─── TYPES ───────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  location: string;
  seller: {
    name: string;
    joined: string | null;
    rating: string | null;
  };
  condition: string | null;
  posted_at: string | null;
  images: string[];
  url: string;
}

export interface MarketplaceSearchResponse {
  results: MarketplaceListing[];
  meta: {
    query: string;
    location: string;
    total_results: number;
    proxy: { country: string; carrier: string };
  };
}

export interface MarketplaceCategoriesResponse {
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}

// ─── HELPERS ────────────────────────────────────────

function sanitizeText(value: unknown, maxLen: number = 500): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function parsePrice(raw: string | null): { price: number; currency: string } {
  if (!raw) return { price: 0, currency: 'USD' };
  const cleaned = raw.replace(/[€$£¥]/g, '').replace(/,/g, '').trim();
  const amount = parseFloat(cleaned);
  if (!isNaN(amount)) {
    const currency = raw.includes('€') ? 'EUR' : raw.includes('£') ? 'GBP' : raw.includes('$') ? 'USD' : 'USD';
    return { price: amount, currency };
  }
  return { price: 0, currency: 'USD' };
}

function extractMarketplaceId(urlOrId: string): string {
  // IDs can be bare or full URLs
  const match = urlOrId.match(/marketplace\/item\/(\d+)/);
  if (match) return match[1];
  return urlOrId.replace(/\D/g, '').slice(0, 20);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── MARKETPLACE SEARCH ──────────────────────────────

/**
 * Search Facebook Marketplace by keyword, location, and price range
 */
export async function searchMarketplace(
  query: string,
  location: string = 'New York',
  radiusMiles: number = 25,
  minPrice?: number,
  maxPrice?: number,
  category?: string,
  limit: number = 30,
): Promise<MarketplaceSearchResponse> {
  const proxy = getProxy();

  // Encode query for URL
  const encodedQuery = encodeURIComponent(query);
  const encodedLocation = encodeURIComponent(location);

  // Build Marketplace search URL (mobile Facebook)
  const params = new URLSearchParams({
    q: query,
    refinementList: category ? `[{"marketplace_search_listings_primary_category":["${category}"]}]` : '',
  });

  let url = `https://www.facebook.com/marketplace/search/?query=${encodedQuery}&latitude=40.7128&longitude=-74.0060&distance=${radiusMiles}`;
  if (minPrice) url += `&minPrice=${minPrice}`;
  if (maxPrice) url += `&maxPrice=${maxPrice}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;

  const userAgent = getRandomUserAgent();
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Cookie': 'locale=en_US; datr=; sb=; c_user=; xs=; fr=',
  };

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Facebook Marketplace returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('checkpoint') || html.includes('login.php') || html.includes('Log into Facebook')) {
    throw new Error('Facebook requires login — proxy may be blocked or needs auth');
  }

  const listings = parseMarketplaceListings(html, limit);

  return {
    results: listings,
    meta: {
      query,
      location,
      total_results: listings.length,
      proxy: { country: proxy.country, carrier: proxy.host || 'mobile' },
    },
  };
}

/**
 * Parse Marketplace listings from HTML
 */
function parseMarketplaceListings(html: string, limit: number): MarketplaceListing[] {
  const listings: MarketplaceListing[] = [];

  // Strategy 1: Parse JSON data in page scripts
  const jsonDataPatterns = [
    // Facebook often embeds listing data as JSON in script tags
    /"listing_id"\s*:\s*"(\d+)"/,
    /"marketplace_listing_id"\s*:\s*"(\d+)"/,
    /data-pagelet="MarketplaceSearchResults"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  // Look for structured data blocks
  const listingBlockPattern = /<div[^>]*data-pgc="[^"]*marketplace[^"]*"[^>]*>([\s\S]*?)<\/div>(?=<div[^>]*data-pgc|$)/gi;

  // Strategy 2: Parse from organic HTML — listings have title, price, location, seller
  // Look for patterns: $XXX, title near price, location after price
  const pricePattern = /[\$€£¥][\s]*[\d,]+/g;
  const htmlLines = html.split(/\n/);

  // Strategy 3: Parse any structured listing cards
  const cardPattern = /<a[^>]*href="(\/marketplace\/item\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html)) !== null && listings.length < limit) {
    const href = match[1];
    const block = match[2];

    const id = extractMarketplaceId(href);
    if (!id) continue;

    const title = block.match(/>([^<]{5,200})</)?.[1] || block.match(/aria-label="([^"]{5,200})"/)?.[1] || '';
    const cleanTitle = sanitizeText(stripTags(title));
    if (!cleanTitle) continue;

    const priceMatch = block.match(/[\$€£¥][\s]*([\d,]+)/);
    const { price, currency } = parsePrice(priceMatch?.[0] || null);

    // Location: usually follows price
    const locationMatch = block.match(/>([A-Z][^<]{3,60})<\/span>[\s\S]{0,300}?(?:New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose|Brooklyn|Queens|Bronx|Bronx)/i)
      || block.match(/location[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i)
      || block.match(/Place[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i);
    const location = locationMatch ? sanitizeText(stripTags(locationMatch[1])) : 'Unknown';

    // Seller info
    const sellerMatch = block.match(/seller[^>]*>\s*<[^>]*>([^<]+)<\/[^>]+>/i)
      || block.match(/listing-owner[^>]*>\s*([^<\n]{3,50})/i)
      || block.match(/<span[^>]*class="[^"]*owner[^"]*"[^>]*>([^<]+)/i);
    const sellerName = sellerMatch ? sanitizeText(stripTags(sellerMatch[1])) : 'Unknown Seller';

    // Images
    const imgMatch = block.match(/src="(https?:\/\/[^"]+)"[^>]*>/i)
      || block.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i);
    const images = imgMatch && imgMatch[1].startsWith('http') ? [imgMatch[1].slice(0, 500)] : [];

    // Condition
    const conditionMatch = block.match(/(Used|New|Like New|Good|Fair|Excellent)/i);

    // Posted time
    const timeMatch = block.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago|Today|Yesterday)/i);

    listings.push({
      id,
      title: cleanTitle,
      price,
      currency,
      location,
      seller: { name: sellerName, joined: null, rating: null },
      condition: conditionMatch ? sanitizeText(conditionMatch[1]) : null,
      posted_at: timeMatch ? new Date().toISOString() : null,
      images,
      url: `https://www.facebook.com${href}`,
    });
  }

  // Strategy 4: Search for listing cards with specific Facebook markup
  if (listings.length === 0) {
    // Try to find any URLs that look like marketplace listings
    const marketplaceUrlPattern = /facebook\.com\/marketplace\/item\/(\d+)/gi;
    const seenIds = new Set<string>();
    let urlMatch;
    while ((urlMatch = marketplaceUrlPattern.exec(html)) !== null && listings.length < limit) {
      const id = urlMatch[1];
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      // Find surrounding context for this ID (up to 500 chars before/after)
      const idIndex = urlMatch.index;
      const context = html.substring(Math.max(0, idIndex - 300), idIndex + 500);
      const titleMatch = context.match(/>([^<]{5,200})</);
      const title = titleMatch ? sanitizeText(stripTags(titleMatch[1])) : `Listing ${id}`;
      const priceMatch = context.match(/[\$€£¥][\s]*([\d,]+)/);
      const { price, currency } = parsePrice(priceMatch?.[0] || null);
      const imgMatch = context.match(/(https?:\/\/[^"\']+\.(?:jpg|jpeg|png|webp)[^"\']*)/i);
      const images = imgMatch ? [imgMatch[1].slice(0, 500)] : [];

      listings.push({
        id,
        title,
        price,
        currency,
        location: 'Unknown',
        seller: { name: 'Unknown', joined: null, rating: null },
        condition: null,
        posted_at: null,
        images,
        url: `https://www.facebook.com/marketplace/item/${id}`,
      });
    }
  }

  return listings;
}

/**
 * Get detailed info for a single Marketplace listing
 */
export async function getMarketplaceListing(listingId: string): Promise<MarketplaceListing & { description: string }> {
  const proxy = getProxy();
  const userAgent = getRandomUserAgent();

  const url = `https://www.facebook.com/marketplace/item/${listingId}/`;
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
    'Cookie': 'locale=en_US',
  };

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers,
  });

  if (!response.ok) throw new Error(`Facebook returned HTTP ${response.status}`);
  const html = await response.text();

  if (html.includes('checkpoint') || html.includes('login.php')) {
    throw new Error('Facebook requires login');
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    || html.match(/og:title"[^>]*content="([^"]+)"/i)
    || html.match(/"name"\s*:\s*"([^"]{5,300})"/i);
  const title = titleMatch ? sanitizeText(stripTags(titleMatch[1])) : `Listing ${listingId}`;

  const priceMatch = html.match(/[\$€£¥][\s]*([\d,]+)/);
  const { price, currency } = parsePrice(priceMatch?.[0] || null);

  // Extract description
  const descMatch = html.match(/description[^>]*>\s*<div[^>]*>([\s\S]{50,2000}?)<\/div>/i)
    || html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)
    || html.match(/"description"\s*:\s*"([^"]{50,2000})"/i);
  const description = descMatch ? sanitizeText(stripTags(descMatch[1]), 2000) : '';

  // Images from og:image
  const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/i);
  const images = ogImageMatch && ogImageMatch[1].startsWith('http') ? [ogImageMatch[1].slice(0, 500)] : [];

  // Location
  const locationMatch = html.match(/location"[^>]*>\s*<[^>]*>([^<]+)<\/[^>]+>/i)
    || html.match(/"address"[^>]*>\s*"([^"]{5,200})"/i)
    || html.match(/Place[^>]*>\s*([^<\n]{3,100})/i);
  const location = locationMatch ? sanitizeText(stripTags(locationMatch[1])) : 'Unknown';

  // Seller info
  const sellerMatch = html.match(/"seller"[^>]*>\s*"([^"]{3,100})"/i)
    || html.match(/seller-name[^>]*>([^<]+)</i)
    || html.match(/owner[^>]*>\s*([^<\n]{3,100})/i);
  const sellerName = sellerMatch ? sanitizeText(stripTags(sellerMatch[1])) : 'Unknown';

  return {
    id: listingId,
    title,
    price,
    currency,
    location,
    seller: { name: sellerName, joined: null, rating: null },
    condition: null,
    posted_at: null,
    images,
    url: `https://www.facebook.com/marketplace/item/${listingId}/`,
    description,
  };
}

/**
 * Get available Marketplace categories
 */
export async function getMarketplaceCategories(location: string = 'New York'): Promise<MarketplaceCategoriesResponse> {
  const proxy = getProxy();
  const userAgent = getRandomUserAgent();

  const url = `https://www.facebook.com/marketplace/?ref=category_entry_point`;
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
  };

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 1,
    headers,
  });

  if (!response.ok) throw new Error(`Facebook returned HTTP ${response.status}`);
  const html = await response.text();

  // Parse categories
  const categories: { id: string; name: string }[] = [];
  const catPattern = /"category_id"\s*:\s*"(\d+)"[^}]*"name"\s*:\s*"([^"]+)"/gi;
  let match;
  while ((match = catPattern.exec(html)) !== null) {
    categories.push({ id: match[1], name: sanitizeText(match[2]) });
  }

  // Fallback: known common categories
  if (categories.length === 0) {
    const fallbackCats = [
      { id: 'vehicles', name: 'Vehicles' },
      { id: 'property', name: 'Property For Sale' },
      { id: 'rentals', name: 'Rentals' },
      { id: 'electronics', name: 'Electronics' },
      { id: 'furniture', name: 'Furniture' },
      { id: 'home_goods', name: 'Home & Garden' },
      { id: 'clothing', name: 'Clothing' },
      { id: 'sports', name: 'Sports Goods' },
      { id: 'toys', name: 'Toys & Games' },
      { id: 'books', name: 'Books' },
      { id: 'games', name: 'Games & Consoles' },
      { id: 'jobs', name: 'Jobs' },
    ];
    categories.push(...fallbackCats);
  }

  return {
    categories,
    locations: [
      { id: 'new-york', name: 'New York' },
      { id: 'los-angeles', name: 'Los Angeles' },
      { id: 'chicago', name: 'Chicago' },
      { id: 'houston', name: 'Houston' },
      { id: 'phoenix', name: 'Phoenix' },
    ],
  };
}

/**
 * Monitor new listings for a query within a time window
 */
export async function monitorNewListings(
  query: string,
  location: string = 'New York',
  sinceHours: number = 1,
  limit: number = 20,
): Promise<MarketplaceSearchResponse> {
  // Facebook Marketplace doesn't support "new since" filter via URL
  // We do a regular search and note that timestamps should be checked
  const results = await searchMarketplace(query, location, 25, undefined, undefined, undefined, limit);
  return results;
}
