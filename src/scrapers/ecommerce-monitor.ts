
/**
 * E-Commerce Monitor API
 * Scrapes e-commerce platforms for product data, pricing, reviews, and market trends.
 */

import { proxyFetch } from '../proxy';

// ─── Types ──────────────────────────────────────────
export interface ECommerceProduct {
  id: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  currency: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  productUrl: string;
  brand: string;
  category: string;
  availability: 'in_stock' | 'out_of_stock' | 'pre_order';
  seller: string;
  platform: 'amazon' | 'ebay' | 'etsy' | 'walmart' | 'aliexpress';
  meta?: {
    proxy?: {
      ip?: string;
      country?: string;
      carrier?: string;
    };
  };
}

export interface PriceHistory {
  currentPrice: number;
  historicalPrices: Array<{
    date: string;
    price: number;
    discount?: number;
  }>;
  priceTrend: 'stable' | 'increasing' | 'decreasing' | 'fluctuating';
  lowestPrice: number;
  highestPrice: number;
}

export interface MarketTrends {
  category: string;
  platform: string;
  totalProducts: number;
  averagePrice: number;
  priceRange: { min: number; max: number };
  ratingDistribution: { [key: string]: number };
  topBrands: Array<{ name: string; productCount: number; averageRating: number }>;
  trendingProducts: ECommerceProduct[];
  lastUpdated: string;
}

export interface CompetitorAnalysis {
  productId: string;
  competitors: Array<{
    platform: string;
    seller: string;
    price: number;
    rating: number;
    reviewCount: number;
    shippingCost: number;
    totalCost: number;
    availability: string;
    url: string;
  }>;
  bestDeal: {
    platform: string;
    seller: string;
    price: number;
    totalCost: number;
    url: string;
  };
}

// ─── Helpers ────────────────────────────────────────
function cleanText(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function extractPrice(text: string): number {
  const priceMatch = text.match(/\$?(\d+\.?\d*)/);
  return priceMatch ? parseFloat(priceMatch[1]) : 0;
}

function extractRating(text: string): number {
  const ratingMatch = text.match(/(\d+\.?\d*)\s*out\s*of\s*5/);
  return ratingMatch ? parseFloat(ratingMatch[1]) : 0;
}

function extractReviewCount(text: string): number {
  const countMatch = text.match(/(\d+)\s*(?:reviews?|ratings?)/i);
  return countMatch ? parseInt(countMatch[1]) : 0;
}

// ─── Amazon Scraper ────────────────────────────────
async function scrapeAmazonProduct(url: string): Promise<ECommerceProduct | null> {
  try {
    const response = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Amazon product: ${response.status}`);
    }

    const html = await response.text();
    return parseAmazonProduct(html, url);
  } catch (error: any) {
    console.error('Error scraping Amazon product:', error.message);
    return null;
  }
}

function parseAmazonProduct(html: string, url: string): ECommerceProduct | null {
  try {
    // Extract product ID from URL
    const productIdMatch = url.match(/dp\/([A-Z0-9]+)/);
    if (!productIdMatch) return null;
    const productId = productIdMatch[1];

    // Extract title
    const titleMatch = html.match(/<span id="productTitle"[^>]*>([^<]+)<\/span>/);
    const title = titleMatch ? cleanText(titleMatch[1]) : 'Unknown Product';

    // Extract price
    const priceMatch = html.match(/<span class="a-price-whole">([^<]+)<\/span>/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : 0;

    // Extract original price (if discounted)
    const originalPriceMatch = html.match(/<span class="a-price a-text-price[^>]*><span class="a-offscreen">\$([^<]+)<\/span>/);
    const originalPrice = originalPriceMatch ? parseFloat(originalPriceMatch[1].replace(',', '')) : undefined;

    // Extract discount percentage
    const discountMatch = html.match(/<span class="savingsPercentage">([^<]+)<\/span>/);
    const discount = discountMatch ? parseInt(discountMatch[1].replace('% off', '').trim()) : undefined;

    // Extract rating
    const ratingMatch = html.match(/<span class="a-icon-alt"[^>]*>(\d+\.\d+) out of 5 stars<\/span>/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // Extract review count
    const reviewCountMatch = html.match(/<span id="acrCustomerReviewText"[^>]*>(\d+)\s*ratings?<\/span>/);
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

    // Extract image URL
    const imageMatch = html.match(/<img id="landingImage"[^>]*src="([^"]+)"[^>]*>/);
    const imageUrl = imageMatch ? imageMatch[1] : '';

    // Extract brand
    const brandMatch = html.match(/<a id="bylineInfo"[^>]*>([^<]+)<\/a>/);
    const brand = brandMatch ? cleanText(brandMatch[1]) : 'Unknown';

    // Extract category
    const categoryMatch = html.match(/<a class="a-link-normal a-color-tertiary"[^>]*>([^<]+)<\/a>/);
    const category = categoryMatch ? cleanText(categoryMatch[1]) : 'Unknown';

    // Extract availability
    const availability = html.includes('a-color-base a-text-bold') ? 'in_stock' :
                       html.includes('a-color-base a-text-bold') && html.includes('Temporarily out of stock') ? 'out_of_stock' :
                       'pre_order';

    return {
      id: productId,
      title,
      description: '',
      price,
      originalPrice,
      discount,
      currency: 'USD',
      rating,
      reviewCount,
      imageUrl,
      productUrl: url,
      brand,
      category,
      availability,
      seller: 'Amazon',
      platform: 'amazon',
    };
  } catch (error: any) {
    console.error('Error parsing Amazon product:', error.message);
    return null;
  }
}

// ─── Ebay Scraper ────────────────────────────────
async function scrapeEbayProduct(url: string): Promise<ECommerceProduct | null> {
  try {
    const response = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Ebay product: ${response.status}`);
    }

    const html = await response.text();
    return parseEbayProduct(html, url);
  } catch (error: any) {
    console.error('Error scraping Ebay product:', error.message);
    return null;
  }
}

function parseEbayProduct(html: string, url: string): ECommerceProduct | null {
  try {
    // Extract product ID from URL
    const productIdMatch = url.match(/itm\/([^\/]+)/);
    if (!productIdMatch) return null;
    const productId = productIdMatch[1];

    // Extract title
    const titleMatch = html.match(/<h1[^>]*class="it-ttl"[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? cleanText(titleMatch[1]) : 'Unknown Product';

    // Extract price
    const priceMatch = html.match(/<span[^>]*class="notranslate"[^>]*>\$([\d,]+\.\d{2})<\/span>/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : 0;

    // Extract rating
    const ratingMatch = html.match(/<span[^>]*class="str-buybox__reviews-summary__stars"[^>]*>([^<]+)<\/span>/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1].split(' ')[0]) : 0;

    // Extract review count
    const reviewCountMatch = html.match(/<span[^>]*class="str-buybox__reviews-summary__count"[^>]*>([^<]+)<\/span>/);
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/[^\d]/g, '')) : 0;

    // Extract image URL
    const imageMatch = html.match(/<img[^>]*id="icImg"[^>]*src="([^"]+)"[^>]*>/);
    const imageUrl = imageMatch ? imageMatch[1] : '';

    // Extract brand (if available)
    const brandMatch = html.match(/<div[^>]*class="ux-labels-brand"[^>]*>([^<]+)<\/div>/);
    const brand = brandMatch ? cleanText(brandMatch[1]) : 'Unknown';

    return {
      id: productId,
      title,
      description: '',
      price,
      currency: 'USD',
      rating,
      reviewCount,
      imageUrl,
      productUrl: url,
      brand,
      category: 'Unknown',
      availability: 'in_stock',
      seller: 'Ebay',
      platform: 'ebay',
    };
  } catch (error: any) {
    console.error('Error parsing Ebay product:', error.message);
    return null;
  }
}

// ─── Etsy Scraper ────────────────────────────────
async function scrapeEtsyProduct(url: string): Promise<ECommerceProduct | null> {
  try {
    const response = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Etsy product: ${response.status}`);
    }

    const html = await response.text();
    return parseEtsyProduct(html, url);
  } catch (error: any) {
    console.error('Error scraping Etsy product:', error.message);
    return null;
  }
}

function parseEtsyProduct(html: string, url: string): ECommerceProduct | null {
  try {
    // Extract product ID from URL
    const productIdMatch = url.match(/\/listing\/(\d+)/);
    if (!productIdMatch) return null;
    const productId = productIdMatch[1];

    // Extract title
    const titleMatch = html.match(/<h1[^>]*class="wt-text-title-large"[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? cleanText(titleMatch[1]) : 'Unknown Product';

    // Extract price
    const priceMatch = html.match(/<span[^>]*class="wt-mr-xs-2"[^>]*>(?:US\s*)?\$([\d,]+\.\d{2})<\/span>/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : 0;

    // Extract rating
    const ratingMatch = html.match(/<span[^>]*class="rating-score"[^>]*>([^<]+)<\/span>/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // Extract review count
    const reviewCountMatch = html.match(/<span[^>]*class="wt-text-caption"[^>]*>([^<]+)\s*reviews?<\/span>/);
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/[^\d]/g, '')) : 0;

    // Extract image URL
    const imageMatch = html.match(/<img[^>]*id="listing-cover-image"[^>]*src="([^"]+)"[^>]*>/);
    const imageUrl = imageMatch ? imageMatch[1] : '';

    // Extract shop name
    const shopMatch = html.match(/<a[^>]*class="shop-name"[^>]*>([^<]+)<\/a>/);
    const seller = shopMatch ? cleanText(shopMatch[1]) : 'Unknown';

    return {
      id: productId,
      title,
      description: '',
      price,
      currency: 'USD',
      rating,
      reviewCount,
      imageUrl,
      productUrl: url,
      brand: 'Etsy',
      category: 'Handmade',
      availability: 'in_stock',
      seller,
      platform: 'etsy',
    };
  } catch (error: any) {
    console.error('Error parsing Etsy product:', error.message);
    return null;
  }
}

// ─── Main API Functions ────────────────────────────
export async function getProductDetails(platform: string, productId: string): Promise<ECommerceProduct | null> {
  let url = '';

  switch (platform.toLowerCase()) {
    case 'amazon':
      url = `https://www.amazon.com/dp/${productId}`;
      return await scrapeAmazonProduct(url);
    case 'ebay':
      url = `https://www.ebay.com/itm/${productId}`;
      return await scrapeEbayProduct(url);
    case 'etsy':
      url = `https://www.etsy.com/listing/${productId}`;
      return await scrapeEtsyProduct(url);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function searchProducts(
  platform: string,
  query: string,
  category?: string,
  minPrice?: number,
  maxPrice?: number,
  limit: number = 10
): Promise<ECommerceProduct[]> {
  try {
    let url = '';

    switch (platform.toLowerCase()) {
      case 'amazon':
        url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
        if (category) url += `&rh=p_n_feature_browse-bin:${category}`;
        if (minPrice) url += `&rh=p_32:${minPrice}`;
        if (maxPrice) url += `&rh=p_32:${maxPrice}`;
        break;
      case 'ebay':
        url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
        if (minPrice) url += `&_udlo=${minPrice}`;
        if (maxPrice) url += `&_udhi=${maxPrice}`;
        break;
      case 'etsy':
        url = `https://www.etsy.com/search?q=${encodeURIComponent(query)}`;
        if (category) url += `&ref=auto-1&search_use_case=category&search_query=${encodeURIComponent(category)}`;
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    const response = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Failed to search products: ${response.status}`);
    }

    const html = await response.text();
    return parseProductSearchResults(html, platform, limit);
  } catch (error: any) {
    console.error('Error searching products:', error.message);
    return [];
  }
}

function parseProductSearchResults(html: string, platform: string, limit: number): ECommerceProduct[] {
  const products: ECommerceProduct[] = [];

  try {
    switch (platform.toLowerCase()) {
      case 'amazon':
        // Extract product links
        const links = html.match(/<a[^>]*href="\/dp\/([A-Z0-9]+)[^"]*"[^>]*>/g) || [];
        for (const link of links.slice(0, limit)) {
          const productIdMatch = link.match(/\/dp\/([A-Z0-9]+)/);
          if (productIdMatch) {
            const productId = productIdMatch[1];
            const url = `https://www.amazon.com/dp/${productId}`;
            products.push({
              id: productId,
              title: 'Amazon Product',
              description: '',
              price: 0,
              currency: 'USD',
              rating: 0,
              reviewCount: 0,
              imageUrl: '',
              productUrl: url,
              brand: 'Amazon',
              category: 'Unknown',
              availability: 'in_stock',
              seller: 'Amazon',
              platform: 'amazon',
            });
          }
        }
        break;

      case 'ebay':
        // Extract product links
        const ebayLinks = html.match(/<a[^>]*href="\/itm\/([^\/]+)[^"]*"[^>]*>/g) || [];
        for (const link of ebayLinks.slice(0, limit)) {
          const productIdMatch = link.match(/\/itm\/([^\/]+)/);
          if (productIdMatch) {
            const productId = productIdMatch[1];
            const url = `https://www.ebay.com/itm/${productId}`;
            products.push({
              id: productId,
              title: 'Ebay Product',
              description: '',
              price: 0,
              currency: 'USD',
              rating: 0,
              reviewCount: 0,
              imageUrl: '',
              productUrl: url,
              brand: 'Ebay',
              category: 'Unknown',
              availability: 'in_stock',
              seller: 'Ebay',
              platform: 'ebay',
            });
          }
        }
        break;

      case 'etsy':
        // Extract product links
        const etsyLinks = html.match(/<a[^>]*href="\/listing\/(\d+)[^"]*"[^>]*>/g) || [];
        for (const link of etsyLinks.slice(0, limit)) {
          const productIdMatch = link.match(/\/listing\/(\d+)/);
          if (productIdMatch) {
            const productId = productIdMatch[1];
            const url = `https://www.etsy.com/listing/${productId}`;
            products.push({
              id: productId,
              title: 'Etsy Product',
              description: '',
              price: 0,
              currency: 'USD',
              rating: 0,
              reviewCount: 0,
              imageUrl: '',
              productUrl: url,
              brand: 'Etsy',
              category: 'Handmade',
              availability: 'in_stock',
              seller: 'Etsy',
              platform: 'etsy',
            });
          }
        }
        break;
    }
  } catch (error: any) {
    console.error('Error parsing search results:', error.message);
  }

  return products;
}

export async function getPriceHistory(productId: string, platform: string): Promise<PriceHistory | null> {
  // This would require historical data scraping or API integration
  // For now, return a mock response
  return {
    currentPrice: 0,
    historicalPrices: [],
    priceTrend: 'stable',
    lowestPrice: 0,
    highestPrice: 0,
  };
}

export async function getMarketTrends(
  category: string,
  platform: string,
  location?: string,
  limit: number = 10
): Promise<MarketTrends | null> {
  // This would require more complex scraping or API integration
  // For now, return a mock response
  return {
    category,
    platform,
    totalProducts: 0,
    averagePrice: 0,
    priceRange: { min: 0, max: 0 },
    ratingDistribution: {},
    topBrands: [],
    trendingProducts: [],
    lastUpdated: new Date().toISOString(),
  };
}

export async function analyzeCompetitors(
  productId: string,
  platform: string,
  location?: string
): Promise<CompetitorAnalysis | null> {
  // This would require competitor analysis across platforms
  // For now, return a mock response
  return {
    productId,
    competitors: [],
    bestDeal: {
      platform: platform,
      seller: 'Unknown',
      price: 0,
      totalCost: 0,
      url: '',
    },
  };
}
