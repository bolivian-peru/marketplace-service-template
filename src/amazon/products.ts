
/**
 * Amazon Product Tracker
 *
 * Extracts product data from Amazon pages including:
 * - ASIN, title, brand
 * - Price information (current, original, discount)
 * - Rating and review count
 * - Buy box information
 * - Availability status
 * - Images
 * - BSR (Best Sellers Rank)
 */

import { proxyFetch } from '../proxy';
import { getProxy } from '../proxy';
import { parse } from 'node-html-parser';

export interface AmazonProduct {
  asin: string;
  title: string;
  brand: string;
  price: {
    current: number;
    currency: string;
    was?: number;
    discount_pct?: number;
  };
  bsr: {
    rank: number;
    category: string;
    sub_category_ranks: Array<{
      category: string;
      rank: number;
    }>;
  };
  rating: number;
  reviews_count: number;
  buy_box: {
    seller: string;
    is_amazon: boolean;
    fulfilled_by: string;
  };
  availability: string;
  images: string[];
  meta: {
    marketplace: string;
    proxy: {
      ip: string | null;
      country: string;
      carrier: string;
      type: 'mobile';
    };
  };
}

export async function getAmazonProduct(asin: string, marketplace: string = 'US'): Promise<AmazonProduct> {
  const proxy = getProxy();
  const ip = await getProxyExitIp();

  // Construct Amazon URL based on marketplace
  const baseUrl = marketplace === 'US' ? 'www.amazon.com' :
                 marketplace === 'UK' ? 'www.amazon.co.uk' :
                 marketplace === 'DE' ? 'www.amazon.de' :
                 'www.amazon.com';

  const url = `https://${baseUrl}/dp/${asin}`;

  try {
    // Fetch the product page with mobile proxy
    const response = await proxyFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
        'Accept-Language': marketplace === 'US' ? 'en-US' :
                           marketplace === 'UK' ? 'en-GB' :
                           marketplace === 'DE' ? 'de-DE' : 'en-US',
      },
      timeoutMs: 30000,
      maxRetries: 3,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Amazon product page: ${response.status}`);
    }

    const html = await response.text();
    const root = parse(html);

    // Extract product data
    const product: AmazonProduct = {
      asin,
      title: extractTitle(root),
      brand: extractBrand(root),
      price: extractPrice(root),
      bsr: extractBSR(root),
      rating: extractRating(root),
      reviews_count: extractReviewsCount(root),
      buy_box: extractBuyBox(root),
      availability: extractAvailability(root),
      images: extractImages(root),
      meta: {
        marketplace,
        proxy: {
          ip,
          country: proxy.country,
          carrier: proxy.host,
          type: 'mobile',
        },
      },
    };

    return product;
  } catch (error) {
    console.error(`Error fetching Amazon product ${asin}:`, error);
    throw error;
  }
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 15000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

function extractTitle(root: any): string {
  // Try multiple selectors for title
  const selectors = [
    '#productTitle',
    'h1#title',
    '.a-size-large.product-title-word-break',
    'span#productTitle',
  ];

  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) {
      return element.textContent.trim();
    }
  }

  return 'Unknown Product Title';
}

function extractBrand(root: any): string {
  // Try to find brand information
  const brandElement = root.querySelector('#bylineInfo');
  if (brandElement) {
    const text = brandElement.textContent.trim();
    if (text.includes('Brand:')) {
      return text.replace('Brand:', '').trim();
    }
    if (text.includes('by ')) {
      return text.replace('by ', '').trim();
    }
  }

  // Fallback to checking for brand in title
  const title = extractTitle(root);
  const brandMatch = title.match(/^([^:]+):/);
  if (brandMatch) {
    return brandMatch[1].trim();
  }

  return 'Unknown Brand';
}

function extractPrice(root: any): AmazonProduct['price'] {
  // Try to find current price
  const priceElement = root.querySelector('.a-price-whole');
  const priceFraction = root.querySelector('.a-price-fraction');
  const originalPriceElement = root.querySelector('.a-price.a-text-price span.a-offscreen');

  if (priceElement && priceFraction) {
    const currentPrice = parseFloat(priceElement.textContent.replace(/[^0-9.]/g, ''));
    const currency = 'USD'; // Default, will be updated based on marketplace
    const price: AmazonProduct['price'] = {
      current: currentPrice,
      currency,
    };

    // Check for discount
    if (originalPriceElement) {
      const originalPriceText = originalPriceElement.textContent;
      const originalPriceMatch = originalPriceText?.match(/\$([0-9.]+)/);
      if (originalPriceMatch) {
        const originalPrice = parseFloat(originalPriceMatch[1]);
        price.was = originalPrice;
        price.discount_pct = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
      }
    }

    return price;
  }

  // If no price found, return default
  return {
    current: 0,
    currency: 'USD',
  };
}

function extractBSR(root: any): AmazonProduct['bsr'] {
  // Try to find BSR information
  const bsrElement = root.querySelector('#SalesRank');
  if (bsrElement) {
    const text = bsrElement.textContent.trim();
    const rankMatch = text.match(/#(\d+)\s+in\s+([^;]+)/);
    if (rankMatch) {
      const rank = parseInt(rankMatch[1]);
      const category = rankMatch[2].trim();

      // Extract subcategory ranks if available
      const subCategoryRanks: Array<{ category: string; rank: number }> = [];
      const subCategoryElements = root.querySelectorAll('.zg_hrsr_item');

      subCategoryElements.forEach((element: any) => {
        const subCategoryText = element.textContent.trim();
        const subRankMatch = subCategoryText.match(/#(\d+)\s+in\s+([^;]+)/);
        if (subRankMatch) {
          subCategoryRanks.push({
            rank: parseInt(subRankMatch[1]),
            category: subRankMatch[2].trim(),
          });
        }
      });

      return {
        rank,
        category,
        sub_category_ranks: subCategoryRanks,
      };
    }
  }

  // If no BSR found, return default
  return {
    rank: 0,
    category: 'Unknown',
    sub_category_ranks: [],
  };
}

function extractRating(root: any): number {
  // Try to find rating
  const ratingElement = root.querySelector('span.a-icon-alt');
  if (ratingElement) {
    const ratingText = ratingElement.textContent.trim();
    const ratingMatch = ratingText.match(/([0-9.]+)\s+out\s+of\s+5\s+stars/);
    if (ratingMatch) {
      return parseFloat(ratingMatch[1]);
    }
  }

  return 0;
}

function extractReviewsCount(root: any): number {
  // Try to find reviews count
  const reviewsElement = root.querySelector('#acrCustomerReviewText');
  if (reviewsElement) {
    const text = reviewsElement.textContent.trim();
    const countMatch = text.match(/([0-9,]+)\s+ratings/);
    if (countMatch) {
      return parseInt(countMatch[1].replace(/,/g, ''));
    }
  }

  return 0;
}

function extractBuyBox(root: any): AmazonProduct['buy_box'] {
  // Try to find buy box information
  const buyBoxElement = root.querySelector('#merchant-info');
  if (buyBoxElement) {
    const text = buyBoxElement.textContent.trim();
    const isAmazon = text.includes('Amazon.com') || text.includes('Amazon.co.uk') || text.includes('Amazon.de');

    return {
      seller: isAmazon ? 'Amazon' : text,
      is_amazon: isAmazon,
      fulfilled_by: isAmazon ? 'Amazon' : 'Merchant',
    };
  }

  // Fallback to default
  return {
    seller: 'Unknown',
    is_amazon: false,
    fulfilled_by: 'Unknown',
  };
}

function extractAvailability(root: any): string {
  // Try to find availability information
  const availabilityElement = root.querySelector('#availability');
  if (availabilityElement) {
    return availabilityElement.textContent.trim();
  }

  // Check for "In Stock" in other elements
  const stockElements = root.querySelectorAll('.a-color-success');
  for (const element of stockElements) {
    const text = element.textContent.trim();
    if (text.includes('In Stock') || text.includes('In stock') || text.includes('Available')) {
      return text;
    }
  }

  return 'Out of Stock';
}

function extractImages(root: any): string[] {
  const images: string[] = [];

  // Try to find main product image
  const mainImage = root.querySelector('#landingImage, #imgTagWrapperId img');
  if (mainImage) {
    const src = mainImage.getAttribute('src') || mainImage.getAttribute('data-old-hires') || mainImage.getAttribute('data-a-dynamic-image');
    if (src) {
      images.push(src);
    }
  }

  // Try to find additional images
  const additionalImages = root.querySelectorAll('.imgTagWrapper img, .aok-align-center img');
  additionalImages.forEach((img: any) => {
    const src = img.getAttribute('src') || img.getAttribute('data-old-hires');
    if (src && !images.includes(src)) {
      images.push(src);
    }
  });

  return images.length > 0 ? images : ['https://via.placeholder.com/400x400?text=No+Image'];
}
