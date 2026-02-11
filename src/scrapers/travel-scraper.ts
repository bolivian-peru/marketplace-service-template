/**
 * Travel Price Tracker Scraper
 * ─────────────────────────────
 * Scrapes flight and hotel prices from Google Flights and Booking.com.
 */

import { proxyFetch } from '../proxy';

export interface FlightResult {
    airline: string;
    departure: string;
    arrival: string;
    duration: string | null;
    stops: number;
    price: number | null;
    priceFormatted: string | null;
    currency: string;
    bookingUrl: string;
    source: string;
}

export interface HotelResult {
    name: string;
    rating: number | null;
    stars: number | null;
    price: number | null;
    priceFormatted: string | null;
    pricePerNight: boolean;
    currency: string;
    address: string | null;
    amenities: string[];
    reviewScore: string | null;
    bookingUrl: string;
    imageUrl: string | null;
    source: string;
}

export interface TravelSearchResult {
    flights: FlightResult[];
    hotels: HotelResult[];
    query: { origin?: string; destination: string; checkIn?: string; checkOut?: string };
    totalResults: number;
}

// ─── GOOGLE FLIGHTS SCRAPER ─────────────────────────

export async function scrapeGoogleFlights(
    origin: string,
    destination: string,
    date: string, // YYYY-MM-DD
    returnDate?: string,
): Promise<FlightResult[]> {
    // Google Flights URL pattern
    const url = `https://www.google.com/travel/flights?q=Flights+from+${encodeURIComponent(origin)}+to+${encodeURIComponent(destination)}+on+${date}${returnDate ? `+return+${returnDate}` : ''}`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Google Flights returned ${response.status}`);
    const html = await response.text();

    const flights: FlightResult[] = [];

    // Try JSON-LD structured data
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            if (data['@type'] === 'FlightReservation' || data['@type'] === 'Flight') {
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    flights.push({
                        airline: item.reservationFor?.provider?.name || item.airline?.name || 'Unknown',
                        departure: item.reservationFor?.departureTime || item.departureTime || '',
                        arrival: item.reservationFor?.arrivalTime || item.arrivalTime || '',
                        duration: null,
                        stops: 0,
                        price: item.totalPrice ? parseFloat(item.totalPrice) : null,
                        priceFormatted: item.totalPrice ? `$${item.totalPrice}` : null,
                        currency: item.priceCurrency || 'USD',
                        bookingUrl: url,
                        source: 'google_flights',
                    });
                }
            }
        } catch { /* skip */ }
    }

    // Fallback: parse HTML patterns
    if (flights.length === 0) {
        // Google Flights uses data attributes and specific patterns
        const pricePattern = /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
        const airlinePattern = /(?:United|Delta|American|Southwest|JetBlue|Alaska|Spirit|Frontier|Hawaiian|Air\s+\w+|Lufthansa|British\s+Airways|Emirates|Qatar|Singapore|Ryanair|EasyJet)/gi;
        const durationPattern = /(\d+)\s*h(?:r)?(?:\s*(\d+)\s*m(?:in)?)?/gi;
        const stopPattern = /(?:Nonstop|(\d+)\s*stop)/gi;

        const prices = html.match(pricePattern) || [];
        const airlines = html.match(airlinePattern) || [];
        const durations = [...html.matchAll(durationPattern)];
        const stops = [...html.matchAll(stopPattern)];

        const count = Math.min(prices.length, airlines.length, 20);
        for (let i = 0; i < count; i++) {
            const priceStr = prices[i]?.replace(/[^0-9.]/g, '');
            flights.push({
                airline: airlines[i] || 'Unknown',
                departure: date,
                arrival: '',
                duration: durations[i] ? `${durations[i][1]}h ${durations[i][2] || '0'}m` : null,
                stops: stops[i]?.[1] ? parseInt(stops[i][1]) : 0,
                price: priceStr ? parseFloat(priceStr) : null,
                priceFormatted: prices[i] || null,
                currency: 'USD',
                bookingUrl: url,
                source: 'google_flights',
            });
        }
    }

    // Sort by price
    flights.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
    return flights;
}

// ─── BOOKING.COM HOTELS SCRAPER ─────────────────────

export async function scrapeBookingHotels(
    destination: string,
    checkIn: string, // YYYY-MM-DD
    checkOut: string, // YYYY-MM-DD
    adults: number = 2,
): Promise<HotelResult[]> {
    const params = new URLSearchParams({
        ss: destination,
        checkin: checkIn,
        checkout: checkOut,
        group_adults: adults.toString(),
        no_rooms: '1',
        lang: 'en-us',
        selected_currency: 'USD',
    });

    const url = `https://www.booking.com/searchresults.html?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Booking.com returned ${response.status}`);
    const html = await response.text();

    const hotels: HotelResult[] = [];

    // Parse JSON-LD
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            const items = data['@graph'] || (Array.isArray(data) ? data : [data]);
            for (const item of items) {
                if (item['@type'] === 'Hotel' || item['@type'] === 'LodgingBusiness') {
                    hotels.push({
                        name: item.name || 'Unknown',
                        rating: item.aggregateRating?.ratingValue || null,
                        stars: item.starRating?.ratingValue || null,
                        price: item.offers?.price ? parseFloat(item.offers.price) : null,
                        priceFormatted: item.offers?.price ? `$${item.offers.price}` : null,
                        pricePerNight: true,
                        currency: item.offers?.priceCurrency || 'USD',
                        address: item.address?.streetAddress || null,
                        amenities: item.amenityFeature?.map((a: any) => a.name) || [],
                        reviewScore: item.aggregateRating?.ratingValue?.toString() || null,
                        bookingUrl: item.url || url,
                        imageUrl: item.image || null,
                        source: 'booking.com',
                    });
                }
            }
        } catch { /* skip */ }
    }

    // Fallback: HTML parsing
    if (hotels.length === 0) {
        const cardPattern = /data-testid="property-card"[\s\S]*?(?:<\/div>\s*){3,}/g;
        const cards = html.match(cardPattern) || [];
        for (const card of cards.slice(0, 25)) {
            const nameMatch = card.match(/data-testid="title"[^>]*>([^<]+)/);
            const priceMatch = card.match(/data-testid="price-and-discounted-price"[^>]*>([^<]+)/);
            const scoreMatch = card.match(/(?:aria-label|class)="[^"]*(?:score|rating)[^"]*"[^>]*>(\d+\.?\d*)/i);
            const linkMatch = card.match(/href="(https?:\/\/www\.booking\.com\/hotel\/[^"]+)"/);

            if (nameMatch) {
                const priceStr = priceMatch?.[1]?.replace(/[^0-9.]/g, '');
                hotels.push({
                    name: nameMatch[1].trim(),
                    rating: scoreMatch ? parseFloat(scoreMatch[1]) : null,
                    stars: null,
                    price: priceStr ? parseFloat(priceStr) : null,
                    priceFormatted: priceMatch?.[1]?.trim() || null,
                    pricePerNight: true,
                    currency: 'USD',
                    address: null,
                    amenities: [],
                    reviewScore: scoreMatch?.[1] || null,
                    bookingUrl: linkMatch?.[1] || url,
                    imageUrl: null,
                    source: 'booking.com',
                });
            }
        }
    }

    hotels.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
    return hotels;
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function searchTravel(
    destination: string,
    options: {
        origin?: string;
        checkIn?: string;
        checkOut?: string;
        type?: 'flights' | 'hotels' | 'both';
        adults?: number;
    } = {},
): Promise<TravelSearchResult> {
    const type = options.type || 'both';
    const flights: FlightResult[] = [];
    const hotels: HotelResult[] = [];

    const promises: Promise<void>[] = [];

    if ((type === 'flights' || type === 'both') && options.origin && options.checkIn) {
        promises.push(
            scrapeGoogleFlights(options.origin, destination, options.checkIn, options.checkOut)
                .then(r => flights.push(...r))
                .catch(err => console.error(`Flights error: ${err.message}`))
        );
    }

    if ((type === 'hotels' || type === 'both') && options.checkIn && options.checkOut) {
        promises.push(
            scrapeBookingHotels(destination, options.checkIn, options.checkOut, options.adults)
                .then(r => hotels.push(...r))
                .catch(err => console.error(`Hotels error: ${err.message}`))
        );
    }

    await Promise.allSettled(promises);

    return {
        flights,
        hotels,
        query: {
            origin: options.origin,
            destination,
            checkIn: options.checkIn,
            checkOut: options.checkOut,
        },
        totalResults: flights.length + hotels.length,
    };
}
