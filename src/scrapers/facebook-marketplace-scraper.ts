/**
 * Facebook Marketplace Monitor Scraper (Bounty #75)
 * ──────────────────────────────────────────────────
 * Scrapes Facebook Marketplace listings, pricing, and seller info
 * via mobile proxies.
 *
 * Facebook requires authentication for Marketplace data.
 * This scraper supports two modes:
 * 1. Authenticated: With FB session cookies → full listing data
 * 2. Public: Without auth → page metadata + title confirmation only
 *
 * Set FB_COOKIES env var with a valid Facebook session cookie string.
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
  seller: {
    name: string;
    profileUrl: string | null;
  };
  images: string[];
  url: string;
  category: string | null;
  postedAt: string | null;
  description: string | null;
}

export interface MarketplaceSearchResult {
  query: string;
  location: string;
  totalResults: number;
  listings: MarketplaceListing[];
}

// ─── ERROR CLASS ────────────────────────────────────

export class MarketplaceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceError';
  }

  get httpStatus(): number {
    switch (this.code) {
      case 'auth_required': return 403;
      case 'rate_limited': return 503;
      case 'captcha_detected': return 503;
      case 'not_found': return 404;
      case 'invalid_input': return 400;
      default: return 500;
    }
  }

  get shouldNotCharge(): boolean {
    return ['auth_required', 'rate_limited', 'captcha_detected', 'scrape_failed'].includes(this.code);
  }
}

// ─── CONSTANTS ──────────────────────────────────────

const FB_BASE = 'https://www.facebook.com';

function buildHeaders(cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Cache-Control': 'no-cache',
  };
  if (cookies) headers['Cookie'] = cookies;
  return headers;
}

// ─── HELPERS ────────────────────────────────────────

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/**
 * Parse listing data from Facebook's embedded JSON/HTML.
 * Facebook uses relay-style GraphQL data embedded in script tags.
 */
function parseListingsFromHtml(html: string): MarketplaceListing[] {
  const listings: MarketplaceListing[] = [];

  // Method 1: Find MarketplaceListing objects in script data
  const listingPattern = /"__typename":"MarketplaceListing"[\s\S]*?"listing_id":"(\d+)"[\s\S]*?"marketplace_listing_title":"([^"]*)"[\s\S]*?"amount":"(\d+)"/g;
  for (const match of html.matchAll(listingPattern)) {
    const [, id, title, amount] = match;
    if (id && !listings.some(l => l.id === id)) {
      listings.push({
        id,
        title: title.replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16))),
        price: parseInt(amount) / 100, // FB stores in cents
        currency: 'USD',
        location: '',
        condition: null,
        seller: { name: '', profileUrl: null },
        images: [],
        url: `${FB_BASE}/marketplace/item/${id}/`,
        category: null,
        postedAt: null,
        description: null,
      });
    }
  }

  // Method 2: Simpler regex for listing data
  if (listings.length === 0) {
    const simplePattern = /marketplace\/item\/(\d+)/g;
    const ids = new Set<string>();
    for (const match of html.matchAll(simplePattern)) {
      ids.add(match[1]);
    }
    for (const id of ids) {
      // Try to find title and price near this ID
      const context = html.slice(
        Math.max(0, html.indexOf(id) - 500),
        html.indexOf(id) + 500
      );
      const titleMatch = context.match(/"marketplace_listing_title":"([^"]*)"/);
      const priceMatch = context.match(/\$(\d[\d,]*)/);

      listings.push({
        id,
        title: titleMatch ? cleanText(titleMatch[1]) : '',
        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
        currency: 'USD',
        location: '',
        condition: null,
        seller: { name: '', profileUrl: null },
        images: [],
        url: `${FB_BASE}/marketplace/item/${id}/`,
        category: null,
        postedAt: null,
        description: null,
      });
    }
  }

  return listings;
}

// ─── SCRAPING FUNCTIONS ─────────────────────────────

/**
 * Search Facebook Marketplace listings
 */
export async function searchMarketplace(params: {
  query: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  limit?: number;
}): Promise<MarketplaceSearchResult> {
  if (!params.query) {
    throw new MarketplaceError('invalid_input', 'Search query is required');
  }

  const cookies = process.env.FB_COOKIES || '';
  const locationSlug = params.location
    ? encodeURIComponent(params.location.replace(/\s+/g, '-').toLowerCase())
    : 'marketplace';

  // Build search URL
  const searchParams = new URLSearchParams();
  searchParams.set('query', params.query);
  if (params.minPrice) searchParams.set('minPrice', String(params.minPrice));
  if (params.maxPrice) searchParams.set('maxPrice', String(params.maxPrice));
  if (params.category) searchParams.set('category', params.category);

  const url = `${FB_BASE}/marketplace/${locationSlug}/search/?${searchParams}`;

  console.log(`[FB-MARKETPLACE] Searching: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(cookies || undefined),
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    if (response.status === 403) throw new MarketplaceError('auth_required', 'Facebook blocked the request');
    if (response.status === 429) throw new MarketplaceError('rate_limited', 'Facebook rate limited this IP');
    throw new MarketplaceError('scrape_failed', `Facebook returned ${response.status}`);
  }

  const html = await response.text();

  // Check for login redirect
  if (html.includes('<title>Log into Facebook') || html.includes('login_form')) {
    if (!cookies) {
      throw new MarketplaceError('auth_required',
        'Facebook Marketplace requires authentication. Set FB_COOKIES env var with valid session cookies.');
    }
    throw new MarketplaceError('auth_required', 'Facebook session expired — refresh FB_COOKIES');
  }

  if (html.includes('captcha')) {
    throw new MarketplaceError('captcha_detected', 'Facebook CAPTCHA triggered');
  }

  const listings = parseListingsFromHtml(html);
  const limit = params.limit || 20;

  return {
    query: params.query,
    location: params.location || 'all',
    totalResults: listings.length,
    listings: listings.slice(0, limit),
  };
}

/**
 * Get details for a specific Marketplace listing
 */
export async function getMarketplaceListing(listingId: string): Promise<MarketplaceListing> {
  if (!listingId) throw new MarketplaceError('invalid_input', 'Listing ID is required');

  const cookies = process.env.FB_COOKIES || '';
  const url = `${FB_BASE}/marketplace/item/${listingId}/`;

  console.log(`[FB-MARKETPLACE] Fetching listing: ${listingId}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(cookies || undefined),
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    if (response.status === 404) throw new MarketplaceError('not_found', `Listing ${listingId} not found`);
    if (response.status === 403) throw new MarketplaceError('auth_required', 'Facebook blocked the request');
    throw new MarketplaceError('scrape_failed', `Facebook returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('<title>Log into Facebook') || html.includes('login_form')) {
    throw new MarketplaceError('auth_required', 'Facebook Marketplace requires authentication');
  }

  // Extract listing details from HTML
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const priceMatch = html.match(/\$(\d[\d,]*)/);
  const descMatch = html.match(/"marketplace_listing_description":"([^"]*)"/);
  const conditionMatch = html.match(/"condition(?:_text)?":"([^"]*)"/);
  const locationMatch = html.match(/"location_text":"([^"]*)"/);
  const sellerMatch = html.match(/"seller_name":"([^"]*)"/);

  // Images
  const images: string[] = [];
  const imgMatches = html.matchAll(/"image_url":"(https?:[^"]*)"/g);
  for (const m of imgMatches) {
    const imgUrl = m[1].replace(/\\/g, '');
    if (!images.includes(imgUrl)) images.push(imgUrl);
  }

  return {
    id: listingId,
    title: titleMatch ? cleanText(titleMatch[1]).replace(' | Facebook Marketplace', '') : '',
    price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
    currency: 'USD',
    location: locationMatch ? locationMatch[1] : '',
    condition: conditionMatch ? conditionMatch[1] : null,
    seller: {
      name: sellerMatch ? sellerMatch[1] : '',
      profileUrl: null,
    },
    images: images.slice(0, 10),
    url: `${FB_BASE}/marketplace/item/${listingId}/`,
    category: null,
    postedAt: null,
    description: descMatch ? descMatch[1].slice(0, 2000) : null,
  };
}
