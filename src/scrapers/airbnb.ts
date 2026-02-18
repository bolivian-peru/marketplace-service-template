/**
 * Airbnb & Short-Term Rental Intelligence Scraper
 * Extracts listings, pricing, availability, reviews, and market stats
 */

import { proxyFetch, getProxy } from '../proxy';

export interface AirbnbListing {
  id: string;
  title: string;
  type: string;
  price_per_night: number;
  total_price: number | null;
  currency: string;
  rating: number;
  reviews_count: number;
  superhost: boolean;
  bedrooms: number;
  bathrooms: number;
  max_guests: number;
  amenities: string[];
  images: string[];
  url: string;
  location: string;
  lat: number | null;
  lng: number | null;
}

export interface AirbnbMarketStats {
  avg_daily_rate: number;
  median_daily_rate: number;
  total_listings: number;
  avg_occupancy_estimate: number | null;
  price_range: { min: number; max: number };
}

export interface AirbnbReview {
  author: string;
  date: string;
  rating: number | null;
  text: string;
}

const ABB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function extractAirbnbState(html: string): any {
  const match = html.match(/data-deferred-state-0="([^"]+)"/);
  if (match) {
    try { return JSON.parse(decodeURIComponent(match[1])); } catch {}
  }
  const bootstrapMatch = html.match(/bootstrapData\s*=\s*({.+?});\s*<\/script>/s);
  if (bootstrapMatch) {
    try { return JSON.parse(bootstrapMatch[1]); } catch {}
  }
  return null;
}

export async function searchListings(
  location: string,
  checkin?: string,
  checkout?: string,
  guests = 2,
  minPrice?: number,
  maxPrice?: number,
): Promise<{ results: AirbnbListing[]; market_overview: AirbnbMarketStats }> {
  const params = new URLSearchParams({
    query: location,
    adults: String(guests),
    ...(checkin && { checkin }),
    ...(checkout && { checkout }),
    ...(minPrice !== undefined && { price_min: String(minPrice) }),
    ...(maxPrice !== undefined && { price_max: String(maxPrice) }),
  });

  const url = `https://www.airbnb.com/s/${encodeURIComponent(location)}/homes?${params.toString()}`;

  const response = await proxyFetch(url, {
    headers: ABB_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) throw new Error(`Airbnb search failed: ${response.status}`);

  const html = await response.text();
  const results: AirbnbListing[] = [];

  // Try JSON-LD first
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      if (data['@type'] === 'ItemList' && data.itemListElement) {
        for (const item of data.itemListElement) {
          const listing = item.item || item;
          results.push({
            id: String(listing.url?.match(/rooms\/(\d+)/)?.[1] || ''),
            title: listing.name || '',
            type: listing['@type'] || 'Accommodation',
            price_per_night: listing.offers?.price ? parseFloat(listing.offers.price) : 0,
            total_price: null,
            currency: listing.offers?.priceCurrency || 'USD',
            rating: listing.aggregateRating?.ratingValue ?? 0,
            reviews_count: listing.aggregateRating?.reviewCount ?? 0,
            superhost: false,
            bedrooms: 0, bathrooms: 0, max_guests: guests,
            amenities: [],
            images: listing.image ? (Array.isArray(listing.image) ? listing.image : [listing.image]) : [],
            url: listing.url || '',
            location, lat: null, lng: null,
          });
        }
      }
    } catch {}
  }

  // Regex fallback
  if (results.length === 0) {
    const listingRegex = /rooms\/(\d+)/g;
    const seenIds = new Set<string>();
    let lMatch;
    while ((lMatch = listingRegex.exec(html)) !== null) {
      const id = lMatch[1];
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      results.push({
        id, title: '', type: 'Listing', price_per_night: 0, total_price: null,
        currency: 'USD', rating: 0, reviews_count: 0, superhost: false,
        bedrooms: 0, bathrooms: 0, max_guests: guests, amenities: [],
        images: [], url: `https://www.airbnb.com/rooms/${id}`, location,
        lat: null, lng: null,
      });
    }
  }

  // Calculate market stats from results
  const prices = results.map(r => r.price_per_night).filter(p => p > 0);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const market_overview: AirbnbMarketStats = {
    avg_daily_rate: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
    median_daily_rate: sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length / 2)] : 0,
    total_listings: results.length,
    avg_occupancy_estimate: null,
    price_range: {
      min: sortedPrices[0] || 0,
      max: sortedPrices[sortedPrices.length - 1] || 0,
    },
  };

  return { results: results.slice(0, 20), market_overview };
}

export async function getListingDetail(listingId: string): Promise<AirbnbListing> {
  const url = `https://www.airbnb.com/rooms/${listingId}`;

  const response = await proxyFetch(url, {
    headers: ABB_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) throw new Error(`Airbnb listing failed for ${listingId}: ${response.status}`);

  const html = await response.text();

  // Extract from JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/);
  let data: any = {};
  if (jsonLdMatch) {
    try { data = JSON.parse(jsonLdMatch[1]); } catch {}
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const superhostMatch = html.includes('Superhost');
  const bedroomMatch = html.match(/(\d+)\s*bedroom/);
  const bathMatch = html.match(/(\d+)\s*bath/);
  const guestMatch = html.match(/(\d+)\s*guest/);

  // Extract amenities
  const amenities: string[] = [];
  const amenityRegex = /"amenity":"([^"]+)"/g;
  let amMatch;
  while ((amMatch = amenityRegex.exec(html)) !== null) {
    amenities.push(amMatch[1]);
  }

  // Extract images
  const images: string[] = [];
  const imgRegex = /https:\/\/a0\.muscache\.com\/im\/pictures\/[^"]+/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 10) {
    images.push(imgMatch[0]);
  }

  return {
    id: listingId,
    title: data.name || titleMatch?.[1]?.replace(/\s*[-·].*Airbnb.*$/, '') || '',
    type: data['@type'] || 'Listing',
    price_per_night: data.offers?.price ? parseFloat(data.offers.price) : 0,
    total_price: null,
    currency: data.offers?.priceCurrency || 'USD',
    rating: data.aggregateRating?.ratingValue ?? 0,
    reviews_count: data.aggregateRating?.reviewCount ?? 0,
    superhost: superhostMatch,
    bedrooms: bedroomMatch ? parseInt(bedroomMatch[1]) : 0,
    bathrooms: bathMatch ? parseInt(bathMatch[1]) : 0,
    max_guests: guestMatch ? parseInt(guestMatch[1]) : 0,
    amenities,
    images,
    url,
    location: data.address?.addressLocality || '',
    lat: data.geo?.latitude ?? null,
    lng: data.geo?.longitude ?? null,
  };
}

export async function getMarketStats(location: string): Promise<AirbnbMarketStats> {
  const { market_overview } = await searchListings(location);
  return market_overview;
}

export async function getListingReviews(
  listingId: string,
  limit = 10,
): Promise<AirbnbReview[]> {
  const url = `https://www.airbnb.com/rooms/${listingId}/reviews`;

  const response = await proxyFetch(url, {
    headers: ABB_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) throw new Error(`Airbnb reviews failed: ${response.status}`);

  const html = await response.text();
  const reviews: AirbnbReview[] = [];

  const reviewRegex = /"comments":"([^"]+)"[^}]*"authorName":"([^"]+)"[^}]*"createdAt":"([^"]+)"/g;
  let rMatch;
  while ((rMatch = reviewRegex.exec(html)) !== null && reviews.length < limit) {
    reviews.push({
      text: rMatch[1].replace(/\\n/g, '\n'),
      author: rMatch[2],
      date: rMatch[3],
      rating: null,
    });
  }

  return reviews;
}
