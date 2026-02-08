/**
 * Google Maps Scraper
 * ───────────────────
 * All Google Maps specific scraping, extraction, and parsing logic.
 */

import { proxyFetch } from '../proxy';
import type { BusinessData, BusinessHours, SearchResult } from '../types';
import {
  decodeHtmlEntities,
  decodeUnicodeEscapes,
  escapeRegex,
  extractPhoneFromText,
  extractAddressFromText,
  extractWebsiteFromText,
  extractRatingFromText,
  extractRatingFromContext,
  extractReviewCountFromText,
  extractReviewCountFromContext,
  extractPriceLevel,
  extractCategoriesFromText,
  extractCoordsFromContext,
  extractEmails,
  extractHours,
  extractCategories,
  isValidCategory,
} from '../utils/helpers';

// ─── GOOGLE MAPS URL BUILDERS ─────────────────────────

/**
 * Build Google Maps search URL for a category in a location
 */
export function buildSearchUrl(query: string, location: string, pageToken?: string): string {
  const searchTerm = encodeURIComponent(`${query} in ${location}`);
  
  let url = `https://www.google.com/maps/search/${searchTerm}`;
  
  if (pageToken) {
    url += `?start=${pageToken}`;
  }
  
  return url;
}

/**
 * Build the Google Maps local search API-like URL
 */
export function buildLocalSearchUrl(query: string, location: string, start: number = 0): string {
  const searchTerm = encodeURIComponent(`${query} in ${location}`);
  return `https://www.google.com/localservices/promos?src=2&q=${searchTerm}&start=${start}`;
}

// ─── BUSINESS NAME VALIDATION ─────────────────────────

/**
 * Check if a string is a valid business name
 */
export function isValidBusinessName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 80) return false;
  
  if (/^["'"']/.test(name)) return false;
  if (/["'"']$/.test(name) && name.split(/["'"']/).length > 2) return false;
  
  if (name.includes(' - ') && name.length > 50) return false;
  
  const wordCount = name.split(/\s+/).length;
  if (wordCount > 8) return false;
  
  const invalidPatterns = [
    /^results?\s*for/i,
    /^showing/i,
    /^map\s*data/i,
    /^google/i,
    /^\d+\s*results?/i,
    /^search/i,
    /^filters?/i,
    /^sort/i,
    /^rating/i,
    /^reviews?$/i,
    /^open\s*now/i,
    /^closed/i,
    /^hours/i,
    /^directions/i,
    /^website/i,
    /^call/i,
    /^share/i,
    /^save/i,
    /^more\s*info/i,
    /^see\s*more/i,
    /^sponsored/i,
    /^ad$/i,
    /^menu$/i,
    /^photos?$/i,
    /^overview$/i,
    /^about$/i,
    /free consult/i,
    /call us/i,
    /call today/i,
    /no insurance/i,
    /affordable/i,
    /highly rated/i,
    /best .+ in/i,
    /elevate your/i,
    /stylish atmosphere/i,
    /incredible experience/i,
    /authentic .+ food/i,
    /private event/i,
    /dental provider/i,
    /dental insurance/i,
    /savings plan/i,
    /showed up on time/i,
    /arrived early/i,
    /excellent job/i,
    /felt no pain/i,
    /very tasty/i,
    /great drinks/i,
    /friendly service/i,
    /fixed it/i,
    /found the leak/i,
    /diagnosed/i,
    /plumbing issues/i,
  ];
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(name)) return false;
  }
  
  if (!/[a-zA-Z]/.test(name)) return false;
  
  if (name === name.toUpperCase() && name.length > 20) return false;
  
  return true;
}

// ─── BUSINESS EXTRACTION FROM HTML ────────────────────

/**
 * Extract business data from Google Maps HTML response
 * Uses multiple strategies to parse Google's obfuscated HTML
 */
export function extractBusinessesFromHtml(html: string): BusinessData[] {
  const businesses: BusinessData[] = [];
  const seenNames = new Set<string>();
  
  // Strategy 1: Extract from embedded JavaScript data arrays
  const jsDataPattern = /\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\][^\]]*?"([^"]{2,100})"/g;
  let match;
  
  while ((match = jsDataPattern.exec(html)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    const name = decodeUnicodeEscapes(match[3]);
    
    if (isValidBusinessName(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      const business = createBusinessFromContext(html, name, { latitude: lat, longitude: lng });
      businesses.push(business);
    }
  }

  // Strategy 2: Extract from aria-label patterns (business cards)
  const ariaLabelPattern = /aria-label="([^"]+)"[^>]*(?:data-cid|data-pid|jsaction)="([^"]+)"/g;
  
  while ((match = ariaLabelPattern.exec(html)) !== null) {
    const name = decodeUnicodeEscapes(match[1]);
    const id = match[2];
    
    if (isValidBusinessName(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      const business = createBusinessFromContext(html, name, null, id);
      businesses.push(business);
    }
  }

  // Strategy 3: Extract from div class patterns with business info
  const divPattern = /class="[^"]*(?:fontHeadlineSmall|qBF1Pd|NrDZNb)[^"]*"[^>]*>([^<]+)</g;
  
  while ((match = divPattern.exec(html)) !== null) {
    const name = decodeUnicodeEscapes(match[1].trim());
    
    if (isValidBusinessName(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      const business = createBusinessFromContext(html, name, null);
      businesses.push(business);
    }
  }

  // Strategy 4: Extract from JSON-LD structured data
  const jsonLdPattern = /<script type="application\/ld\+json">([^<]+)<\/script>/g;
  
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(match[1]);
      const extracted = extractFromJsonLd(jsonData);
      for (const biz of extracted) {
        if (!seenNames.has(biz.name.toLowerCase())) {
          seenNames.add(biz.name.toLowerCase());
          businesses.push(biz);
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // Strategy 5: Parse the window.__WIZ_DATA__ or APP_INITIALIZATION_STATE
  const wizDataPattern = /window\.__WIZ_DATA__\s*=\s*(\[[\s\S]*?\]);/;
  const wizMatch = html.match(wizDataPattern);
  if (wizMatch) {
    try {
      const extracted = parseWizData(wizMatch[1]);
      for (const biz of extracted) {
        if (!seenNames.has(biz.name.toLowerCase())) {
          seenNames.add(biz.name.toLowerCase());
          businesses.push(biz);
        }
      }
    } catch {
      // Parse error, skip
    }
  }

  return businesses;
}

/**
 * Create a business object by extracting context from surrounding HTML
 */
export function createBusinessFromContext(
  html: string,
  name: string,
  coordinates: { latitude: number; longitude: number } | null,
  placeId?: string
): BusinessData {
  const business: BusinessData = {
    name: name.trim(),
    address: null,
    phone: null,
    website: null,
    email: null,
    hours: null,
    rating: null,
    reviewCount: null,
    categories: [],
    coordinates,
    placeId: placeId || null,
    priceLevel: null,
    permanentlyClosed: false,
  };

  const nameIndex = html.indexOf(name);
  if (nameIndex === -1) return business;
  
  const contextStart = Math.max(0, nameIndex - 500);
  const contextEnd = Math.min(html.length, nameIndex + 2000);
  const context = html.substring(contextStart, contextEnd);

  // Extract rating
  const ratingPatterns = [
    /(\d\.\d)\s*stars?/i,
    /rating[:\s]*(\d\.\d)/i,
    /aria-label="(\d\.?\d?)\s*stars?/i,
    />(\d\.\d)<\/span>[^<]*(?:star|rating)/i,
    /class="[^"]*(?:rating|stars)[^"]*"[^>]*>(\d\.?\d?)</i,
    /(\d\.\d)\s*\(\d+\)/,
  ];
  
  for (const pattern of ratingPatterns) {
    const ratingMatch = context.match(pattern);
    if (ratingMatch) {
      const rating = parseFloat(ratingMatch[1]);
      if (rating >= 1 && rating <= 5) {
        business.rating = rating;
        break;
      }
    }
  }

  // Extract review count
  const reviewPatterns = [
    /\((\d{1,3}(?:,\d{3})*)\s*(?:reviews?|review)\)/i,
    /(\d{1,3}(?:,\d{3})*)\s*(?:reviews?|review)/i,
    /(\d+)\s*Google\s*reviews?/i,
    />(\d{1,3}(?:,\d{3})*)<\/[^>]+>[^<]*review/i,
  ];
  
  for (const pattern of reviewPatterns) {
    const reviewMatch = context.match(pattern);
    if (reviewMatch) {
      business.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
      break;
    }
  }

  // Extract phone number
  const phonePatterns = [
    /(\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/,
    /(\(\d{3}\)\s*\d{3}[-.]?\d{4})/,
    /(?:phone|tel|call)[:\s]*(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i,
    /href="tel:([^"]+)"/,
  ];
  
  for (const pattern of phonePatterns) {
    const phoneMatch = context.match(pattern);
    if (phoneMatch) {
      business.phone = phoneMatch[1].trim();
      break;
    }
  }

  // Extract address
  const addressPatterns = [
    /(\d+\s+[\w\s]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Pl|Place)[^,]*,\s*[\w\s]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i,
    /(\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5})/i,
    /class="[^"]*(?:address|location)[^"]*"[^>]*>([^<]+)</i,
    /aria-label="[^"]*address[^"]*"[^>]*>([^<]+)</i,
  ];
  
  for (const pattern of addressPatterns) {
    const addressMatch = context.match(pattern);
    if (addressMatch && addressMatch[1].length > 10 && addressMatch[1].length < 200) {
      business.address = addressMatch[1].trim();
      break;
    }
  }

  // Extract website
  const websitePatterns = [
    /href="(https?:\/\/(?!(?:www\.)?google\.com|maps\.google|gstatic)[^\s"]+)"[^>]*>(?:[^<]*(?:website|visit|site|homepage))/i,
    /(?:website|site)[:\s]*<a[^>]*href="(https?:\/\/[^"]+)"/i,
    /data-url="(https?:\/\/(?!google|gstatic)[^"]+)"/i,
  ];
  
  for (const pattern of websitePatterns) {
    const websiteMatch = context.match(pattern);
    if (websiteMatch) {
      const url = websiteMatch[1];
      if (!url.includes('google.com') && !url.includes('gstatic.com')) {
        business.website = url;
        break;
      }
    }
  }

  // Extract price level
  const priceMatch = context.match(/(\${1,4})\s*(?:·|•|-|<)/);
  if (priceMatch) {
    business.priceLevel = priceMatch[1];
  }

  // Extract categories
  const categoryPatterns = [
    /·\s*([A-Za-z\s&]+?)\s*(?:·|<|$)/g,
    /class="[^"]*(?:category|type)[^"]*"[^>]*>([^<]+)</gi,
  ];
  
  for (const pattern of categoryPatterns) {
    let catMatch;
    while ((catMatch = pattern.exec(context)) !== null) {
      const cat = catMatch[1].trim();
      if (cat.length > 2 && cat.length < 50 && !business.categories.includes(cat) && isValidCategory(cat)) {
        business.categories.push(cat);
      }
    }
  }

  // Check for permanently closed
  business.permanentlyClosed = /permanently\s*closed/i.test(context);

  // Extract coordinates if not already set
  if (!business.coordinates) {
    const coordMatch = context.match(/(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        business.coordinates = { latitude: lat, longitude: lng };
      }
    }
  }

  return business;
}

// ─── JSON-LD EXTRACTION ───────────────────────────────

/**
 * Extract businesses from JSON-LD structured data
 */
export function extractFromJsonLd(data: any): BusinessData[] {
  const businesses: BusinessData[] = [];
  
  const processItem = (item: any) => {
    if (item['@type'] === 'LocalBusiness' || item['@type'] === 'Restaurant' || 
        item['@type'] === 'Store' || item['@type']?.includes('Business')) {
      const business: BusinessData = {
        name: item.name || '',
        address: formatJsonLdAddress(item.address),
        phone: item.telephone || null,
        website: item.url || null,
        email: item.email || null,
        hours: parseJsonLdHours(item.openingHoursSpecification),
        rating: item.aggregateRating?.ratingValue ? parseFloat(item.aggregateRating.ratingValue) : null,
        reviewCount: item.aggregateRating?.reviewCount ? parseInt(item.aggregateRating.reviewCount) : null,
        categories: item['@type'] ? [item['@type']] : [],
        coordinates: item.geo ? {
          latitude: parseFloat(item.geo.latitude),
          longitude: parseFloat(item.geo.longitude)
        } : null,
        placeId: null,
        priceLevel: item.priceRange || null,
        permanentlyClosed: false,
      };
      
      if (business.name) {
        businesses.push(business);
      }
    }
    
    if (Array.isArray(item)) {
      item.forEach(processItem);
    } else if (typeof item === 'object' && item !== null) {
      Object.values(item).forEach(processItem);
    }
  };
  
  processItem(data);
  return businesses;
}

/**
 * Format JSON-LD address object to string
 */
export function formatJsonLdAddress(address: any): string | null {
  if (!address) return null;
  if (typeof address === 'string') return address;
  
  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    address.addressCountry
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Parse JSON-LD opening hours
 */
export function parseJsonLdHours(hours: any): BusinessHours | null {
  if (!hours) return null;
  if (!Array.isArray(hours)) hours = [hours];
  
  const result: BusinessHours = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  for (const spec of hours) {
    const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
    for (const day of days) {
      const dayName = typeof day === 'string' ? day.replace('http://schema.org/', '') : dayNames[day];
      result[dayName] = `${spec.opens || 'Open'} - ${spec.closes || 'Close'}`;
    }
  }
  
  return Object.keys(result).length > 0 ? result : null;
}

// ─── WIZ DATA PARSING ────────────────────────────────

/**
 * Parse Google's WIZ_DATA format
 */
export function parseWizData(jsonStr: string): BusinessData[] {
  const businesses: BusinessData[] = [];
  
  try {
    const namePattern = /\["([^"]{3,100})",null,\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/g;
    let match;
    
    while ((match = namePattern.exec(jsonStr)) !== null) {
      const name = decodeUnicodeEscapes(match[1]);
      const lat = parseFloat(match[2]);
      const lng = parseFloat(match[3]);
      
      if (isValidBusinessName(name)) {
        businesses.push({
          name,
          address: null,
          phone: null,
          website: null,
          email: null,
          hours: null,
          rating: null,
          reviewCount: null,
          categories: [],
          coordinates: { latitude: lat, longitude: lng },
          placeId: null,
          priceLevel: null,
          permanentlyClosed: false,
        });
      }
    }
  } catch {
    // Parse error
  }
  
  return businesses;
}

// ─── GOOGLE LOCAL SEARCH EXTRACTION ──────────────────

/**
 * Extract businesses from Google Local Search (tbm=lcl) results
 */
export function extractFromGoogleLocalSearch(html: string): BusinessData[] {
  const businesses: BusinessData[] = [];
  const seenNames = new Set<string>();

  // Pattern 1: Extract from data-cid divs (business cards)
  const cardPattern = /data-cid="([^"]+)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*dbg0pd[^"]*"[^>]*>([^<]+)<[\s\S]*?(?:<span[^>]*class="[^"]*rllt__details[^"]*"[^>]*>([\s\S]*?)<\/span>)?/gi;
  
  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const cid = match[1];
    const name = decodeHtmlEntities(match[2].trim());
    const detailsHtml = match[3] || '';
    
    if (!isValidBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const business = parseBusinessDetails(name, detailsHtml, cid);
    businesses.push(business);
  }

  // Pattern 2: Alternative structure with OSrXXb class
  const altPattern = /<span[^>]*class="[^"]*OSrXXb[^"]*"[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*>([^<]*\d\.\d[^<]*)<\/span>[\s\S]*?(?:<span[^>]*>([^<]+)<\/span>)?/gi;
  
  while ((match = altPattern.exec(html)) !== null) {
    const name = decodeHtmlEntities(match[1].trim());
    const ratingText = match[2] || '';
    const addressText = match[3] || '';
    
    if (!isValidBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const business: BusinessData = {
      name,
      address: addressText.trim() || null,
      phone: extractPhoneFromText(html.substring(html.indexOf(name), html.indexOf(name) + 1000)),
      website: null,
      email: null,
      hours: null,
      rating: extractRatingFromText(ratingText),
      reviewCount: extractReviewCountFromText(ratingText),
      categories: [],
      coordinates: null,
      placeId: null,
      priceLevel: extractPriceLevel(ratingText),
      permanentlyClosed: false,
    };
    
    businesses.push(business);
  }

  // Pattern 3: Look for VkpGBb cards
  const vkpPattern = /<div[^>]*class="[^"]*VkpGBb[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  
  while ((match = vkpPattern.exec(html)) !== null) {
    const cardHtml = match[1];
    const nameMatch = cardHtml.match(/<span[^>]*>([^<]{3,50})<\/span>/);
    if (!nameMatch) continue;
    
    const name = decodeHtmlEntities(nameMatch[1].trim());
    if (!isValidBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    businesses.push(parseBusinessFromCardHtml(name, cardHtml));
  }

  return businesses;
}

/**
 * Extract businesses from regular Google Search results
 */
export function extractFromGoogleSearch(html: string, query: string): BusinessData[] {
  const businesses: BusinessData[] = [];
  const seenNames = new Set<string>();

  // Look for local pack / knowledge panel data
  const localPackPattern = /<div[^>]*class="[^"]*(?:VkpGBb|rllt__link|cXedhc)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  
  let match;
  while ((match = localPackPattern.exec(html)) !== null) {
    const cardHtml = match[1];
    const nameMatch = cardHtml.match(/<(?:span|div)[^>]*class="[^"]*(?:OSrXXb|dbg0pd|SPZz6b)[^"]*"[^>]*>([^<]+)</i);
    
    if (!nameMatch) continue;
    
    const name = decodeHtmlEntities(nameMatch[1].trim());
    if (!isValidBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    businesses.push(parseBusinessFromCardHtml(name, cardHtml));
  }

  // Look for knowledge graph business info
  const kgPattern = /<div[^>]*data-attrid="title"[^>]*>([^<]+)<[\s\S]*?(?:data-attrid="[^"]*address[^"]*"[^>]*>([^<]+)<)?/gi;
  
  while ((match = kgPattern.exec(html)) !== null) {
    const name = decodeHtmlEntities(match[1].trim());
    const address = match[2] ? decodeHtmlEntities(match[2].trim()) : null;
    
    if (!isValidBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const context = html.substring(Math.max(0, html.indexOf(name) - 200), html.indexOf(name) + 1500);
    
    businesses.push({
      name,
      address,
      phone: extractPhoneFromText(context),
      website: extractWebsiteFromText(context),
      email: null,
      hours: null,
      rating: extractRatingFromContext(context),
      reviewCount: extractReviewCountFromContext(context),
      categories: [],
      coordinates: extractCoordsFromContext(context),
      placeId: null,
      priceLevel: null,
      permanentlyClosed: /permanently\s*closed/i.test(context),
    });
  }

  return businesses;
}

// ─── BUSINESS PARSING HELPERS ─────────────────────────

/**
 * Parse business details from details HTML string
 */
export function parseBusinessDetails(name: string, detailsHtml: string, cid: string): BusinessData {
  const ratingMatch = detailsHtml.match(/(\d\.?\d?)\s*\((\d+)\)/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
  const reviewCount = ratingMatch ? parseInt(ratingMatch[2]) : null;

  const addressMatch = detailsHtml.match(/(?:·|\|)\s*([^·|<]+(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Ct|Pl|Pkwy)[^·|<]*)/i);
  const address = addressMatch ? addressMatch[1].trim() : null;

  const phone = extractPhoneFromText(detailsHtml);

  const categoryMatch = detailsHtml.match(/^([^·|0-9(]+?)(?:·|\||<|\d)/);
  const categories = categoryMatch && categoryMatch[1].trim().length > 2 
    ? [categoryMatch[1].trim()] 
    : [];

  const priceLevel = extractPriceLevel(detailsHtml);

  return {
    name,
    address,
    phone,
    website: null,
    email: null,
    hours: null,
    rating: rating && rating >= 1 && rating <= 5 ? rating : null,
    reviewCount,
    categories,
    coordinates: null,
    placeId: cid,
    priceLevel,
    permanentlyClosed: /closed/i.test(detailsHtml) && !/open/i.test(detailsHtml),
  };
}

/**
 * Parse business from card HTML
 */
export function parseBusinessFromCardHtml(name: string, cardHtml: string): BusinessData {
  return {
    name,
    address: extractAddressFromText(cardHtml),
    phone: extractPhoneFromText(cardHtml),
    website: extractWebsiteFromText(cardHtml),
    email: null,
    hours: null,
    rating: extractRatingFromContext(cardHtml),
    reviewCount: extractReviewCountFromContext(cardHtml),
    categories: extractCategoriesFromText(cardHtml),
    coordinates: null,
    placeId: null,
    priceLevel: extractPriceLevel(cardHtml),
    permanentlyClosed: /permanently\s*closed/i.test(cardHtml),
  };
}

/**
 * Enrich business data with additional info from HTML
 */
export function enrichBusinessData(business: BusinessData, html: string): void {
  const nameIndex = html.indexOf(business.name);
  if (nameIndex === -1) return;
  
  const context = html.substring(Math.max(0, nameIndex - 200), nameIndex + 2000);
  
  if (!business.address) business.address = extractAddressFromText(context);
  if (!business.phone) business.phone = extractPhoneFromText(context);
  if (!business.website) business.website = extractWebsiteFromText(context);
  if (!business.rating) business.rating = extractRatingFromContext(context);
  if (!business.reviewCount) business.reviewCount = extractReviewCountFromContext(context);
  if (!business.coordinates) business.coordinates = extractCoordsFromContext(context);
  if (!business.priceLevel) business.priceLevel = extractPriceLevel(context);
}

// ─── LEGACY LOCAL SEARCH EXTRACTION ──────────────────

/**
 * Extract businesses from Google Local Search results (legacy)
 */
export function extractFromLocalSearch(html: string): BusinessData[] {
  const businesses: BusinessData[] = [];
  
  const cardPattern = /data-ri="(\d+)"[\s\S]*?<span class="[^"]*OSrXXb[^"]*"[^>]*>([^<]+)<\/span>[\s\S]*?<span class="[^"]*yi40Hd[^"]*"[^>]*>([^<]*)<\/span>/g;
  
  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const name = match[2].trim();
    const ratingText = match[3];
    
    const business: BusinessData = {
      name,
      address: null,
      phone: null,
      website: null,
      email: null,
      hours: null,
      rating: null,
      reviewCount: null,
      categories: [],
      coordinates: null,
      placeId: null,
      priceLevel: null,
      permanentlyClosed: false,
    };

    const ratingMatch = ratingText.match(/(\d\.?\d?)/);
    if (ratingMatch) {
      business.rating = parseFloat(ratingMatch[1]);
    }

    const reviewMatch = html.substring(html.indexOf(name), html.indexOf(name) + 500).match(/\((\d+)\)/);
    if (reviewMatch) {
      business.reviewCount = parseInt(reviewMatch[1]);
    }

    businesses.push(business);
  }

  const altPattern = /class="[^"]*dbg0pd[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?(\d\.?\d?)\s*(?:\((\d+)\))?/g;
  
  while ((match = altPattern.exec(html)) !== null) {
    const name = match[1].trim();
    if (name && !businesses.some(b => b.name === name)) {
      businesses.push({
        name,
        address: null,
        phone: null,
        website: null,
        email: null,
        hours: null,
        rating: match[2] ? parseFloat(match[2]) : null,
        reviewCount: match[3] ? parseInt(match[3]) : null,
        categories: [],
        coordinates: null,
        placeId: null,
        priceLevel: null,
        permanentlyClosed: false,
      });
    }
  }

  return businesses;
}

// ─── SINGLE BUSINESS EXTRACTION (LEGACY) ─────────────

/**
 * Extract a single business's details from the page
 */
export function extractSingleBusiness(html: string, name: string, cid: string): BusinessData | null {
  return createBusinessFromContext(html, name, null, cid);
}

// ─── MAIN SCRAPING FUNCTION ──────────────────────────

/**
 * Scrape Google Maps for businesses using multiple strategies
 */
export async function scrapeGoogleMaps(
  query: string,
  location: string,
  limit: number = 20,
  startIndex: number = 0
): Promise<SearchResult> {
  const businesses: BusinessData[] = [];
  const seenNames = new Set<string>();
  let currentStart = startIndex;
  
  // Strategy 1: Try Google Local Search (tbm=lcl)
  console.log('[Scraper] Trying Google Local Search...');
  const localSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' near ' + location)}&tbm=lcl&start=${currentStart}`;
  
  try {
    const localResponse = await proxyFetch(localSearchUrl, {
      timeoutMs: 45000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (localResponse.ok) {
      const localHtml = await localResponse.text();
      const localBusinesses = extractFromGoogleLocalSearch(localHtml);
      
      for (const biz of localBusinesses) {
        if (businesses.length >= limit) break;
        if (!seenNames.has(biz.name.toLowerCase())) {
          seenNames.add(biz.name.toLowerCase());
          businesses.push(biz);
        }
      }
      console.log(`[Scraper] Found ${localBusinesses.length} from Local Search`);
    }
  } catch (err) {
    console.log(`[Scraper] Local Search failed: ${err}`);
  }

  // Strategy 2: Try Google Maps search URL
  if (businesses.length < limit) {
    console.log('[Scraper] Trying Google Maps...');
    const mapsUrl = buildSearchUrl(query, location);
    
    try {
      const mapsResponse = await proxyFetch(mapsUrl, {
        timeoutMs: 45000,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (mapsResponse.ok) {
        const mapsHtml = await mapsResponse.text();
        const mapsBusinesses = extractBusinessesFromHtml(mapsHtml);
        
        for (const biz of mapsBusinesses) {
          if (businesses.length >= limit) break;
          if (!seenNames.has(biz.name.toLowerCase())) {
            seenNames.add(biz.name.toLowerCase());
            enrichBusinessData(biz, mapsHtml);
            businesses.push(biz);
          }
        }
        console.log(`[Scraper] Found ${mapsBusinesses.length} from Maps`);
      }
    } catch (err) {
      console.log(`[Scraper] Maps failed: ${err}`);
    }
  }

  // Strategy 3: Try regular Google Search with place results
  if (businesses.length < limit) {
    console.log('[Scraper] Trying Google Search...');
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' in ' + location + ' address phone')}`;
    
    try {
      const searchResponse = await proxyFetch(searchUrl, {
        timeoutMs: 45000,
      });

      if (searchResponse.ok) {
        const searchHtml = await searchResponse.text();
        const searchBusinesses = extractFromGoogleSearch(searchHtml, query);
        
        for (const biz of searchBusinesses) {
          if (businesses.length >= limit) break;
          if (!seenNames.has(biz.name.toLowerCase())) {
            seenNames.add(biz.name.toLowerCase());
            businesses.push(biz);
          }
        }
        console.log(`[Scraper] Found ${searchBusinesses.length} from Search`);
      }
    } catch (err) {
      console.log(`[Scraper] Search failed: ${err}`);
    }
  }

  const nextPageToken = businesses.length >= limit ? String(currentStart + limit) : null;

  return {
    businesses: businesses.slice(0, limit),
    totalFound: businesses.length,
    nextPageToken,
    searchQuery: query,
    location,
  };
}

// ─── DETAILED BUSINESS EXTRACTION ────────────────────

/**
 * Extract detailed business information from a place page
 */
export function extractDetailedBusiness(html: string, placeId: string): BusinessData {
  const business: BusinessData = {
    name: '',
    address: null,
    phone: null,
    website: null,
    email: null,
    hours: null,
    rating: null,
    reviewCount: null,
    categories: [],
    coordinates: null,
    placeId,
    priceLevel: null,
    permanentlyClosed: false,
  };

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    const title = titleMatch[1].replace(' - Google Maps', '').trim();
    business.name = title;
  }

  const coordMatch = html.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (coordMatch) {
    business.coordinates = {
      latitude: parseFloat(coordMatch[1]),
      longitude: parseFloat(coordMatch[2]),
    };
  }

  const addressMatch = html.match(/data-tooltip="Address"[^>]*>([^<]+)/);
  if (addressMatch) {
    business.address = addressMatch[1].trim();
  }

  const phoneMatch = html.match(/data-tooltip="Phone"[^>]*>([^<]+)/);
  if (phoneMatch) {
    business.phone = phoneMatch[1].trim();
  } else {
    const phonePatterns = [
      /\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
      /\(\d{3}\)\s*\d{3}[-.]?\d{4}/,
    ];
    for (const pattern of phonePatterns) {
      const match = html.match(pattern);
      if (match) {
        business.phone = match[0];
        break;
      }
    }
  }

  const websiteMatch = html.match(/data-tooltip="Website"[^>]*href="([^"]+)"/);
  if (websiteMatch) {
    business.website = websiteMatch[1];
  }

  const ratingMatch = html.match(/(\d\.?\d?)\s*(?:stars?|out of 5)/i);
  if (ratingMatch) {
    business.rating = parseFloat(ratingMatch[1]);
  }

  const reviewMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*reviews?/i);
  if (reviewMatch) {
    business.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
  }

  business.hours = extractHours(html, business.name);
  business.categories = extractCategories(html, business.name);

  const emails = extractEmails(html);
  if (emails.length > 0) {
    business.email = emails[0];
  }

  business.permanentlyClosed = /permanently\s*closed/i.test(html);

  return business;
}
