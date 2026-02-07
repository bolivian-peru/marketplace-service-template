/**
 * ┌─────────────────────────────────────────────────┐
 * │    Real Estate Listing Aggregator               │
 * │    Zillow, Redfin, Realtor.com data            │
 * │    Price, history, schools, agent info          │
 * └─────────────────────────────────────────────────┘
 * 
 * Bounty: https://github.com/bolivian-peru/marketplace-service-template/issues/15
 * Price: $0.01 per listing ($50 bounty)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const realEstateRouter = new Hono();

// ─── CONFIGURATION ─────────────────────────────────
const SERVICE_NAME = 'real-estate-aggregator';
const PRICE_USDC = 0.01;  // $0.01 per listing
const DESCRIPTION = 'Aggregate property listings from Zillow, Redfin, Realtor.com. Get price, beds/baths, sqft, price history, days on market, school ratings, listing agent.';

const OUTPUT_SCHEMA = {
  input: {
    location: 'string — ZIP code or city name (required)',
    priceMin: 'number — Minimum price filter (optional)',
    priceMax: 'number — Maximum price filter (optional)',
    beds: 'number — Minimum bedrooms (optional)',
    baths: 'number — Minimum bathrooms (optional)',
    limit: 'number — Max results (default: 20, max: 100)',
    source: 'string — Specific source: zillow, redfin, realtor, or all (default: all)',
  },
  output: {
    location: 'string — Search location used',
    listings: [{
      id: 'string — Listing ID',
      source: 'string — Data source (zillow/redfin/realtor)',
      address: 'string — Full property address',
      city: 'string — City name',
      state: 'string — State code',
      zipCode: 'string — ZIP code',
      price: 'number — Current listing price',
      priceHistory: '[{ date: string, price: number, event: string }] — Price changes',
      beds: 'number — Bedrooms',
      baths: 'number — Bathrooms (including half baths)',
      sqft: 'number — Square footage',
      lotSize: 'string | null — Lot size',
      yearBuilt: 'number | null — Year built',
      propertyType: 'string — Property type (Single Family, Condo, etc)',
      daysOnMarket: 'number — Days since listed',
      listingAgent: '{ name: string, phone: string, brokerage: string } | null',
      schoolRatings: '[{ name: string, rating: number, distance: string, type: string }] | null',
      coordinates: '{ lat: number, lng: number }',
      images: 'string[] — Image URLs',
      listingUrl: 'string — Original listing URL',
    }],
    metadata: {
      totalFound: 'number — Total listings matching criteria',
      returned: 'number — Listings in this response',
      sources: 'string[] — Sources queried',
      scrapedAt: 'string — ISO timestamp',
    },
  },
};

// ─── TYPES ─────────────────────────────────────────

interface PriceHistoryEntry {
  date: string;
  price: number;
  event: string;
}

interface SchoolRating {
  name: string;
  rating: number;
  distance: string;
  type: string;
}

interface ListingAgent {
  name: string;
  phone: string;
  brokerage: string;
}

interface PropertyListing {
  id: string;
  source: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  price: number;
  priceHistory: PriceHistoryEntry[];
  beds: number;
  baths: number;
  sqft: number;
  lotSize: string | null;
  yearBuilt: number | null;
  propertyType: string;
  daysOnMarket: number;
  listingAgent: ListingAgent | null;
  schoolRatings: SchoolRating[] | null;
  coordinates: { lat: number; lng: number };
  images: string[];
  listingUrl: string;
}

// ─── ZILLOW SCRAPER ─────────────────────────────────

async function scrapeZillow(location: string, filters: any, limit: number): Promise<PropertyListing[]> {
  const listings: PropertyListing[] = [];
  const proxy = await getProxy('mobile');
  
  // Normalize location for Zillow URL
  const normalizedLocation = location.replace(/\s+/g, '-').toLowerCase();
  const searchUrl = `https://www.zillow.com/homes/${normalizedLocation}_rb/`;
  
  try {
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Extract JSON data from page script
    const dataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
    if (dataMatch) {
      const pageData = JSON.parse(dataMatch[1]);
      const searchResults = pageData?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults || [];
      
      for (const result of searchResults.slice(0, limit)) {
        const listing: PropertyListing = {
          id: result.zpid || result.id || `zillow-${Date.now()}-${Math.random()}`,
          source: 'zillow',
          address: result.address || result.streetAddress || 'Address unavailable',
          city: result.addressCity || extractCity(result.address),
          state: result.addressState || extractState(result.address),
          zipCode: result.addressZipcode || extractZip(result.address),
          price: result.price || result.unformattedPrice || 0,
          priceHistory: extractPriceHistory(result.priceHistory),
          beds: result.beds || 0,
          baths: result.baths || 0,
          sqft: result.area || result.livingArea || 0,
          lotSize: result.lotAreaString || result.lotSize || null,
          yearBuilt: result.yearBuilt || null,
          propertyType: result.hdpData?.homeInfo?.homeType || result.propertyType || 'Unknown',
          daysOnMarket: result.daysOnZillow || calculateDaysOnMarket(result.dateSold),
          listingAgent: extractAgent(result.brokerName, result.brokerPhone),
          schoolRatings: null, // Requires additional request
          coordinates: {
            lat: result.latLong?.latitude || result.latitude || 0,
            lng: result.latLong?.longitude || result.longitude || 0,
          },
          images: extractImages(result.carouselPhotos || result.photos),
          listingUrl: result.detailUrl || `https://www.zillow.com/homedetails/${result.zpid}_zpid/`,
        };
        
        // Apply filters
        if (filters.priceMin && listing.price < filters.priceMin) continue;
        if (filters.priceMax && listing.price > filters.priceMax) continue;
        if (filters.beds && listing.beds < filters.beds) continue;
        if (filters.baths && listing.baths < filters.baths) continue;
        
        listings.push(listing);
      }
    }
    
    // Fallback: parse HTML directly if JSON not found
    if (listings.length === 0) {
      const cardPattern = /<article[^>]*data-test="property-card"[^>]*>([\s\S]*?)<\/article>/g;
      let match;
      while ((match = cardPattern.exec(html)) !== null && listings.length < limit) {
        const card = match[1];
        const listing = parseListingCard(card, 'zillow');
        if (listing) listings.push(listing);
      }
    }
    
  } catch (error) {
    console.error('Zillow scrape error:', error);
  }
  
  return listings;
}

// ─── REDFIN SCRAPER ─────────────────────────────────

async function scrapeRedfin(location: string, filters: any, limit: number): Promise<PropertyListing[]> {
  const listings: PropertyListing[] = [];
  const proxy = await getProxy('mobile');
  
  // Redfin API endpoint
  const searchQuery = encodeURIComponent(location);
  const apiUrl = `https://www.redfin.com/stingray/do/location-autocomplete?location=${searchQuery}&v=2`;
  
  try {
    // First, get location info
    const locationResponse = await proxyFetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
      },
    }, proxy);
    
    let locationText = await locationResponse.text();
    // Redfin returns JSON with prefix
    if (locationText.startsWith('{}&&')) {
      locationText = locationText.substring(4);
    }
    
    const locationData = JSON.parse(locationText);
    const regionId = locationData?.payload?.sections?.[0]?.rows?.[0]?.id;
    
    if (regionId) {
      // Fetch listings for this region
      const listingsUrl = `https://www.redfin.com/stingray/api/gis?al=1&region_id=${regionId}&region_type=6&num_homes=${limit}&v=8`;
      
      const listingsResponse = await proxyFetch(listingsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
          'Accept': 'application/json',
        },
      }, proxy);
      
      let listingsText = await listingsResponse.text();
      if (listingsText.startsWith('{}&&')) {
        listingsText = listingsText.substring(4);
      }
      
      const listingsData = JSON.parse(listingsText);
      const homes = listingsData?.payload?.homes || [];
      
      for (const home of homes.slice(0, limit)) {
        const listing: PropertyListing = {
          id: home.propertyId || home.mlsId || `redfin-${Date.now()}`,
          source: 'redfin',
          address: home.streetLine?.value || home.address || 'Address unavailable',
          city: home.city || '',
          state: home.state || '',
          zipCode: home.zip || '',
          price: home.price?.value || 0,
          priceHistory: home.priceHistory?.map((p: any) => ({
            date: p.date,
            price: p.price,
            event: p.eventDescription || 'Price Change',
          })) || [],
          beds: home.beds || 0,
          baths: home.baths || 0,
          sqft: home.sqFt?.value || 0,
          lotSize: home.lotSize?.value ? `${home.lotSize.value} sqft` : null,
          yearBuilt: home.yearBuilt || null,
          propertyType: home.propertyType || 'Unknown',
          daysOnMarket: home.dom || 0,
          listingAgent: home.listingAgent ? {
            name: home.listingAgent.name || 'Unknown',
            phone: home.listingAgent.phone || '',
            brokerage: home.listingAgent.brokerName || '',
          } : null,
          schoolRatings: home.schools?.map((s: any) => ({
            name: s.name,
            rating: s.rating || 0,
            distance: s.distance || '',
            type: s.type || 'Unknown',
          })) || null,
          coordinates: {
            lat: home.latLong?.latitude || 0,
            lng: home.latLong?.longitude || 0,
          },
          images: home.photos?.map((p: any) => p.photoUrls?.fullScreenPhotoUrl) || [],
          listingUrl: home.url ? `https://www.redfin.com${home.url}` : '',
        };
        
        if (filters.priceMin && listing.price < filters.priceMin) continue;
        if (filters.priceMax && listing.price > filters.priceMax) continue;
        if (filters.beds && listing.beds < filters.beds) continue;
        if (filters.baths && listing.baths < filters.baths) continue;
        
        listings.push(listing);
      }
    }
    
  } catch (error) {
    console.error('Redfin scrape error:', error);
  }
  
  return listings;
}

// ─── REALTOR.COM SCRAPER ────────────────────────────

async function scrapeRealtor(location: string, filters: any, limit: number): Promise<PropertyListing[]> {
  const listings: PropertyListing[] = [];
  const proxy = await getProxy('mobile');
  
  const normalizedLocation = location.replace(/\s+/g, '_').toLowerCase();
  const searchUrl = `https://www.realtor.com/realestateandhomes-search/${normalizedLocation}`;
  
  try {
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Extract JSON from script tag
    const dataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
    if (dataMatch) {
      const pageData = JSON.parse(dataMatch[1]);
      const searchResults = pageData?.props?.pageProps?.properties || 
                           pageData?.props?.pageProps?.searchResults?.home_search?.results || [];
      
      for (const result of searchResults.slice(0, limit)) {
        const listing: PropertyListing = {
          id: result.property_id || result.listing_id || `realtor-${Date.now()}`,
          source: 'realtor',
          address: result.location?.address?.line || result.address?.line || 'Address unavailable',
          city: result.location?.address?.city || result.address?.city || '',
          state: result.location?.address?.state_code || result.address?.state_code || '',
          zipCode: result.location?.address?.postal_code || result.address?.postal_code || '',
          price: result.list_price || result.price || 0,
          priceHistory: extractRealtorPriceHistory(result.price_history || result.property_history),
          beds: result.description?.beds || result.beds || 0,
          baths: result.description?.baths || result.baths || 0,
          sqft: result.description?.sqft || result.sqft || 0,
          lotSize: result.description?.lot_sqft ? `${result.description.lot_sqft} sqft` : null,
          yearBuilt: result.description?.year_built || result.year_built || null,
          propertyType: result.description?.type || result.property_type || 'Unknown',
          daysOnMarket: result.list_date ? calculateDaysOnMarket(result.list_date) : 0,
          listingAgent: result.advertisers?.[0] ? {
            name: result.advertisers[0].name || 'Unknown',
            phone: result.advertisers[0].phone || '',
            brokerage: result.advertisers[0].broker?.name || '',
          } : null,
          schoolRatings: result.nearby_schools?.map((s: any) => ({
            name: s.name,
            rating: s.rating || 0,
            distance: s.distance_in_miles ? `${s.distance_in_miles} mi` : '',
            type: s.education_levels?.join(', ') || 'Unknown',
          })) || null,
          coordinates: {
            lat: result.location?.address?.coordinate?.lat || 0,
            lng: result.location?.address?.coordinate?.lon || 0,
          },
          images: result.photos?.map((p: any) => p.href) || result.primary_photo ? [result.primary_photo.href] : [],
          listingUrl: result.permalink ? `https://www.realtor.com/realestateandhomes-detail/${result.permalink}` : '',
        };
        
        if (filters.priceMin && listing.price < filters.priceMin) continue;
        if (filters.priceMax && listing.price > filters.priceMax) continue;
        if (filters.beds && listing.beds < filters.beds) continue;
        if (filters.baths && listing.baths < filters.baths) continue;
        
        listings.push(listing);
      }
    }
    
  } catch (error) {
    console.error('Realtor.com scrape error:', error);
  }
  
  return listings;
}

// ─── HELPER FUNCTIONS ──────────────────────────────

function extractCity(address: string): string {
  const parts = address?.split(',');
  return parts?.[1]?.trim() || '';
}

function extractState(address: string): string {
  const parts = address?.split(',');
  const stateZip = parts?.[2]?.trim() || '';
  return stateZip.split(' ')[0] || '';
}

function extractZip(address: string): string {
  const zipMatch = address?.match(/\b\d{5}(-\d{4})?\b/);
  return zipMatch?.[0] || '';
}

function extractPriceHistory(history: any): PriceHistoryEntry[] {
  if (!history || !Array.isArray(history)) return [];
  return history.map((h: any) => ({
    date: h.date || h.time || new Date().toISOString(),
    price: h.price || h.amount || 0,
    event: h.event || h.priceChangeRate ? 'Price Change' : 'Listed',
  }));
}

function extractRealtorPriceHistory(history: any): PriceHistoryEntry[] {
  if (!history || !Array.isArray(history)) return [];
  return history.map((h: any) => ({
    date: h.date || new Date().toISOString(),
    price: h.price || h.listing_price || 0,
    event: h.event_name || h.event || 'Update',
  }));
}

function calculateDaysOnMarket(dateString: string | undefined): number {
  if (!dateString) return 0;
  const listDate = new Date(dateString);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - listDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function extractAgent(name?: string, phone?: string): ListingAgent | null {
  if (!name) return null;
  return {
    name: name,
    phone: phone || '',
    brokerage: '',
  };
}

function extractImages(photos: any): string[] {
  if (!photos) return [];
  if (Array.isArray(photos)) {
    return photos.map((p: any) => p.url || p.href || p.mixedSources?.jpeg?.[0]?.url || '').filter(Boolean);
  }
  return [];
}

function parseListingCard(html: string, source: string): PropertyListing | null {
  try {
    const priceMatch = html.match(/\$[\d,]+/);
    const addressMatch = html.match(/address[^>]*>([^<]+)/i);
    const bedsMatch = html.match(/(\d+)\s*(?:bd|bed)/i);
    const bathsMatch = html.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath)/i);
    const sqftMatch = html.match(/([\d,]+)\s*(?:sqft|sq\s*ft)/i);
    
    if (!priceMatch) return null;
    
    return {
      id: `${source}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: source,
      address: addressMatch?.[1]?.trim() || 'Address unavailable',
      city: '',
      state: '',
      zipCode: '',
      price: parseInt(priceMatch[0].replace(/[$,]/g, '')) || 0,
      priceHistory: [],
      beds: parseInt(bedsMatch?.[1] || '0'),
      baths: parseFloat(bathsMatch?.[1] || '0'),
      sqft: parseInt(sqftMatch?.[1]?.replace(/,/g, '') || '0'),
      lotSize: null,
      yearBuilt: null,
      propertyType: 'Unknown',
      daysOnMarket: 0,
      listingAgent: null,
      schoolRatings: null,
      coordinates: { lat: 0, lng: 0 },
      images: [],
      listingUrl: '',
    };
  } catch {
    return null;
  }
}

// ─── MAIN ROUTE ────────────────────────────────────

realEstateRouter.post('/run', async (c) => {
  // Check for x402 payment
  const payment = extractPayment(c.req);
  
  if (!payment) {
    return c.json(build402Response(
      PRICE_USDC,
      SERVICE_NAME,
      DESCRIPTION,
      OUTPUT_SCHEMA
    ), 402);
  }
  
  // Verify payment
  const verified = await verifyPayment(payment, PRICE_USDC);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }
  
  // Parse request
  const body = await c.req.json();
  const { location, priceMin, priceMax, beds, baths, limit = 20, source = 'all' } = body;
  
  if (!location) {
    return c.json({ error: 'location is required (ZIP code or city name)' }, 400);
  }
  
  const filters = { priceMin, priceMax, beds, baths };
  const effectiveLimit = Math.min(limit, 100);
  
  // Scrape based on source selection
  let allListings: PropertyListing[] = [];
  const sourcesQueried: string[] = [];
  
  if (source === 'all' || source === 'zillow') {
    sourcesQueried.push('zillow');
    const zillowListings = await scrapeZillow(location, filters, effectiveLimit);
    allListings = allListings.concat(zillowListings);
  }
  
  if (source === 'all' || source === 'redfin') {
    sourcesQueried.push('redfin');
    const redfinListings = await scrapeRedfin(location, filters, effectiveLimit);
    allListings = allListings.concat(redfinListings);
  }
  
  if (source === 'all' || source === 'realtor') {
    sourcesQueried.push('realtor');
    const realtorListings = await scrapeRealtor(location, filters, effectiveLimit);
    allListings = allListings.concat(realtorListings);
  }
  
  // Deduplicate by address
  const seen = new Set<string>();
  const uniqueListings = allListings.filter(listing => {
    const key = listing.address.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Sort by price (ascending)
  uniqueListings.sort((a, b) => a.price - b.price);
  
  // Limit results
  const finalListings = uniqueListings.slice(0, effectiveLimit);
  
  return c.json({
    location,
    listings: finalListings,
    metadata: {
      totalFound: uniqueListings.length,
      returned: finalListings.length,
      sources: sourcesQueried,
      scrapedAt: new Date().toISOString(),
    },
  });
});

// ─── SCHEMA ENDPOINT ────────────────────────────────

realEstateRouter.get('/schema', (c) => {
  return c.json({
    service: SERVICE_NAME,
    description: DESCRIPTION,
    price: `$${PRICE_USDC} USDC per request`,
    schema: OUTPUT_SCHEMA,
  });
});

export default realEstateRouter;
