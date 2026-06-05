/**
 * Real Estate Listing Aggregator
 * ──────────────────────────────
 * Scrapes property listings from Zillow, Realtor.com, Redfin.
 * Extracts price, beds/baths, sqft, address, and listing status.
 *
 * Bounty: Wave 2 — $50 Real Estate Listing Aggregator
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ───────────────────────────────────────────

export interface RealEstateListing {
  /** Property address */
  address: string;
  /** Listing price */
  price: number | null;
  /** Currency */
  currency: string;
  /** Number of bedrooms */
  beds: number | null;
  /** Number of bathrooms */
  baths: number | null;
  /** Square footage */
  sqft: number | null;
  /** Property type (house, condo, apartment) */
  propertyType: string | null;
  /** Listing status (for_sale, for_rent, sold, pending) */
  status: 'for_sale' | 'for_rent' | 'sold' | 'pending' | 'unknown';
  /** Year built */
  yearBuilt: number | null;
  /** Lot size in acres */
  lotSize: number | null;
  /** Listing URL */
  url: string;
  /** Source platform */
  source: string;
  /** Main image URL */
  image: string | null;
  /** Days on market */
  daysOnMarket: number | null;
  /** Timestamp of this check (ISO 8601) */
  checkedAt: string;
}

export interface RealEstateResponse {
  query: { location: string; type: string; limit: number };
  results: RealEstateListing[];
  totalFound: number;
  priceRange: { min: number | null; max: number | null; avg: number | null };
}

// ─── SEARCH URL BUILDERS ─────────────────────────────

function buildZillowUrl(location: string, type: string): string {
  const q = encodeURIComponent(location);
  const filter = type === 'rent' ? '_fsrp' : '';
  return `https://www.zillow.com/homes/${q}_rb/${filter}`;
}

function buildRealtorUrl(location: string, type: string): string {
  const q = encodeURIComponent(location);
  const listingType = type === 'rent' ? 'for-rent' : 'realestate';
  return `https://www.realtor.com/${listingType}/${q}`;
}

function buildRedfinUrl(location: string, type: string): string {
  const q = encodeURIComponent(location.replace(/\s+/g, '-').toLowerCase());
  const filter = type === 'rent' ? '/apartments-for-rent' : '';
  return `https://www.redfin.com/city/0/${q}${filter}`;
}

// ─── EXTRACTION ──────────────────────────────────────

function extractFromJsonLd(html: string): RealEstateListing[] {
  const results: RealEstateListing[] = [];
  const regex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = data['@graph'] || [data];

      for (const item of items) {
        if (item['@type'] === 'SingleFamilyResidence' || item['@type'] === 'Residence' || 
            item['@type'] === 'Apartment' || item['@type'] === 'RealEstateListing') {
          
          const addr = item.address || {};
          const fullAddr = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
            .filter(Boolean).join(', ');

          let status: RealEstateListing['status'] = 'unknown';
          if (item.listingStatus) {
            const s = item.listingStatus.toLowerCase();
            if (s.includes('sale') || s.includes('active')) status = 'for_sale';
            else if (s.includes('rent')) status = 'for_rent';
            else if (s.includes('sold')) status = 'sold';
            else if (s.includes('pending')) status = 'pending';
          }

          results.push({
            address: fullAddr || item.name || '',
            price: item.offers?.price ? parseFloat(item.offers.price) : null,
            currency: item.offers?.priceCurrency || 'USD',
            beds: item.numberOfBedrooms || item.bedrooms || null,
            baths: item.numberOfBathroomsTotal || item.bathrooms || null,
            sqft: item.floorSize?.value || item.livingArea || null,
            propertyType: item.propertyType || item['@type']?.replace('SingleFamilyResidence', 'House') || null,
            status,
            yearBuilt: item.yearBuilt || null,
            lotSize: item.lotSize?.value || null,
            url: item.url || '',
            source: 'zillow',
            image: item.image || item.photo?.[0] || null,
            daysOnMarket: null,
            checkedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}
  }
  return results;
}

function extractFromHtml(html: string, url: string, source: string): RealEstateListing[] {
  const results: RealEstateListing[] = [];
  
  // Extract price cards
  const cardRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
  const cards = html.match(cardRegex) || [];
  
  for (const card of cards) {
    // Price
    const priceMatch = card.match(/(?:[$])\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    // Address
    const addrMatch = card.match(/<address[^>]*>([\s\S]*?)<\/address>/i) || 
                      card.match(/(?:data-testid="property-address")[^>]*>([^<]+)/i);
    const address = addrMatch ? decodeHtmlEntities(addrMatch[1].replace(/<[^>]+>/g, '').trim()) : '';

    // Beds/baths/sqft
    const bedsMatch = card.match(/(\d+)\s*(?:bd|bed|beds)/i);
    const bathsMatch = card.match(/(\d+)\s*(?:ba|bath|baths)/i);
    const sqftMatch = card.match(/([\d,]+)\s*(?:sqft|sq ft|sq\. ft\.|ft²)/i);

    if (price || address) {
      results.push({
        address: address || 'Unknown',
        price,
        currency: 'USD',
        beds: bedsMatch ? parseInt(bedsMatch[1]) : null,
        baths: bathsMatch ? parseInt(bathsMatch[1]) : null,
        sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
        propertyType: null,
        status: 'for_sale',
        yearBuilt: null,
        lotSize: null,
        url,
        source,
        image: null,
        daysOnMarket: null,
        checkedAt: new Date().toISOString(),
      });
      if (results.length >= 20) break;
    }
  }

  return results;
}

// ─── MAIN SCRAPER ────────────────────────────────────

async function scrapeRealEstateSource(
  source: string,
  url: string,
): Promise<RealEstateListing[]> {
  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) return [];
  const html = await response.text();
  if (html.length < 1000) return [];

  // Try JSON-LD first
  let results = extractFromJsonLd(html);
  if (results.length === 0) {
    results = extractFromHtml(html, url, source);
  }

  // Tag source
  results.forEach(r => { r.source = source; });
  return results;
}

export async function aggregateRealEstate(
  location: string,
  type: 'sale' | 'rent' = 'sale',
  limit: number = 20,
): Promise<RealEstateResponse> {
  const sources = [
    { name: 'zillow', build: buildZillowUrl },
    { name: 'realtor', build: buildRealtorUrl },
    { name: 'redfin', build: buildRedfinUrl },
  ];

  const allResults: RealEstateListing[] = [];

  const tasks = sources.map(async ({ name, build }) => {
    const url = build(location, type);
    try {
      const results = await scrapeRealEstateSource(name, url);
      allResults.push(...results);
    } catch {}
  });

  await Promise.allSettled(tasks);

  allResults.sort((a, b) => {
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  });

  const prices = allResults.filter(r => r.price !== null).map(r => r.price!);

  return {
    query: { location, type, limit },
    results: allResults.slice(0, limit),
    totalFound: allResults.length,
    priceRange: {
      min: prices.length > 0 ? Math.min(...prices) : null,
      max: prices.length > 0 ? Math.max(...prices) : null,
      avg: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    },
  };
}
