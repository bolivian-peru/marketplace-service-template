/**
 * Zillow Real Estate Listing Intelligence Scraper (Bounty #79)
 * ─────────────────────────────────────────────────────────────
 * Scrapes Zillow property listings, Zestimates, market trends,
 * comparable properties, and neighborhood stats via mobile proxy.
 *
 * Zillow embeds structured property data in JSON within their pages.
 * We parse both the HTML and embedded JSON for maximum data extraction.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface ZillowProperty {
  zpid: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  price: number | null;
  zestimate: number | null;
  rent_zestimate: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lot_size: string | null;
  year_built: number | null;
  property_type: string;
  listing_status: string;
  days_on_zillow: number | null;
  price_per_sqft: number | null;
  hoa_fee: number | null;
  tax_assessed_value: number | null;
  annual_tax: number | null;
  url: string;
  images: string[];
  lat: number | null;
  lng: number | null;
}

export interface ZillowPropertyDetail extends ZillowProperty {
  description: string;
  features: string[];
  appliances: string[];
  heating: string | null;
  cooling: string | null;
  parking: string | null;
  construction: string | null;
  roof: string | null;
  flooring: string[];
  school_district: string | null;
  nearby_schools: SchoolInfo[];
  price_history: PriceHistoryEntry[];
  tax_history: TaxHistoryEntry[];
  agent: AgentInfo | null;
  broker: string | null;
  mls_id: string | null;
}

export interface SchoolInfo {
  name: string;
  rating: number | null;
  level: string;
  distance: string | null;
  type: string;
}

export interface PriceHistoryEntry {
  date: string;
  event: string;
  price: number | null;
  source: string | null;
}

export interface TaxHistoryEntry {
  year: number;
  tax: number | null;
  assessment: number | null;
}

export interface AgentInfo {
  name: string;
  phone: string | null;
  brokerage: string | null;
}

export interface ZillowComparable {
  zpid: string;
  address: string;
  price: number | null;
  zestimate: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  year_built: number | null;
  distance_miles: number | null;
  sold_date: string | null;
  sold_price: number | null;
  similarity_score: number | null;
  url: string;
}

export interface ZillowMarketTrends {
  location: string;
  median_list_price: number | null;
  median_sale_price: number | null;
  median_zestimate: number | null;
  avg_price_per_sqft: number | null;
  median_days_on_market: number | null;
  total_listings: number;
  new_listings_30d: number | null;
  price_reduced_pct: number | null;
  median_rent: number | null;
  yoy_price_change: number | null;
  inventory_months: number | null;
  price_distribution: {
    under_200k: number;
    range_200k_400k: number;
    range_400k_600k: number;
    range_600k_800k: number;
    range_800k_1m: number;
    over_1m: number;
  };
  property_types: Record<string, number>;
}

export interface NeighborhoodStats {
  location: string;
  median_home_value: number | null;
  median_rent: number | null;
  population: number | null;
  median_income: number | null;
  walkability_score: number | null;
  transit_score: number | null;
  bike_score: number | null;
  crime_rate: string | null;
  school_rating_avg: number | null;
  nearby_amenities: AmenityCount;
  market_temperature: string | null;
  appreciation_rate: number | null;
}

export interface AmenityCount {
  restaurants: number;
  grocery_stores: number;
  parks: number;
  schools: number;
  hospitals: number;
  shopping: number;
}

export interface ZestimateData {
  zpid: string;
  address: string;
  zestimate: number | null;
  zestimate_low: number | null;
  zestimate_high: number | null;
  rent_zestimate: number | null;
  last_updated: string | null;
  value_change_30d: number | null;
  value_change_1yr: number | null;
  tax_assessment: number | null;
}

// ─── HELPERS ────────────────────────────────────────

const ZILLOW_BASE = 'https://www.zillow.com';

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

function safeParseInt(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseInt(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

function safeParseFloat(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchZillowPage(url: string): Promise<string> {
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 25_000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (!response.ok) {
    if (response.status === 403) throw new Error('Zillow blocked the request (403). Proxy IP may be flagged.');
    if (response.status === 429) throw new Error('Rate limited by Zillow (429). Try again later.');
    throw new Error(`Zillow returned ${response.status}`);
  }

  return response.text();
}

async function fetchZillowApi(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${ZILLOW_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await proxyFetch(url.toString(), {
    maxRetries: 2,
    timeoutMs: 25_000,
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Zillow API returned ${response.status}`);
  }

  return response.json();
}

function extractEmbeddedJson(html: string): any | null {
  // Zillow embeds property data in a preloaded state script
  const patterns = [
    /<!--"(\{.*?)"-->/s,
    /"queryData"\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*"[a-zA-Z]|\})/,
    /"cat1"\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*"cat2"|\})/,
    /"searchResults"\s*:\s*(\{[\s\S]*?\})\s*[,}]/,
    /"listResults"\s*:\s*(\[[\s\S]*?\])\s*[,}]/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        let jsonStr = match[1];
        // Unescape HTML entities in JSON
        jsonStr = jsonStr
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        return JSON.parse(jsonStr);
      } catch { /* try next pattern */ }
    }
  }

  return null;
}

function parsePropertyFromJson(item: any): ZillowProperty {
  const addr = item.address || item.hdpData?.homeInfo || {};
  const streetAddr = addr.streetAddress || item.streetAddress || item.addressStreet || '';
  const city = addr.city || item.city || '';
  const state = addr.state || item.state || '';
  const zip = addr.zipcode || item.zipcode || '';

  return {
    zpid: String(item.zpid || item.id || ''),
    address: streetAddr || item.address || '',
    city,
    state,
    zipcode: zip,
    price: safeParseInt(item.price || item.unformattedPrice || item.hdpData?.homeInfo?.price),
    zestimate: safeParseInt(item.zestimate || item.hdpData?.homeInfo?.zestimate),
    rent_zestimate: safeParseInt(item.rentZestimate || item.hdpData?.homeInfo?.rentZestimate),
    bedrooms: safeParseInt(item.beds || item.bedrooms || item.hdpData?.homeInfo?.bedrooms),
    bathrooms: safeParseFloat(item.baths || item.bathrooms || item.hdpData?.homeInfo?.bathrooms),
    sqft: safeParseInt(item.area || item.livingArea || item.hdpData?.homeInfo?.livingArea),
    lot_size: item.lotSize || item.lotAreaString || item.hdpData?.homeInfo?.lotAreaString || null,
    year_built: safeParseInt(item.yearBuilt || item.hdpData?.homeInfo?.yearBuilt),
    property_type: item.homeType || item.propertyType || item.hdpData?.homeInfo?.homeType || 'Unknown',
    listing_status: item.statusText || item.homeStatus || item.listingStatus || item.hdpData?.homeInfo?.homeStatus || 'Unknown',
    days_on_zillow: safeParseInt(item.daysOnZillow || item.timeOnZillow || item.hdpData?.homeInfo?.daysOnZillow),
    price_per_sqft: safeParseInt(item.hdpData?.homeInfo?.pricePerSquareFoot),
    hoa_fee: safeParseInt(item.hoaFee || item.hdpData?.homeInfo?.monthlyHoaFee),
    tax_assessed_value: safeParseInt(item.taxAssessedValue || item.hdpData?.homeInfo?.taxAssessedValue),
    annual_tax: safeParseInt(item.propertyTaxRate || item.hdpData?.homeInfo?.taxAnnualAmount),
    url: item.detailUrl
      ? `${ZILLOW_BASE}${item.detailUrl.startsWith('/') ? '' : '/'}${item.detailUrl}`
      : `${ZILLOW_BASE}/homedetails/${item.zpid || ''}_zpid/`,
    images: (item.carouselPhotos || item.photos || item.images || [])
      .map((p: any) => p.url || p.mixedSources?.jpeg?.[0]?.url || p.href || '')
      .filter(Boolean)
      .slice(0, 8),
    lat: safeParseFloat(item.latLong?.latitude || item.latitude || item.lat),
    lng: safeParseFloat(item.latLong?.longitude || item.longitude || item.lng),
  };
}

// ─── PROPERTY SEARCH ────────────────────────────────

export async function searchProperties(
  location: string,
  options: {
    status?: string;        // 'for_sale' | 'for_rent' | 'recently_sold'
    price_min?: number;
    price_max?: number;
    beds_min?: number;
    beds_max?: number;
    baths_min?: number;
    property_type?: string; // 'house' | 'condo' | 'townhouse' | 'multi-family' | 'land'
    sort?: string;          // 'newest' | 'price_low' | 'price_high' | 'beds' | 'sqft'
    limit?: number;
  } = {},
): Promise<ZillowProperty[]> {
  const {
    status = 'for_sale',
    price_min,
    price_max,
    beds_min,
    beds_max,
    baths_min,
    property_type,
    sort = 'newest',
    limit = 20,
  } = options;

  // Build search URL
  const encodedLocation = encodeURIComponent(location.replace(/\s+/g, '-'));
  let searchPath = `/${encodedLocation}/`;

  // Status-based URL suffix
  if (status === 'for_rent') {
    searchPath += 'rentals/';
  } else if (status === 'recently_sold') {
    searchPath += 'sold/';
  }

  const params = new URLSearchParams();
  params.set('searchQueryState', JSON.stringify({
    usersSearchTerm: location,
    filterState: {
      ...(price_min ? { price: { min: price_min } } : {}),
      ...(price_max ? { price: { ...((price_min ? { min: price_min } : {})), max: price_max } } : {}),
      ...(beds_min ? { beds: { min: beds_min } } : {}),
      ...(beds_max ? { beds: { ...((beds_min ? { min: beds_min } : {})), max: beds_max } } : {}),
      ...(baths_min ? { baths: { min: baths_min } } : {}),
      ...(property_type ? { homeType: { value: property_type } } : {}),
      sort: { value: sort === 'newest' ? 'days' : sort === 'price_low' ? 'pricea' : sort === 'price_high' ? 'priced' : 'size' },
      ...(status === 'for_rent' ? { isForRent: { value: true }, isForSaleByAgent: { value: false }, isForSaleByOwner: { value: false } } : {}),
      ...(status === 'recently_sold' ? { isRecentlySold: { value: true }, isForSaleByAgent: { value: false }, isForSaleByOwner: { value: false } } : {}),
    },
  }));

  const fullUrl = `${ZILLOW_BASE}${searchPath}?${params.toString()}`;
  const html = await fetchZillowPage(fullUrl);

  const listings: ZillowProperty[] = [];

  // Try to extract from embedded JSON data
  const embedded = extractEmbeddedJson(html);
  if (embedded) {
    const results = embedded.listResults || embedded.searchResults?.listResults || [];
    for (const item of results) {
      if (listings.length >= limit) break;
      listings.push(parsePropertyFromJson(item));
    }
  }

  // Fallback: parse from HTML
  if (listings.length === 0) {
    listings.push(...parsePropertiesFromHtml(html, limit));
  }

  return listings.slice(0, limit);
}

function parsePropertiesFromHtml(html: string, limit: number): ZillowProperty[] {
  const listings: ZillowProperty[] = [];

  // Try finding the property cards
  const cards = html.split('data-test="property-card"');
  for (let i = 1; i < cards.length && listings.length < limit; i++) {
    const card = cards[i];
    const cardHtml = card.slice(0, 5000);

    // ZPID
    const zpidMatch = cardHtml.match(/\/(\d+)_zpid/) || cardHtml.match(/zpid[":]+(\d+)/);
    const zpid = zpidMatch ? zpidMatch[1] : '';

    // Address
    const addrMatch = cardHtml.match(/data-test="property-card-addr"[^>]*>([^<]+)/);
    const address = addrMatch ? cleanText(addrMatch[1]) : '';

    // Price
    const priceMatch = cardHtml.match(/data-test="property-card-price"[^>]*>([^<]+)/) ||
                       cardHtml.match(/\$(\d[\d,]+)/);
    const price = priceMatch ? safeParseInt(priceMatch[1]) : null;

    // Beds/baths/sqft
    const bedsMatch = cardHtml.match(/(\d+)\s*(?:bd|bed|bds)/i);
    const bathsMatch = cardHtml.match(/([\d.]+)\s*(?:ba|bath)/i);
    const sqftMatch = cardHtml.match(/([\d,]+)\s*(?:sqft|sq\s*ft)/i);

    // Status
    const statusMatch = cardHtml.match(/data-test="property-card-status"[^>]*>([^<]+)/);

    // Images
    const images: string[] = [];
    const imgMatches = cardHtml.matchAll(/src="(https:\/\/[^"]*photos\.zillowstatic\.com[^"]+)"/g);
    for (const im of imgMatches) {
      if (!images.includes(im[1])) images.push(im[1]);
    }

    // Detail URL
    const urlMatch = cardHtml.match(/href="(\/homedetails\/[^"]+)"/);

    // Parse address components
    const addrParts = address.split(',').map(s => s.trim());
    const stateZip = (addrParts[2] || '').trim().split(/\s+/);

    if (zpid || address) {
      listings.push({
        zpid,
        address: addrParts[0] || address,
        city: addrParts[1] || '',
        state: stateZip[0] || '',
        zipcode: stateZip[1] || '',
        price,
        zestimate: null,
        rent_zestimate: null,
        bedrooms: bedsMatch ? safeParseInt(bedsMatch[1]) : null,
        bathrooms: bathsMatch ? safeParseFloat(bathsMatch[1]) : null,
        sqft: sqftMatch ? safeParseInt(sqftMatch[1]) : null,
        lot_size: null,
        year_built: null,
        property_type: 'Unknown',
        listing_status: statusMatch ? cleanText(statusMatch[1]) : 'For Sale',
        days_on_zillow: null,
        price_per_sqft: null,
        hoa_fee: null,
        tax_assessed_value: null,
        annual_tax: null,
        url: urlMatch ? `${ZILLOW_BASE}${urlMatch[1]}` : `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`,
        images: images.slice(0, 5),
        lat: null,
        lng: null,
      });
    }
  }

  return listings;
}

// ─── PROPERTY DETAIL ────────────────────────────────

export async function getPropertyDetail(zpid: string): Promise<ZillowPropertyDetail> {
  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  const html = await fetchZillowPage(url);

  let data: any = {};

  // Try JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (jsonLdMatch) {
    try { data = JSON.parse(jsonLdMatch[1]); } catch { /* ignore */ }
  }

  // Try embedded API data
  const apiDataMatch = html.match(/"apiCache"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (apiDataMatch) {
    try {
      const decoded = apiDataMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\');
      const parsed = JSON.parse(decoded);
      const detailKey = Object.keys(parsed).find(k => k.includes('ForSale') || k.includes('property'));
      if (detailKey) {
        data = { ...data, ...(parsed[detailKey]?.property || parsed[detailKey]) };
      }
    } catch { /* ignore */ }
  }

  // Try preloaded state
  const preloadMatch = html.match(/"gdpClientCache"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (preloadMatch) {
    try {
      const decoded = preloadMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const parsed = JSON.parse(decoded);
      const key = Object.keys(parsed)[0];
      if (key) {
        const propData = JSON.parse(parsed[key])?.property;
        if (propData) data = { ...data, ...propData };
      }
    } catch { /* ignore */ }
  }

  // Title / address
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const titleText = titleMatch ? cleanText(titleMatch[1]) : '';

  const address = data.streetAddress || data.address?.streetAddress || extractBetween(html, 'data-testid="bdp-summary-address"', '</') || titleText.split('|')[0]?.trim() || '';

  // Price
  let price: number | null = safeParseInt(data.price);
  if (!price) {
    const priceMatch = html.match(/\$(\d[\d,]+)\s*(?:<|\/|\s)/);
    if (priceMatch) price = safeParseInt(priceMatch[1]);
  }

  // Zestimate
  let zestimate: number | null = safeParseInt(data.zestimate);
  if (!zestimate) {
    const zestMatch = html.match(/Zestimate[^$]*\$(\d[\d,]+)/i);
    if (zestMatch) zestimate = safeParseInt(zestMatch[1]);
  }

  // Rent zestimate
  let rentZest: number | null = safeParseInt(data.rentZestimate);
  if (!rentZest) {
    const rentMatch = html.match(/Rent Zestimate[^$]*\$(\d[\d,]+)/i);
    if (rentMatch) rentZest = safeParseInt(rentMatch[1]);
  }

  // Description
  const descBlock = extractBetween(html, 'data-testid="description"', '</div>') ||
                    extractBetween(html, '"description":', '",') ||
                    data.description || '';
  const description = cleanText(descBlock).slice(0, 3000);

  // Beds / baths / sqft
  const beds = safeParseInt(data.bedrooms || data.beds);
  const baths = safeParseFloat(data.bathrooms || data.baths);
  const sqft = safeParseInt(data.livingArea || data.livingAreaValue);
  const yearBuilt = safeParseInt(data.yearBuilt);

  // Features extraction from HTML
  const features: string[] = [];
  const featuresBlock = extractBetween(html, 'data-testid="home-facts"', '</section>') ||
                        extractBetween(html, '"homeFactsSection"', '</section>');
  if (featuresBlock) {
    const items = featuresBlock.match(/>([^<]{3,80})</g);
    if (items) {
      for (const item of items) {
        const clean = cleanText(item.slice(1));
        if (clean && clean.length > 2 && !clean.includes('{') && !features.includes(clean)) {
          features.push(clean);
        }
      }
    }
  }

  // Home details
  const heating = extractBetween(html, 'Heating:', '<') || data.heatingSystem || null;
  const cooling = extractBetween(html, 'Cooling:', '<') || data.coolingSystem || null;
  const parking = extractBetween(html, 'Parking:', '<') || data.parkingFeatures || null;
  const construction = extractBetween(html, 'Construction:', '<') || data.constructionMaterials || null;
  const roof = extractBetween(html, 'Roof:', '<') || data.roof || null;

  // Flooring
  const flooring: string[] = [];
  const floorMatch = html.match(/Flooring[:\s]*([^<]+)/i);
  if (floorMatch) {
    flooring.push(...floorMatch[1].split(',').map(s => s.trim()).filter(Boolean));
  }

  // Appliances
  const appliances: string[] = [];
  const applianceMatch = html.match(/Appliances[:\s]*([^<]+)/i);
  if (applianceMatch) {
    appliances.push(...applianceMatch[1].split(',').map(s => s.trim()).filter(Boolean));
  }

  // Price history
  const priceHistory: PriceHistoryEntry[] = [];
  const priceHistoryData = data.priceHistory || [];
  for (const entry of priceHistoryData) {
    priceHistory.push({
      date: entry.date || entry.time || '',
      event: entry.event || entry.priceChangeType || '',
      price: safeParseInt(entry.price),
      source: entry.source || entry.buyerAgent?.name || null,
    });
  }

  // If no JSON price history, try HTML
  if (priceHistory.length === 0) {
    const historyBlock = extractBetween(html, 'Price History', '</table>') || '';
    const rows = historyBlock.split('<tr');
    for (let i = 1; i < rows.length && priceHistory.length < 20; i++) {
      const dateMatch = rows[i].match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      const eventMatch = rows[i].match(/>([^<]*(?:Listed|Sold|Price change|Pending|Removed)[^<]*)</i);
      const priceMatch = rows[i].match(/\$(\d[\d,]+)/);
      if (dateMatch) {
        priceHistory.push({
          date: dateMatch[1],
          event: eventMatch ? cleanText(eventMatch[1]) : '',
          price: priceMatch ? safeParseInt(priceMatch[1]) : null,
          source: null,
        });
      }
    }
  }

  // Tax history
  const taxHistory: TaxHistoryEntry[] = [];
  const taxHistoryData = data.taxHistory || [];
  for (const entry of taxHistoryData) {
    taxHistory.push({
      year: safeParseInt(entry.time || entry.year) || 0,
      tax: safeParseInt(entry.taxPaid || entry.tax),
      assessment: safeParseInt(entry.value || entry.taxAssessment),
    });
  }

  // Schools
  const nearbySchools: SchoolInfo[] = [];
  const schoolsData = data.schools || data.nearbySchools || [];
  for (const school of schoolsData) {
    nearbySchools.push({
      name: school.name || school.schoolName || '',
      rating: safeParseInt(school.rating || school.greatSchoolsRating),
      level: school.level || school.grades || '',
      distance: school.distance ? `${school.distance} mi` : null,
      type: school.type || school.schoolType || 'public',
    });
  }

  // Agent info
  let agent: AgentInfo | null = null;
  const agentName = data.listingAgent?.name || extractBetween(html, 'listing-agent-name', '</');
  if (agentName) {
    agent = {
      name: cleanText(agentName),
      phone: data.listingAgent?.phone || extractBetween(html, 'listing-agent-phone', '</') || null,
      brokerage: data.brokerageName || extractBetween(html, 'listing-broker-name', '</') || null,
    };
  }

  // MLS ID
  const mlsMatch = html.match(/MLS[#:\s]*([A-Z0-9-]+)/i) || html.match(/"mlsId"\s*:\s*"([^"]+)"/);
  const mlsId = mlsMatch ? mlsMatch[1] : null;

  // Broker
  const broker = data.brokerageName || extractBetween(html, 'brokerage-name', '</') || null;

  // School district
  const schoolDistrict = data.schoolDistrict?.name || extractBetween(html, 'School District', '</') || null;

  // Images
  const images: string[] = [];
  const imgMatches = html.matchAll(/src="(https:\/\/[^"]*(?:photos\.zillowstatic|zillowstatic)[^"]+)"/g);
  for (const im of imgMatches) {
    if (!images.includes(im[1])) images.push(im[1]);
  }

  // City, state, zip
  const addrParts = address.split(',').map((s: string) => s.trim());
  const stateZip = (addrParts[2] || '').trim().split(/\s+/);

  return {
    zpid,
    address: data.streetAddress || addrParts[0] || address,
    city: data.city || addrParts[1] || '',
    state: data.state || stateZip[0] || '',
    zipcode: data.zipcode || stateZip[1] || '',
    price,
    zestimate,
    rent_zestimate: rentZest,
    bedrooms: beds,
    bathrooms: baths,
    sqft,
    lot_size: data.lotAreaString || data.lotSize || null,
    year_built: yearBuilt,
    property_type: data.homeType || data.propertyType || 'Unknown',
    listing_status: data.homeStatus || data.listingStatus || 'Unknown',
    days_on_zillow: safeParseInt(data.daysOnZillow),
    price_per_sqft: safeParseInt(data.resoFacts?.pricePerSquareFoot),
    hoa_fee: safeParseInt(data.monthlyHoaFee || data.hoaFee),
    tax_assessed_value: safeParseInt(data.taxAssessedValue),
    annual_tax: safeParseInt(data.taxAnnualAmount),
    url: `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`,
    images: images.slice(0, 15),
    lat: safeParseFloat(data.latitude || data.lat),
    lng: safeParseFloat(data.longitude || data.lng),
    description,
    features: features.slice(0, 30),
    appliances: appliances.slice(0, 15),
    heating: heating ? cleanText(heating) : null,
    cooling: cooling ? cleanText(cooling) : null,
    parking: parking ? cleanText(parking) : null,
    construction: construction ? cleanText(construction) : null,
    roof: roof ? cleanText(roof) : null,
    flooring: flooring.slice(0, 10),
    school_district: schoolDistrict ? cleanText(schoolDistrict) : null,
    nearby_schools: nearbySchools.slice(0, 10),
    price_history: priceHistory.slice(0, 20),
    tax_history: taxHistory.slice(0, 10),
    agent,
    broker: broker ? cleanText(broker) : null,
    mls_id: mlsId,
  };
}

// ─── ZESTIMATE TRACKING ─────────────────────────────

export async function getZestimate(zpid: string): Promise<ZestimateData> {
  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  const html = await fetchZillowPage(url);

  let data: any = {};

  // Extract embedded data
  const preloadMatch = html.match(/"gdpClientCache"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (preloadMatch) {
    try {
      const decoded = preloadMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const parsed = JSON.parse(decoded);
      const key = Object.keys(parsed)[0];
      if (key) {
        data = JSON.parse(parsed[key])?.property || {};
      }
    } catch { /* ignore */ }
  }

  // Address
  const address = data.streetAddress || data.address?.streetAddress || '';
  const fullAddress = address
    ? `${address}, ${data.city || ''} ${data.state || ''} ${data.zipcode || ''}`
    : '';

  // Zestimate
  let zestimate = safeParseInt(data.zestimate);
  let zestimateLow = safeParseInt(data.zestimateLowPercent);
  let zestimateHigh = safeParseInt(data.zestimateHighPercent);

  // Calculate low/high from percentages if available
  if (zestimate && zestimateLow && typeof zestimateLow === 'number') {
    zestimateLow = Math.round(zestimate * (1 - zestimateLow / 100));
  }
  if (zestimate && zestimateHigh && typeof zestimateHigh === 'number') {
    zestimateHigh = Math.round(zestimate * (1 + zestimateHigh / 100));
  }

  // Fallback: try HTML
  if (!zestimate) {
    const zestMatch = html.match(/Zestimate[^$]*\$(\d[\d,]+)/i);
    if (zestMatch) zestimate = safeParseInt(zestMatch[1]);
  }

  // Rent zestimate
  let rentZest = safeParseInt(data.rentZestimate);
  if (!rentZest) {
    const rentMatch = html.match(/Rent Zestimate[^$]*\$(\d[\d,]+)/i);
    if (rentMatch) rentZest = safeParseInt(rentMatch[1]);
  }

  // Value changes
  let change30d: number | null = null;
  let change1yr: number | null = null;
  const change30Match = html.match(/30-day change[^$+-]*([+-]?\$[\d,]+)/i);
  if (change30Match) change30d = safeParseInt(change30Match[1]);
  const change1yrMatch = html.match(/1-year change[^$+-]*([+-]?\$[\d,]+)/i);
  if (change1yrMatch) change1yr = safeParseInt(change1yrMatch[1]);

  // Last updated
  const updatedMatch = html.match(/(?:Updated|As of)\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i);

  return {
    zpid,
    address: fullAddress || address,
    zestimate,
    zestimate_low: zestimateLow,
    zestimate_high: zestimateHigh,
    rent_zestimate: rentZest,
    last_updated: updatedMatch ? updatedMatch[1] : null,
    value_change_30d: change30d,
    value_change_1yr: change1yr,
    tax_assessment: safeParseInt(data.taxAssessedValue),
  };
}

// ─── COMPARABLE PROPERTIES ──────────────────────────

export async function getComparables(zpid: string, limit: number = 10): Promise<ZillowComparable[]> {
  // Zillow shows comps on the property detail page
  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  const html = await fetchZillowPage(url);

  const comps: ZillowComparable[] = [];

  // Try embedded JSON comps data
  const compsMatch = html.match(/"comps"\s*:\s*(\[[\s\S]*?\])\s*[,}]/) ||
                     html.match(/"nearbyHomes"\s*:\s*(\[[\s\S]*?\])\s*[,}]/) ||
                     html.match(/"similarHomes"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);

  if (compsMatch) {
    try {
      const compsData = JSON.parse(compsMatch[1]);
      for (const comp of compsData) {
        if (comps.length >= limit) break;
        comps.push({
          zpid: String(comp.zpid || ''),
          address: comp.address?.streetAddress || comp.formattedAddress || comp.address || '',
          price: safeParseInt(comp.price),
          zestimate: safeParseInt(comp.zestimate),
          bedrooms: safeParseInt(comp.bedrooms || comp.beds),
          bathrooms: safeParseFloat(comp.bathrooms || comp.baths),
          sqft: safeParseInt(comp.livingArea || comp.area),
          year_built: safeParseInt(comp.yearBuilt),
          distance_miles: safeParseFloat(comp.distance),
          sold_date: comp.dateSold || comp.lastSoldDate || null,
          sold_price: safeParseInt(comp.lastSoldPrice),
          similarity_score: safeParseFloat(comp.similarityScore || comp.score),
          url: comp.zpid ? `${ZILLOW_BASE}/homedetails/${comp.zpid}_zpid/` : '',
        });
      }
    } catch { /* ignore */ }
  }

  // Fallback: parse nearby homes from HTML
  if (comps.length === 0) {
    const nearbySection = extractBetween(html, 'Nearby homes', '</section>') ||
                          extractBetween(html, 'Similar homes', '</section>') || '';
    const cardBlocks = nearbySection.split(/data-test="property-card"|class="list-card/);
    for (let i = 1; i < cardBlocks.length && comps.length < limit; i++) {
      const block = cardBlocks[i].slice(0, 3000);
      const zpidMatch = block.match(/\/(\d+)_zpid/);
      const addrMatch = block.match(/>([^<]*\d+[^<]*(?:St|Ave|Rd|Dr|Blvd|Ln|Ct|Way|Pl|Cir)[^<]*)</i);
      const priceMatch = block.match(/\$(\d[\d,]+)/);
      const bedsMatch = block.match(/(\d+)\s*(?:bd|bed)/i);
      const bathsMatch = block.match(/([\d.]+)\s*(?:ba|bath)/i);
      const sqftMatch = block.match(/([\d,]+)\s*(?:sqft|sq\s*ft)/i);

      if (zpidMatch || addrMatch) {
        comps.push({
          zpid: zpidMatch ? zpidMatch[1] : '',
          address: addrMatch ? cleanText(addrMatch[1]) : '',
          price: priceMatch ? safeParseInt(priceMatch[1]) : null,
          zestimate: null,
          bedrooms: bedsMatch ? safeParseInt(bedsMatch[1]) : null,
          bathrooms: bathsMatch ? safeParseFloat(bathsMatch[1]) : null,
          sqft: sqftMatch ? safeParseInt(sqftMatch[1]) : null,
          year_built: null,
          distance_miles: null,
          sold_date: null,
          sold_price: null,
          similarity_score: null,
          url: zpidMatch ? `${ZILLOW_BASE}/homedetails/${zpidMatch[1]}_zpid/` : '',
        });
      }
    }
  }

  return comps.slice(0, limit);
}

// ─── MARKET TRENDS ──────────────────────────────────

export async function getMarketTrends(location: string): Promise<ZillowMarketTrends> {
  // Fetch listings to compute market trends
  const listings = await searchProperties(location, { limit: 100 });

  const prices = listings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0);
  const sqftPrices = listings
    .map(l => l.price_per_sqft)
    .filter((p): p is number => p !== null && p > 0);
  const daysOnMarket = listings
    .map(l => l.days_on_zillow)
    .filter((d): d is number => d !== null && d >= 0);
  const zestimates = listings
    .map(l => l.zestimate)
    .filter((z): z is number => z !== null && z > 0);

  // Sort prices for median
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianListPrice = sortedPrices.length > 0
    ? sortedPrices[Math.floor(sortedPrices.length / 2)]
    : null;

  // Average price per sqft
  const avgPricePerSqft = sqftPrices.length > 0
    ? Math.round(sqftPrices.reduce((a, b) => a + b, 0) / sqftPrices.length)
    : null;

  // Median days on market
  const sortedDays = [...daysOnMarket].sort((a, b) => a - b);
  const medianDays = sortedDays.length > 0
    ? sortedDays[Math.floor(sortedDays.length / 2)]
    : null;

  // Median zestimate
  const sortedZest = [...zestimates].sort((a, b) => a - b);
  const medianZest = sortedZest.length > 0
    ? sortedZest[Math.floor(sortedZest.length / 2)]
    : null;

  // New listings (last 30 days)
  const newListings = listings.filter(l =>
    l.days_on_zillow !== null && l.days_on_zillow <= 30
  ).length;

  // Price reduced percentage
  const priceReduced = listings.filter(l =>
    l.listing_status?.toLowerCase().includes('price') ||
    l.listing_status?.toLowerCase().includes('reduced')
  ).length;
  const priceReducedPct = listings.length > 0
    ? Math.round((priceReduced / listings.length) * 100)
    : null;

  // Price distribution
  const priceDistribution = {
    under_200k: prices.filter(p => p < 200000).length,
    range_200k_400k: prices.filter(p => p >= 200000 && p < 400000).length,
    range_400k_600k: prices.filter(p => p >= 400000 && p < 600000).length,
    range_600k_800k: prices.filter(p => p >= 600000 && p < 800000).length,
    range_800k_1m: prices.filter(p => p >= 800000 && p < 1000000).length,
    over_1m: prices.filter(p => p >= 1000000).length,
  };

  // Property type distribution
  const propertyTypes: Record<string, number> = {};
  for (const l of listings) {
    const t = l.property_type || 'Unknown';
    propertyTypes[t] = (propertyTypes[t] || 0) + 1;
  }

  // Rent zestimates for median rent
  const rents = listings
    .map(l => l.rent_zestimate)
    .filter((r): r is number => r !== null && r > 0);
  const sortedRents = [...rents].sort((a, b) => a - b);
  const medianRent = sortedRents.length > 0
    ? sortedRents[Math.floor(sortedRents.length / 2)]
    : null;

  return {
    location,
    median_list_price: medianListPrice,
    median_sale_price: null, // Would require recently_sold data
    median_zestimate: medianZest,
    avg_price_per_sqft: avgPricePerSqft,
    median_days_on_market: medianDays,
    total_listings: listings.length,
    new_listings_30d: newListings,
    price_reduced_pct: priceReducedPct,
    median_rent: medianRent,
    yoy_price_change: null, // Would require historical data
    inventory_months: null, // Would require sales velocity data
    price_distribution: priceDistribution,
    property_types: propertyTypes,
  };
}

// ─── NEIGHBORHOOD STATS ─────────────────────────────

export async function getNeighborhoodStats(location: string): Promise<NeighborhoodStats> {
  // Fetch the Zillow neighborhood page
  const encodedLocation = encodeURIComponent(location.replace(/\s+/g, '-'));
  const url = `${ZILLOW_BASE}/${encodedLocation}/`;
  const html = await fetchZillowPage(url);

  // Also fetch some listings for value data
  const listings = await searchProperties(location, { limit: 50 });

  // Median home value from listings
  const prices = listings
    .map(l => l.price || l.zestimate)
    .filter((p): p is number => p !== null && p > 0);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianHomeValue = sortedPrices.length > 0
    ? sortedPrices[Math.floor(sortedPrices.length / 2)]
    : null;

  // Median rent
  const rents = listings
    .map(l => l.rent_zestimate)
    .filter((r): r is number => r !== null && r > 0);
  const sortedRents = [...rents].sort((a, b) => a - b);
  const medianRent = sortedRents.length > 0
    ? sortedRents[Math.floor(sortedRents.length / 2)]
    : null;

  // Walk/transit/bike scores from HTML
  let walkScore: number | null = null;
  let transitScore: number | null = null;
  let bikeScore: number | null = null;

  const walkMatch = html.match(/Walk Score[^0-9]*(\d{1,3})/i);
  if (walkMatch) walkScore = safeParseInt(walkMatch[1]);
  const transitMatch = html.match(/Transit Score[^0-9]*(\d{1,3})/i);
  if (transitMatch) transitScore = safeParseInt(transitMatch[1]);
  const bikeMatch = html.match(/Bike Score[^0-9]*(\d{1,3})/i);
  if (bikeMatch) bikeScore = safeParseInt(bikeMatch[1]);

  // Population
  const popMatch = html.match(/Population[^0-9]*(\d[\d,]+)/i);
  const population = popMatch ? safeParseInt(popMatch[1]) : null;

  // Median income
  const incomeMatch = html.match(/Median (?:household )?income[^$]*\$(\d[\d,]+)/i);
  const medianIncome = incomeMatch ? safeParseInt(incomeMatch[1]) : null;

  // Crime rate
  const crimeMatch = html.match(/(Low|Below Average|Average|Above Average|High)\s*(?:crime|safety)/i);
  const crimeRate = crimeMatch ? crimeMatch[1] : null;

  // School rating average — would need detail page data per listing
  const schoolRatings: number[] = [];

  // Market temperature
  let marketTemp: string | null = null;
  if (html.includes('Hot') || html.includes('hot market')) marketTemp = 'Hot';
  else if (html.includes('Warm') || html.includes('warm market')) marketTemp = 'Warm';
  else if (html.includes('Cool') || html.includes('cool market')) marketTemp = 'Cool';
  else if (html.includes('Cold') || html.includes('cold market')) marketTemp = 'Cold';

  // Appreciation rate
  const appreciationMatch = html.match(/(?:appreciation|value change)[^0-9+-]*([+-]?\d+\.?\d*)%/i);
  const appreciationRate = appreciationMatch ? safeParseFloat(appreciationMatch[1]) : null;

  return {
    location,
    median_home_value: medianHomeValue,
    median_rent: medianRent,
    population,
    median_income: medianIncome,
    walkability_score: walkScore,
    transit_score: transitScore,
    bike_score: bikeScore,
    crime_rate: crimeRate,
    school_rating_avg: null,
    nearby_amenities: {
      restaurants: 0,
      grocery_stores: 0,
      parks: 0,
      schools: 0,
      hospitals: 0,
      shopping: 0,
    },
    market_temperature: marketTemp,
    appreciation_rate: appreciationRate,
  };
}
