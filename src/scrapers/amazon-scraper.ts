/**
 * Amazon Product BSR Scraper (Bounty #72)
 * ───────────────────────────────────────────
 * Scrapes Amazon product pages for price, Best Seller Rank, reviews,
 * ratings, buy box, and availability. Uses mobile proxies to avoid
 * Amazon's aggressive anti-bot detection.
 */

import { proxyFetch, getProxy } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

// ─── RESULT TYPES ───────────────────────────────────

export interface PriceInfo {
  current: number | null;
  currency: string;
  was: number | null;
  discount_pct: number | null;
}

export interface BSRank {
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
  title: string;
  price: PriceInfo;
  bsr: BSRank;
  rating: number | null;
  reviews_count: number | null;
  buy_box: BuyBox;
  availability: string | null;
  brand: string | null;
  images: string[];
  meta: {
    marketplace: string;
    proxy: { country: string; carrier: string };
  };
}

export interface AmazonSearchResult {
  position: number;
  asin: string;
  title: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviews_count: number | null;
  image_url: string | null;
  url: string;
  prime: boolean;
  sponsored: boolean;
}

export interface AmazonReviewsResult {
  asin: string;
  title: string;
  overall: number;
  title_only: string;
  body: string;
  author: string;
  date: string;
  verified: boolean;
  helpful: number;
  stars: number;
}

// ─── HELPERS ────────────────────────────────────────

function sanitizeText(value: unknown, maxLen: number = 500): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function normalizeMoney(raw: string | null): { amount: number | null; currency: string } {
  if (!raw) return { amount: null, currency: 'USD' };
  const cleaned = raw.replace(/[£$€¥₹]/g, '').replace(/,/g, '').trim();
  const match = cleaned.match(/^([\d.]+)/);
  const amount = match ? parseFloat(match[1]) : null;
  const currency = raw.includes('£') ? 'GBP' : raw.includes('€') ? 'EUR' : raw.includes('¥') ? 'JPY' : raw.includes('₹') ? 'INR' : 'USD';
  return { amount, currency };
}

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'amazon.com',
  UK: 'amazon.co.uk',
  GB: 'amazon.co.uk',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  ES: 'amazon.es',
  IT: 'amazon.it',
  JP: 'amazon.co.jp',
  CA: 'amazon.ca',
};

function buildAmazonUrl(asin: string, marketplace: string = 'US'): string {
  const domain = MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || 'amazon.com';
  return `https://www.${domain}/dp/${asin}`;
}

function buildSearchUrl(query: string, marketplace: string = 'US', category?: string): string {
  const domain = MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || 'amazon.com';
  const params = new URLSearchParams({ k: query });
  if (category) params.set('i', category);
  return `https://www.${domain}/s?${params.toString()}`;
}

// ─── PRODUCT PAGE PARSING ────────────────────────────

function parsePrice(html: string): PriceInfo {
  // Current price
  const currentPatterns = [
    /class="[^"]*a-price-whole[^"]*"[^>]*>([\d,]+)<\/span><span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>([\d]+)/,
    /class="[^"]*a-price[a-z]*[^"]*"[^>]*>.*?[\$£€¥₹][\s]*([\d,]+)\.([\d]+)/,
    /"priceAmount":\s*([\d.]+)/,
    /class="[^"]*a-offscreen[^"]*"[^>]*>[\$£€¥₹][\s]*([\d,]+)/,
  ];

  let currentAmount: number | null = null;
  let currency = 'USD';

  for (const pattern of currentPatterns) {
    const match = html.match(pattern);
    if (match) {
      const whole = (match[1] || '').replace(/,/g, '');
      const fraction = match[2] || '00';
      const amount = parseFloat(`${whole}.${fraction}`);
      if (amount > 0) {
        currentAmount = amount;
        if (html.includes('£')) currency = 'GBP';
        else if (html.includes('€')) currency = 'EUR';
        else if (html.includes('¥')) currency = 'JPY';
        else if (html.includes('₹')) currency = 'INR';
        break;
      }
    }
  }

  // Was price
  let wasAmount: number | null = null;
  const wasMatch = html.match(/class="[^"]*a-text-strike[^"]*"[^>]*>[\$£€¥₹][\s]*([\d,]+)/);
  if (wasMatch) wasAmount = parseFloat(wasMatch[1].replace(/,/g, ''));

  let discount: number | null = null;
  if (currentAmount && wasAmount && wasAmount > currentAmount) {
    discount = Math.round(((wasAmount - currentAmount) / wasAmount) * 100);
  }

  return { current: currentAmount, currency, was: wasAmount, discount_pct: discount };
}

function parseBSR(html: string): BSRank {
  const subRanks: { category: string; rank: number }[] = [];
  let mainRank: number | null = null;
  let mainCategory: string | null = null;

  // Best Sellers Rank pattern
  const bsrPatterns = [
    /#([\d,]+)\s+in\s+<a[^>]*>([^<]+)<\/a>/g,
    /#([\d,]+)\s+in\s+([^#<\n]+?)(?:\s+#|<\/span>|$)/g,
    /Best Sellers Rank:\s*#([\d,]+)\s+in\s+([^#<\n]+)/gi,
  ];

  for (const pattern of bsrPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const rank = parseInt(match[1].replace(/,/g, ''));
      const category = sanitizeText(match[2], 100);
      if (!mainRank) {
        mainRank = rank;
        mainCategory = category;
      } else {
        subRanks.push({ category, rank });
      }
    }
  }

  // Also try structured data
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch && !mainRank) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const offers = Array.isArray(data) ? data : [data];
      for (const item of offers) {
        if (item.aggregateRating) {
          // BSR sometimes in offers
        }
      }
    } catch { /* skip */ }
  }

  return { rank: mainRank, category: mainCategory, sub_category_ranks: subRanks.slice(0, 5) };
}

function parseBuyBox(html: string): BuyBox {
  let seller: string | null = null;
  let isAmazon = false;
  let fulfilledBy: string | null = null;

  // Buy box seller
  const sellerMatch = html.match(/sold by[^:]*:\s*<[^>]*>([^<]+)<\/a>/i)
    || html.match(/Sold by[^<]*<[^>]*>([^<]+)<\/a>/i)
    || html.match(/"sellerName"\s*:\s*"([^"]+)"/i);
  if (sellerMatch) seller = sanitizeText(sellerMatch[1]);

  // Fulfilled by Amazon
  const fbaMatch = html.match(/fulfilled by amazon/i)
    || html.match(/Fulfilled by Amazon/i)
    || html.match(/"fulfillmentBasis"\s*:\s*"FBA"/i);
  if (fbaMatch) fulfilledBy = 'FBA';

  // Is Amazon
  const amazonMatch = html.match(/sold by\s*(?:amazon|amzn)/i)
    || html.match(/class="[^"]*a-size-mini[^"]*"[^>]*>\s*(?:Amazon\.com|Amazon)/i);
  if (amazonMatch || /sold and shipped by amazon/i.test(html)) isAmazon = true;

  return { seller, is_amazon: isAmazon, fulfilled_by: fulfilledBy };
}

function parseRating(html: string): number | null {
  const patterns = [
    /class="[^"]*a-icon-alt[^"]*"[^>]*>([\d.]+)\s+out\s+of\s+[\d.]+/i,
    /"ratingValue"\s*:\s*([\d.]+)/,
    /([\d.]+)\s+out\s+of\s+5\s+stars/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const rating = parseFloat(match[1]);
      if (rating >= 0 && rating <= 5) return rating;
    }
  }
  return null;
}

function parseReviewsCount(html: string): number | null {
  const patterns = [
    /class="[^"]*a-size-base[^"]*"[^>]*>\s*([\d,]+)\s+(?:customer|global)\s+reviews/i,
    /"reviewCount"\s*:\s*"([\d,]+)"/,
    /([\d,]+)\s+ratings?/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return parseInt(match[1].replace(/,/g, ''));
  }
  return null;
}

function parseAvailability(html: string): string | null {
  const patterns = [
    /class="[^"]*a昂?availability[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i,
    /<div[^>]*id="availability"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i,
    /"availability":\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return sanitizeText(match[1]);
  }
  return null;
}

function parseBrand(html: string): string | null {
  const patterns = [
    /Brand[:\s]*<[^>]*>([^<]+)<\/a>/i,
    /Brand:\s*<[^>]*>\s*<[^>]*>([^<]+)<\/span>/i,
    /"brand"\s*:\s*"([^"]+)"/i,
    /class="[^"]*po-brand[^"]*"[^>]*>\s*<span[^>]*class="[^"]*"[^>]*>([^<]+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return sanitizeText(match[1]);
  }
  return null;
}

function parseImages(html: string): string[] {
  const images: string[] = [];
  // hiRes images from imageBlock JSON
  const hiResMatch = html.match(/"hiRes"\s*:\s*\[([^\]]+)\]/);
  if (hiResMatch) {
    const imgMatches = hiResMatch[1].match(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi);
    if (imgMatches) {
      for (const m of imgMatches) {
        const url = m.replace(/"/g, '').replace(/\\\//g, '/');
        if (!images.includes(url)) images.push(url);
      }
    }
  }
  // Also extract from data OldLookImage or landingImage
  if (images.length === 0) {
    const imgPattern = /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    let match;
    while ((match = imgPattern.exec(html)) !== null) {
      const url = match[1].replace(/\\\//g, '/');
      if (!images.includes(url) && url.includes('amazon.com/images')) {
        images.push(url);
      }
    }
  }
  return images.slice(0, 5);
}

function parseTitle(html: string): string {
  const patterns = [
    /<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /"name"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return sanitizeText(match[1], 500);
  }
  return 'Unknown Product';
}

// ─── MAIN FUNCTIONS ─────────────────────────────────

export async function scrapeAmazonProduct(
  asin: string,
  marketplace: string = 'US',
): Promise<AmazonProduct> {
  const url = buildAmazonUrl(asin, marketplace);
  const userAgent = getRandomUserAgent();
  const proxy = getProxy();

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
    'Referer': `https://www.${MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || 'amazon.com'}/`,
  };

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Amazon returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') || html.includes('robot check') || html.includes('blocked')) {
    throw new Error('Amazon CAPTCHA or block detected — try a different proxy');
  }

  return {
    asin,
    title: parseTitle(html),
    price: parsePrice(html),
    bsr: parseBSR(html),
    rating: parseRating(html),
    reviews_count: parseReviewsCount(html),
    buy_box: parseBuyBox(html),
    availability: parseAvailability(html),
    brand: parseBrand(html),
    images: parseImages(html),
    meta: {
      marketplace: marketplace.toUpperCase(),
      proxy: { country: proxy.country, carrier: proxy.host || 'mobile' },
    },
  };
}

export async function searchAmazonProducts(
  query: string,
  marketplace: string = 'US',
  limit: number = 20,
): Promise<AmazonSearchResult[]> {
  const url = buildSearchUrl(query, marketplace);
  const userAgent = getRandomUserAgent();

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
    'Referer': `https://www.${MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || 'amazon.com'}/`,
  };

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Amazon search returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') || html.includes('robot check')) {
    throw new Error('Amazon CAPTCHA or block detected');
  }

  return parseSearchResults(html, marketplace, limit);
}

function parseSearchResults(html: string, marketplace: string, limit: number): AmazonSearchResult[] {
  const results: AmazonSearchResult[] = [];

  // Search result items
  const itemPattern = /<div[^>]*data-asin="([A-Z0-9]{10})"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*data-asin|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(html)) !== null && results.length < limit) {
    const asin = match[1];
    const block = match[2];

    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i)
      || block.match(/aria-label="([^"]{5,300})"/i);
    const title = titleMatch ? sanitizeText(titleMatch[1]) : `ASIN ${asin}`;

    const priceMatch = block.match(/[\$£€¥₹][\s]*([\d,]+)\.([\d]+)/)
      || block.match(/class="[^"]*a-price-whole[^"]*"[^>]*>([\d,]+)/);
    const { amount: price } = normalizeMoney(priceMatch ? `${priceMatch[1]}.${priceMatch[2] || '00'}` : null);

    const ratingMatch = block.match(/([\d.]+)\s+out\s+of\s+[\d.]+\s+stars?/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    const reviewsMatch = block.match(/\(([\d,]+)\)/);
    const reviews_count = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, '')) : null;

    const imgMatch = block.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    const image_url = imgMatch ? imgMatch[1].replace(/_\w+\.jpg/, '.jpg') : null;

    const primeMatch = /prime|PRIME/.test(block);
    const sponsoredMatch = /sponsor|Sponsored|Sponsored links/.test(block);

    const domain = MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || 'amazon.com';

    results.push({
      position: results.length + 1,
      asin,
      title,
      price,
      currency: priceMatch ? (priceMatch[0].includes('£') ? 'GBP' : priceMatch[0].includes('€') ? 'EUR' : 'USD') : 'USD',
      rating,
      reviews_count,
      image_url,
      url: `https://www.${domain}/dp/${asin}`,
      prime: primeMatch,
      sponsored: sponsoredMatch,
    });
  }

  return results;
}

export async function scrapeAmazonReviews(
  asin: string,
  sort: string = 'recent',
  limit: number = 10,
): Promise<AmazonReviewsResult[]> {
  const marketplace = 'US';
  const domain = MARKETPLACE_DOMAINS[marketplace] || 'amazon.com';
  const sortParam = sort === 'recent' ? 'recent' : sort === 'helpful' ? 'helpful' : 'top';
  const url = `https://www.${domain}/product-reviews/${asin}?sortBy=${sortParam}`;

  const userAgent = getRandomUserAgent();
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US',
    'DNT': '1',
  };

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 1,
    headers,
  });

  if (!response.ok) throw new Error(`Amazon reviews fetch failed: HTTP ${response.status}`);
  const html = await response.text();

  return parseReviewResults(html, asin, limit);
}

function parseReviewResults(html: string, asin: string, limit: number): AmazonReviewsResult[] {
  const results: AmazonReviewsResult[] = [];

  const reviewPattern = /<div[^>]*data-asin="[^"]*"[^>]*data-name="[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*data-asin|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = reviewPattern.exec(html)) !== null && results.length < limit) {
    const block = match[1];

    const starsMatch = block.match(/class="[^"]*a-star-(\d)[^"]*"[^>]*>/i)
      || block.match(/aria-label="([\d.]+)\s+out\s+of/i);
    const stars = starsMatch ? parseInt(starsMatch[1]) : 5;

    const titleMatch = block.match(/class="[^"]*review-title[^"]*"[^>]*>([^<]+)<\/span>/i)
      || block.match(/aria-label="([^"]{5,200})"/i);
    const title = titleMatch ? sanitizeText(titleMatch[1]) : '';

    const bodyMatch = block.match(/class="[^"]*review-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || block.match(/<span[^>]*>([\s\S]{20,2000}?)<\/span>/i);
    const body = bodyMatch ? sanitizeText(bodyMatch[1], 2000) : '';

    const authorMatch = block.match(/class="[^"]*author[^"]*"[^>]*>\s*<[^>]*>([^<]+)<\/a>/i)
      || block.match(/"author"\s*:\s*"([^"]+)"/i);
    const author = authorMatch ? sanitizeText(authorMatch[1]) : 'Anonymous';

    const dateMatch = block.match(/data-hook="review-date"[^>]*>([^<]+)<\/span>/i)
      || block.match(/class="[^"]*review-date[^"]*"[^>]*>([^<]+)<\/span>/i);
    const date = dateMatch ? sanitizeText(dateMatch[1]) : '';

    const verifiedMatch = /verified purchase|VINE VOICE/i.test(block);
    const helpfulMatch = block.match(/(\d+)\s+people found this helpful/i);

    results.push({
      asin,
      title,
      overall: stars,
      title_only: title,
      body,
      author,
      date,
      verified: verifiedMatch,
      helpful: helpfulMatch ? parseInt(helpfulMatch[1]) : 0,
      stars,
    });
  }

  return results;
}
