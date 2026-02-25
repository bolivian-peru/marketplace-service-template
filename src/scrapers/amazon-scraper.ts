/**
 * Amazon Product Scraper
 * 
 * Extracts product data from Amazon pages including:
 * - Price, BSR (Best Seller Rank), reviews, rating
 * - Buy box winner, availability, brand
 * - Images, title, marketplace
 * 
 * Uses mobile proxies to bypass Amazon's anti-bot measures.
 */

import { proxyFetch } from '../proxy';

export interface AmazonProduct {
  asin: string;
  title: string;
  price: {
    current: number | null;
    currency: string;
    was: number | null;
    discount_pct: number | null;
  };
  bsr: {
    rank: number | null;
    category: string | null;
    sub_category_ranks: Array<{ category: string; rank: number }>;
  } | null;
  rating: number | null;
  reviews_count: number | null;
  buy_box: {
    seller: string | null;
    is_amazon: boolean;
    fulfilled_by: string | null;
  };
  availability: string | null;
  brand: string | null;
  images: string[];
  meta: {
    marketplace: string;
    proxy?: { ip: string; country: string; carrier?: string };
  };
}

export interface AmazonSearchResult {
  query: string;
  category: string | null;
  marketplace: string;
  products: Array<{
    asin: string;
    title: string;
    price: number | null;
    rating: number | null;
    reviews_count: number | null;
    image: string | null;
  }>;
  total_results: number | null;
}

export interface AmazonReview {
  id: string;
  author: string;
  rating: number;
  title: string;
  content: string;
  date: string;
  verified: boolean;
  helpful_count: number;
}

export interface AmazonReviewsResult {
  asin: string;
  reviews: AmazonReview[];
  total_reviews: number;
  average_rating: number | null;
  pagination: {
    current_page: number;
    total_pages: number | null;
  };
}

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'amazon.com',
  UK: 'amazon.co.uk',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
  CA: 'amazon.ca',
  AU: 'amazon.com.au',
  JP: 'amazon.co.jp',
};

function getAmazonDomain(marketplace: string): string {
  return MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || 'amazon.com';
}

function cleanPrice(priceText: string | null): { value: number | null; currency: string } {
  if (!priceText) return { value: null, currency: 'USD' };
  
  // Extract currency symbol
  const currencyMatch = priceText.match(/[\$\€\£\¥]/);
  const currencyMap: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  const currency = currencyMatch ? (currencyMap[currencyMatch[0]] || 'USD') : 'USD';
  
  // Extract numeric value
  const numericMatch = priceText.replace(/,/g, '').match(/[\d,]+\.?\d*/);
  const value = numericMatch ? parseFloat(numericMatch[0]) : null;
  
  return { value, currency };
}

function parseBSR(html: string): AmazonProduct['bsr'] {
  // Look for BSR patterns in Amazon HTML
  const bsrPatterns = [
    /#([\d,]+)\s+in\s+([^<]+)(?:\s*\([^)]*\))?/i,
    /Best Sellers Rank[\s\S]*?#([\d,]+)\s+in\s+([^<]+)/i,
    /bestseller[^<]*#([\d,]+)[^<]*in[^<]*([^<]+)/i,
  ];
  
  let mainRank: number | null = null;
  let mainCategory: string | null = null;
  const subRanks: Array<{ category: string; rank: number }> = [];
  
  for (const pattern of bsrPatterns) {
    const matches = html.matchAll(new RegExp(pattern, 'gi'));
    for (const match of matches) {
      const rank = parseInt(match[1].replace(/,/g, ''));
      const category = match[2].trim().replace(/\s+/g, ' ');
      
      if (!mainRank) {
        mainRank = rank;
        mainCategory = category;
      } else {
        subRanks.push({ category, rank });
      }
    }
  }
  
  if (!mainRank) return null;
  
  return {
    rank: mainRank,
    category: mainCategory,
    sub_category_ranks: subRanks.slice(0, 5), // Limit to 5 sub-categories
  };
}

function parseRating(html: string): { rating: number | null; reviews_count: number | null } {
  // Look for rating patterns
  const ratingPatterns = [
    /(\d+\.?\d*)\s*out of\s*5\s*stars/i,
    /(\d+\.?\d*)\s*stars?/i,
    /"ratingValue"\s*:\s*"(\d+\.?\d*)"/,
    /(\d+\.?\d*)\s*\/\s*5/,
  ];
  
  const reviewPatterns = [
    /(\d{1,3}(?:,\d{3})*)\s+ratings?/i,
    /(\d{1,3}(?:,\d{3})*)\s+reviews?/i,
    /"reviewCount"\s*:\s*"(\d+)"/,
    /\((\d{1,3}(?:,\d{3})*)\)/,
  ];
  
  let rating: number | null = null;
  let reviews_count: number | null = null;
  
  for (const pattern of ratingPatterns) {
    const match = html.match(pattern);
    if (match) {
      rating = parseFloat(match[1]);
      if (rating >= 1 && rating <= 5) break;
      rating = null;
    }
  }
  
  for (const pattern of reviewPatterns) {
    const match = html.match(pattern);
    if (match) {
      reviews_count = parseInt(match[1].replace(/,/g, ''));
      break;
    }
  }
  
  return { rating, reviews_count };
}

function parseBuyBox(html: string): AmazonProduct['buy_box'] {
  // Check if sold by Amazon
  const isAmazon = /sold by Amazon|Ships from Amazon|Amazon\.com/i.test(html);
  
  // Extract seller name
  const sellerPatterns = [
    /Sold by\s*<[^>]*>\s*([^<]+)/i,
    /seller=([^&"]+)/i,
    /merchant\s*[=:]\s*([^&"]+)/i,
  ];
  
  let seller: string | null = isAmazon ? 'Amazon' : null;
  
  for (const pattern of sellerPatterns) {
    const match = html.match(pattern);
    if (match) {
      seller = decodeURIComponent(match[1]).trim();
      break;
    }
  }
  
  // Check fulfillment
  const fulfilledBy = /Fulfilled by Amazon|Fulfillment by Amazon/i.test(html) 
    ? 'Amazon' 
    : /Fulfilled by merchant/i.test(html) 
    ? 'Merchant' 
    : null;
  
  return {
    seller,
    is_amazon: isAmazon,
    fulfilled_by: fulfilledBy,
  };
}

function parseAvailability(html: string): string | null {
  const patterns = [
    /In Stock/i,
    /Out of Stock/i,
    /Currently unavailable/i,
    /Only \d+ left/i,
    /Usually ships/i,
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[0];
  }
  
  return null;
}

function parseImages(html: string): string[] {
  const images: string[] = [];
  
  // Look for hi-res images
  const imagePatterns = [
    /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g,
    /"large"\s*:\s*"(https:\/\/[^"]+)"/g,
    /data-old-hires\s*=\s*"(https:\/\/[^"]+)"/g,
    /"url"\s*:\s*"(https:\/\/m\.media-amazon\.com[^"]+)"/g,
  ];
  
  for (const pattern of imagePatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && !images.includes(match[1])) {
        images.push(match[1]);
      }
    }
  }
  
  return images.slice(0, 5); // Limit to 5 images
}

export async function fetchAmazonProduct(
  asin: string, 
  marketplace: string = 'US'
): Promise<AmazonProduct> {
  const domain = getAmazonDomain(marketplace);
  const url = `https://${domain}/dp/${asin}`;
  
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
    },
    timeoutMs: 45_000,
    maxRetries: 3,
  });
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Product not found: ${asin}`);
    }
    if (response.status === 503) {
      throw new Error('Amazon is blocking requests (CAPTCHA). Try again later.');
    }
    throw new Error(`Failed to fetch product: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Check for CAPTCHA
  if (html.includes('captcha') || html.includes('Captcha') || html.includes('robot')) {
    throw new Error('Amazon CAPTCHA detected. Mobile proxy rotation required.');
  }
  
  // Extract title
  const titleMatch = html.match(/<span[^>]*id="productTitle"[^>]*>([^<]+)<\/span>/i) ||
                     html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Unknown Product';
  
  // Extract brand
  const brandMatch = html.match(/<a[^>]*id="bylineInfo"[^>]*>([^<]+)<\/a>/i) ||
                     html.match(/Brand:\s*([^<\n]+)/i) ||
                     html.match(/"brand"\s*:\s*"([^"]+)"/i);
  const brand = brandMatch ? brandMatch[1].replace(/^Visit the\s+/i, '').trim() : null;
  
  // Extract prices
  const currentPriceMatch = html.match(/<span[^>]*class="[^"]*a-price[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i) ||
                           html.match(/"priceAmount"\s*:\s*(\d+\.?\d*)/);
  const wasPriceMatch = html.match(/<span[^>]*class="[^"]*a-text-price[^"]*"[^>]*>[^<]*<span[^>]*>([^<]+)<\/span>/i) ||
                       html.match(/was\s*[:\s]*([^<\n]+)/i);
  
  const currentPrice = cleanPrice(currentPriceMatch ? currentPriceMatch[1] : null);
  const wasPrice = cleanPrice(wasPriceMatch ? wasPriceMatch[1] : null);
  
  let discount_pct: number | null = null;
  if (currentPrice.value && wasPrice.value && wasPrice.value > currentPrice.value) {
    discount_pct = Math.round(((wasPrice.value - currentPrice.value) / wasPrice.value) * 100);
  }
  
  // Parse other data
  const bsr = parseBSR(html);
  const { rating, reviews_count } = parseRating(html);
  const buy_box = parseBuyBox(html);
  const availability = parseAvailability(html);
  const images = parseImages(html);
  
  return {
    asin,
    title,
    price: {
      current: currentPrice.value,
      currency: currentPrice.currency,
      was: wasPrice.value,
      discount_pct,
    },
    bsr,
    rating,
    reviews_count,
    buy_box,
    availability,
    brand,
    images,
    meta: {
      marketplace: marketplace.toUpperCase(),
    },
  };
}

export async function searchAmazon(
  query: string,
  category: string | null = null,
  marketplace: string = 'US'
): Promise<AmazonSearchResult> {
  const domain = getAmazonDomain(marketplace);
  let url = `https://${domain}/s?k=${encodeURIComponent(query)}`;
  if (category) {
    url += `&i=${encodeURIComponent(category)}`;
  }
  
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 45_000,
    maxRetries: 3,
  });
  
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Check for CAPTCHA
  if (html.includes('captcha') || html.includes('Captcha')) {
    throw new Error('Amazon CAPTCHA detected during search.');
  }
  
  // Extract total results
  const totalMatch = html.match(/([\d,]+)\s+results?\s+for/i) ||
                    html.match(/of\s+([\d,]+)\s+results/i);
  const total_results = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;
  
  // Extract product listings
  const products: AmazonSearchResult['products'] = [];
  
  // Find all product containers
  const productRegex = /data-asin="([A-Z0-9]{10})"[\s\S]*?<h2[^>]*a-size-mini[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi;
  const matches = html.matchAll(productRegex);
  
  for (const match of matches) {
    const asin = match[1];
    const titleHtml = match[2];
    const title = titleHtml.replace(/<[^>]+>/g, '').trim();
    
    // Extract price from the product section
    const section = match[0];
    const priceMatch = section.match(/<span[^>]*class="[^"]*a-price[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i);
    const price = priceMatch ? cleanPrice(priceMatch[1]).value : null;
    
    // Extract rating
    const ratingMatch = section.match(/(\d+\.?\d*)\s*out of\s*5/i) ||
                       section.match(/a-icon-star[^>]*>(\d+\.?\d*)/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    
    // Extract review count
    const reviewMatch = section.match(/\(([\d,]+)\)/);
    const reviews_count = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null;
    
    // Extract image
    const imageMatch = section.match(/src="(https:\/\/[^"]+)"/);
    const image = imageMatch ? imageMatch[1] : null;
    
    products.push({
      asin,
      title,
      price,
      rating,
      reviews_count,
      image,
    });
    
    if (products.length >= 20) break; // Limit to 20 results
  }
  
  return {
    query,
    category,
    marketplace: marketplace.toUpperCase(),
    products,
    total_results,
  };
}

export async function fetchAmazonReviews(
  asin: string,
  sort: 'recent' | 'helpful' = 'recent',
  limit: number = 10,
  marketplace: string = 'US'
): Promise<AmazonReviewsResult> {
  const domain = getAmazonDomain(marketplace);
  const sortParam = sort === 'recent' ? 'recent' : 'helpful';
  const url = `https://${domain}/product-reviews/${asin}/ref=cm_cr_arp_d_viewopt_sr?ie=UTF8&reviewerType=all_reviews&sortBy=${sortParam}`;
  
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 45_000,
    maxRetries: 3,
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch reviews: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Extract total reviews
  const totalMatch = html.match(/([\d,]+)\s+global\s+ratings?/i) ||
                    html.match(/([\d,]+)\s+reviews?/i);
  const total_reviews = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;
  
  // Extract average rating
  const avgMatch = html.match(/(\d+\.?\d*)\s*out of\s*5\s*stars/i) ||
                  html.match(/"ratingValue"\s*:\s*"(\d+\.?\d*)"/);
  const average_rating = avgMatch ? parseFloat(avgMatch[1]) : null;
  
  // Extract individual reviews
  const reviews: AmazonReview[] = [];
  
  // Review pattern matching
  const reviewBlocks = html.matchAll(/<div[^>]*data-hook="review"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
  
  for (const blockMatch of reviewBlocks) {
    const block = blockMatch[1];
    
    // Extract review ID
    const idMatch = block.match(/id="([^"]+)"/);
    const id = idMatch ? idMatch[1] : '';
    
    // Extract author
    const authorMatch = block.match(/<span[^>]*class="[^"]*a-profile-name[^"]*"[^>]*>([^<]+)<\/span>/i);
    const author = authorMatch ? authorMatch[1].trim() : 'Anonymous';
    
    // Extract rating
    const ratingMatch = block.match(/(\d+\.?\d*)\s*out of\s*5/i) ||
                       block.match(/a-icon-star[^>]*>(\d+)/i);
    const rating = ratingMatch ? parseInt(ratingMatch[1]) : 5;
    
    // Extract title
    const titleMatch = block.match(/data-hook="review-title"[^>]*>([\s\S]*?)<\/span>/i) ||
                      block.match(/<a[^>]*class="[^"]*review-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    // Remove rating prefix from title if present
    title = title.replace(/^\d+\.\d+\s+out of\s+5\s+stars\s*/i, '');
    
    // Extract content
    const contentMatch = block.match(/data-hook="review-body"[^>]*>([\s\S]*?)<\/div>/i);
    let content = contentMatch ? contentMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    
    // Extract date
    const dateMatch = block.match(/on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i) ||
                     block.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    const date = dateMatch ? dateMatch[1] : '';
    
    // Check if verified purchase
    const verified = /Verified Purchase/i.test(block);
    
    // Extract helpful count
    const helpfulMatch = block.match(/(\d+)\s+people found this helpful/i) ||
                        block.match(/(\d+)\s+helpful/i);
    const helpful_count = helpfulMatch ? parseInt(helpfulMatch[1]) : 0;
    
    reviews.push({
      id,
      author,
      rating,
      title,
      content,
      date,
      verified,
      helpful_count,
    });
    
    if (reviews.length >= limit) break;
  }
  
  return {
    asin,
    reviews,
    total_reviews,
    average_rating,
    pagination: {
      current_page: 1,
      total_pages: Math.ceil(total_reviews / 10) || null,
    },
  };
}

export async function fetchAmazonBestsellers(
  category: string,
  marketplace: string = 'US'
): Promise<{ category: string; products: AmazonProduct[] }> {
  const domain = getAmazonDomain(marketplace);
  
  // Map common categories to Amazon browse IDs
  const categoryMap: Record<string, string> = {
    'electronics': 'electronics',
    'books': 'books',
    'clothing': 'fashion',
    'home': 'garden',
    'toys': 'toys-and-games',
    'sports': 'sporting-goods',
    'beauty': 'beauty',
    'health': 'hpc',
  };
  
  const categorySlug = categoryMap[category.toLowerCase()] || category;
  const url = `https://${domain}/gp/bestsellers/${categorySlug}`;
  
  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 45_000,
    maxRetries: 3,
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch bestsellers: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Extract ASINs from bestseller list
  const products: AmazonProduct[] = [];
  const asinMatches = html.matchAll(/data-asin="([A-Z0-9]{10})"/g);
  
  for (const match of asinMatches) {
    const asin = match[1];
    try {
      const product = await fetchAmazonProduct(asin, marketplace);
      products.push(product);
      if (products.length >= 10) break; // Limit to top 10
    } catch (err) {
      // Skip failed products
      continue;
    }
  }
  
  return {
    category,
    products,
  };
}
