/**
 * Amazon Product & BSR Scraper
 * ────────────────────────────
 * Extracts product data, BSR rankings, search results, bestsellers,
 * and reviews from Amazon using mobile proxies.
 *
 * Supports marketplaces: US, UK, DE, FR, IT, ES, CA, JP, IN, AU
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface AmazonPrice {
  current: number | null;
  currency: string;
  was: number | null;
  discount_pct: number | null;
}

export interface BsrRank {
  rank: number | null;
  category: string | null;
  sub_category_ranks: { category: string; rank: number }[];
}

export interface BuyBox {
  seller: string | null;
  is_amazon: boolean;
  fulfilled_by: string | null;
}

export interface AmazonProduct {
  asin: string;
  title: string | null;
  price: AmazonPrice;
  bsr: BsrRank;
  rating: number | null;
  reviews_count: number | null;
  buy_box: BuyBox;
  availability: string | null;
  brand: string | null;
  images: string[];
  description: string | null;
  features: string[];
  marketplace: string;
}

export interface AmazonSearchResult {
  asin: string;
  title: string | null;
  price: AmazonPrice;
  rating: number | null;
  reviews_count: number | null;
  image: string | null;
  is_sponsored: boolean;
  url: string;
}

export interface AmazonReview {
  author: string | null;
  rating: number | null;
  title: string | null;
  text: string;
  date: string | null;
  verified_purchase: boolean;
  helpful_count: number | null;
}

export interface AmazonBestseller {
  rank: number;
  asin: string | null;
  title: string | null;
  price: AmazonPrice;
  rating: number | null;
  reviews_count: number | null;
  image: string | null;
  url: string;
}

// ─── MARKETPLACE DOMAINS ────────────────────────────

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  IT: 'www.amazon.it',
  ES: 'www.amazon.es',
  CA: 'www.amazon.ca',
  JP: 'www.amazon.co.jp',
  IN: 'www.amazon.in',
  AU: 'www.amazon.com.au',
};

const MARKETPLACE_CURRENCIES: Record<string, string> = {
  US: 'USD', UK: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR',
  ES: 'EUR', CA: 'CAD', JP: 'JPY', IN: 'INR', AU: 'AUD',
};

export function getMarketplaceDomain(marketplace: string): string {
  return MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || MARKETPLACE_DOMAINS.US;
}

function getCurrency(marketplace: string): string {
  return MARKETPLACE_CURRENCIES[marketplace.toUpperCase()] || 'USD';
}

// ─── USER AGENTS ────────────────────────────────────

const MOBILE_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
];

function randomUA(): string {
  return MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
}

// ─── HELPERS ────────────────────────────────────────

function extractText(html: string, startMarker: string, endMarker: string): string | null {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;
  const afterStart = startIdx + startMarker.length;
  const endIdx = html.indexOf(endMarker, afterStart);
  if (endIdx === -1) return null;
  return html.slice(afterStart, endIdx).trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/<[^>]+>/g, '');
}

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.,]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseInteger(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9]/g, '');
  const num = parseInt(cleaned);
  return isNaN(num) ? null : num;
}

async function fetchAmazonPage(url: string): Promise<string> {
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
    },
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Amazon returned HTTP ${response.status}`);
  }

  const html = await response.text();

  // Detect CAPTCHA / bot block
  if (html.includes('captcha') && html.includes('Type the characters')) {
    throw new Error('Amazon CAPTCHA detected — proxy IP may be flagged. Retry with a different exit.');
  }

  if (html.includes('Sorry, we just need to make sure you') || html.includes('robot')) {
    throw new Error('Amazon bot detection triggered. Retry shortly.');
  }

  return html;
}

// ─── PRODUCT SCRAPER ────────────────────────────────

export async function scrapeProduct(asin: string, marketplace: string = 'US'): Promise<AmazonProduct> {
  const domain = getMarketplaceDomain(marketplace);
  const url = `https://${domain}/dp/${encodeURIComponent(asin)}`;
  const html = await fetchAmazonPage(url);

  // Title
  const title = extractText(html, 'id="productTitle"', '</span>')
    ?? extractText(html, 'id="title"', '</span>');
  const cleanTitle = title ? decodeEntities(title).trim() : null;

  // Price
  const priceWhole = extractText(html, 'class="a-price-whole"', '</span>');
  const priceFraction = extractText(html, 'class="a-price-fraction"', '</span>');
  let currentPrice: number | null = null;
  if (priceWhole) {
    const whole = priceWhole.replace(/[^0-9]/g, '');
    const frac = priceFraction?.replace(/[^0-9]/g, '') || '00';
    currentPrice = parseFloat(`${whole}.${frac}`);
    if (isNaN(currentPrice)) currentPrice = null;
  }

  // Was price (strike-through)
  let wasPrice: number | null = null;
  const wasPriceText = extractText(html, 'priceBlockStrikePriceString"', '</span>')
    ?? extractText(html, 'class="a-text-price"', '</span>');
  if (wasPriceText) {
    wasPrice = parsePrice(wasPriceText);
  }

  let discountPct: number | null = null;
  if (currentPrice && wasPrice && wasPrice > currentPrice) {
    discountPct = Math.round(((wasPrice - currentPrice) / wasPrice) * 100);
  }

  // Rating
  const ratingText = extractText(html, 'id="acrPopover"', '</span>')
    ?? extractText(html, 'class="a-icon-alt">', '</span>');
  let rating: number | null = null;
  if (ratingText) {
    const match = ratingText.match(/([\d.]+)\s*out of/);
    if (match) rating = parseFloat(match[1]);
  }

  // Review count
  const reviewCountText = extractText(html, 'id="acrCustomerReviewText"', '</span>');
  const reviewsCount = parseInteger(reviewCountText);

  // BSR
  const bsr = extractBsr(html);

  // Buy Box
  const buyBox = extractBuyBox(html);

  // Availability
  const availText = extractText(html, 'id="availability"', '</div>');
  const availability = availText ? decodeEntities(availText).trim().replace(/\s+/g, ' ') : null;

  // Brand
  const brand = extractText(html, 'id="bylineInfo"', '</a>')
    ?? extractText(html, '"brand":"', '"');
  const cleanBrand = brand ? decodeEntities(brand).replace(/^(Visit the |Brand: )/, '').trim() : null;

  // Images
  const images: string[] = [];
  const imgRegex = /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 10) {
    images.push(imgMatch[1]);
  }

  // Description
  const descText = extractText(html, 'id="productDescription"', '</div>');
  const description = descText ? decodeEntities(descText).trim().replace(/\s+/g, ' ') : null;

  // Feature bullets
  const features: string[] = [];
  const bulletRegex = /class="a-list-item"[^>]*>\s*<span[^>]*>(.*?)<\/span>/gs;
  let bulletMatch;
  while ((bulletMatch = bulletRegex.exec(html)) !== null && features.length < 10) {
    const text = decodeEntities(bulletMatch[1]).trim();
    if (text.length > 5 && text.length < 500) {
      features.push(text);
    }
  }

  return {
    asin,
    title: cleanTitle,
    price: {
      current: currentPrice,
      currency: getCurrency(marketplace),
      was: wasPrice,
      discount_pct: discountPct,
    },
    bsr,
    rating,
    reviews_count: reviewsCount,
    buy_box: buyBox,
    availability,
    brand: cleanBrand,
    images,
    description,
    features,
    marketplace: marketplace.toUpperCase(),
  };
}

function extractBsr(html: string): BsrRank {
  const bsrResult: BsrRank = { rank: null, category: null, sub_category_ranks: [] };

  // Pattern 1: "Best Sellers Rank: #1 in Electronics"
  const bsrMatch = html.match(/Best\s*Sellers?\s*Rank[:\s]*#?([\d,]+)\s+in\s+([^<(]+)/i);
  if (bsrMatch) {
    bsrResult.rank = parseInteger(bsrMatch[1]);
    bsrResult.category = bsrMatch[2].trim();
  }

  // Sub-category ranks
  const subRankRegex = /#([\d,]+)\s+in\s+([^<(]+?)(?:\s*\(|<)/g;
  let subMatch;
  let first = true;
  while ((subMatch = subRankRegex.exec(html)) !== null && bsrResult.sub_category_ranks.length < 5) {
    // Skip the first match if it's the main BSR we already captured
    if (first && bsrResult.rank !== null) {
      first = false;
      continue;
    }
    first = false;
    const rank = parseInteger(subMatch[1]);
    const category = subMatch[2].trim();
    if (rank !== null && category.length > 1) {
      bsrResult.sub_category_ranks.push({ category, rank });
    }
  }

  return bsrResult;
}

function extractBuyBox(html: string): BuyBox {
  // "Sold by" and "Fulfilled by"
  const soldBy = extractText(html, 'id="sellerProfileTriggerId"', '</a>')
    ?? extractText(html, 'Sold by', '</');
  const seller = soldBy ? decodeEntities(soldBy).trim() : null;

  const isAmazon = seller
    ? /amazon/i.test(seller)
    : html.includes('Ships from and sold by Amazon');

  let fulfilledBy: string | null = null;
  if (html.includes('Fulfilled by Amazon') || html.includes('Ships from Amazon')) {
    fulfilledBy = 'Amazon';
  } else if (seller) {
    fulfilledBy = seller;
  }

  return { seller, is_amazon: isAmazon, fulfilled_by: fulfilledBy };
}

// ─── SEARCH SCRAPER ─────────────────────────────────

export async function scrapeSearch(
  query: string,
  marketplace: string = 'US',
  category?: string,
  limit: number = 20,
): Promise<AmazonSearchResult[]> {
  const domain = getMarketplaceDomain(marketplace);
  const params = new URLSearchParams({ k: query });
  if (category) params.set('i', category);

  const url = `https://${domain}/s?${params.toString()}`;
  const html = await fetchAmazonPage(url);

  const results: AmazonSearchResult[] = [];
  const currency = getCurrency(marketplace);

  // Split by search result items
  const itemRegex = /data-asin="([A-Z0-9]{10})"/g;
  let match;
  const asins: string[] = [];
  while ((match = itemRegex.exec(html)) !== null && asins.length < limit) {
    if (!asins.includes(match[1])) {
      asins.push(match[1]);
    }
  }

  // For each ASIN found, extract data from the search page HTML
  for (const asin of asins.slice(0, limit)) {
    // Find the section for this ASIN
    const asinIdx = html.indexOf(`data-asin="${asin}"`);
    if (asinIdx === -1) continue;

    // Take a chunk of HTML around this result (up to next data-asin or 5000 chars)
    const nextAsinIdx = html.indexOf('data-asin="', asinIdx + 20);
    const chunk = html.slice(asinIdx, nextAsinIdx > 0 ? nextAsinIdx : asinIdx + 5000);

    // Title
    const titleMatch = chunk.match(/class="a-size-[^"]*\s+a-color-base\s+a-text-normal"[^>]*>(.*?)<\/span>/s)
      ?? chunk.match(/class="a-text-normal"[^>]*>(.*?)<\/span>/s);
    const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;

    // Price
    const priceMatch = chunk.match(/class="a-price-whole"[^>]*>([\d,]+)/);
    const fracMatch = chunk.match(/class="a-price-fraction"[^>]*>(\d+)/);
    let price: number | null = null;
    if (priceMatch) {
      const whole = priceMatch[1].replace(/,/g, '');
      const frac = fracMatch ? fracMatch[1] : '00';
      price = parseFloat(`${whole}.${frac}`);
      if (isNaN(price)) price = null;
    }

    // Rating
    const ratingMatch = chunk.match(/([\d.]+) out of 5/);
    const ratingVal = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Review count
    const reviewMatch = chunk.match(/aria-label="([\d,]+)"[^>]*>[\s\S]*?<\/span>\s*<\/a>/);
    const reviewCount = reviewMatch ? parseInteger(reviewMatch[1]) : null;

    // Image
    const imgMatch = chunk.match(/src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/);
    const image = imgMatch ? imgMatch[1] : null;

    // Sponsored
    const isSponsored = /Sponsored|AdHolder/i.test(chunk);

    results.push({
      asin,
      title,
      price: { current: price, currency, was: null, discount_pct: null },
      rating: ratingVal,
      reviews_count: reviewCount,
      image,
      is_sponsored: isSponsored,
      url: `https://${domain}/dp/${asin}`,
    });
  }

  return results;
}

// ─── BESTSELLERS SCRAPER ────────────────────────────

export async function scrapeBestsellers(
  marketplace: string = 'US',
  category: string = 'electronics',
  limit: number = 20,
): Promise<AmazonBestseller[]> {
  const domain = getMarketplaceDomain(marketplace);
  const url = `https://${domain}/Best-Sellers/zgbs/${encodeURIComponent(category)}`;
  const html = await fetchAmazonPage(url);

  const results: AmazonBestseller[] = [];
  const currency = getCurrency(marketplace);

  // Pattern: zg-bdg-text (rank badge) followed by product info
  const itemRegex = /class="zg-bdg-text"[^>]*>#?(\d+)<\/span>[\s\S]*?(?:data-asin="([A-Z0-9]{10})")?[\s\S]*?<a[^>]*href="([^"]*\/dp\/([A-Z0-9]{10})[^"]*)"[^>]*>(.*?)<\/a>/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(html)) !== null && results.length < limit) {
    const rank = parseInt(itemMatch[1]);
    const asin = itemMatch[4] || itemMatch[2] || null;
    const title = decodeEntities(itemMatch[5]).trim();

    // Extract price from nearby chunk
    const chunkStart = itemMatch.index;
    const chunk = html.slice(chunkStart, chunkStart + 2000);
    const priceMatch = chunk.match(/class="a-price-whole"[^>]*>([\d,]+)/);
    const fracMatch = chunk.match(/class="a-price-fraction"[^>]*>(\d+)/);
    let price: number | null = null;
    if (priceMatch) {
      price = parseFloat(`${priceMatch[1].replace(/,/g, '')}.${fracMatch ? fracMatch[1] : '00'}`);
      if (isNaN(price)) price = null;
    }

    const ratingMatch = chunk.match(/([\d.]+) out of 5/);
    const reviewMatch = chunk.match(/([\d,]+)\s*(?:ratings|reviews)/i);
    const imgMatch = chunk.match(/src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/);

    results.push({
      rank,
      asin,
      title: title || null,
      price: { current: price, currency, was: null, discount_pct: null },
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      reviews_count: reviewMatch ? parseInteger(reviewMatch[1]) : null,
      image: imgMatch ? imgMatch[1] : null,
      url: asin ? `https://${domain}/dp/${asin}` : `https://${domain}${itemMatch[3]}`,
    });
  }

  // Fallback: simpler regex if the above didn't match
  if (results.length === 0) {
    const simpleRegex = /\/dp\/([A-Z0-9]{10})/g;
    let simpleMatch;
    let rank = 1;
    const seen = new Set<string>();
    while ((simpleMatch = simpleRegex.exec(html)) !== null && results.length < limit) {
      const asin = simpleMatch[1];
      if (seen.has(asin)) continue;
      seen.add(asin);
      results.push({
        rank: rank++,
        asin,
        title: null,
        price: { current: null, currency, was: null, discount_pct: null },
        rating: null,
        reviews_count: null,
        image: null,
        url: `https://${domain}/dp/${asin}`,
      });
    }
  }

  return results;
}

// ─── REVIEWS SCRAPER ────────────────────────────────

export async function scrapeReviews(
  asin: string,
  marketplace: string = 'US',
  sort: string = 'recent',
  limit: number = 10,
): Promise<{ asin: string; reviews: AmazonReview[]; marketplace: string }> {
  const domain = getMarketplaceDomain(marketplace);
  const sortBy = sort === 'helpful' ? 'helpful' : 'recent';
  const url = `https://${domain}/product-reviews/${encodeURIComponent(asin)}?sortBy=${sortBy}&pageNumber=1`;
  const html = await fetchAmazonPage(url);

  const reviews: AmazonReview[] = [];

  // Each review is inside a div with data-hook="review"
  const reviewBlocks = html.split('data-hook="review"');

  for (let i = 1; i < reviewBlocks.length && reviews.length < limit; i++) {
    const block = reviewBlocks[i].slice(0, 5000);

    // Author
    const authorMatch = block.match(/class="a-profile-name"[^>]*>(.*?)<\/span>/);
    const author = authorMatch ? decodeEntities(authorMatch[1]).trim() : null;

    // Rating
    const ratingMatch = block.match(/([\d.]+) out of 5 stars/);
    const ratingVal = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Title
    const titleMatch = block.match(/data-hook="review-title"[^>]*>(?:[\s\S]*?<span[^>]*>)?(.*?)<\/span>/);
    const titleText = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;

    // Review text
    const textMatch = block.match(/data-hook="review-body"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
    const text = textMatch ? decodeEntities(textMatch[1]).trim() : '';

    // Date
    const dateMatch = block.match(/data-hook="review-date"[^>]*>(.*?)<\/span>/);
    const dateText = dateMatch ? decodeEntities(dateMatch[1]).trim() : null;

    // Verified purchase
    const verified = /Verified Purchase/i.test(block);

    // Helpful count
    const helpfulMatch = block.match(/([\d,]+)\s+(?:people|person)\s+found this helpful/i);
    const helpfulCount = helpfulMatch ? parseInteger(helpfulMatch[1]) : null;

    if (text || titleText) {
      reviews.push({
        author,
        rating: ratingVal,
        title: titleText,
        text,
        date: dateText,
        verified_purchase: verified,
        helpful_count: helpfulCount,
      });
    }
  }

  return { asin, reviews, marketplace: marketplace.toUpperCase() };
}
