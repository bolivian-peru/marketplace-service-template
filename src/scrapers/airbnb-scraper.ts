/**
 * Airbnb Market Intelligence Scraper (Bounty #78)
 * ────────────────────────────────────────────────
 * Scrapes Airbnb listings, pricing, reviews, and market stats
 * via mobile proxy using Airbnb's internal API endpoints.
 *
 * Airbnb's mobile app communicates via JSON APIs that are more
 * reliable than HTML scraping. We mimic mobile app requests.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface AirbnbListing {
  id: string;
  title: string;
  type: string;
  price_per_night: number | null;
  total_price: number | null;
  currency: string;
  rating: number | null;
  reviews_count: number | null;
  superhost: boolean;
  bedrooms: number;
  bathrooms: number;
  max_guests: number;
  amenities: string[];
  images: string[];
  url: string;
  lat: number | null;
  lng: number | null;
}

export interface AirbnbListingDetail extends AirbnbListing {
  description: string;
  neighborhood: string | null;
  host: {
    name: string;
    superhost: boolean;
    response_rate: string | null;
    response_time: string | null;
  };
  house_rules: string[];
  check_in_time: string | null;
  check_out_time: string | null;
  cancellation_policy: string | null;
}

export interface AirbnbReview {
  author: string;
  rating: number | null;
  date: string;
  text: string;
  response: string | null;
}

export interface MarketStats {
  location: string;
  avg_daily_rate: number | null;
  median_daily_rate: number | null;
  total_listings: number;
  avg_rating: number | null;
  superhost_pct: number | null;
  price_distribution: {
    under_100: number;
    range_100_200: number;
    range_200_300: number;
    range_300_500: number;
    over_500: number;
  };
  property_types: Record<string, number>;
}

// ─── HELPERS ────────────────────────────────────────

const AIRBNB_BASE = 'https://www.airbnb.com';

// Airbnb uses a specific API key for their explore endpoint
const API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20';

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

async function fetchAirbnbPage(url: string): Promise<string> {
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 25_000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    if (response.status === 403) throw new Error('Airbnb blocked the request (403). Proxy IP may be flagged.');
    throw new Error(`Airbnb returned ${response.status}`);
  }

  return response.text();
}

async function fetchAirbnbApi(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${AIRBNB_BASE}/api/v3/${path}`);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await proxyFetch(url.toString(), {
    maxRetries: 2,
    timeoutMs: 25_000,
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'X-Airbnb-API-Key': API_KEY,
      'User-Agent': 'Airbnb/24.10 iPhone/17.0 Type/Phone',
    },
  });

  if (!response.ok) {
    throw new Error(`Airbnb API returned ${response.status}`);
  }

  return response.json();
}

// ─── SEARCH SCRAPER ─────────────────────────────────

function parseListingFromHtml(html: string): AirbnbListing[] {
  const listings: AirbnbListing[] = [];

  // Airbnb embeds listing data in a JSON script tag
  const jsonMatch = html.match(/<!--(.*?)-->/s);
  const dataScript = extractBetween(html, 'data-deferred-state-0="', '"');

  // Try to find listing data in the page's embedded JSON
  // Look for the StaySearchResults data
  const stayResultsMatch = html.match(/"searchResults"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (stayResultsMatch) {
    try {
      const results = JSON.parse(stayResultsMatch[1]);
      for (const item of results) {
        if (item?.listing) {
          listings.push(parseListingData(item.listing, item.pricingQuote));
        }
      }
      return listings;
    } catch { /* fall through to HTML parsing */ }
  }

  // Fallback: parse from HTML structure
  // Find listing cards by their data patterns
  const cards = html.split('data-testid="card-container"');
  for (let i = 1; i < cards.length; i++) {
    const card = cards[i];
    const endIdx = card.indexOf('data-testid="card-container"');
    const cardHtml = endIdx > 0 ? card.slice(0, endIdx) : card.slice(0, 5000);

    // Extract listing ID from URL
    const idMatch = cardHtml.match(/\/rooms\/(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Title
    const titleMatch = cardHtml.match(/data-testid="listing-card-title"[^>]*>([^<]+)/);
    const title = titleMatch ? cleanText(titleMatch[1]) : '';

    // Type
    const typeMatch = cardHtml.match(/data-testid="listing-card-subtitle"[^>]*>([^<]+)/);
    const type = typeMatch ? cleanText(typeMatch[1]) : '';

    // Price
    let pricePerNight: number | null = null;
    const priceMatch = cardHtml.match(/\$(\d[\d,]*)\s*(?:night|per night)/i) ||
                       cardHtml.match(/(\d[\d,]*)\s*(?:USD|EUR|GBP)/);
    if (priceMatch) {
      pricePerNight = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    // Rating
    let rating: number | null = null;
    const ratingMatch = cardHtml.match(/([\d.]+)\s*(?:\(|out of|★)/);
    if (ratingMatch) rating = parseFloat(ratingMatch[1]);

    // Reviews count
    let reviewsCount: number | null = null;
    const reviewsMatch = cardHtml.match(/\((\d[\d,]*)\s*(?:review|rating)/i);
    if (reviewsMatch) reviewsCount = parseInt(reviewsMatch[1].replace(/,/g, ''));

    // Superhost
    const superhost = cardHtml.toLowerCase().includes('superhost');

    // Images
    const images: string[] = [];
    const imgMatches = cardHtml.matchAll(/src="(https:\/\/a0\.muscache\.com[^"]+)"/g);
    for (const im of imgMatches) {
      if (!images.includes(im[1])) images.push(im[1]);
    }

    // Bedrooms/bathrooms/guests from subtitle
    let bedrooms = 0, bathrooms = 0, maxGuests = 0;
    const specMatch = cardHtml.match(/(\d+)\s*bed(?:room)?s?\b/i);
    if (specMatch) bedrooms = parseInt(specMatch[1]);
    const bathMatch = cardHtml.match(/(\d+)\s*bath(?:room)?s?\b/i);
    if (bathMatch) bathrooms = parseInt(bathMatch[1]);
    const guestMatch = cardHtml.match(/(\d+)\s*guests?\b/i);
    if (guestMatch) maxGuests = parseInt(guestMatch[1]);

    if (id && (title || pricePerNight)) {
      listings.push({
        id,
        title,
        type,
        price_per_night: pricePerNight,
        total_price: null,
        currency: 'USD',
        rating,
        reviews_count: reviewsCount,
        superhost,
        bedrooms,
        bathrooms,
        max_guests: maxGuests,
        amenities: [],
        images: images.slice(0, 5),
        url: `${AIRBNB_BASE}/rooms/${id}`,
        lat: null,
        lng: null,
      });
    }
  }

  return listings;
}

function parseListingData(listing: any, pricing?: any): AirbnbListing {
  return {
    id: String(listing.id || listing.listingId || ''),
    title: listing.name || listing.title || '',
    type: listing.roomTypeCategory || listing.propertyType || listing.room_type || '',
    price_per_night: pricing?.rate?.amount || pricing?.pricePerNight || null,
    total_price: pricing?.total?.amount || null,
    currency: pricing?.rate?.currency || pricing?.currency || 'USD',
    rating: listing.avgRating || listing.reviewsRating || null,
    reviews_count: listing.reviewsCount || listing.numberOfReviews || null,
    superhost: listing.isSuperhost || listing.is_superhost || false,
    bedrooms: listing.bedrooms || 0,
    bathrooms: listing.bathrooms || 0,
    max_guests: listing.personCapacity || listing.maxGuests || 0,
    amenities: (listing.previewAmenities || listing.amenityIds || []).slice(0, 20),
    images: (listing.contextualPictures || listing.photos || [])
      .map((p: any) => p.picture || p.large || p.url || '')
      .filter(Boolean)
      .slice(0, 5),
    url: `${AIRBNB_BASE}/rooms/${listing.id || listing.listingId}`,
    lat: listing.lat || listing.coordinate?.latitude || null,
    lng: listing.lng || listing.coordinate?.longitude || null,
  };
}

export async function searchAirbnb(
  location: string,
  checkin?: string,
  checkout?: string,
  guests: number = 2,
  priceMin?: number,
  priceMax?: number,
  limit: number = 20,
): Promise<AirbnbListing[]> {
  // Build search URL
  let url = `${AIRBNB_BASE}/s/${encodeURIComponent(location)}/homes`;
  const params = new URLSearchParams();
  if (checkin) params.set('checkin', checkin);
  if (checkout) params.set('checkout', checkout);
  params.set('adults', String(Math.max(1, guests)));
  if (priceMin) params.set('price_min', String(priceMin));
  if (priceMax) params.set('price_max', String(priceMax));
  params.set('search_type', 'filter_change');

  const fullUrl = `${url}?${params.toString()}`;
  const html = await fetchAirbnbPage(fullUrl);
  const listings = parseListingFromHtml(html);

  return listings.slice(0, limit);
}

// ─── LISTING DETAIL SCRAPER ─────────────────────────

export async function getListingDetail(listingId: string): Promise<AirbnbListingDetail> {
  const url = `${AIRBNB_BASE}/rooms/${listingId}`;
  const html = await fetchAirbnbPage(url);

  // Try to extract structured data from JSON-LD or embedded data
  let data: any = {};
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (jsonLdMatch) {
    try {
      data = JSON.parse(jsonLdMatch[1]);
    } catch { /* ignore */ }
  }

  // Title
  const title = data.name || cleanText(extractBetween(html, '<h1', '</h1>') || '');

  // Description
  const descBlock = extractBetween(html, 'data-section-id="DESCRIPTION_DEFAULT"', '</section>') ||
                    extractBetween(html, 'data-testid="listing-description"', '</div>');
  const description = descBlock ? cleanText(descBlock).slice(0, 3000) : (data.description || '');

  // Price
  let pricePerNight: number | null = null;
  const priceMatch = html.match(/\$(\d[\d,]*)\s*(?:\/?\s*night|per night)/i);
  if (priceMatch) pricePerNight = parseInt(priceMatch[1].replace(/,/g, ''));

  // Rating
  let rating: number | null = null;
  if (data.aggregateRating?.ratingValue) {
    rating = parseFloat(data.aggregateRating.ratingValue);
  } else {
    const ratingMatch = html.match(/([\d.]+)\s*·\s*\d+\s*review/);
    if (ratingMatch) rating = parseFloat(ratingMatch[1]);
  }

  // Reviews count
  let reviewsCount: number | null = null;
  if (data.aggregateRating?.reviewCount) {
    reviewsCount = parseInt(data.aggregateRating.reviewCount);
  } else {
    const rcMatch = html.match(/(\d[\d,]*)\s*review/i);
    if (rcMatch) reviewsCount = parseInt(rcMatch[1].replace(/,/g, ''));
  }

  // Type
  const typeMatch = html.match(/data-testid="listing-type"[^>]*>([^<]+)/);
  const type = typeMatch ? cleanText(typeMatch[1]) : (data['@type'] || '');

  // Host
  const hostMatch = html.match(/Hosted by\s*([^<]+)/);
  const hostName = hostMatch ? cleanText(hostMatch[1]) : '';
  const superhost = html.toLowerCase().includes('superhost');

  // Response rate/time
  const responseRateMatch = html.match(/Response rate:\s*(\d+%)/);
  const responseTimeMatch = html.match(/Response time:\s*([^<]+)</);

  // Bedrooms, bathrooms, guests
  let bedrooms = 0, bathrooms = 0, maxGuests = 0;
  const specMatch = html.match(/(\d+)\s*bedroom/i);
  if (specMatch) bedrooms = parseInt(specMatch[1]);
  const bathMatch = html.match(/(\d+)\s*bathroom/i);
  if (bathMatch) bathrooms = parseInt(bathMatch[1]);
  const guestMatch = html.match(/(\d+)\s*guest/i);
  if (guestMatch) maxGuests = parseInt(guestMatch[1]);

  // Amenities
  const amenities: string[] = [];
  const amenityBlock = extractBetween(html, 'data-section-id="AMENITIES_DEFAULT"', '</section>');
  if (amenityBlock) {
    const items = amenityBlock.match(/>([^<]{3,50})</g);
    if (items) {
      for (const item of items) {
        const clean = cleanText(item.slice(1));
        if (clean && clean.length > 2 && !clean.includes('{') && !amenities.includes(clean)) {
          amenities.push(clean);
        }
      }
    }
  }

  // Images
  const images: string[] = [];
  const imgMatches = html.matchAll(/src="(https:\/\/a0\.muscache\.com[^"]+)"/g);
  for (const im of imgMatches) {
    if (!images.includes(im[1])) images.push(im[1]);
  }

  // House rules
  const houseRules: string[] = [];
  const rulesBlock = extractBetween(html, 'data-section-id="POLICIES_DEFAULT"', '</section>');
  if (rulesBlock) {
    const ruleItems = rulesBlock.match(/>([^<]{5,80})</g);
    if (ruleItems) {
      for (const item of ruleItems) {
        const clean = cleanText(item.slice(1));
        if (clean && clean.length > 4 && !clean.includes('{')) houseRules.push(clean);
      }
    }
  }

  // Check-in/out
  const checkinMatch = html.match(/Check-in[:\s]*([^<]+)/i);
  const checkoutMatch = html.match(/Check(?:out|-out)[:\s]*([^<]+)/i);

  // Cancellation
  const cancelMatch = html.match(/(Free cancellation|Strict|Moderate|Flexible)\s*(?:cancellation)?/i);

  // Neighborhood
  const neighborhoodMatch = html.match(/data-section-id="LOCATION_DEFAULT"[\s\S]*?<h3[^>]*>([^<]+)/);

  return {
    id: listingId,
    title,
    type,
    price_per_night: pricePerNight,
    total_price: null,
    currency: 'USD',
    rating,
    reviews_count: reviewsCount,
    superhost,
    bedrooms,
    bathrooms,
    max_guests: maxGuests,
    amenities: amenities.slice(0, 30),
    images: images.slice(0, 10),
    url: `${AIRBNB_BASE}/rooms/${listingId}`,
    lat: null,
    lng: null,
    description,
    neighborhood: neighborhoodMatch ? cleanText(neighborhoodMatch[1]) : null,
    host: {
      name: hostName,
      superhost,
      response_rate: responseRateMatch ? responseRateMatch[1] : null,
      response_time: responseTimeMatch ? cleanText(responseTimeMatch[1]) : null,
    },
    house_rules: houseRules.slice(0, 10),
    check_in_time: checkinMatch ? cleanText(checkinMatch[1]) : null,
    check_out_time: checkoutMatch ? cleanText(checkoutMatch[1]) : null,
    cancellation_policy: cancelMatch ? cancelMatch[0] : null,
  };
}

// ─── REVIEWS SCRAPER ────────────────────────────────

export async function getListingReviews(
  listingId: string,
  limit: number = 10,
): Promise<AirbnbReview[]> {
  const url = `${AIRBNB_BASE}/rooms/${listingId}/reviews`;
  const html = await fetchAirbnbPage(url);
  const reviews: AirbnbReview[] = [];

  // Try to parse reviews from the page
  const reviewBlocks = html.split('data-testid="pdp-review"');
  for (let i = 1; i < reviewBlocks.length && reviews.length < limit; i++) {
    const block = reviewBlocks[i];
    const endIdx = block.indexOf('data-testid="pdp-review"');
    const reviewHtml = endIdx > 0 ? block.slice(0, endIdx) : block.slice(0, 3000);

    // Author
    const authorMatch = reviewHtml.match(/class="[^"]*"[^>]*>([^<]+)<\/(?:h[23]|span|div)/);
    const author = authorMatch ? cleanText(authorMatch[1]) : 'Guest';

    // Date
    const dateMatch = reviewHtml.match(/(\w+\s+\d{4})/);
    const date = dateMatch ? dateMatch[1] : '';

    // Rating
    let rating: number | null = null;
    const ratingMatch = reviewHtml.match(/([\d.]+)\s*(?:out of|★|star)/i);
    if (ratingMatch) rating = parseFloat(ratingMatch[1]);

    // Text
    const textMatch = reviewHtml.match(/data-testid="pdp-review-text"[^>]*>([\s\S]*?)<\/(?:span|div)/);
    const text = textMatch ? cleanText(textMatch[1]) : '';

    // Host response
    let response: string | null = null;
    const responseMatch = reviewHtml.match(/Response from[^:]*:([\s\S]*?)<\/(?:span|div)/);
    if (responseMatch) response = cleanText(responseMatch[1]);

    if (text || author !== 'Guest') {
      reviews.push({ author, rating, date, text: text.slice(0, 2000), response });
    }
  }

  // Fallback: try to extract from embedded JSON
  if (reviews.length === 0) {
    const jsonMatch = html.match(/"reviews"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        for (const r of parsed) {
          if (reviews.length >= limit) break;
          reviews.push({
            author: r.reviewer?.firstName || r.author || 'Guest',
            rating: r.rating || null,
            date: r.createdAt || r.date || '',
            text: (r.comments || r.text || '').slice(0, 2000),
            response: r.response?.comments || null,
          });
        }
      } catch { /* ignore */ }
    }
  }

  return reviews;
}

// ─── MARKET STATS ───────────────────────────────────

export async function getMarketStats(
  location: string,
  checkin?: string,
  checkout?: string,
): Promise<MarketStats> {
  // Fetch a large set of listings to compute stats
  const listings = await searchAirbnb(location, checkin, checkout, 2, undefined, undefined, 100);

  const prices = listings.map(l => l.price_per_night).filter((p): p is number => p !== null && p > 0);
  const ratings = listings.map(l => l.rating).filter((r): r is number => r !== null);

  // Price statistics
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const avg = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  const median = sortedPrices.length > 0
    ? sortedPrices[Math.floor(sortedPrices.length / 2)]
    : null;

  // Rating average
  const avgRating = ratings.length > 0
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null;

  // Superhost percentage
  const superhostCount = listings.filter(l => l.superhost).length;
  const superhostPct = listings.length > 0
    ? Math.round((superhostCount / listings.length) * 100)
    : null;

  // Price distribution
  const priceDistribution = {
    under_100: prices.filter(p => p < 100).length,
    range_100_200: prices.filter(p => p >= 100 && p < 200).length,
    range_200_300: prices.filter(p => p >= 200 && p < 300).length,
    range_300_500: prices.filter(p => p >= 300 && p < 500).length,
    over_500: prices.filter(p => p >= 500).length,
  };

  // Property type distribution
  const propertyTypes: Record<string, number> = {};
  for (const l of listings) {
    const t = l.type || 'Unknown';
    propertyTypes[t] = (propertyTypes[t] || 0) + 1;
  }

  return {
    location,
    avg_daily_rate: avg,
    median_daily_rate: median,
    total_listings: listings.length,
    avg_rating: avgRating,
    superhost_pct: superhostPct,
    price_distribution: priceDistribution,
    property_types: propertyTypes,
  };
}