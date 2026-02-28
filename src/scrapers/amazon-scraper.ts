/**
 * Amazon Product & BSR Tracker (Bounty #72)
 * ──────────────────────────────────────────
 * Scrapes Amazon product data, BSR rankings, search results, bestsellers,
 * and reviews via mobile proxy.
 *
 * Supports marketplaces: US, UK, DE, FR, ES, IT, CA, JP, AU
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface AmazonPrice {
  current: number | null;
  currency: string;
  was: number | null;
  discount_pct: number | null;
}

export interface BsrEntry {
  rank: number;
  category: string;
}

export interface BuyBox {
  seller: string;
  is_amazon: boolean;
  fulfilled_by: string;
}

export interface AmazonProduct {
  asin: string;
  title: string;
  price: AmazonPrice;
  bsr: {
    rank: number | null;
    category: string | null;
    sub_category_ranks: BsrEntry[];
  };
  rating: number | null;
  reviews_count: number | null;
  buy_box: BuyBox | null;
  availability: string | null;
  brand: string | null;
  images: string[];
  description: string | null;
  features: string[];
  marketplace: string;
}

export interface AmazonSearchResult {
  asin: string;
  title: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviews_count: number | null;
  image: string | null;
  is_prime: boolean;
  is_sponsored: boolean;
  url: string;
}

export interface AmazonReview {
  title: string;
  body: string;
  rating: number;
  author: string;
  date: string;
  verified_purchase: boolean;
  helpful_votes: number;
}

export interface BestsellerItem {
  rank: number;
  asin: string;
  title: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviews_count: number | null;
  image: string | null;
  url: string;
}

// ─── MARKETPLACE CONFIG ─────────────────────────────

const MARKETPLACES: Record<string, { domain: string; currency: string }> = {
  US: { domain: 'www.amazon.com', currency: 'USD' },
  UK: { domain: 'www.amazon.co.uk', currency: 'GBP' },
  DE: { domain: 'www.amazon.de', currency: 'EUR' },
  FR: { domain: 'www.amazon.fr', currency: 'EUR' },
  ES: { domain: 'www.amazon.es', currency: 'EUR' },
  IT: { domain: 'www.amazon.it', currency: 'EUR' },
  CA: { domain: 'www.amazon.ca', currency: 'CAD' },
  JP: { domain: 'www.amazon.co.jp', currency: 'JPY' },
  AU: { domain: 'www.amazon.com.au', currency: 'AUD' },
};

function getMarketplace(code: string) {
  const mp = MARKETPLACES[code.toUpperCase()];
  if (!mp) throw new Error(`Unsupported marketplace: ${code}. Supported: ${Object.keys(MARKETPLACES).join(', ')}`);
  return mp;
}

// ─── HELPERS ────────────────────────────────────────

function extractBetween(html: string, start: string, end: string): string | null {
  const i = html.indexOf(start);
  if (i === -1) return null;
  const j = html.indexOf(end, i + start.length);
  if (j === -1) return null;
  return html.slice(i + start.length, j).trim();
}

function extractAll(html: string, start: string, end: string): string[] {
  const results: string[] = [];
  let pos = 0;
  while (true) {
    const i = html.indexOf(start, pos);
    if (i === -1) break;
    const j = html.indexOf(end, i + start.length);
    if (j === -1) break;
    results.push(html.slice(i + start.length, j).trim());
    pos = j + end.length;
  }
  return results;
}

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

function parsePrice(text: string): number | null {
  const match = text.match(/[\d,.]+/);
  if (!match) return null;
  // Handle European format (1.234,56 → 1234.56)
  let num = match[0];
  if (num.includes(',') && num.includes('.')) {
    if (num.lastIndexOf(',') > num.lastIndexOf('.')) {
      // European: 1.234,56
      num = num.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234.56
      num = num.replace(/,/g, '');
    }
  } else if (num.includes(',') && !num.includes('.')) {
    // Could be "1,234" (US thousand separator) or "12,34" (European decimal)
    const parts = num.split(',');
    if (parts[parts.length - 1].length === 2 && parts.length === 2) {
      num = num.replace(',', '.'); // European decimal
    } else {
      num = num.replace(/,/g, ''); // Thousand separator
    }
  }
  const val = parseFloat(num);
  return isNaN(val) ? null : val;
}

async function fetchPage(url: string): Promise<string> {
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 20_000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    if (response.status === 503) throw new Error('Amazon CAPTCHA/bot detection triggered. Retry later.');
    throw new Error(`Amazon returned ${response.status}`);
  }

  const html = await response.text();

  // Check for CAPTCHA
  if (html.includes('captcha') || html.includes('Type the characters you see in this image')) {
    throw new Error('Amazon CAPTCHA triggered. Mobile proxy IP may be flagged.');
  }

  return html;
}

// ─── PRODUCT SCRAPER ────────────────────────────────

export async function scrapeProduct(asin: string, marketplace: string = 'US'): Promise<AmazonProduct> {
  const mp = getMarketplace(marketplace);
  const url = `https://${mp.domain}/dp/${asin}`;
  const html = await fetchPage(url);

  // Title
  const title = cleanText(
    extractBetween(html, 'id="productTitle"', '</span>') ||
    extractBetween(html, 'id="title"', '</span>') || ''
  );

  // Price
  const priceWhole = extractBetween(html, 'class="a-price-whole">', '</span>') || '';
  const priceFraction = extractBetween(html, 'class="a-price-fraction">', '</span>') || '';
  let currentPrice: number | null = null;
  if (priceWhole) {
    currentPrice = parsePrice(priceWhole + '.' + (priceFraction || '00'));
  }
  // Fallback: try corePriceDisplay
  if (currentPrice === null) {
    const priceBlock = extractBetween(html, 'id="corePriceDisplay_desktop_feature_div"', '</div>');
    if (priceBlock) {
      const priceMatch = priceBlock.match(/[\$£€¥]\s*[\d,.]+/);
      if (priceMatch) currentPrice = parsePrice(priceMatch[0]);
    }
  }

  // Was price (strikethrough)
  let wasPrice: number | null = null;
  const wasPriceBlock = extractBetween(html, 'class="a-text-price"', '</span>');
  if (wasPriceBlock) {
    const stripped = cleanText(wasPriceBlock);
    wasPrice = parsePrice(stripped);
  }

  const discount_pct = (currentPrice && wasPrice && wasPrice > currentPrice)
    ? Math.round(((wasPrice - currentPrice) / wasPrice) * 100)
    : null;

  // BSR
  let bsrRank: number | null = null;
  let bsrCategory: string | null = null;
  const subCategoryRanks: BsrEntry[] = [];

  // Method 1: product detail table
  const bsrBlock = extractBetween(html, 'Best Sellers Rank', '</table>') ||
                   extractBetween(html, 'Best Sellers Rank', '</ul>');
  if (bsrBlock) {
    // Main rank: #1 in Category or #1,234 in Category
    const mainRankMatch = bsrBlock.match(/#([\d,]+)\s+in\s+([^<(]+)/);
    if (mainRankMatch) {
      bsrRank = parseInt(mainRankMatch[1].replace(/,/g, ''));
      bsrCategory = cleanText(mainRankMatch[2]);
    }

    // Sub-category ranks
    const subMatches = bsrBlock.matchAll(/#([\d,]+)\s+in\s+<a[^>]*>([^<]+)<\/a>/g);
    for (const m of subMatches) {
      subCategoryRanks.push({
        rank: parseInt(m[1].replace(/,/g, '')),
        category: cleanText(m[2]),
      });
    }
  }

  // Rating
  let rating: number | null = null;
  const ratingText = extractBetween(html, 'id="acrPopover"', '</span>');
  if (ratingText) {
    const rm = ratingText.match(/([\d.]+)\s*out\s*of/);
    if (rm) rating = parseFloat(rm[1]);
  }
  if (rating === null) {
    const altRating = extractBetween(html, 'class="a-icon-alt">', '</span>');
    if (altRating) {
      const rm2 = altRating.match(/([\d.]+)/);
      if (rm2) rating = parseFloat(rm2[1]);
    }
  }

  // Reviews count
  let reviewsCount: number | null = null;
  const reviewsText = extractBetween(html, 'id="acrCustomerReviewText"', '</span>');
  if (reviewsText) {
    const rcm = cleanText(reviewsText).match(/([\d,]+)/);
    if (rcm) reviewsCount = parseInt(rcm[1].replace(/,/g, ''));
  }

  // Buy box
  let buyBox: BuyBox | null = null;
  const merchantBlock = extractBetween(html, 'id="merchant-info"', '</div>') ||
                        extractBetween(html, 'id="tabular-buybox"', '</div>');
  if (merchantBlock) {
    const sellerText = cleanText(merchantBlock);
    const isAmazon = sellerText.toLowerCase().includes('amazon');
    const sellerLink = extractBetween(merchantBlock, 'id="sellerProfileTriggerId">', '</a>');
    buyBox = {
      seller: sellerLink ? cleanText(sellerLink) : (isAmazon ? 'Amazon' : 'Third Party'),
      is_amazon: isAmazon,
      fulfilled_by: sellerText.toLowerCase().includes('fulfilled by amazon') ||
                    sellerText.toLowerCase().includes('ships from amazon') ? 'Amazon' : 'Seller',
    };
  }

  // Availability
  const availBlock = extractBetween(html, 'id="availability"', '</div>');
  const availability = availBlock ? cleanText(availBlock) : null;

  // Brand
  const brandText = extractBetween(html, 'id="bylineInfo"', '</a>');
  const brand = brandText ? cleanText(brandText).replace(/^(Visit the |Brand: )/, '') : null;

  // Images
  const images: string[] = [];
  const imgMatches = html.matchAll(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
  for (const im of imgMatches) {
    if (!images.includes(im[1])) images.push(im[1]);
  }
  if (images.length === 0) {
    const mainImg = extractBetween(html, 'id="landingImage"', '>');
    if (mainImg) {
      const srcMatch = mainImg.match(/src="(https:\/\/[^"]+)"/);
      if (srcMatch) images.push(srcMatch[1]);
    }
  }

  // Description
  const descBlock = extractBetween(html, 'id="productDescription"', '</div>');
  const description = descBlock ? cleanText(descBlock).slice(0, 2000) : null;

  // Features / bullet points
  const features: string[] = [];
  const featureBlock = extractBetween(html, 'id="feature-bullets"', '</div>');
  if (featureBlock) {
    const items = extractAll(featureBlock, '<span class="a-list-item">', '</span>');
    for (const item of items) {
      const clean = cleanText(item);
      if (clean && clean.length > 3) features.push(clean);
    }
  }

  return {
    asin,
    title,
    price: {
      current: currentPrice,
      currency: mp.currency,
      was: wasPrice,
      discount_pct,
    },
    bsr: {
      rank: bsrRank,
      category: bsrCategory,
      sub_category_ranks: subCategoryRanks,
    },
    rating,
    reviews_count: reviewsCount,
    buy_box: buyBox,
    availability,
    brand,
    images: images.slice(0, 10),
    description,
    features: features.slice(0, 10),
    marketplace: marketplace.toUpperCase(),
  };
}

// ─── SEARCH SCRAPER ─────────────────────────────────

export async function searchAmazon(
  query: string,
  marketplace: string = 'US',
  category?: string,
  limit: number = 20,
): Promise<AmazonSearchResult[]> {
  const mp = getMarketplace(marketplace);
  let url = `https://${mp.domain}/s?k=${encodeURIComponent(query)}`;
  if (category) url += `&i=${encodeURIComponent(category)}`;

  const html = await fetchPage(url);
  const results: AmazonSearchResult[] = [];

  // Extract search result items
  const items = extractAll(html, 'data-asin="', '</div></div></div></div>');

  for (const item of items) {
    if (results.length >= limit) break;

    // Get ASIN from the data attribute context
    const asinEnd = item.indexOf('"');
    if (asinEnd === -1) continue;
    const asin = item.slice(0, asinEnd).trim();
    if (!asin || asin.length < 5 || asin.length > 15) continue;

    // Title
    const titleBlock = extractBetween(item, 'class="a-size-medium a-color-base a-text-normal">', '</span>') ||
                       extractBetween(item, 'class="a-size-base-plus a-color-base a-text-normal">', '</span>') ||
                       extractBetween(item, 'class="a-text-normal">', '</span>');
    const title = titleBlock ? cleanText(titleBlock) : '';
    if (!title) continue;

    // Price
    const priceWhole = extractBetween(item, 'class="a-price-whole">', '</span>') || '';
    const priceFraction = extractBetween(item, 'class="a-price-fraction">', '</span>') || '';
    let price: number | null = null;
    if (priceWhole) {
      price = parsePrice(priceWhole + '.' + (priceFraction || '00'));
    }

    // Rating
    let rating: number | null = null;
    const ratingAlt = extractBetween(item, 'class="a-icon-alt">', '</span>');
    if (ratingAlt) {
      const rm = ratingAlt.match(/([\d.]+)/);
      if (rm) rating = parseFloat(rm[1]);
    }

    // Reviews count
    let reviewsCount: number | null = null;
    const reviewsLink = extractBetween(item, 'class="a-size-base s-underline-text">', '</span>');
    if (reviewsLink) {
      const rcm = cleanText(reviewsLink).match(/([\d,]+)/);
      if (rcm) reviewsCount = parseInt(rcm[1].replace(/,/g, ''));
    }

    // Image
    const imgMatch = item.match(/src="(https:\/\/[^"]*images[^"]*\.(jpg|png|webp)[^"]*)"/);
    const image = imgMatch ? imgMatch[1] : null;

    // Prime
    const isPrime = item.includes('a-icon-prime') || item.includes('prime');

    // Sponsored
    const isSponsored = item.toLowerCase().includes('sponsored') || item.includes('AdHolder');

    results.push({
      asin,
      title,
      price,
      currency: mp.currency,
      rating,
      reviews_count: reviewsCount,
      image,
      is_prime: isPrime,
      is_sponsored: isSponsored,
      url: `https://${mp.domain}/dp/${asin}`,
    });
  }

  return results;
}

// ─── BESTSELLERS SCRAPER ────────────────────────────

export async function scrapeBestsellers(
  category: string = 'electronics',
  marketplace: string = 'US',
  limit: number = 50,
): Promise<BestsellerItem[]> {
  const mp = getMarketplace(marketplace);
  const url = `https://${mp.domain}/Best-Sellers/zgbs/${encodeURIComponent(category)}`;
  const html = await fetchPage(url);
  const results: BestsellerItem[] = [];

  // Bestseller items are in zg-item-immersion divs
  const items = extractAll(html, 'class="zg-item-immersion"', '</div></div></div>');

  let rank = 0;
  for (const item of items) {
    if (results.length >= limit) break;
    rank++;

    // ASIN from link
    const linkMatch = item.match(/\/dp\/([A-Z0-9]{10})/);
    if (!linkMatch) continue;
    const asin = linkMatch[1];

    // Title
    const titleBlock = extractBetween(item, 'class="_cDEzb_p13n-sc-css-line-clamp-', '</div>') ||
                       extractBetween(item, 'class="a-link-normal"', '</a>');
    const title = titleBlock ? cleanText(titleBlock) : '';

    // Price
    const priceBlock = extractBetween(item, 'class="_cDEzb_p13n-sc-price', '</span>');
    const price = priceBlock ? parsePrice(cleanText(priceBlock)) : null;

    // Rating
    let rating: number | null = null;
    const ratingAlt = extractBetween(item, 'class="a-icon-alt">', '</span>');
    if (ratingAlt) {
      const rm = ratingAlt.match(/([\d.]+)/);
      if (rm) rating = parseFloat(rm[1]);
    }

    // Reviews count
    let reviewsCount: number | null = null;
    const reviewsText = extractBetween(item, 'class="a-size-small">', '</span>');
    if (reviewsText) {
      const rcm = cleanText(reviewsText).match(/([\d,]+)/);
      if (rcm) reviewsCount = parseInt(rcm[1].replace(/,/g, ''));
    }

    // Image
    const imgMatch = item.match(/src="(https:\/\/[^"]*images[^"]*\.(jpg|png|webp)[^"]*)"/);
    const image = imgMatch ? imgMatch[1] : null;

    results.push({
      rank,
      asin,
      title,
      price,
      currency: mp.currency,
      rating,
      reviews_count: reviewsCount,
      image,
      url: `https://${mp.domain}/dp/${asin}`,
    });
  }

  return results;
}

// ─── REVIEWS SCRAPER ────────────────────────────────

export async function scrapeReviews(
  asin: string,
  marketplace: string = 'US',
  sort: string = 'recent',
  limit: number = 10,
): Promise<AmazonReview[]> {
  const mp = getMarketplace(marketplace);
  const sortBy = sort === 'helpful' ? 'helpful' : 'recent';
  const url = `https://${mp.domain}/product-reviews/${asin}?sortBy=${sortBy}&pageSize=${Math.min(limit, 10)}`;
  const html = await fetchPage(url);
  const reviews: AmazonReview[] = [];

  // Reviews are in review divs
  const reviewBlocks = extractAll(html, 'data-hook="review"', 'review-votes');

  for (const block of reviewBlocks) {
    if (reviews.length >= limit) break;

    // Title
    const titleBlock = extractBetween(block, 'data-hook="review-title"', '</a>') ||
                       extractBetween(block, 'data-hook="review-title"', '</span>');
    const title = titleBlock ? cleanText(titleBlock) : '';

    // Body
    const bodyBlock = extractBetween(block, 'data-hook="review-body"', '</div>');
    const body = bodyBlock ? cleanText(bodyBlock).slice(0, 5000) : '';

    // Rating
    let rating = 0;
    const ratingBlock = extractBetween(block, 'class="a-icon-alt">', '</span>');
    if (ratingBlock) {
      const rm = ratingBlock.match(/([\d.]+)/);
      if (rm) rating = parseFloat(rm[1]);
    }

    // Author
    const authorBlock = extractBetween(block, 'class="a-profile-name">', '</span>');
    const author = authorBlock ? cleanText(authorBlock) : 'Anonymous';

    // Date
    const dateBlock = extractBetween(block, 'data-hook="review-date">', '</span>');
    const date = dateBlock ? cleanText(dateBlock) : '';

    // Verified purchase
    const verifiedPurchase = block.includes('Verified Purchase');

    // Helpful votes
    let helpfulVotes = 0;
    const helpfulBlock = extractBetween(block, 'data-hook="helpful-vote-statement">', '</span>');
    if (helpfulBlock) {
      const hm = cleanText(helpfulBlock).match(/([\d,]+)/);
      if (hm) helpfulVotes = parseInt(hm[1].replace(/,/g, ''));
    }

    if (title || body) {
      reviews.push({ title, body, rating, author, date, verified_purchase: verifiedPurchase, helpful_votes: helpfulVotes });
    }
  }

  return reviews;
}