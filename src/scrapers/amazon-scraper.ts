/**
 * Amazon Product & BSR Tracker Scraper (Bounty #72)
 * ──────────────────────────────────────────────────
 * Scrapes Amazon product data: price, BSR, reviews, ratings,
 * buy box winner, and competitor analysis via mobile proxies.
 *
 * Amazon has aggressive anti-bot (TLS fingerprinting, ML anomaly
 * detection). Mobile carrier IPs blend with Amazon shopping app traffic.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface AmazonProduct {
  asin: string;
  title: string;
  price: {
    current: number | null;
    currency: string;
    originalPrice: number | null;
    savings: string | null;
  };
  rating: number | null;
  ratingsCount: number | null;
  reviewsCount: number | null;
  bsr: BestSellerRank[];
  availability: string | null;
  seller: string | null;
  brand: string | null;
  category: string | null;
  features: string[];
  images: string[];
  url: string;
  marketplace: string;
}

export interface BestSellerRank {
  rank: number;
  category: string;
}

export interface AmazonSearchResult {
  query: string;
  marketplace: string;
  totalResults: number;
  products: AmazonProductSummary[];
}

export interface AmazonProductSummary {
  asin: string;
  title: string;
  price: number | null;
  rating: number | null;
  ratingsCount: number | null;
  isPrime: boolean;
  isSponsored: boolean;
  url: string;
  image: string | null;
}

export interface AmazonReview {
  title: string;
  rating: number;
  author: string;
  date: string;
  text: string;
  verified: boolean;
  helpful: number | null;
}

// ─── ERROR CLASS ────────────────────────────────────

export class AmazonError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AmazonError';
  }

  get httpStatus(): number {
    switch (this.code) {
      case 'captcha_detected': return 503;
      case 'rate_limited': return 503;
      case 'blocked': return 403;
      case 'not_found': return 404;
      case 'invalid_input': return 400;
      default: return 500;
    }
  }

  get shouldNotCharge(): boolean {
    return ['captcha_detected', 'rate_limited', 'blocked', 'scrape_failed'].includes(this.code);
  }
}

// ─── CONSTANTS ──────────────────────────────────────

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  IT: 'www.amazon.it',
  CA: 'www.amazon.ca',
  JP: 'www.amazon.co.jp',
};

function getDomain(marketplace: string): string {
  return MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || MARKETPLACE_DOMAINS.US;
}

function buildHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
  };
}

// ─── HELPERS ────────────────────────────────────────

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(html: string): number | null {
  // Try multiple price patterns
  const patterns = [
    /class="a-price"[^>]*>.*?class="a-offscreen"[^>]*>\s*\$([\d,.]+)/s,
    /id="priceblock_ourprice"[^>]*>\s*\$([\d,.]+)/,
    /id="priceblock_dealprice"[^>]*>\s*\$([\d,.]+)/,
    /"priceAmount"\s*:\s*"?([\d.]+)"?/,
    /class="a-price-whole"[^>]*>([\d,]+)\s*<.*?class="a-price-fraction"[^>]*>(\d+)/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const whole = match[1].replace(/,/g, '');
      const fraction = match[2] || '';
      return parseFloat(`${whole}${fraction ? '.' + fraction : ''}`);
    }
  }
  return null;
}

function parseBSR(html: string): BestSellerRank[] {
  const ranks: BestSellerRank[] = [];

  // Pattern 1: "Best Sellers Rank" section
  const bsrSection = html.match(/Best Sellers Rank[\s\S]*?<\/(?:table|div|ul)>/i);
  if (bsrSection) {
    const rankMatches = bsrSection[0].matchAll(/#([\d,]+)\s+(?:in\s+)?([^<(]+)/g);
    for (const m of rankMatches) {
      ranks.push({
        rank: parseInt(m[1].replace(/,/g, '')),
        category: cleanText(m[2]).replace(/\s*\(.*$/, ''),
      });
    }
  }

  // Pattern 2: alternate BSR format
  if (ranks.length === 0) {
    const altMatches = html.matchAll(/"salesRank"\s*:\s*\{[^}]*"displayGroupRank"\s*:\s*(\d+)[^}]*"displayGroup"\s*:\s*"([^"]*)"/g);
    for (const m of altMatches) {
      ranks.push({ rank: parseInt(m[1]), category: m[2] });
    }
  }

  return ranks;
}

// ─── SCRAPING FUNCTIONS ─────────────────────────────

/**
 * Get product details by ASIN
 */
export async function getProduct(asin: string, marketplace: string = 'US'): Promise<AmazonProduct> {
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    throw new AmazonError('invalid_input', 'Valid 10-character ASIN is required');
  }

  const domain = getDomain(marketplace);
  const url = `https://${domain}/dp/${asin}`;

  console.log(`[AMAZON] Fetching product: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(),
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    if (response.status === 404) throw new AmazonError('not_found', `Product ${asin} not found`);
    if (response.status === 503) throw new AmazonError('rate_limited', 'Amazon rate limited this IP');
    throw new AmazonError('scrape_failed', `Amazon returned ${response.status}`);
  }

  const html = await response.text();

  // Check for robot check page
  if (html.includes('Type the characters you see') || (html.includes('captcha') && html.length < 10000)) {
    throw new AmazonError('captcha_detected', 'Amazon CAPTCHA triggered');
  }

  // Extract title
  const titleMatch = html.match(/id="productTitle"[^>]*>([^<]+)/);
  const title = titleMatch ? cleanText(titleMatch[1]) : '';

  if (!title) {
    throw new AmazonError('scrape_failed', 'Could not extract product data — page may be blocked');
  }

  // Price
  const price = parsePrice(html);
  const origPriceMatch = html.match(/class="a-text-price"[^>]*><span[^>]*>\$([\d,.]+)/);
  const originalPrice = origPriceMatch ? parseFloat(origPriceMatch[1].replace(/,/g, '')) : null;

  // Rating
  const ratingMatch = html.match(/(\d\.\d)\s+out of\s+5/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  // Ratings count
  const ratingsMatch = html.match(/([\d,]+)\s+(?:global\s+)?ratings/);
  const ratingsCount = ratingsMatch ? parseInt(ratingsMatch[1].replace(/,/g, '')) : null;

  // BSR
  const bsr = parseBSR(html);

  // Brand
  const brandMatch = html.match(/id="bylineInfo"[^>]*>.*?(?:Brand:\s*|Visit the\s+)([\w\s&'-]+)/s);
  const brand = brandMatch ? cleanText(brandMatch[1]) : null;

  // Availability
  const availMatch = html.match(/id="availability"[^>]*>[\s\S]*?<span[^>]*>([^<]+)/);
  const availability = availMatch ? cleanText(availMatch[1]) : null;

  // Features (bullet points)
  const features: string[] = [];
  const featureMatches = html.matchAll(/id="feature-bullets"[\s\S]*?<li[^>]*><span[^>]*>([^<]+)/g);
  for (const m of featureMatches) {
    const f = cleanText(m[1]);
    if (f.length > 5) features.push(f);
  }

  // Images
  const images: string[] = [];
  const imgMatches = html.matchAll(/"hiRes"\s*:\s*"(https?:[^"]+)"/g);
  for (const m of imgMatches) {
    if (!images.includes(m[1])) images.push(m[1]);
  }

  // Seller
  const sellerMatch = html.match(/id="sellerProfileTriggerId"[^>]*>([^<]+)/) ||
                      html.match(/id="merchant-info"[^>]*>([^<]+)/);
  const seller = sellerMatch ? cleanText(sellerMatch[1]) : null;

  // Savings
  let savings: string | null = null;
  if (price && originalPrice && originalPrice > price) {
    const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
    savings = `${pct}% ($${(originalPrice - price).toFixed(2)})`;
  }

  return {
    asin,
    title,
    price: {
      current: price,
      currency: marketplace === 'UK' ? 'GBP' : marketplace === 'JP' ? 'JPY' : 'USD',
      originalPrice,
      savings,
    },
    rating,
    ratingsCount,
    reviewsCount: ratingsCount, // Amazon shows ratings count, not separate reviews
    bsr,
    availability,
    seller,
    brand,
    category: bsr.length > 0 ? bsr[0].category : null,
    features: features.slice(0, 10),
    images: images.slice(0, 8),
    url: `https://${domain}/dp/${asin}`,
    marketplace: marketplace.toUpperCase(),
  };
}

/**
 * Search Amazon by keyword
 */
export async function searchProducts(
  query: string,
  marketplace: string = 'US',
  category?: string,
  limit: number = 20,
): Promise<AmazonSearchResult> {
  if (!query) throw new AmazonError('invalid_input', 'Search query is required');

  const domain = getDomain(marketplace);
  const params = new URLSearchParams({ k: query });
  if (category) params.set('i', category);

  const url = `https://${domain}/s?${params}`;
  console.log(`[AMAZON] Searching: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(),
    maxRetries: 3,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new AmazonError('scrape_failed', `Amazon returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('Type the characters you see') || (html.includes('captcha') && html.length < 10000)) {
    throw new AmazonError('captcha_detected', 'Amazon CAPTCHA triggered');
  }

  const products: AmazonProductSummary[] = [];

  // Parse search result cards
  const cards = html.split('data-asin="');
  for (let i = 1; i < cards.length && products.length < limit; i++) {
    const card = cards[i];
    const asinEnd = card.indexOf('"');
    if (asinEnd <= 0) continue;
    const asin = card.slice(0, asinEnd);
    if (asin.length !== 10) continue;

    const cardHtml = card.slice(0, 3000);

    // Title
    const titleMatch = cardHtml.match(/class="a-size-(?:base|medium|mini)[^"]*a-text-normal[^"]*"[^>]*>([^<]+)/);
    const title = titleMatch ? cleanText(titleMatch[1]) : '';
    if (!title) continue;

    // Price
    const priceMatch = cardHtml.match(/class="a-offscreen"[^>]*>\$([\d,.]+)/) ||
                       cardHtml.match(/a-price-whole[^>]*>([\d,]+)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    // Rating
    const ratingMatch = cardHtml.match(/(\d\.\d) out of 5/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Ratings count
    const countMatch = cardHtml.match(/([\d,]+)\s*$/m) || cardHtml.match(/aria-label="([\d,]+)"/);
    const ratingsCount = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : null;

    // Prime
    const isPrime = cardHtml.includes('a-icon-prime') || cardHtml.includes('Prime');

    // Sponsored
    const isSponsored = cardHtml.toLowerCase().includes('sponsored') || cardHtml.includes('AdHolder');

    // Image
    const imgMatch = cardHtml.match(/src="(https:\/\/m\.media-amazon\.com[^"]+)"/);

    products.push({
      asin,
      title,
      price,
      rating,
      ratingsCount,
      isPrime,
      isSponsored,
      url: `https://${domain}/dp/${asin}`,
      image: imgMatch ? imgMatch[1] : null,
    });
  }

  return {
    query,
    marketplace: marketplace.toUpperCase(),
    totalResults: products.length,
    products,
  };
}

/**
 * Get product reviews
 */
export async function getReviews(
  asin: string,
  marketplace: string = 'US',
  sort: string = 'recent',
  limit: number = 10,
): Promise<AmazonReview[]> {
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    throw new AmazonError('invalid_input', 'Valid ASIN is required');
  }

  const domain = getDomain(marketplace);
  const sortBy = sort === 'helpful' ? 'helpful' : 'recent';
  const url = `https://${domain}/product-reviews/${asin}?sortBy=${sortBy}`;

  console.log(`[AMAZON] Fetching reviews: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(),
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new AmazonError('scrape_failed', `Amazon returned ${response.status}`);
  }

  const html = await response.text();
  const reviews: AmazonReview[] = [];

  // Parse review blocks
  const reviewBlocks = html.split('data-hook="review"');
  for (let i = 1; i < reviewBlocks.length && reviews.length < limit; i++) {
    const block = reviewBlocks[i].slice(0, 5000);

    const titleMatch = block.match(/data-hook="review-title"[^>]*>[\s\S]*?<span[^>]*>([^<]+)/);
    const ratingMatch = block.match(/(\d\.\d) out of 5/);
    const authorMatch = block.match(/class="a-profile-name"[^>]*>([^<]+)/);
    const dateMatch = block.match(/data-hook="review-date"[^>]*>([^<]+)/);
    const textMatch = block.match(/data-hook="review-body"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
    const verifiedMatch = block.includes('Verified Purchase');
    const helpfulMatch = block.match(/([\d,]+)\s+(?:people|person)\s+found/);

    reviews.push({
      title: titleMatch ? cleanText(titleMatch[1]) : '',
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
      author: authorMatch ? cleanText(authorMatch[1]) : 'Anonymous',
      date: dateMatch ? cleanText(dateMatch[1]) : '',
      text: textMatch ? cleanText(textMatch[1]).slice(0, 2000) : '',
      verified: verifiedMatch,
      helpful: helpfulMatch ? parseInt(helpfulMatch[1].replace(/,/g, '')) : null,
    });
  }

  return reviews;
}

/**
 * Get bestsellers in a category
 */
export async function getBestsellers(
  category: string = 'electronics',
  marketplace: string = 'US',
): Promise<AmazonProductSummary[]> {
  const domain = getDomain(marketplace);
  const url = `https://${domain}/Best-Sellers/zgbs/${category}`;

  console.log(`[AMAZON] Fetching bestsellers: ${url}`);

  const response = await proxyFetch(url, {
    headers: buildHeaders(),
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new AmazonError('scrape_failed', `Amazon returned ${response.status}`);
  }

  const html = await response.text();
  const products: AmazonProductSummary[] = [];

  // Parse bestseller items
  const items = html.split('data-asin="');
  for (let i = 1; i < items.length && products.length < 20; i++) {
    const asinEnd = items[i].indexOf('"');
    if (asinEnd <= 0) continue;
    const asin = items[i].slice(0, asinEnd);
    if (asin.length !== 10) continue;

    const itemHtml = items[i].slice(0, 3000);
    const titleMatch = itemHtml.match(/class="[^"]*a-text-normal[^"]*"[^>]*>([^<]+)/) ||
                       itemHtml.match(/class="_cDEzb_p13n-sc-css-line-clamp[^"]*"[^>]*>([^<]+)/);
    if (!titleMatch) continue;

    const priceMatch = itemHtml.match(/class="a-offscreen"[^>]*>\$([\d,.]+)/) ||
                       itemHtml.match(/a-price-whole[^>]*>([\d,]+)/);
    const ratingMatch = itemHtml.match(/(\d\.\d) out of 5/);

    products.push({
      asin,
      title: cleanText(titleMatch[1]),
      price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      ratingsCount: null,
      isPrime: true,
      isSponsored: false,
      url: `https://${domain}/dp/${asin}`,
      image: null,
    });
  }

  return products;
}
