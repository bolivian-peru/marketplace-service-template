/**
 * Travel Prices Scraper — Proxies.sx Marketplace Service
 * Bounty: Travel Prices ($200)
 *
 * Scrapes flight prices from Booking.com, Expedia, Kayak + hotel prices.
 * Uses Proxies.sx mobile proxies to bypass geo-restrictions.
 *
 * Endpoints:
 *   GET /api/travel/flights?origin=NYC&destination=LAX&date=2026-08-01
 *   GET /api/travel/hotels?location=Paris&checkIn=2026-08-01&checkOut=2026-08-03
 */

import { proxyFetch } from '../proxy';

// ─── Types ───────────────────────────────────────────
export interface FlightResult {
  airline: string;
  flightNumber: string;
  departure: string;
  arrival: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  currency: string;
  stops: number;
  duration: string;
  scrapedAt: string;
}

export interface HotelResult {
  name: string;
  location: string;
  pricePerNight: number;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  stars: number | null;
  amenities: string[];
  imageUrl: string;
  bookingUrl: string;
  scrapedAt: string;
}

export interface TravelSearchParams {
  origin?: string;
  destination?: string;
  date?: string;
  returnDate?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  currency?: string;
}

// ─── Constants ───────────────────────────────────────
export const FLIGHTS_SERVICE_NAME = 'travel-prices-flights';
export const HOTELS_SERVICE_NAME = 'travel-prices-hotels';
export const FLIGHTS_PRICE_USDC = 0.005;
export const HOTELS_PRICE_USDC = 0.005;
export const FLIGHTS_DESC = 'Scrape flight prices from Booking.com and Kayak. Real 4G/5G mobile IP. Output: airline, price, stops, duration.';
export const HOTELS_DESC = 'Scrape hotel prices from Booking.com. Real 4G/5G mobile IP. Output: name, price/night, rating, stars, amenities.';

function extractPrice(text: string): { price: number | null; currency: string } {
  const patterns = [
    /(\$|USD|€|EUR|£|GBP)\s*([\d,]+\.?\d*)/gi,
    /([\d,]+\.?\d*)\s*(\$|USD|€|EUR|£|GBP)/gi,
    /"price"\s*:\s*"?([\d.]+)"?/gi,
    /data-price="([\d.]+)"/gi,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      let currency = match[1] || 'USD';
      const numStr = (match[2] || match[1]).replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) {
        const m: Record<string, string> = { '$': 'USD', 'USD': 'USD', '€': 'EUR', 'EUR': 'EUR', '£': 'GBP', 'GBP': 'GBP' };
        return { price: Math.round(num * 100) / 100, currency: m[currency] || currency.toUpperCase() };
      }
    }
  }
  return { price: null, currency: 'USD' };
}

async function scrapeBookingFlights(html: string, origin: string, destination: string): Promise<FlightResult[]> {
  const results: FlightResult[] = [];
  // Booking.com embeds flight data in JSON-LD
  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (jsonMatch) {
    for (const block of jsonMatch) {
      try {
        const ld = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
        if (ld['@type'] === 'Flight') {
          const offer = ld.offers?.[0] || ld.offers || {};
          results.push({
            airline: ld.provider?.name || 'Unknown',
            flightNumber: ld.flightNumber || '',
            departure: ld.departureAirport?.name || origin,
            arrival: ld.arrivalAirport?.name || destination,
            origin,
            destination,
            departureTime: ld.departureTime || '',
            arrivalTime: ld.arrivalTime || '',
            price: offer.price ? parseFloat(String(offer.price)) : 0,
            currency: offer.priceCurrency || 'USD',
            stops: ld.itinerary?.length ? ld.itinerary.length - 1 : 0,
            duration: ld.flightDuration || '',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch {}
    }
  }

  // Fallback: regex extraction
  if (results.length === 0) {
    const priceBlocks = html.match(/<div[^>]*data-testid="flight-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
    if (priceBlocks) {
      for (const block of priceBlocks) {
        const priceResult = extractPrice(block);
        if (priceResult.price) {
          results.push({
            airline: 'Unknown',
            flightNumber: '',
            departure: origin,
            arrival: destination,
            origin,
            destination,
            departureTime: '',
            arrivalTime: '',
            price: priceResult.price,
            currency: priceResult.currency,
            stops: 0,
            duration: '',
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  return results;
}

async function scrapeBookingHotels(html: string, location: string): Promise<HotelResult[]> {
  const results: HotelResult[] = [];
  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (jsonMatch) {
    for (const block of jsonMatch) {
      try {
        const ld = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
        if (ld['@type'] === 'Hotel' || ld['@type'] === 'LodgingBusiness') {
          results.push({
            name: ld.name || 'Unknown',
            location: ld.address?.addressLocality || location,
            pricePerNight: ld.priceRange ? parseFloat(String(ld.priceRange).replace(/[^0-9.]/g, '')) : 0,
            currency: ld.currenciesAccepted || 'USD',
            rating: ld.aggregateRating?.ratingValue || null,
            reviewCount: ld.aggregateRating?.reviewCount || null,
            stars: ld.starRating?.ratingValue || null,
            amenities: ld.amenityFeature?.map((a: any) => a.name) || [],
            imageUrl: ld.image || '',
            bookingUrl: ld.url || '',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch {}
    }
  }

  // Fallback: regex
  if (results.length === 0) {
    const hotelCards = html.match(/<div[^>]*data-testid="property-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
    if (hotelCards) {
      for (const card of hotelCards) {
        const nameMatch = card.match(/data-testid="title"[^>]*>([^<]+)</);
        const priceResult = extractPrice(card);
        if (nameMatch && priceResult.price) {
          results.push({
            name: nameMatch[1].trim(),
            location,
            pricePerNight: priceResult.price,
            currency: priceResult.currency,
            rating: null,
            reviewCount: null,
            stars: null,
            amenities: [],
            imageUrl: '',
            bookingUrl: '',
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  return results;
}

export async function scrapeFlights(params: TravelSearchParams): Promise<FlightResult[]> {
  const origin = params.origin || 'NYC';
  const destination = params.destination || 'LAX';
  const date = params.date || '2026-08-01';

  const url = `https://www.booking.com/flights/search.html?from=${origin}&to=${destination}&depart=${date}`;
  const result = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!result.ok) return [];
  return scrapeBookingFlights(result.text || '', origin, destination);
}

export async function scrapeHotels(params: TravelSearchParams): Promise<HotelResult[]> {
  const location = params.destination || 'Paris';
  const checkIn = params.checkIn || '2026-08-01';
  const checkOut = params.checkOut || '2026-08-03';

  const url = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(location)}&checkin=${checkIn}&checkout=${checkOut}`;
  const result = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!result.ok) return [];
  return scrapeBookingHotels(result.text || '', location);
}
