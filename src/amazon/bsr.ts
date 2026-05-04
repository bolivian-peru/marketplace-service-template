

/**
 * Amazon Best Sellers Rank (BSR) Tracker
 *
 * Extracts category best sellers rankings from Amazon pages
 * Supports tracking BSR for specific categories and subcategories
 */

import { proxyFetch } from '../proxy';
import { getProxy } from '../proxy';
import { parse } from 'node-html-parser';

export interface AmazonBSRData {
  category: string;
  rank: number;
  subcategories: Array<{
    name: string;
    rank: number;
    url: string;
  }>;
  products: Array<{
    asin: string;
    title: string;
    price: number;
    rating: number;
    reviews_count: number;
    url: string;
  }>;
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

export async function getAmazonBSR(
  category: string,
  marketplace: string = 'US',
  limit: number = 20
): Promise<AmazonBSRData> {
  const proxy = getProxy();
  const ip = await getProxyExitIp();

  // Construct Amazon URL based on marketplace and category
  const baseUrl = marketplace === 'US' ? 'www.amazon.com' :
                 marketplace === 'UK' ? 'www.amazon.co.uk' :
                 marketplace === 'DE' ? 'www.amazon.de' :
                 'www.amazon.com';

  // Map category names to Amazon browse nodes
  const categoryMap: Record<string, string> = {
    'electronics': 'electronics',
    'books': 'books',
    'home': 'home-garden',
    'sports': 'sports-outdoors',
    'beauty': 'beauty',
    'toys': 'toys-and-games',
    'clothing': 'fashion',
    'automotive': 'automotive',
    'grocery': 'grocery',
    'pet-supplies': 'pet-supplies',
  };

  const amazonCategory = categoryMap[category.toLowerCase()] || category;
  const url = `https://${baseUrl}/gp/bestsellers/${amazonCategory}`;

  try {
    // Fetch the best sellers page with mobile proxy
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
      throw new Error(`Failed to fetch Amazon best sellers page: ${response.status}`);
    }

    const html = await response.text();
    const root = parse(html);

    // Extract BSR data
    const bsrData: AmazonBSRData = {
      category: amazonCategory,
      rank: extractCategoryRank(root),
      subcategories: extractSubcategories(root, baseUrl, marketplace),
      products: await extractBestSellersProducts(root, baseUrl, marketplace, limit),
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

    return bsrData;
  } catch (error) {
    console.error(`Error fetching Amazon BSR for category ${category}:`, error);
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

function extractCategoryRank(root: any): number {
  // Try to find the category rank
  const rankElement = root.querySelector('#zg_banner_text');
  if (rankElement) {
    const text = rankElement.textContent.trim();
    const rankMatch = text.match(/#(\d+)/);
    if (rankMatch) {
      return parseInt(rankMatch[1]);
    }
  }

  return 0;
}

function extractSubcategories(root: any, baseUrl: string, marketplace: string): AmazonBSRData['subcategories'] {
  const subcategories: AmazonBSRData['subcategories'] = [];

  // Find subcategory links
  const subcategoryElements = root.querySelectorAll('#zg_banner_text + ul li a');
  subcategoryElements.forEach((element: any) => {
    const name = element.textContent.trim();
    const href = element.getAttribute('href');

    if (name && href) {
      // Construct full URL
      let fullUrl = href;
      if (!href.startsWith('http')) {
        fullUrl = `https://${baseUrl}${href}`;
      }

      subcategories.push({
        name,
        rank: 0, // Rank will be determined when fetching the specific category
        url: fullUrl,
      });
    }
  });

  return subcategories;
}

async function extractBestSellersProducts(
  root: any,
  baseUrl: string,
  marketplace: string,
  limit: number
): Promise<AmazonBSRData['products']> {
  const products: AmazonBSRData['products'] = [];

  // Find product elements
  const productElements = root.querySelectorAll('#zg-ordered-list .zg-item-immersion, #zg-center-div .zg-item-immersion, .p13n-sc-uncoverable-card');

  for (let i = 0; i < Math.min(productElements.length, limit); i++) {
    const element = productElements[i];
    try {
      const asin = extractASIN(element);
      const title = extractProductTitle(element);
      const price = extractProductPrice(element);
      const rating = extractProductRating(element);
      const reviewsCount = extractProductReviewsCount(element);
      const url = extractProductUrl(element, baseUrl);

      if (asin && title) {
        products.push({
          asin,
          title,
          price,
          rating,
          reviews_count: reviewsCount,
          url,
        });
      }
    } catch (error) {
      console.error(`Error extracting product ${i}:`, error);
      continue;
    }
  }

  return products;
}

function extractASIN(element: any): string | null {
  const asinElement = element.querySelector('[data-asin]');
  if (asinElement) {
    return asinElement.getAttribute('data-asin');
  }

  // Fallback to checking for ASIN in other attributes
  const dataAsin = element.getAttribute('data-asin') ||
                   element.getAttribute('data-item-id') ||
                   element.getAttribute('id');

  if (dataAsin && dataAsin.startsWith('B')) {
    return dataAsin;
  }

  return null;
}

function extractProductTitle(element: any): string {
  const titleElement = element.querySelector('.p13n-sc-line-clamp-1, .a-size-medium, .a-text-bold');
  if (titleElement) {
    return titleElement.textContent.trim();
  }

  return 'Unknown Product';
}

function extractProductPrice(element: any): number {
  const priceElement = element.querySelector('.p13n-sc-price, .a-price-whole, .a-offscreen');
  if (priceElement) {
    const priceText = priceElement.textContent.trim();
    const priceMatch = priceText.match(/\$([0-9.]+)/) || priceText.match(/([0-9.]+)/);
    if (priceMatch) {
      return parseFloat(priceMatch[1]);
    }
  }

  return 0;
}

function extractProductRating(element: any): number {
  const ratingElement = element.querySelector('.a-icon-alt');
  if (ratingElement) {
    const ratingText = ratingElement.textContent.trim();
    const ratingMatch = ratingText.match(/([0-9.]+)\s+out\s+of\s+5/);
    if (ratingMatch) {
      return parseFloat(ratingMatch[1]);
    }
  }

  return 0;
}

function extractProductReviewsCount(element: any): number {
  const reviewsElement = element.querySelector('.a-size-small');
  if (reviewsElement) {
    const text = reviewsElement.textContent.trim();
    const countMatch = text.match(/([0-9,]+)/);
    if (countMatch) {
      return parseInt(countMatch[1].replace(/,/g, ''));
    }
  }

  return 0;
}

function extractProductUrl(element: any, baseUrl: string): string {
  const linkElement = element.querySelector('a.a-link-normal');
  if (linkElement) {
    const href = linkElement.getAttribute('href');
    if (href) {
      if (href.startsWith('http')) {
        return href;
      } else {
        return `https://${baseUrl}${href}`;
      }
    }
  }

  return '#';
}

