/**
 * Google Reviews — Search Result Extraction
 */

import { decodeHtmlEntities } from '../../utils/helpers';
import { extractBusinessInfo } from './extract-business';
import type { BusinessInfo } from '../../types';

// ─── SEARCH EXTRACTION ──────────────────────────────

/**
 * Extract business listings from Google Maps search results
 */
export function extractSearchResults(html: string): BusinessInfo[] {
  const businesses: BusinessInfo[] = [];
  const seenNames = new Set<string>();

  function isValidBusinessName(name: string): boolean {
    if (!name || name.length < 2 || name.length > 80) return false;
    if (/[{}();=+\\]/.test(name)) return false;
    if (/^\d+$/.test(name)) return false;
    if (/^https?:\/\//.test(name)) return false;
    if (/^[a-f0-9]{20,}$/i.test(name)) return false;
    if (/^ChIJ/.test(name)) return false;
    if (/function|var |let |const |return |null|undefined|true|false|window\./i.test(name)) return false;
    if (!/[a-zA-Z]/.test(name)) return false;
    return true;
  }

  function addBusiness(info: BusinessInfo): void {
    if (isValidBusinessName(info.name) && !seenNames.has(info.name)) {
      seenNames.add(info.name);
      businesses.push(info);
    }
  }

  function emptyBusiness(name: string, placeId: string = ''): BusinessInfo {
    return {
      name: decodeHtmlEntities(name.trim()),
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
  }

  // Strategy 1: Parse embedded JS data arrays (works even on JS-heavy pages)
  const jsDataPattern = /\["([^"]{2,80})",\s*"[^"]*",\s*"[^"]*",\s*"[^"]*"\s*,\s*([\d.]+)\s*,\s*[\d,]*\s*,/g;
  let jm;
  while ((jm = jsDataPattern.exec(html)) !== null) {
    const name = jm[1];
    if (name.length > 2 && name.length < 80 && !/^http|^\/|^\d+$/.test(name)) {
      const info = emptyBusiness(name);
      info.rating = parseFloat(jm[2]) || null;
      addBusiness(info);
    }
  }

  // Strategy 2: Extract from window.APP_INITIALIZATION_STATE or similar JS blobs
  const appStateMatches = html.match(/\[\\"([^\\]{3,80})\\",\\"([^\\]{5,200})\\"/g) || [];
  for (const asm of appStateMatches) {
    const parts = asm.match(/\[\\"([^\\]+)\\",\\"([^\\]+)\\"/);
    if (parts && parts[1].length > 2 && parts[1].length < 80 && !/^http|^\/|^\d+$/.test(parts[1])) {
      const info = emptyBusiness(parts[1]);
      if (parts[2] && parts[2].length > 5 && parts[2].length < 200) {
        info.address = decodeHtmlEntities(parts[2]);
      }
      addBusiness(info);
    }
  }

  // Strategy 3: Extract from JSON-LD blocks
  const jsonLdPattern = /"@type"\s*:\s*"(?:LocalBusiness|Restaurant|Store|Hotel|[A-Z]\w+)"[\s\S]*?(?="@type"|$)/g;
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    const block = match[0];
    const nameMatch = block.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      const info = extractBusinessInfo(block, '');
      info.name = decodeHtmlEntities(nameMatch[1]);
      addBusiness(info);
    }
  }

  // Strategy 4: Extract from search result cards (mobile HTML)
  if (businesses.length === 0) {
    const cardPatterns = [
      /class="[^"]*(?:Nv2PK|qBF1Pd)[^"]*"[\s\S]*?(?=class="[^"]*(?:Nv2PK|qBF1Pd)[^"]*"|$)/gi,
      /data-result-index="\d+"[\s\S]*?(?=data-result-index="|$)/gi,
    ];

    for (const cardPattern of cardPatterns) {
      const cards = html.match(cardPattern) || [];
      for (const card of cards) {
        const nameMatch = card.match(/class="[^"]*(?:qBF1Pd|fontHeadlineSmall|NrDZNb)[^"]*"[^>]*>([^<]+)/i) ||
                          card.match(/aria-label="([^"]+)"/i);
        if (nameMatch) {
          const info = emptyBusiness(nameMatch[1]);

          const ratingMatch = card.match(/([\d.]+)\s*(?:stars?|\()/i);
          if (ratingMatch) info.rating = parseFloat(ratingMatch[1]);

          const countMatch = card.match(/\(([\d,]+)\)/);
          if (countMatch) info.totalReviews = parseInt(countMatch[1].replace(/,/g, ''));

          const addrMatch = card.match(/class="[^"]*(?:W4Efsd|fontBodyMedium)[^"]*"[^>]*>[\s\S]*?·[\s\S]*?([^<·]+)/i);
          if (addrMatch) info.address = decodeHtmlEntities(addrMatch[1].trim());

          const catMatch = card.match(/class="[^"]*(?:W4Efsd|fontBodyMedium)[^"]*"[^>]*>([^<·]+)/i);
          if (catMatch && catMatch[1].trim().length < 50) {
            info.category = decodeHtmlEntities(catMatch[1].trim());
            info.categories = [info.category];
          }

          const placeIdMatch = card.match(/data-cid="([^"]+)"/i) || card.match(/place_id[=:]([A-Za-z0-9_-]+)/i);
          if (placeIdMatch) info.placeId = placeIdMatch[1];

          addBusiness(info);
        }
      }
      if (businesses.length > 0) break;
    }
  }

  // Strategy 5: Extract business names from aria-label attributes
  if (businesses.length === 0) {
    const ariaLabels = html.match(/aria-label="([^"]{3,80})"/gi) || [];
    for (const al of ariaLabels) {
      const nameMatch = al.match(/aria-label="([^"]+)"/i);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (name.length > 2 && name.length < 80 && 
            !/directions|close|search|menu|zoom|map|back|filter|clear|share|save|sign/i.test(name) &&
            !/^\d+$/.test(name)) {
          addBusiness(emptyBusiness(name));
        }
      }
    }
  }

  // Strategy 6: Extract from Google Maps internal data format (\\x22name\\x22:\\x22...\\x22)
  if (businesses.length === 0) {
    const hexNames = html.match(/\\x22([^\\]{3,80})\\x22,\\x22([^\\]{0,200})\\x22/g) || [];
    for (const hex of hexNames) {
      const parts = hex.match(/\\x22([^\\]+)\\x22,\\x22([^\\]*)\\x22/);
      if (parts && parts[1].length > 2 && parts[1].length < 80 &&
          !/^http|^\/|^\d+$|^[a-f0-9]+$|^ChIJ/.test(parts[1]) &&
          /[A-Z]/.test(parts[1])) {
        const info = emptyBusiness(parts[1]);
        if (parts[2] && parts[2].length > 5 && parts[2].length < 200 && /\d/.test(parts[2])) {
          info.address = decodeHtmlEntities(parts[2]);
        }
        addBusiness(info);
      }
    }
  }

  console.log(`[REVIEWS] Search extraction strategies found ${businesses.length} businesses`);
  return businesses;
}

/** Extract businesses from Google Local Search results (tbm=lcl with gbv=1) */
export function extractFromLocalSearch(html: string): BusinessInfo[] {
  const businesses: BusinessInfo[] = [];
  const seenNames = new Set<string>();

  function emptyBiz(name: string): BusinessInfo {
    return {
      name: decodeHtmlEntities(name.trim()),
      placeId: '',
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
  }

  const cardPattern = /class="X7NTVe"[\s\S]*?(?=class="X7NTVe"|class="Q0HXG"><\/div><\/div>|<\/footer>)/gi;
  const cards = html.match(cardPattern) || [];

  for (const card of cards) {
    const nameMatch = card.match(/class="ilUpNd XV43Ef aSRlid">([^<]+)<\/div>/i);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    if (name.length < 2 || seenNames.has(name)) continue;
    seenNames.add(name);

    const info = emptyBiz(name);

    // Extract rating
    const ratingMatch = card.match(/class="oqSTJd">([\d.]+)<\/span>/);
    if (ratingMatch) info.rating = parseFloat(ratingMatch[1]);

    // Extract review count
    const countMatch = card.match(/\(([\d,]+)\)<\/span>/);
    if (countMatch) info.totalReviews = parseInt(countMatch[1].replace(/,/g, ''));

    // Extract price level
    const priceMatch = card.match(/(?:·|&middot;)\s*(\$[\d]+[–\-]\$?[\d]+)/);
    if (priceMatch) info.priceLevel = priceMatch[1];

    // Extract category and address from after <br>
    const catAddrMatch = card.match(/<br\s*\/?>\s*([^<]+)/);
    if (catAddrMatch) {
      const parts = catAddrMatch[1].split(/\s*[⋅·]\s*/);
      if (parts.length >= 2) {
        info.category = decodeHtmlEntities(parts[0].trim());
        info.categories = [info.category];
        info.address = decodeHtmlEntities(parts.slice(1).join(', ').trim());
      } else if (parts[0]) {
        info.address = decodeHtmlEntities(parts[0].trim());
      }
    }

    // Extract ludocid as place ID
    const ludocidMatch = card.match(/ludocid=(\d+)/);
    if (ludocidMatch) info.placeId = ludocidMatch[1];

    businesses.push(info);
  }

  console.log(`[REVIEWS] Local search extraction found ${businesses.length} businesses`);
  return businesses;
}
