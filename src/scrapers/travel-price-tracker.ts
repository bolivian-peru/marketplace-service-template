/**
 * Travel Price Tracker
 * ─────────────────────
 * Scrapes travel sites for flight, hotel, and package pricing.
 * Supports metasearch aggregation across multiple providers.
 *
 * Bounty: Wave 2 — $50 Travel Price Tracker API
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ───────────────────────────────────────────

export interface TravelPrice {
  /** Provider name (Expedia, Booking, Kayak, etc.) */
  provider: string;
  /** Price in destination currency */
  price: number | null;
  /** Currency code */
  currency: string;
  /** Departure location */
  origin: string | null;
  /** Destination / hotel name */
  destination: string;
  /** Check-in or departure date */
  departDate: string | null;
  /** Check-out or return date */
  returnDate: string | null;
  /** Flight number or hotel room type */
  details: string | null;
  /** Booking URL */
  url: string;
  /** Whether this is a flight, hotel, or package */
  type: 'flight' | 'hotel' | 'package' | 'other';
  /** Timestamp of this check (ISO 8601) */
  checkedAt: string;
}

export interface TravelSearchParams {
  /** Type of travel */
  type: 'flight' | 'hotel' | 'package';
  /** Origin city/airport code (for flights) */
  origin?: string;
  /** Destination city/airport/hotel */
  destination: string;
  /** Departure/check-in date (YYYY-MM-DD) */
  departDate?: string;
  /** Return/check-out date (YYYY-MM-DD) */
  returnDate?: string;
  /** Number of travelers */
  travelers?: number;
  /** Max results */
  limit?: number;
}

export interface TravelPriceResponse {
  query: TravelSearchParams;
  results: TravelPrice[];
  totalFound: number;
  cheapest: TravelPrice | null;
  priceRange: { min: number | null; max: number | null };
}

// ─── PROVIDER SEARCH URL BUILDERS ────────────────────

const PROVIDERS: Record<string, (p: TravelSearchParams) => string | null> = {
  googleFlights: (p) => {
    if (p.type !== 'flight' || !p.origin || !p.destination) return null;
    const parts = [
      `https://www.google.com/travel/flights`,
      `?q=flights+from+${encodeURIComponent(p.origin)}+to+${encodeURIComponent(p.destination)}`,
    ];
    if (p.departDate) parts.push(`+on+${p.departDate}`);
    if (p.returnDate) parts.push(`+return+on+${p.returnDate}`);
    return parts.join('');
  },
  kayak: (p) => {
    const base = 'https://www.kayak.com';
    if (p.type === 'flight' && p.origin && p.destination) {
      let url = `${base}/flights/${p.origin}-${p.destination}`;
      if (p.departDate) url += `/${p.departDate}`;
      if (p.returnDate) url += `/${p.returnDate}`;
      return url;
    }
    return null;
  },
  skyscanner: (p) => {
    if (p.type !== 'flight' || !p.origin || !p.destination) return null;
    const parts = [
      `https://www.skyscanner.net/transport/flights/${p.origin.toLowerCase()}/${p.destination.toLowerCase()}`,
    ];
    if (p.departDate) parts.push(`/${p.departDate.replace(/-/g, '')}`);
    if (p.returnDate) parts.push(`/${p.returnDate.replace(/-/g, '')}`);
    return parts.join('');
  },
  booking: (p) => {
    if (p.type !== 'hotel' || !p.destination) return null;
    const q = encodeURIComponent(p.destination);
    let url = `https://www.booking.com/searchresults.html?ss=${q}`;
    if (p.departDate) url += `&checkin=${p.departDate}`;
    if (p.returnDate) url += `&checkout=${p.returnDate}`;
    return url;
  },
};

// ─── PRICE EXTRACTION ───────────────────────────────

/**
 * Extract price from HTML using travel-specific patterns
 */
function extractPriceRangeFromHtml(html: string): { min: number | null; max: number | null; currency: string } {
  const prices: number[] = [];

  // Match all currency amounts
  const priceRegex = /(?:[$€£¥]|USD|EUR|GBP)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g;
  let match;
  while ((match = priceRegex.exec(html)) !== null) {
    const val = parseFloat(match[1].replace(/,/g, ''));
    if (val > 1 && val < 50000) {
      prices.push(val);
    }
  }

  // Also try JSON-LD
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = data['@graph'] || [data];
      for (const item of items) {
        if (item['@type'] === 'Flight' || item['@type'] === 'Hotel') {
          if (item.offers?.price) prices.push(parseFloat(item.offers.price));
          if (item.price) prices.push(parseFloat(item.price));
        }
      }
    } catch {}
  }

  // Sort and find min/max
  prices.sort((a, b) => a - b);
  const min = prices.length > 0 ? prices[0] : null;
  const max = prices.length > 0 ? prices[prices.length - 1] : null;

  // Detect currency
  let currency = 'USD';
  if (html.includes('€')) currency = 'EUR';
  else if (html.includes('£')) currency = 'GBP';

  return { min, max, currency };
}

/**
 * Extract travel listing details from HTML
 */
function extractTravelListings(
  html: string,
  params: TravelSearchParams,
  provider: string,
  url: string,
): TravelPrice[] {
  const results: TravelPrice[] = [];
  const { min: _, max: __, currency } = extractPriceRangeFromHtml(html);

  // Try JSON-LD first
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = data['@graph'] || (Array.isArray(data) ? data : [data]);

      for (const item of items) {
        if (item['@type'] === 'Flight') {
          results.push({
            provider,
            price: item.offers?.price ? parseFloat(item.offers.price) : null,
            currency: item.offers?.priceCurrency || currency,
            origin: item.departureAirport?.name || params.origin || null,
            destination: item.arrivalAirport?.name || params.destination,
            departDate: item.departureTime?.substring(0, 10) || params.departDate || null,
            returnDate: item.arrivalTime?.substring(0, 10) || params.returnDate || null,
            details: item.flightNumber || item.name || null,
            url,
            type: 'flight',
            checkedAt: new Date().toISOString(),
          });
        } else if (item['@type'] === 'Hotel' || item['@type'] === 'LodgingBusiness') {
          results.push({
            provider,
            price: item.offers?.price ? parseFloat(item.offers.price) : null,
            currency: item.offers?.priceCurrency || currency,
            origin: null,
            destination: item.name || params.destination,
            departDate: params.departDate || null,
            returnDate: params.returnDate || null,
            details: item.description || item.amenityFeature?.join?.(', ') || null,
            url,
            type: 'hotel',
            checkedAt: new Date().toISOString(),
          });
        }
      }
      if (results.length > 0) break;
    } catch {}
  }

  // HTML fallback: extract price cards/blocks
  if (results.length === 0) {
    // Look for common price display patterns
    const priceBlocks = html.match(/<div[^>]*class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [];
    const extractedPrices: number[] = [];

    for (const block of priceBlocks) {
      const pm = block.match(/(?:[$€£¥]|USD|EUR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/);
      if (pm) {
        const val = parseFloat(pm[1].replace(/,/g, ''));
        if (val > 1 && val < 50000) extractedPrices.push(val);
      }
    }

    if (extractedPrices.length > 0) {
      extractedPrices.sort((a, b) => a - b);
      results.push({
        provider,
        price: extractedPrices[0],
        currency,
        origin: params.origin || null,
        destination: params.destination,
        departDate: params.departDate || null,
        returnDate: params.returnDate || null,
        details: `Cheapest of ${extractedPrices.length} prices found`,
        url,
        type: params.type,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  return results.slice(0, params.limit || 20);
}

// ─── MAIN SCRAPER ────────────────────────────────────

/**
 * Scrape a travel provider for pricing data
 */
async function scrapeProvider(
  provider: string,
  url: string,
  params: TravelSearchParams,
): Promise<TravelPrice[]> {
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) return [];

  const html = await response.text();
  if (html.length < 1000) return [];

  return extractTravelListings(html, params, provider, url);
}

/**
 * Track prices across multiple travel providers
 */
export async function trackTravelPrices(params: TravelSearchParams): Promise<TravelPriceResponse> {
  const allResults: TravelPrice[] = [];
  const providerNames = Object.keys(PROVIDERS);

  // Build search URLs for all supported providers
  const tasks = providerNames.map(async (name) => {
    const buildUrl = PROVIDERS[name];
    if (!buildUrl) return;
    const url = buildUrl(params);
    if (!url) return;

    try {
      const results = await scrapeProvider(name, url, params);
      allResults.push(...results);
    } catch {
      // Skip providers that fail
    }
  });

  await Promise.allSettled(tasks);

  // If nothing found, return a basic result showing what we searched
  if (allResults.length === 0) {
    return {
      query: params,
      results: [],
      totalFound: 0,
      cheapest: null,
      priceRange: { min: null, max: null },
    };
  }

  // Sort by price
  allResults.sort((a, b) => {
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  });

  const prices = allResults.filter(r => r.price !== null).map(r => r.price!);

  return {
    query: params,
    results: allResults.slice(0, params.limit || 50),
    totalFound: allResults.length,
    cheapest: allResults[0] || null,
    priceRange: {
      min: prices.length > 0 ? Math.min(...prices) : null,
      max: prices.length > 0 ? Math.max(...prices) : null,
    },
  };
}
