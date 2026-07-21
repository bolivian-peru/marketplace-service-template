/**
 * Google Reviews — Business Info Extraction
 */

import { decodeHtmlEntities } from '../../utils/helpers';
import type { BusinessInfo, BusinessHours } from '../../types';

// ─── BUSINESS INFO EXTRACTION ───────────────────────

/**
 * Extract business information from Google Maps HTML
 */
export function extractBusinessInfo(html: string, placeId: string): BusinessInfo {
  const info: BusinessInfo = {
    name: '',
    placeId,
    rating: null,
    totalReviews: null,
    address: null,
    phone: null,
    website: null,
    hours: null,
    category: null,
    categories: [],
    priceLevel: null,
    photos: [],
    coordinates: null,
    permanentlyClosed: false,
  };

  // Extract name — try multiple patterns
  const namePatterns = [
    /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i,
    /<title>([^<]+?)(?:\s*[-–|·]\s*Google Maps)?<\/title>/i,
    /"name"\s*:\s*"([^"]+)"/,
    /data-header-feature-name="([^"]+)"/i,
    /class="[^"]*DUwDvf[^"]*"[^>]*>([^<]+)/i,
    /aria-label="([^"]+?)(?:\s+reviews?)"/i,
  ];

  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 1) {
      info.name = decodeHtmlEntities(match[1].trim());
      break;
    }
  }

  // Extract rating
  const ratingPatterns = [
    /"ratingValue"\s*:\s*"?([\d.]+)"?/,
    /aria-label="([\d.]+)\s+stars?"/i,
    /class="[^"]*(?:Aq14fc|fontDisplayLarge)[^"]*"[^>]*>([\d.]+)/i,
    /"aggregateRating"[^}]*"ratingValue"\s*:\s*"?([\d.]+)"?/,
  ];

  for (const pattern of ratingPatterns) {
    const match = html.match(pattern);
    if (match) {
      const rating = parseFloat(match[1]);
      if (rating >= 1 && rating <= 5) {
        info.rating = rating;
        break;
      }
    }
  }

  // Extract total reviews
  const reviewCountPatterns = [
    /"reviewCount"\s*:\s*"?(\d+)"?/,
    /([\d,]+)\s+reviews?/i,
    /aria-label="[\d.]+ stars?,?\s*([\d,]+)\s+reviews?"/i,
    /class="[^"]*(?:F7nice|fontBodyMedium)[^"]*"[^>]*>\(?([\d,]+)\)?/i,
  ];

  for (const pattern of reviewCountPatterns) {
    const match = html.match(pattern);
    if (match) {
      const count = parseInt(match[1].replace(/,/g, ''));
      if (count > 0) {
        info.totalReviews = count;
        break;
      }
    }
  }

  // Extract address
  const addressPatterns = [
    /"address"\s*:\s*"([^"]+)"/,
    /"streetAddress"\s*:\s*"([^"]+)"/,
    /data-item-id="address"[^>]*>[\s\S]*?<[^>]*>([^<]+)/i,
    /aria-label="Address[:\s]*([^"]+)"/i,
    /class="[^"]*(?:Io6YTe|rogA2c)[^"]*"[^>]*>([^<]+)/i,
  ];

  for (const pattern of addressPatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 5) {
      info.address = decodeHtmlEntities(match[1].trim());
      break;
    }
  }

  // Extract phone
  const phonePatterns = [
    /"telephone"\s*:\s*"([^"]+)"/,
    /data-item-id="phone[^"]*"[^>]*>[\s\S]*?<[^>]*>([^<]+)/i,
    /aria-label="Phone[:\s]*([^"]+)"/i,
    /href="tel:([^"]+)"/i,
    /(\+?1?\s*[-.(]?\d{3}[-.)]\s*\d{3}[-.\s]\d{4})/,
  ];

  for (const pattern of phonePatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length >= 7) {
      info.phone = decodeHtmlEntities(match[1].trim());
      break;
    }
  }

  // Extract website
  const websitePatterns = [
    /"url"\s*:\s*"(https?:\/\/(?!google\.com)[^"]+)"/,
    /data-item-id="authority"[^>]*>[\s\S]*?href="([^"]+)"/i,
    /aria-label="Website[:\s]*([^"]+)"/i,
  ];

  for (const pattern of websitePatterns) {
    const match = html.match(pattern);
    if (match && match[1].startsWith('http') && !match[1].includes('google.com')) {
      info.website = match[1];
      break;
    }
  }

  // Extract category
  const categoryPatterns = [
    /"@type"\s*:\s*"([^"]+)"(?!.*"@context")/,
    /data-item-id="category"[^>]*>[\s\S]*?<[^>]*>([^<]+)/i,
    /class="[^"]*(?:DkEaL|fontBodyMedium)[^"]*"[^>]*>([^<]+(?:restaurant|shop|store|bar|cafe|hotel|salon|gym|clinic|dentist|hospital|pharmacy|bank|school)[^<]*)/i,
    /jsaction="pane\.rating\.category"[^>]*>([^<]+)/i,
  ];

  for (const pattern of categoryPatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 2 && match[1].trim().length < 100) {
      info.category = decodeHtmlEntities(match[1].trim());
      info.categories = [info.category];
      break;
    }
  }

  // Extract hours
  const hoursMatch = html.match(/"openingHours"\s*:\s*\[([^\]]+)\]/);
  if (hoursMatch) {
    try {
      const hoursArray = JSON.parse(`[${hoursMatch[1]}]`) as string[];
      const hours: BusinessHours = {};
      for (const entry of hoursArray) {
        const parts = entry.match(/^(\w+)[\s:]+(.+)$/);
        if (parts) {
          hours[parts[1]] = parts[2];
        }
      }
      if (Object.keys(hours).length > 0) {
        info.hours = hours;
      }
    } catch { /* ignore parse errors */ }
  }

  // Extract hours from aria-label pattern
  if (!info.hours) {
    const hoursLabelMatch = html.match(/aria-label="([^"]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^"]*)"/i);
    if (hoursLabelMatch) {
      const hours: BusinessHours = {};
      const dayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,:;\s]+([^,;]+?)(?=(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|$)/gi;
      let dayMatch;
      while ((dayMatch = dayPattern.exec(hoursLabelMatch[1])) !== null) {
        hours[dayMatch[1]] = dayMatch[2].trim();
      }
      if (Object.keys(hours).length > 0) {
        info.hours = hours;
      }
    }
  }

  // Extract coordinates
  const coordPatterns = [
    /"geo"\s*:\s*\{[^}]*"latitude"\s*:\s*([-\d.]+)[^}]*"longitude"\s*:\s*([-\d.]+)/,
    /@([-\d.]+),([-\d.]+)/,
    /center=([-\d.]+)%2C([-\d.]+)/,
    /ll=([-\d.]+),([-\d.]+)/,
  ];

  for (const pattern of coordPatterns) {
    const match = html.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        info.coordinates = { latitude: lat, longitude: lng };
        break;
      }
    }
  }

  // Extract price level
  const priceMatch = html.match(/aria-label="Price[:\s]*([^"]+)"/i) ||
                     html.match(/"priceRange"\s*:\s*"([^"]+)"/);
  if (priceMatch) {
    info.priceLevel = priceMatch[1].trim();
  }

  // Check if permanently closed
  info.permanentlyClosed = /permanently closed/i.test(html) || /Permanently closed/i.test(html);

  // Extract photos
  const photoPattern = /https:\/\/lh[35]\.googleusercontent\.com\/[a-zA-Z0-9_\-\/=]+/g;
  const photoMatches = html.match(photoPattern) || [];
  const uniquePhotos = [...new Set(photoMatches)].slice(0, 10);
  info.photos = uniquePhotos;

  return info;
}

// ─── GOOGLE SEARCH FALLBACK ─────────────────────────

/** Extract basic business info from Google Search results page (fallback when Maps gives sparse data) */
export function extractBusinessFromSearch(html: string, placeId: string): BusinessInfo {
  const info: BusinessInfo = {
    name: '',
    placeId,
    rating: null,
    totalReviews: null,
    address: null,
    phone: null,
    website: null,
    hours: null,
    category: null,
    categories: [],
    priceLevel: null,
    photos: [],
    coordinates: null,
    permanentlyClosed: false,
  };

  // Extract name from Knowledge Panel title or heading
  const titleMatch = html.match(/<div[^>]*data-attrid="title"[^>]*>([^<]+)</i) ||
                     html.match(/<h2[^>]*data-attrid="title"[^>]*>([^<]+)</i) ||
                     html.match(/class="[^"]*(?:qrShPb|SPZz6b|PZPZlf)[^"]*"[^>]*>([^<]+)/i) ||
                     html.match(/<title>([^<]+?)(?:\s*[-–|].*)?<\/title>/i);
  if (titleMatch) {
    let name = decodeHtmlEntities(titleMatch[1].trim());
    name = name.replace(/\s*[-–|].*$/, '').replace(/\s*- Google.*$/, '').trim();
    const genericNames = /^(google|search|maps|place_id|sign in|error|404|not found)/i;
    if (name.length > 1 && name.length < 100 && !genericNames.test(name)) info.name = name;
  }

  // Extract rating
  const ratingMatch = html.match(/class="[^"]*(?:Aq14fc|oqSTJd)[^"]*"[^>]*>([\d.]+)/i) ||
                      html.match(/aria-label="Rated ([\d.]+)/i);
  if (ratingMatch) info.rating = parseFloat(ratingMatch[1]);

  // Extract review count
  const countMatch = html.match(/\(([\d,]+)\s*(?:review|rating)/i) ||
                     html.match(/([\d,]+)\s*(?:Google )?reviews?/i);
  if (countMatch) info.totalReviews = parseInt(countMatch[1].replace(/,/g, ''));

  // Extract address from Knowledge Panel
  const addrMatch = html.match(/data-attrid="kc:\/location\/address"[^>]*>[\s\S]*?class="[^"]*(?:LrzXr|hgKElc)[^"]*"[^>]*>([^<]+)/i) ||
                    html.match(/class="[^"]*LrzXr[^"]*"[^>]*>([^<]*\d[^<]*(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl)[^<]*)/i);
  if (addrMatch) info.address = decodeHtmlEntities(addrMatch[1].trim());

  // Extract phone
  const phoneMatch = html.match(/data-attrid="kc:\/collection\/knowledge_panels\/has_phone[^"]*"[^>]*>[\s\S]*?(\+?[\d\s\-().]{10,})/i) ||
                     html.match(/class="[^"]*LrzXr[^"]*"[^>]*>(\+?1?\s*[\d\s\-().]{10,})/i);
  if (phoneMatch) info.phone = phoneMatch[1].trim();

  // Extract category
  const catMatch = html.match(/data-attrid="subtitle"[^>]*>[\s\S]*?class="[^"]*(?:YhemCb|hgKElc)[^"]*"[^>]*>([^<]+)/i) ||
                   html.match(/class="[^"]*(?:YhemCb)[^"]*"[^>]*>([^<]+)/i);
  if (catMatch) {
    info.category = decodeHtmlEntities(catMatch[1].trim());
    info.categories = [info.category];
  }

  console.log(`[REVIEWS] Google Search fallback extracted: "${info.name}", ${info.rating}★, ${info.totalReviews} reviews`);
  return info;
}
