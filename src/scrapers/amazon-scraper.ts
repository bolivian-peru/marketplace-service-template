// Optimized for Proxies.sx marketplace - Implementation by sherif Gomma Moustafa Hefnawy
/**
 * Amazon Product & BSR Tracker (Bounty #72)
 * ──────────────────────────────────────────
 * Scrapes Amazon product pages and Best Sellers pages
 * for product data, pricing, and Best Sellers Rank (BSR).
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ──────────────────────────────────────────

export interface BsrEntry {
  rank: number;
  category: string;
}

export interface AmazonProduct {
  asin: string;
  title: string;
  url: string;
  price: number | null;
  currency: string;
  listPrice: number | null;
  rating: number | null;
  reviewCount: number | null;
  availability: string | null;
  brand: string | null;
  bsr: BsrEntry[];
  features: string[];
  images: string[];
  categories: string[];
}

export interface AmazonBestSeller {
  rank: number;
  asin: string | null;
  title: string;
  url: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  image: string | null;
}

// ─── SCRAPER HEADERS ────────────────────────────────

const scraperHeaders: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

// ─── PRODUCT SCRAPER ────────────────────────────────

export async function scrapeAmazonProduct(asin: string): Promise<AmazonProduct> {
  const url = `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;

  const response = await proxyFetch(url, {
    headers: scraperHeaders,
    timeoutMs: 45_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Amazon product fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Check for CAPTCHA / bot detection
  if (html.includes('api-services-support@amazon.com') || html.includes('Type the characters you see in this image')) {
    throw new Error('Amazon bot detection triggered. Try again with a different proxy rotation.');
  }

  return parseProductPage(html, asin);
}

export function parseProductPage(html: string, asin: string): AmazonProduct {
  const title = extractBetween(html, '<span id="productTitle"', '</span>');
  const brand = extractBrand(html);
  const price = extractPrice(html);
  const listPrice = extractListPrice(html);
  const rating = extractProductRating(html);
  const reviewCount = extractProductReviewCount(html);
  const availability = extractAvailability(html);
  const bsr = extractBSR(html);
  const features = extractFeatures(html);
  const images = extractImages(html);
  const categories = extractBreadcrumbs(html);

  return {
    asin,
    title: title ? decodeHtmlEntities(title.replace(/<[^>]+>/g, '').trim()) : `Amazon Product ${asin}`,
    url: `https://www.amazon.com/dp/${asin}`,
    price: price?.amount ?? null,
    currency: price?.currency ?? 'USD',
    listPrice: listPrice ?? null,
    rating,
    reviewCount,
    availability,
    brand,
    bsr,
    features,
    images,
    categories,
  };
}

// ─── BEST SELLERS SCRAPER ───────────────────────────

export async function scrapeAmazonBestSellers(
  category: string = '',
  limit: number = 20,
): Promise<AmazonBestSeller[]> {
  const baseUrl = 'https://www.amazon.com/gp/bestsellers';
  const url = category
    ? `${baseUrl}/${encodeURIComponent(category)}`
    : baseUrl;

  const response = await proxyFetch(url, {
    headers: scraperHeaders,
    timeoutMs: 45_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Amazon Best Sellers fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  if (html.includes('api-services-support@amazon.com') || html.includes('Type the characters you see in this image')) {
    throw new Error('Amazon bot detection triggered. Try again with a different proxy rotation.');
  }

  return parseBestSellersPage(html).slice(0, limit);
}

export function parseBestSellersPage(html: string): AmazonBestSeller[] {
  const results: AmazonBestSeller[] = [];

  // Amazon Best Sellers use zg-grid-general-faceout or p13n-sc-uncoverable-faceout
  // Pattern 1: Modern BS page — look for ranked items
  const itemPattern = /<div[^>]*class="[^"]*zg-grid-general-faceout[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let match: RegExpExecArray | null;
  let rank = 1;

  while ((match = itemPattern.exec(html)) !== null) {
    const block = match[1];
    const product = parseBestSellerBlock(block, rank);
    if (product) {
      results.push(product);
      rank++;
    }
  }

  // Pattern 2: Fallback — look for p13n asin blocks
  if (results.length === 0) {
    const altPattern = /data-asin="([A-Z0-9]{10})"[\s\S]*?<span[^>]*class="[^"]*p13n-sc-price[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
    let altMatch: RegExpExecArray | null;
    rank = 1;

    while ((altMatch = altPattern.exec(html)) !== null) {
      const blockAsin = altMatch[1];
      const priceText = decodeHtmlEntities(altMatch[2].replace(/<[^>]+>/g, '').trim());

      // Try to get title near this asin
      const asinIdx = html.indexOf(`data-asin="${blockAsin}"`);
      const regionEnd = Math.min(asinIdx + 2000, html.length);
      const region = html.substring(asinIdx, regionEnd);

      const titleMatch = region.match(/<a[^>]*class="[^"]*a-link-normal[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/);
      const ratingMatch = region.match(/<span[^>]*class="[^"]*a-icon-alt[^"]*"[^>]*>([\d.]+)\s*out of\s*5/);
      const reviewMatch = region.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const imgMatch = region.match(/<img[^>]*src="(https:\/\/[^"]+)"[^>]*>/);
      const linkMatch = region.match(/<a[^>]*href="(\/[^"]*\/dp\/[^"]+)"/);

      results.push({
        rank,
        asin: blockAsin,
        title: titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : `Product ${blockAsin}`,
        url: linkMatch ? `https://www.amazon.com${linkMatch[1].split('?')[0]}` : `https://www.amazon.com/dp/${blockAsin}`,
        price: parseFloat(priceText.replace(/[^0-9.]/g, '')) || null,
        currency: 'USD',
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null,
        image: imgMatch ? imgMatch[1] : null,
      });
      rank++;
    }
  }

  // Pattern 3: Generic ranked list extraction
  if (results.length === 0) {
    const genericPattern = /#(\d+)\s*[\s\S]*?(?:data-asin="([A-Z0-9]{10})"|\/dp\/([A-Z0-9]{10}))/g;
    let gMatch: RegExpExecArray | null;

    while ((gMatch = genericPattern.exec(html)) !== null) {
      const gRank = parseInt(gMatch[1]);
      const gAsin = gMatch[2] || gMatch[3];
      const gRegionStart = Math.max(0, gMatch.index - 200);
      const gRegionEnd = Math.min(gMatch.index + 1500, html.length);
      const gRegion = html.substring(gRegionStart, gRegionEnd);

      const gTitle = gRegion.match(/<span[^>]*class="[^"]*"[^>]*>([^<]{10,120})<\/span>/);

      results.push({
        rank: gRank,
        asin: gAsin || null,
        title: gTitle ? decodeHtmlEntities(gTitle[1].trim()) : `Best Seller #${gRank}`,
        url: gAsin ? `https://www.amazon.com/dp/${gAsin}` : 'https://www.amazon.com/gp/bestsellers',
        price: null,
        currency: 'USD',
        rating: null,
        reviewCount: null,
        image: null,
      });
    }
  }

  return results;
}

function parseBestSellerBlock(block: string, rank: number): AmazonBestSeller | null {
  const titleMatch = block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
  const priceMatch = block.match(/<span[^>]*class="[^"]*(?:p13n-sc-price|a-color-price)[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const ratingMatch = block.match(/([\d.]+)\s*out of\s*5/);
  const reviewMatch = block.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
  const asinMatch = block.match(/\/dp\/([A-Z0-9]{10})/);
  const imgMatch = block.match(/<img[^>]*src="(https:\/\/[^"]+)"[^>]*>/);
  const linkMatch = block.match(/<a[^>]*href="(\/[^"]*\/dp\/[^"]+)"/);

  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim())
    : null;

  if (!title) return null;

  const priceText = priceMatch
    ? decodeHtmlEntities(priceMatch[1].replace(/<[^>]+>/g, '').trim())
    : null;

  return {
    rank,
    asin: asinMatch ? asinMatch[1] : null,
    title,
    url: linkMatch
      ? `https://www.amazon.com${linkMatch[1].split('?')[0]}`
      : asinMatch
        ? `https://www.amazon.com/dp/${asinMatch[1]}`
        : 'https://www.amazon.com/gp/bestsellers',
    price: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) || null : null,
    currency: 'USD',
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
    reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null,
    image: imgMatch ? imgMatch[1] : null,
  };
}

// ─── EXTRACTION HELPERS ─────────────────────────────

function extractBetween(html: string, startMarker: string, endMarker: string): string | null {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;

  const contentStart = html.indexOf('>', startIdx) + 1;
  if (contentStart === 0) return null;

  const endIdx = html.indexOf(endMarker, contentStart);
  if (endIdx === -1) return null;

  return html.substring(contentStart, endIdx);
}

function extractBrand(html: string): string | null {
  // Try bylineInfo first
  const byline = html.match(/id="bylineInfo"[^>]*>[\s\S]*?(?:Visit the\s+|Brand:\s*)([\s\S]*?)(?:\s+Store|<)/);
  if (byline) return decodeHtmlEntities(byline[1].replace(/<[^>]+>/g, '').trim());

  // Try brand table row
  const brandRow = html.match(/(?:Brand|Manufacturer)[^<]*<\/(?:th|td)>\s*<td[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i);
  if (brandRow) return decodeHtmlEntities(brandRow[1].replace(/<[^>]+>/g, '').trim());

  return null;
}

function extractPrice(html: string): { amount: number; currency: string } | null {
  // Try the main price display
  const patterns = [
    /class="a-price[^"]*"[^>]*>\s*<span[^>]*class="a-offscreen"[^>]*>([\s\S]*?)<\/span>/,
    /id="priceblock_ourprice"[^>]*>([\s\S]*?)<\/span>/,
    /id="priceblock_dealprice"[^>]*>([\s\S]*?)<\/span>/,
    /class="[^"]*apexPriceToPay[^"]*"[^>]*>\s*<span[^>]*class="a-offscreen"[^>]*>([\s\S]*?)<\/span>/,
    /class="priceToPay"[^>]*>[\s\S]*?<span[^>]*class="a-offscreen"[^>]*>([\s\S]*?)<\/span>/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const raw = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '').trim());
      const currency = raw.startsWith('£') ? 'GBP' : raw.startsWith('€') ? 'EUR' : 'USD';
      const amount = parseFloat(raw.replace(/[^0-9.]/g, ''));
      if (!isNaN(amount) && amount > 0) {
        return { amount, currency };
      }
    }
  }

  return null;
}

function extractListPrice(html: string): number | null {
  const match = html.match(/class="[^"]*basisPrice[^"]*"[\s\S]*?<span[^>]*class="a-offscreen"[^>]*>([\s\S]*?)<\/span>/);
  if (match) {
    const amount = parseFloat(match[1].replace(/[^0-9.]/g, ''));
    if (!isNaN(amount) && amount > 0) return amount;
  }

  const altMatch = html.match(/(?:List Price|Was)[\s\S]{0,100}?\$([\d,.]+)/);
  if (altMatch) {
    const amount = parseFloat(altMatch[1].replace(/,/g, ''));
    if (!isNaN(amount) && amount > 0) return amount;
  }

  return null;
}

function extractProductRating(html: string): number | null {
  const match = html.match(/id="acrPopover"[\s\S]*?title="([\d.]+)\s*out of\s*5/);
  if (match) {
    const r = parseFloat(match[1]);
    if (r >= 1 && r <= 5) return r;
  }

  const altMatch = html.match(/<span[^>]*class="[^"]*a-icon-alt[^"]*"[^>]*>([\d.]+)\s*out of\s*5/);
  if (altMatch) {
    const r = parseFloat(altMatch[1]);
    if (r >= 1 && r <= 5) return r;
  }

  return null;
}

function extractProductReviewCount(html: string): number | null {
  const match = html.match(/id="acrCustomerReviewText"[^>]*>([\d,]+)\s*(?:ratings?|reviews?)/i);
  if (match) return parseInt(match[1].replace(/,/g, ''));

  const altMatch = html.match(/([\d,]+)\s*global\s*ratings/i);
  if (altMatch) return parseInt(altMatch[1].replace(/,/g, ''));

  return null;
}

function extractAvailability(html: string): string | null {
  const match = html.match(/id="availability"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
  if (match) {
    const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '').trim());
    if (text.length > 0 && text.length < 200) return text;
  }
  return null;
}

function extractBSR(html: string): BsrEntry[] {
  const entries: BsrEntry[] = [];

  // Pattern 1: Product details table  — "Best Sellers Rank"
  // e.g. "#1,234 in Electronics" or "#5 in Cell Phones & Accessories"
  const bsrSection = html.match(/(?:Best Sellers Rank|Amazon Best Sellers Rank)[\s\S]*?(?:<\/(?:tr|ul|div)>)/i);
  if (bsrSection) {
    const rankPattern = /#([\d,]+)\s+in\s+([^<(]+)/g;
    let m: RegExpExecArray | null;
    while ((m = rankPattern.exec(bsrSection[0])) !== null) {
      const rank = parseInt(m[1].replace(/,/g, ''));
      const category = decodeHtmlEntities(m[2].trim().replace(/\s*\(See Top 100.*$/i, ''));
      if (rank > 0 && category.length > 1) {
        entries.push({ rank, category });
      }
    }
  }

  // Pattern 2: Fallback — search entire page for BSR mentions
  if (entries.length === 0) {
    const globalPattern = /Best\s*Sellers?\s*Rank[\s\S]{0,50}?#([\d,]+)\s+in\s+([^<(]+)/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = globalPattern.exec(html)) !== null) {
      const rank = parseInt(m2[1].replace(/,/g, ''));
      const category = decodeHtmlEntities(m2[2].trim().replace(/\s*\(See Top 100.*$/i, ''));
      if (rank > 0 && category.length > 1) {
        entries.push({ rank, category });
      }
    }
  }

  return entries;
}

function extractFeatures(html: string): string[] {
  const features: string[] = [];

  const featureSection = html.match(/id="feature-bullets"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/);
  if (featureSection) {
    const liPattern = /<li[^>]*>\s*<span[^>]*class="[^"]*a-list-item[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = liPattern.exec(featureSection[1])) !== null) {
      const text = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '').trim());
      if (text.length > 5 && text.length < 500 && !/^\s*$/.test(text)) {
        features.push(text);
      }
    }
  }

  return features;
}

function extractImages(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Look for main image and alt images in the image data JSON
  const imgDataMatch = html.match(/'colorImages'[\s\S]*?\{[\s\S]*?'initial'[\s\S]*?\[([\s\S]*?)\]/);
  if (imgDataMatch) {
    const hiResPattern = /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = hiResPattern.exec(imgDataMatch[1])) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        images.push(m[1]);
      }
    }

    if (images.length === 0) {
      const largePattern = /"large"\s*:\s*"(https:\/\/[^"]+)"/g;
      while ((m = largePattern.exec(imgDataMatch[1])) !== null) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          images.push(m[1]);
        }
      }
    }
  }

  // Fallback: landingImage
  if (images.length === 0) {
    const mainImg = html.match(/id="landingImage"[^>]*src="(https:\/\/[^"]+)"/);
    if (mainImg && !seen.has(mainImg[1])) {
      images.push(mainImg[1]);
    }
  }

  return images;
}

function extractBreadcrumbs(html: string): string[] {
  const categories: string[] = [];
  const breadcrumb = html.match(/id="wayfinding-breadcrumbs_feature_div"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/);

  if (breadcrumb) {
    const linkPattern = /<a[^>]*class="[^"]*a-link-normal[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = linkPattern.exec(breadcrumb[1])) !== null) {
      const cat = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '').trim());
      if (cat.length > 0) categories.push(cat);
    }
  }

  return categories;
}
