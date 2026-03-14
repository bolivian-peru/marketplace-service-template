/**
 * Facebook Marketplace Monitor Scraper (Bounty #75)
 * ─────────────────────────────────────────────────
 * Scrapes Facebook Marketplace listings, tracks prices,
 * analyzes sellers, and scores deals via mobile proxy.
 *
 * Facebook Marketplace renders server-side HTML with embedded
 * JSON data. We parse the HTML + embedded structured data
 * from the mobile web version for reliability.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  location: string | null;
  image_url: string | null;
  url: string;
  condition: string | null;
  category: string | null;
  date_listed: string | null;
  description: string | null;
  is_shipping_available: boolean;
}

export interface ListingDetail extends MarketplaceListing {
  seller: SellerProfile;
  images: string[];
  full_description: string | null;
  specifications: Record<string, string>;
}

export interface SellerProfile {
  id: string | null;
  name: string;
  profile_url: string | null;
  joined_date: string | null;
  location: string | null;
  rating: number | null;
  response_rate: string | null;
  is_verified: boolean;
  listings_count: number | null;
  badges: string[];
}

export interface PriceAlert {
  listing_id: string;
  title: string;
  current_price: number | null;
  target_price: number;
  currency: string;
  url: string;
  below_target: boolean;
  price_diff: number | null;
  price_diff_pct: number | null;
}

export interface DealScore {
  listing_id: string;
  title: string;
  price: number | null;
  score: number;          // 0-100
  rating: string;         // 'excellent' | 'good' | 'fair' | 'poor'
  factors: DealFactor[];
  url: string;
}

export interface DealFactor {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface MarketplaceSearchResult {
  query: string;
  location: string | null;
  listings: MarketplaceListing[];
  total_found: number;
  has_more: boolean;
  cursor: string | null;
}

export interface SellerAnalysis {
  seller: SellerProfile;
  trust_score: number;    // 0-100
  trust_level: string;    // 'high' | 'medium' | 'low' | 'unknown'
  recent_listings: MarketplaceListing[];
  risk_factors: string[];
  positive_signals: string[];
}

// ─── HELPERS ────────────────────────────────────────

const FB_BASE = 'https://www.facebook.com';
const FB_MOBILE = 'https://m.facebook.com';

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

function parsePrice(text: string): { price: number | null; currency: string } {
  if (!text) return { price: null, currency: 'USD' };

  const cleaned = cleanText(text);

  // Free items
  if (/free/i.test(cleaned)) return { price: 0, currency: 'USD' };

  // Currency detection
  let currency = 'USD';
  if (cleaned.includes('€')) currency = 'EUR';
  else if (cleaned.includes('£')) currency = 'GBP';
  else if (cleaned.includes('C$') || cleaned.includes('CA$')) currency = 'CAD';
  else if (cleaned.includes('A$') || cleaned.includes('AU$')) currency = 'AUD';
  else if (cleaned.includes('MX$')) currency = 'MXN';

  // Extract numeric value
  const match = cleaned.match(/[\d,]+(?:\.\d{1,2})?/);
  if (match) {
    const price = parseFloat(match[0].replace(/,/g, ''));
    if (!isNaN(price)) return { price, currency };
  }

  return { price: null, currency };
}

function extractJsonLd(html: string): any[] {
  const results: any[] = [];
  const regex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1]));
    } catch { /* skip invalid JSON */ }
  }
  return results;
}

function extractEmbeddedData(html: string): any | null {
  // Facebook embeds marketplace data in various script tags
  const patterns = [
    /data-sjs>(.*?)<\/script>/gs,
    /"marketplace_listing_renderable_target":\s*(\{[^}]+\})/,
    /"marketplace_listing":\s*(\{[\s\S]*?\})\s*[,}]/,
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m && m[1]) {
      try {
        return JSON.parse(m[1]);
      } catch { /* continue */ }
    }
  }
  return null;
}

// ─── SEARCH LISTINGS ────────────────────────────────

export async function searchListings(
  query: string,
  location?: string,
  options: {
    minPrice?: number;
    maxPrice?: number;
    category?: string;
    condition?: string;
    sortBy?: 'best_match' | 'price_low' | 'price_high' | 'date_newest';
    radius?: number;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<MarketplaceSearchResult> {
  const limit = Math.min(options.limit || 20, 50);

  // Build Facebook Marketplace search URL
  const params = new URLSearchParams();
  params.set('query', query);
  if (options.minPrice) params.set('minPrice', String(Math.floor(options.minPrice * 100)));
  if (options.maxPrice) params.set('maxPrice', String(Math.floor(options.maxPrice * 100)));
  if (options.radius) params.set('radiusKM', String(options.radius));

  // Map sort options
  const sortMap: Record<string, string> = {
    'price_low': 'PRICE_ASCEND',
    'price_high': 'PRICE_DESCEND',
    'date_newest': 'CREATION_TIME_DESCEND',
    'best_match': 'BEST_MATCH',
  };
  if (options.sortBy && sortMap[options.sortBy]) {
    params.set('sortBy', sortMap[options.sortBy]);
  }

  // Condition filter
  if (options.condition) {
    const conditionMap: Record<string, string> = {
      'new': 'new',
      'used_like_new': 'used_like_new',
      'used_good': 'used_good',
      'used_fair': 'used_fair',
    };
    if (conditionMap[options.condition]) {
      params.set('itemCondition', conditionMap[options.condition]);
    }
  }

  if (options.cursor) params.set('cursor', options.cursor);

  const locationSlug = location
    ? encodeURIComponent(location.replace(/\s+/g, '-').toLowerCase())
    : '';
  const searchPath = locationSlug
    ? `/marketplace/${locationSlug}/search?${params.toString()}`
    : `/marketplace/search?${params.toString()}`;

  const url = `${FB_MOBILE}${searchPath}`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  const html = await response.text();
  const listings = parseSearchResults(html, limit);

  // Extract cursor for pagination
  const nextCursor = extractBetween(html, '"cursor":"', '"') ||
    extractBetween(html, 'cursor=', '&') ||
    null;

  return {
    query,
    location: location || null,
    listings,
    total_found: listings.length,
    has_more: !!nextCursor,
    cursor: nextCursor,
  };
}

function parseSearchResults(html: string, limit: number): MarketplaceListing[] {
  const listings: MarketplaceListing[] = [];

  // Try structured data first
  const jsonLd = extractJsonLd(html);
  for (const data of jsonLd) {
    if (data['@type'] === 'Product' || data['@type'] === 'Offer') {
      const listing = parseJsonLdListing(data);
      if (listing) listings.push(listing);
    }
    if (Array.isArray(data['@graph'])) {
      for (const item of data['@graph']) {
        if (item['@type'] === 'Product' || item['@type'] === 'Offer') {
          const listing = parseJsonLdListing(item);
          if (listing) listings.push(listing);
        }
      }
    }
  }

  // Parse HTML listing cards
  // Facebook Marketplace uses various card structures
  const cardPatterns = [
    // Mobile marketplace cards with data attributes
    /data-testid="marketplace[_-]feed[_-]item"[\s\S]*?<a\s+href="(\/marketplace\/item\/(\d+)[^"]*)"[\s\S]*?<\/a>/gi,
    // Standard listing links
    /<a[^>]*href="\/marketplace\/item\/(\d+)\/?[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    // Alternative card format
    /marketplace\/item\/(\d+)[\s\S]*?<img[^>]*src="([^"]*)"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi,
  ];

  for (const pattern of cardPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && listings.length < limit) {
      const id = match[2] || match[1];
      if (!id || listings.some(l => l.id === id)) continue;

      // Extract surrounding context for this listing card
      const start = Math.max(0, match.index - 200);
      const end = Math.min(html.length, match.index + match[0].length + 500);
      const context = html.slice(start, end);

      const listing = parseListingCard(id, context);
      if (listing) listings.push(listing);
    }
  }

  // Fallback: parse embedded JSON data structures
  if (listings.length === 0) {
    const embeddedListings = parseEmbeddedListings(html);
    listings.push(...embeddedListings.slice(0, limit));
  }

  return listings.slice(0, limit);
}

function parseJsonLdListing(data: any): MarketplaceListing | null {
  if (!data.name) return null;

  const offer = data.offers || data;
  const priceInfo = parsePrice(offer.price || offer.lowPrice || '');

  return {
    id: data.productID || data.sku || data.url?.match(/\/item\/(\d+)/)?.[1] || `ld-${Date.now()}`,
    title: cleanText(data.name),
    price: priceInfo.price,
    currency: offer.priceCurrency || priceInfo.currency,
    location: data.availableAtOrFrom?.address?.addressLocality || null,
    image_url: Array.isArray(data.image) ? data.image[0] : data.image || null,
    url: data.url ? `${FB_BASE}${data.url.startsWith('/') ? data.url : `/${data.url}`}` : '',
    condition: data.itemCondition?.replace('https://schema.org/', '') || null,
    category: data.category || null,
    date_listed: data.datePosted || null,
    description: data.description ? cleanText(data.description).slice(0, 500) : null,
    is_shipping_available: !!data.shippingDetails || !!offer.availableDeliveryMethod,
  };
}

function parseListingCard(id: string, context: string): MarketplaceListing | null {
  // Extract title
  const titleMatch = context.match(/<span[^>]*class="[^"]*"[^>]*>([^<]{5,100})<\/span>/);
  const title = titleMatch ? cleanText(titleMatch[1]) : null;

  // Extract price
  const priceMatch = context.match(/(\$[\d,]+(?:\.\d{2})?|Free|€[\d,]+|£[\d,]+)/i);
  const priceInfo = priceMatch ? parsePrice(priceMatch[1]) : { price: null, currency: 'USD' };

  // Extract image
  const imgMatch = context.match(/<img[^>]*src="([^"]+)"[^>]*>/);
  const imageUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : null;

  // Extract location
  const locationMatch = context.match(/(?:location|posted in|·)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?)/);
  const location = locationMatch ? cleanText(locationMatch[1]) : null;

  if (!title && !priceInfo.price) return null;

  return {
    id,
    title: title || 'Untitled Listing',
    price: priceInfo.price,
    currency: priceInfo.currency,
    location,
    image_url: imageUrl,
    url: `${FB_BASE}/marketplace/item/${id}`,
    condition: null,
    category: null,
    date_listed: null,
    description: null,
    is_shipping_available: false,
  };
}

function parseEmbeddedListings(html: string): MarketplaceListing[] {
  const listings: MarketplaceListing[] = [];

  // Facebook embeds listing data in require() calls and __d() definitions
  const dataPatterns = [
    /"listing_id"\s*:\s*"(\d+)"[\s\S]*?"listing_title"\s*:\s*"([^"]*)"[\s\S]*?"listing_price"\s*:\s*\{[^}]*"amount"\s*:\s*"([\d.]+)"/g,
    /"id"\s*:\s*"(\d+)"[^}]*"marketplace_listing_title"\s*:\s*"([^"]*)"[^}]*"listing_price"\s*:\s*\{[^}]*"amount"\s*:\s*"([\d.]+)"/g,
  ];

  for (const pattern of dataPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const [, id, title, amount] = match;
      if (listings.some(l => l.id === id)) continue;

      listings.push({
        id,
        title: cleanText(title),
        price: parseFloat(amount) || null,
        currency: 'USD',
        location: null,
        image_url: null,
        url: `${FB_BASE}/marketplace/item/${id}`,
        condition: null,
        category: null,
        date_listed: null,
        description: null,
        is_shipping_available: false,
      });
    }
  }

  return listings;
}

// ─── LISTING DETAIL ─────────────────────────────────

export async function getListingDetail(listingId: string): Promise<ListingDetail | null> {
  const url = `${FB_MOBILE}/marketplace/item/${listingId}/`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  const html = await response.text();
  return parseListingDetail(listingId, html);
}

function parseListingDetail(listingId: string, html: string): ListingDetail | null {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/) ||
    html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? cleanText(titleMatch[1]).replace(/ \| Facebook Marketplace$/i, '') : 'Unknown';

  // Extract price
  const priceMatch = html.match(/(?:price|amount)[^>]*>?\s*(\$[\d,]+(?:\.\d{2})?|Free|€[\d,]+|£[\d,]+)/i) ||
    html.match(/(\$[\d,]+(?:\.\d{2})?)/);
  const priceInfo = priceMatch ? parsePrice(priceMatch[1]) : { price: null, currency: 'USD' };

  // Extract description
  const descMatch = html.match(/(?:description|listing_description)[^>]*>([\s\S]{10,2000}?)<\/(?:div|span|p)/i);
  const description = descMatch ? cleanText(descMatch[1]).slice(0, 2000) : null;

  // Extract images
  const images: string[] = [];
  const imgPattern = /<img[^>]*src="(https:\/\/[^"]*(?:marketplace|fbcdn|scontent)[^"]*)"[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(html)) !== null && images.length < 10) {
    const src = imgMatch[1].replace(/&amp;/g, '&');
    if (!images.includes(src)) images.push(src);
  }

  // Extract location
  const locationMatch = html.match(/(?:listed in|location|posted in)\s*([^<]{3,60})/i);
  const location = locationMatch ? cleanText(locationMatch[1]) : null;

  // Extract condition
  const conditionMatch = html.match(/(?:condition|item.?condition)\s*:?\s*(New|Used\s*-?\s*(?:Like New|Good|Fair)|Refurbished)/i);
  const condition = conditionMatch ? cleanText(conditionMatch[1]) : null;

  // Extract category
  const categoryMatch = html.match(/(?:category|listed.?in)\s*:?\s*([A-Za-z\s&]+?)(?:<|,|\.|$)/i);
  const category = categoryMatch ? cleanText(categoryMatch[1]) : null;

  // Extract date
  const dateMatch = html.match(/(?:listed|posted)\s*(?:on)?\s*(\w+\s+\d{1,2},?\s*\d{4}|\d+\s*(?:hours?|days?|weeks?|minutes?)\s*ago)/i);
  const dateListed = dateMatch ? cleanText(dateMatch[1]) : null;

  // Extract shipping info
  const hasShipping = /(?:shipping|delivery)\s*(?:available|offered|included)/i.test(html);

  // Extract specifications
  const specs: Record<string, string> = {};
  const specPattern = /<dt[^>]*>([^<]+)<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/gi;
  let specMatch;
  while ((specMatch = specPattern.exec(html)) !== null) {
    specs[cleanText(specMatch[1])] = cleanText(specMatch[2]);
  }

  // Extract seller info
  const seller = parseSellerFromHtml(html);

  return {
    id: listingId,
    title,
    price: priceInfo.price,
    currency: priceInfo.currency,
    location,
    image_url: images[0] || null,
    url: `${FB_BASE}/marketplace/item/${listingId}`,
    condition,
    category,
    date_listed: dateListed,
    description,
    is_shipping_available: hasShipping,
    seller,
    images,
    full_description: description,
    specifications: specs,
  };
}

function parseSellerFromHtml(html: string): SellerProfile {
  // Extract seller name
  const nameMatch = html.match(/(?:seller|sold by|listed by)[^>]*>?\s*<a[^>]*>([^<]+)<\/a>/i) ||
    html.match(/(?:seller|sold by|listed by)\s*:?\s*([^<]{2,50})/i);
  const name = nameMatch ? cleanText(nameMatch[1]) : 'Unknown Seller';

  // Extract seller profile URL
  const profileMatch = html.match(/(?:seller|sold by|listed by)[^>]*>\s*<a[^>]*href="(\/(?:profile\.php\?id=\d+|[a-zA-Z0-9.]+))[^"]*"/i);
  const profileUrl = profileMatch ? `${FB_BASE}${profileMatch[1]}` : null;

  // Extract seller ID
  const idMatch = profileUrl?.match(/(?:id=|\.com\/)(\d+)/) ||
    html.match(/seller_id["\s:]*(\d+)/);
  const sellerId = idMatch ? idMatch[1] : null;

  // Extract join date
  const joinMatch = html.match(/(?:joined|member since)\s*(?:Facebook\s*(?:in)?)?\s*(\w+\s*\d{4}|\d{4})/i);
  const joinedDate = joinMatch ? cleanText(joinMatch[1]) : null;

  // Seller location
  const locMatch = html.match(/(?:lives in|from)\s*([^<]{3,50})/i);
  const sellerLocation = locMatch ? cleanText(locMatch[1]) : null;

  // Verified badge
  const isVerified = /verified|✓|badge/i.test(html);

  // Response rate
  const responseMatch = html.match(/(?:response|reply)\s*(?:rate|time)[^>]*>?\s*(\d+%|[^<]{3,30})/i);
  const responseRate = responseMatch ? cleanText(responseMatch[1]) : null;

  // Listing count
  const listCountMatch = html.match(/(\d+)\s*(?:items?|listings?)\s*(?:for sale|listed)/i);
  const listingsCount = listCountMatch ? parseInt(listCountMatch[1]) : null;

  // Badges
  const badges: string[] = [];
  if (isVerified) badges.push('verified');
  if (/top seller/i.test(html)) badges.push('top_seller');
  if (/very responsive/i.test(html)) badges.push('very_responsive');
  if (/community/i.test(html)) badges.push('community_member');

  return {
    id: sellerId,
    name,
    profile_url: profileUrl,
    joined_date: joinedDate,
    location: sellerLocation,
    rating: null,
    response_rate: responseRate,
    is_verified: isVerified,
    listings_count: listingsCount,
    badges,
  };
}

// ─── SELLER ANALYSIS ────────────────────────────────

export async function analyzeSeller(sellerId: string): Promise<SellerAnalysis> {
  // Fetch seller's marketplace listings page
  const url = `${FB_MOBILE}/marketplace/profile/${sellerId}/`;

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  const html = await response.text();
  const seller = parseSellerFromHtml(html);
  seller.id = sellerId;

  // Parse seller's recent listings
  const recentListings = parseSearchResults(html, 10);

  // Compute trust score
  const { trustScore, trustLevel, riskFactors, positiveSignals } = computeTrustScore(seller, recentListings);

  return {
    seller,
    trust_score: trustScore,
    trust_level: trustLevel,
    recent_listings: recentListings,
    risk_factors: riskFactors,
    positive_signals: positiveSignals,
  };
}

function computeTrustScore(
  seller: SellerProfile,
  listings: MarketplaceListing[],
): { trustScore: number; trustLevel: string; riskFactors: string[]; positiveSignals: string[] } {
  let score = 50; // Start at baseline
  const riskFactors: string[] = [];
  const positiveSignals: string[] = [];

  // Verified badge (+15)
  if (seller.is_verified) {
    score += 15;
    positiveSignals.push('Verified account');
  }

  // Join date — older accounts are more trustworthy
  if (seller.joined_date) {
    const joinYear = parseInt(seller.joined_date.match(/\d{4}/)?.[0] || '0');
    const currentYear = new Date().getFullYear();
    const accountAge = currentYear - joinYear;

    if (accountAge >= 5) {
      score += 15;
      positiveSignals.push(`Account age: ${accountAge} years`);
    } else if (accountAge >= 2) {
      score += 10;
      positiveSignals.push(`Account age: ${accountAge} years`);
    } else if (accountAge < 1) {
      score -= 10;
      riskFactors.push('New account (less than 1 year old)');
    }
  } else {
    riskFactors.push('Account age unknown');
  }

  // Response rate
  if (seller.response_rate) {
    const rate = parseInt(seller.response_rate);
    if (!isNaN(rate) && rate >= 90) {
      score += 10;
      positiveSignals.push(`High response rate: ${seller.response_rate}`);
    }
  }

  // Badges
  if (seller.badges.includes('top_seller')) {
    score += 10;
    positiveSignals.push('Top seller badge');
  }
  if (seller.badges.includes('very_responsive')) {
    score += 5;
    positiveSignals.push('Very responsive');
  }

  // Listing volume
  if (seller.listings_count !== null) {
    if (seller.listings_count >= 10) {
      score += 5;
      positiveSignals.push(`Active seller with ${seller.listings_count} listings`);
    }
    if (seller.listings_count > 100) {
      riskFactors.push('Very high listing count — may be a commercial reseller');
    }
  }

  // Price anomalies in listings
  const prices = listings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0);

  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const suspiciouslyLow = prices.filter(p => p < avgPrice * 0.3);
    if (suspiciouslyLow.length > prices.length * 0.5) {
      score -= 10;
      riskFactors.push('Multiple listings priced suspiciously low');
    }
  }

  // Profile completeness
  if (!seller.location) {
    score -= 5;
    riskFactors.push('No location specified');
  }
  if (!seller.profile_url) {
    score -= 5;
    riskFactors.push('No profile URL found');
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  let trustLevel: string;
  if (score >= 75) trustLevel = 'high';
  else if (score >= 50) trustLevel = 'medium';
  else if (score >= 25) trustLevel = 'low';
  else trustLevel = 'unknown';

  return { trustScore: score, trustLevel, riskFactors, positiveSignals };
}

// ─── PRICE TRACKING ─────────────────────────────────

export async function checkPriceAlerts(
  listingIds: string[],
  targetPrice: number,
): Promise<PriceAlert[]> {
  const alerts: PriceAlert[] = [];

  // Fetch each listing in parallel (up to 10)
  const ids = listingIds.slice(0, 10);
  const promises = ids.map(id => getListingDetail(id).catch(() => null));
  const results = await Promise.all(promises);

  for (const listing of results) {
    if (!listing) continue;

    const belowTarget = listing.price !== null && listing.price <= targetPrice;
    const priceDiff = listing.price !== null ? listing.price - targetPrice : null;
    const priceDiffPct = listing.price !== null && targetPrice > 0
      ? ((listing.price - targetPrice) / targetPrice) * 100
      : null;

    alerts.push({
      listing_id: listing.id,
      title: listing.title,
      current_price: listing.price,
      target_price: targetPrice,
      currency: listing.currency,
      url: listing.url,
      below_target: belowTarget,
      price_diff: priceDiff !== null ? Math.round(priceDiff * 100) / 100 : null,
      price_diff_pct: priceDiffPct !== null ? Math.round(priceDiffPct * 10) / 10 : null,
    });
  }

  return alerts;
}

// ─── DEAL SCORING ───────────────────────────────────

export async function scoreDeal(listingId: string): Promise<DealScore | null> {
  const listing = await getListingDetail(listingId);
  if (!listing) return null;

  return computeDealScore(listing);
}

export async function scoreDeals(
  query: string,
  location?: string,
  limit?: number,
): Promise<DealScore[]> {
  const searchResult = await searchListings(query, location, { limit: limit || 10 });
  const scores: DealScore[] = [];

  // Get details for each listing
  const promises = searchResult.listings.map(l =>
    getListingDetail(l.id).catch(() => null)
  );
  const details = await Promise.all(promises);

  for (const detail of details) {
    if (!detail) continue;
    scores.push(computeDealScore(detail));
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function computeDealScore(listing: ListingDetail): DealScore {
  const factors: DealFactor[] = [];
  let totalWeight = 0;
  let weightedScore = 0;

  // Factor 1: Price competitiveness (weight: 30)
  const priceWeight = 30;
  let priceScore = 50; // default if unknown
  if (listing.price !== null) {
    if (listing.price === 0) {
      priceScore = 100; // Free is best deal
    } else if (listing.price < 10) {
      priceScore = 90;
    } else if (listing.price < 50) {
      priceScore = 75;
    } else if (listing.price < 200) {
      priceScore = 60;
    } else {
      priceScore = 40;
    }
  }
  factors.push({
    name: 'price_competitiveness',
    score: priceScore,
    weight: priceWeight,
    detail: listing.price !== null ? `Listed at $${listing.price}` : 'Price not available',
  });
  totalWeight += priceWeight;
  weightedScore += priceScore * priceWeight;

  // Factor 2: Listing quality (weight: 20)
  const qualityWeight = 20;
  let qualityScore = 30;
  if (listing.description && listing.description.length > 50) qualityScore += 20;
  if (listing.images.length >= 3) qualityScore += 20;
  if (listing.condition) qualityScore += 15;
  if (listing.specifications && Object.keys(listing.specifications).length > 0) qualityScore += 15;
  qualityScore = Math.min(100, qualityScore);
  factors.push({
    name: 'listing_quality',
    score: qualityScore,
    weight: qualityWeight,
    detail: `${listing.images.length} images, ${listing.description?.length || 0} char description`,
  });
  totalWeight += qualityWeight;
  weightedScore += qualityScore * qualityWeight;

  // Factor 3: Seller trust (weight: 25)
  const sellerWeight = 25;
  let sellerScore = 40;
  if (listing.seller.is_verified) sellerScore += 20;
  if (listing.seller.badges.length > 0) sellerScore += 10;
  if (listing.seller.response_rate) {
    const rate = parseInt(listing.seller.response_rate);
    if (!isNaN(rate) && rate >= 80) sellerScore += 15;
  }
  if (listing.seller.joined_date) sellerScore += 10;
  sellerScore = Math.min(100, sellerScore);
  factors.push({
    name: 'seller_trust',
    score: sellerScore,
    weight: sellerWeight,
    detail: listing.seller.is_verified ? 'Verified seller' : 'Unverified seller',
  });
  totalWeight += sellerWeight;
  weightedScore += sellerScore * sellerWeight;

  // Factor 4: Convenience (weight: 15)
  const convWeight = 15;
  let convScore = 40;
  if (listing.is_shipping_available) convScore += 30;
  if (listing.location) convScore += 15;
  convScore = Math.min(100, convScore);
  factors.push({
    name: 'convenience',
    score: convScore,
    weight: convWeight,
    detail: listing.is_shipping_available ? 'Shipping available' : 'Local pickup only',
  });
  totalWeight += convWeight;
  weightedScore += convScore * convWeight;

  // Factor 5: Condition (weight: 10)
  const condWeight = 10;
  let condScore = 50;
  if (listing.condition) {
    const cond = listing.condition.toLowerCase();
    if (cond.includes('new')) condScore = 100;
    else if (cond.includes('like new')) condScore = 85;
    else if (cond.includes('good')) condScore = 65;
    else if (cond.includes('fair')) condScore = 40;
  }
  factors.push({
    name: 'item_condition',
    score: condScore,
    weight: condWeight,
    detail: listing.condition || 'Condition not specified',
  });
  totalWeight += condWeight;
  weightedScore += condScore * condWeight;

  const finalScore = Math.round(weightedScore / totalWeight);

  let rating: string;
  if (finalScore >= 80) rating = 'excellent';
  else if (finalScore >= 60) rating = 'good';
  else if (finalScore >= 40) rating = 'fair';
  else rating = 'poor';

  return {
    listing_id: listing.id,
    title: listing.title,
    price: listing.price,
    score: finalScore,
    rating,
    factors,
    url: listing.url,
  };
}
