/**
 * Amazon Product Scraper
 * ──────────────────────
 * Extracts real-time product data from Amazon product pages via mobile proxy.
 * Handles: price, BSR, reviews, rating, buy box, availability, images, features.
 * Supports US, UK, DE, FR, IT, ES, CA, JP marketplaces.
 *
 * Amazon anti-bot strategy:
 * - Mobile User-Agent (iPhone Safari) — blends with Amazon app traffic
 * - Accept-Language matching marketplace locale
 * - Retry on CAPTCHA detection
 * - Proxy rotation for anti-fingerprinting
 */

import { proxyFetch } from '../proxy';
import type {
  AmazonProduct,
  BestSellerItem,
  BestSellersResponse,
  BSRData,
  BuyBoxData,
  PriceData,
  ProductDimensions,
  ProductVariation,
  ProxyMeta,
  Review,
  ReviewsResponse,
  SearchResponse,
  SearchResult,
  SubCategoryRank,
} from '../types';
import { BESTSELLER_CATEGORIES, MARKETPLACES } from '../types';

// ─── HELPERS ─────────────────────────────────────────

function getMarketplaceConfig(marketplace: string) {
  const key = marketplace.toUpperCase();
  return MARKETPLACES[key] || MARKETPLACES['US'];
}

function isCaptcha(html: string): boolean {
  return (
    html.includes('Type the characters you see in this image') ||
    html.includes('Enter the characters you see below') ||
    html.includes('api.perfdrive.com') ||
    html.includes('captcha') ||
    html.toLowerCase().includes('robot check') ||
    html.includes('Sorry, we just need to make sure')
  );
}

function getMarketplaceHeaders(marketplace: string): Record<string, string> {
  const config = getMarketplaceConfig(marketplace);
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': `${config.language},en;q=0.8`,
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
  };
}

// ─── TEXT EXTRACTION HELPERS ─────────────────────────

function extractText(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1]?.trim() || null : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── PRICE PARSER ────────────────────────────────────

function parsePrice(html: string, currency: string): PriceData {
  let current: number | null = null;
  let was: number | null = null;
  let dealLabel: string | null = null;

  // Try multiple price patterns
  const patterns = [
    // a-price-whole + a-price-fraction
    /class="a-price[^"]*">[\s\S]*?<span class="a-offscreen">\s*([£$€¥₹]?[\d,]+\.?\d*)\s*<\/span>/,
    // #priceblock_ourprice
    /id="priceblock_ourprice"[^>]*>\s*([£$€¥₹]?[\d,]+\.?\d*)/,
    // #priceblock_dealprice
    /id="priceblock_dealprice"[^>]*>\s*([£$€¥₹]?[\d,]+\.?\d*)/,
    // price_inside_buybox
    /id="price_inside_buybox"[^>]*>\s*([£$€¥₹]?[\d,]+\.?\d*)/,
    // kindle / digital
    /class="[^"]*kindle[^"]*price[^"]*"[^>]*>\s*([£$€¥₹]?[\d,]+\.?\d*)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const priceStr = match[1].replace(/[£$€¥₹,]/g, '').trim();
      const parsed = parseFloat(priceStr);
      if (!isNaN(parsed) && parsed > 0) {
        current = parsed;
        break;
      }
    }
  }

  // Try to find the "was" price (struck-through)
  const wasPatterns = [
    /class="a-text-strike"[^>]*>\s*([£$€¥₹]?[\d,]+\.?\d*)/,
    /id="[^"]*was[^"]*"[^>]*>\s*([£$€¥₹]?[\d,]+\.?\d*)/i,
    /class="[^"]*savingsPercentage[^"]*"[\s\S]*?([£$€¥₹]?[\d,]+\.?\d*)\s*<\/span>/,
  ];

  for (const pattern of wasPatterns) {
    const match = html.match(pattern);
    if (match) {
      const priceStr = match[1].replace(/[£$€¥₹,]/g, '').trim();
      const parsed = parseFloat(priceStr);
      if (!isNaN(parsed) && parsed > 0) {
        was = parsed;
        break;
      }
    }
  }

  // Deal label (Limited time deal, etc.)
  const dealMatch = html.match(/class="[^"]*dealBadge[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  if (dealMatch) {
    dealLabel = stripTags(dealMatch[1]).trim() || null;
  }

  const discountPct = current && was && was > current
    ? Math.round(((was - current) / was) * 100)
    : null;

  return {
    current,
    currency,
    was,
    discount_pct: discountPct,
    deal_label: dealLabel,
  };
}

// ─── BSR PARSER ──────────────────────────────────────

function parseBSR(html: string): BSRData {
  let rank: number | null = null;
  let category: string | null = null;
  const subCategoryRanks: SubCategoryRank[] = [];

  // Pattern for BSR block
  const bsrSectionMatch = html.match(
    /Best Sellers Rank[\s\S]*?(<ul[\s\S]*?<\/ul>|<span[\s\S]*?<\/span>)/
  );

  // Pattern 1: BSR in product details table
  const bsrTableMatch = html.match(
    /Best Sellers Rank[^<]*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/
  );

  if (bsrTableMatch) {
    const bsrContent = bsrTableMatch[1];
    // Extract main rank
    const mainRankMatch = bsrContent.match(/#([\d,]+)\s+in\s+([^(<\n]+)/);
    if (mainRankMatch) {
      rank = parseInt(mainRankMatch[1].replace(/,/g, ''));
      category = decodeHtmlEntities(mainRankMatch[2].trim());
    }

    // Extract sub-category ranks
    const subRankPattern = /#([\d,]+)\s+in\s+<a[^>]*>([^<]+)<\/a>/g;
    let subMatch;
    while ((subMatch = subRankPattern.exec(bsrContent)) !== null) {
      subCategoryRanks.push({
        rank: parseInt(subMatch[1].replace(/,/g, '')),
        category: decodeHtmlEntities(subMatch[2].trim()),
      });
    }
  }

  // Pattern 2: BSR in span/li elements
  if (!rank) {
    const bsrSpanMatch = html.match(/#([\d,]+)\s+in\s+([A-Za-z &]+)(?:\s*\(|<)/);
    if (bsrSpanMatch) {
      rank = parseInt(bsrSpanMatch[1].replace(/,/g, ''));
      category = decodeHtmlEntities(bsrSpanMatch[2].trim());
    }
  }

  // Pattern 3: JSON-LD or window data
  if (!rank) {
    const jsonBsrMatch = html.match(/"bestRank":(\d+)/);
    if (jsonBsrMatch) {
      rank = parseInt(jsonBsrMatch[1]);
    }
  }

  return { rank, category, sub_category_ranks: subCategoryRanks };
}

// ─── BUY BOX PARSER ──────────────────────────────────

function parseBuyBox(html: string): BuyBoxData {
  let seller: string | null = null;
  let isAmazon = false;
  let fulfilledBy: string | null = null;
  let sellerRating: number | null = null;
  let sellerRatingsCount: number | null = null;

  // Check if sold by Amazon
  if (
    html.includes('Ships from and sold by <b>Amazon') ||
    html.includes('Sold by: <span>Amazon') ||
    html.includes('"soldByAmazon"') ||
    html.match(/Sold by[\s\S]{0,200}Amazon\.com/)
  ) {
    seller = 'Amazon.com';
    isAmazon = true;
    fulfilledBy = 'Amazon';
  } else {
    // Third-party seller
    const soldByMatch = html.match(/Sold by[:\s]+<[^>]*>([^<]{1,100})</) ||
      html.match(/sold by[:\s]+<span[^>]*>([^<]{1,100})</) ||
      html.match(/sellerProfileTriggerId[^>]*>([^<]{1,100})</);

    if (soldByMatch) {
      seller = decodeHtmlEntities(soldByMatch[1].trim());
      isAmazon = seller.toLowerCase().includes('amazon');
    }

    // Fulfilled by Amazon (FBA)?
    if (html.includes('Fulfilled by Amazon') || html.includes('fulfillment_by_amazon')) {
      fulfilledBy = 'Amazon';
    } else {
      const fulfilledMatch = html.match(/Fulfilled by[:\s]+<[^>]*>([^<]{1,80})</);
      if (fulfilledMatch) {
        fulfilledBy = decodeHtmlEntities(fulfilledMatch[1].trim());
      }
    }

    // Seller rating
    const ratingMatch = html.match(/(\d+)%\s+positive\s+(feedback|rating)/i);
    if (ratingMatch) {
      sellerRating = parseInt(ratingMatch[1]);
    }
    const ratingsCountMatch = html.match(/([\d,]+)\s+rating/i);
    if (ratingsCountMatch) {
      sellerRatingsCount = parseInt(ratingsCountMatch[1].replace(/,/g, ''));
    }
  }

  return {
    seller,
    is_amazon: isAmazon,
    fulfilled_by: fulfilledBy,
    seller_rating: sellerRating,
    seller_ratings_count: sellerRatingsCount,
  };
}

// ─── IMAGES PARSER ───────────────────────────────────

function parseImages(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Pattern 1: colorImages JSON blob
  const colorImagesMatch = html.match(/'colorImages'\s*:\s*(\{[\s\S]*?\})\s*,\s*'colorToAsin'/);
  if (colorImagesMatch) {
    const jsonStr = colorImagesMatch[1];
    const hiResMatches = jsonStr.matchAll(/"hiRes"\s*:\s*"([^"]+)"/g);
    for (const m of hiResMatches) {
      if (!seen.has(m[1])) {
        images.push(m[1]);
        seen.add(m[1]);
      }
    }
  }

  // Pattern 2: landingImageUrl
  if (images.length === 0) {
    const mainImageMatch = html.match(/"landingImageUrl"\s*:\s*"([^"]+)"/);
    if (mainImageMatch && !seen.has(mainImageMatch[1])) {
      images.push(mainImageMatch[1]);
      seen.add(mainImageMatch[1]);
    }
  }

  // Pattern 3: #imgTagWrapperId
  if (images.length === 0) {
    const imgMatch = html.match(/id="landingImage"[^>]*data-old-hires="([^"]+)"/);
    if (imgMatch && !seen.has(imgMatch[1])) {
      images.push(imgMatch[1]);
      seen.add(imgMatch[1]);
    }
  }

  // Pattern 4: large image in meta
  const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
  if (ogImageMatch && !seen.has(ogImageMatch[1])) {
    images.push(ogImageMatch[1]);
    seen.add(ogImageMatch[1]);
  }

  return images.slice(0, 10); // max 10 images
}

// ─── FEATURES PARSER ─────────────────────────────────

function parseFeatures(html: string): string[] {
  const features: string[] = [];

  // Feature bullets
  const featureSection = html.match(/id="feature-bullets"[\s\S]*?<ul[\s\S]*?<\/ul>/);
  if (featureSection) {
    const liPattern = /<li[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/g;
    let match;
    while ((match = liPattern.exec(featureSection[0])) !== null) {
      const text = stripTags(match[1]).trim();
      if (text && text.length > 3 && !text.includes('Make sure this fits')) {
        features.push(decodeHtmlEntities(text));
      }
    }
  }

  return features.slice(0, 10);
}

// ─── VARIATIONS PARSER ───────────────────────────────

function parseVariations(html: string, currentAsin: string): ProductVariation[] {
  const variations: ProductVariation[] = [];

  // Try to extract variation ASINs
  const variationPattern = /"asin"\s*:\s*"([A-Z0-9]{10})"/g;
  const seen = new Set<string>();
  let match;
  let count = 0;

  while ((match = variationPattern.exec(html)) !== null && count < 20) {
    const asin = match[1];
    if (!seen.has(asin)) {
      seen.add(asin);
      variations.push({
        asin,
        title: asin === currentAsin ? 'Current' : `Variation ${variations.length + 1}`,
        selected: asin === currentAsin,
      });
      count++;
    }
  }

  return variations.filter(v => v.asin !== currentAsin || v.selected).slice(0, 10);
}

// ─── DIMENSIONS PARSER ───────────────────────────────

function parseDimensions(html: string): ProductDimensions {
  let weight: string | null = null;
  let dimensions: string | null = null;

  const weightMatch = html.match(/Item Weight[^<]*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i) ||
    html.match(/Package Weight[^<]*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  if (weightMatch) {
    weight = stripTags(weightMatch[1]).trim() || null;
  }

  const dimMatch = html.match(/Product Dimensions[^<]*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i) ||
    html.match(/Item Dimensions[^<]*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  if (dimMatch) {
    dimensions = stripTags(dimMatch[1]).trim() || null;
  }

  return { weight, dimensions };
}

// ─── CATEGORIES PARSER ───────────────────────────────

function parseCategories(html: string): string[] {
  const categories: string[] = [];

  // Breadcrumb navigation
  const breadcrumbPattern = /class="a-color-tertiary"[^>]*>\s*›\s*<\/span>[\s\S]*?class="[^"]*"[^>]*>([^<]+)</g;
  const altPattern = /class="a-link-normal a-color-tertiary"[^>]*>([^<]{2,50})<\/a>/g;

  let match;
  while ((match = altPattern.exec(html)) !== null) {
    const cat = decodeHtmlEntities(match[1].trim());
    if (cat && !categories.includes(cat)) {
      categories.push(cat);
    }
  }

  return categories.slice(0, 5);
}

// ─── PROXY CARRIER DETECTION ─────────────────────────

async function getProxyMeta(country: string): Promise<ProxyMeta> {
  try {
    const res = await proxyFetch('https://api.ipify.org?format=json', {
      maxRetries: 1,
      timeoutMs: 8_000,
    });
    const data = await res.json() as any;
    return {
      ip: data.ip || null,
      country,
      carrier: null, // carrier info not exposed by ipify
      type: 'mobile',
    };
  } catch {
    return { ip: null, country, carrier: null, type: 'mobile' };
  }
}

// ─── PRODUCT SCRAPER ─────────────────────────────────

export async function scrapeProduct(
  asin: string,
  marketplace: string = 'US',
): Promise<AmazonProduct> {
  const config = getMarketplaceConfig(marketplace);
  const url = `https://${config.domain}/dp/${asin}`;
  const headers = getMarketplaceHeaders(marketplace);

  let html = '';
  let lastError: Error | null = null;

  // Try up to 3 times (CAPTCHA retry)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await proxyFetch(url, {
        headers,
        maxRetries: 1,
        timeoutMs: 45_000,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      html = await res.text();

      if (isCaptcha(html)) {
        console.warn(`[AMAZON] CAPTCHA detected for ${asin} (attempt ${attempt + 1})`);
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error('CAPTCHA block — Amazon is rate-limiting this proxy. Try again in a few minutes.');
      }

      break;
    } catch (err: any) {
      lastError = err;
      if (!err.message?.includes('CAPTCHA') && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      } else if (err.message?.includes('CAPTCHA')) {
        throw err;
      }
    }
  }

  if (!html) {
    throw lastError || new Error('Failed to fetch product page');
  }

  // Verify we got a real product page
  if (!html.includes('data-asin') && !html.includes('productTitle') && !html.includes(asin)) {
    throw new Error(`Product ${asin} not found on Amazon ${marketplace}`);
  }

  // Extract title
  const title = extractText(html, /id="productTitle"[^>]*>([\s\S]*?)<\/span>/) ||
    extractText(html, /<title>([^<]+)<\/title>/)?.replace(/ - Amazon.*$/i, '').trim() ||
    null;

  const proxyMeta = await getProxyMeta(config.country);

  return {
    asin,
    title: title ? decodeHtmlEntities(title) : null,
    price: parsePrice(html, config.currency),
    bsr: parseBSR(html),
    rating: parseRating(html),
    reviews_count: parseReviewsCount(html),
    buy_box: parseBuyBox(html),
    availability: parseAvailability(html),
    brand: parseBrand(html),
    images: parseImages(html),
    features: parseFeatures(html),
    categories: parseCategories(html),
    dimensions: parseDimensions(html),
    aplus_content: html.includes('aplus-module') || html.includes('a-aplus'),
    variations: parseVariations(html, asin),
    meta: {
      marketplace: marketplace.toUpperCase(),
      url,
      scraped_at: new Date().toISOString(),
      proxy: proxyMeta,
    },
  };
}

function parseRating(html: string): number | null {
  const patterns = [
    /(\d+\.?\d*)\s+out of 5 stars/,
    /class="a-icon-alt"[^>]*>(\d+\.?\d*)\s+out of 5/,
    /"ratingValue"\s*:\s*"?(\d+\.?\d*)"?/,
  ];
  for (const p of patterns) {
    const match = html.match(p);
    if (match) {
      const r = parseFloat(match[1]);
      if (!isNaN(r) && r >= 0 && r <= 5) return r;
    }
  }
  return null;
}

function parseReviewsCount(html: string): number | null {
  const patterns = [
    /id="acrCustomerReviewText"[^>]*>([\d,]+)\s+rating/,
    /([\d,]+)\s+global\s+ratings/,
    /([\d,]+)\s+customer\s+review/,
    /"reviewCount"\s*:\s*(\d+)/,
  ];
  for (const p of patterns) {
    const match = html.match(p);
    if (match) {
      const n = parseInt(match[1].replace(/,/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

function parseAvailability(html: string): string | null {
  const patterns = [
    /id="availability"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/,
    /class="a-size-medium a-color-success"[^>]*>([\s\S]*?)<\/span>/,
    /class="a-color-state a-text-bold"[^>]*>([\s\S]*?)<\/span>/,
  ];
  for (const p of patterns) {
    const match = html.match(p);
    if (match) {
      const text = stripTags(match[1]).trim();
      if (text && text.length < 100) return decodeHtmlEntities(text);
    }
  }
  if (html.includes('In Stock')) return 'In Stock';
  if (html.includes('Out of Stock') || html.includes('Currently unavailable')) return 'Out of Stock';
  return null;
}

function parseBrand(html: string): string | null {
  const patterns = [
    /id="bylineInfo"[^>]*>[\s\S]*?(?:Visit the\s+)?<a[^>]*>([^<]+)<\/a>/,
    /class="[^"]*brand[^"]*"[^>]*>([^<]+)</i,
    /"brand"\s*:\s*"([^"]+)"/,
    /by\s+<a[^>]*>([^<]{1,80})<\/a>/,
  ];
  for (const p of patterns) {
    const match = html.match(p);
    if (match) {
      const brand = decodeHtmlEntities(match[1].trim());
      if (brand && brand.length < 100) return brand;
    }
  }
  return null;
}

// ─── SEARCH SCRAPER ──────────────────────────────────

export async function searchProducts(
  query: string,
  category: string | null = null,
  marketplace: string = 'US',
  page: number = 1,
): Promise<SearchResponse> {
  const config = getMarketplaceConfig(marketplace);

  let url = `https://${config.domain}/s?k=${encodeURIComponent(query)}&page=${page}`;
  if (category) {
    const catKey = category.toLowerCase().replace(/\s+/g, '-');
    const catId = BESTSELLER_CATEGORIES[catKey];
    if (catId) {
      url += `&i=${catId}`;
    }
  }

  const headers = getMarketplaceHeaders(marketplace);
  let html = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await proxyFetch(url, { headers, maxRetries: 1, timeoutMs: 45_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
    if (!isCaptcha(html)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    else throw new Error('CAPTCHA block on search');
  }

  const results: SearchResult[] = [];

  // Extract search result items
  const itemPattern = /data-asin="([A-Z0-9]{10})"[\s\S]*?(?=data-asin="|<\/div>\s*<\/div>\s*<\/div>\s*<div[^>]*data-component)/g;
  let match;
  let count = 0;

  while ((match = itemPattern.exec(html)) !== null && count < 20) {
    const asin = match[1];
    const chunk = html.slice(match.index, match.index + 3000);

    // Title
    const titleMatch = chunk.match(/class="a-size-[^"]*\s*a-color-base[^"]*\s*a-text-normal[^"]*"[^>]*>([\s\S]*?)<\/span>/) ||
      chunk.match(/class="a-size-medium[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])).trim() : null;

    // Price
    const priceMatch = chunk.match(/class="a-offscreen"[^>]*>\s*([£$€¥]?[\d,]+\.?\d*)/);
    let currentPrice: number | null = null;
    if (priceMatch) {
      currentPrice = parseFloat(priceMatch[1].replace(/[£$€¥,]/g, ''));
    }

    // Rating
    const ratingMatch = chunk.match(/(\d+\.?\d*)\s+out of 5 stars/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Reviews count
    const reviewsMatch = chunk.match(/([\d,]+)\s*<\/span>\s*<\/a>\s*<\/div>/);
    const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, '')) : null;

    // Image
    const imgMatch = chunk.match(/class="s-image"[^>]*src="([^"]+)"/);
    const image = imgMatch ? imgMatch[1] : null;

    // Sponsored
    const isSponsored = chunk.includes('Sponsored') || chunk.includes('sp_atf');
    const isPrime = chunk.includes('a-icon-prime');

    if (asin && title) {
      results.push({
        asin,
        title,
        price: {
          current: isNaN(currentPrice as number) ? null : currentPrice,
          currency: config.currency,
          was: null,
          discount_pct: null,
        },
        rating,
        reviews_count: reviewsCount,
        bsr_rank: null,
        bsr_category: null,
        is_prime: isPrime,
        is_sponsored: isSponsored,
        image,
        url: `https://${config.domain}/dp/${asin}`,
      });
      count++;
    }
  }

  // Total results
  const totalMatch = html.match(/([\d,]+)\s+results?\s+for/i) ||
    html.match(/of\s+([\d,]+)\s+results/i);
  const totalResults = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

  const proxyMeta = await getProxyMeta(config.country);

  return {
    query,
    category,
    marketplace: marketplace.toUpperCase(),
    total_results: totalResults,
    page,
    results,
    meta: { proxy: proxyMeta },
  };
}

// ─── BESTSELLERS SCRAPER ─────────────────────────────

export async function scrapeBestSellers(
  category: string = 'electronics',
  marketplace: string = 'US',
): Promise<BestSellersResponse> {
  const config = getMarketplaceConfig(marketplace);
  const catKey = category.toLowerCase().replace(/\s+/g, '-');
  const catPath = BESTSELLER_CATEGORIES[catKey] || catKey;
  const url = `https://${config.domain}/bestsellers/${catPath}`;
  const categoryUrl = url;

  const headers = getMarketplaceHeaders(marketplace);
  let html = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await proxyFetch(url, { headers, maxRetries: 1, timeoutMs: 45_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
    if (!isCaptcha(html)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    else throw new Error('CAPTCHA block on bestsellers');
  }

  const items: BestSellerItem[] = [];

  // Extract bestseller items
  const itemPattern = /data-asin="([A-Z0-9]{10})"[\s\S]*?(?=data-asin="|<\/ol>)/g;
  let match;
  let rank = 1;

  // Alternative: look for zg-item-immersion divs
  const zgPattern = /class="[^"]*zg-item[^"]*"[\s\S]*?href="[^"]*\/dp\/([A-Z0-9]{10})[^"]*"([\s\S]*?)(?=class="[^"]*zg-item|<\/ol>)/g;

  while ((match = zgPattern.exec(html)) !== null && rank <= 50) {
    const asin = match[1];
    const chunk = match[2];

    // Title
    const titleMatch = chunk.match(/class="[^"]*p13n-sc-truncate[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
      chunk.match(/aria-label="([^"]+)"/);
    const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])).trim() : null;

    // Price
    const priceMatch = chunk.match(/class="a-offscreen"[^>]*>\s*([£$€¥]?[\d,]+\.?\d*)/) ||
      chunk.match(/class="[^"]*price[^"]*"[^>]*>\s*([£$€¥]?[\d,]+\.?\d*)/i);
    let currentPrice: number | null = null;
    if (priceMatch) {
      currentPrice = parseFloat(priceMatch[1].replace(/[£$€¥,]/g, ''));
      if (isNaN(currentPrice)) currentPrice = null;
    }

    // Rating
    const ratingMatch = chunk.match(/(\d+\.?\d*)\s+out of 5/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Reviews
    const reviewsMatch = chunk.match(/([\d,]+)\s*(?:review|rating)/i);
    const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, '')) : null;

    // Image
    const imgMatch = chunk.match(/src="([^"]+?\.jpg[^"]*)"/);
    const image = imgMatch ? imgMatch[1] : null;

    if (asin) {
      items.push({
        rank,
        asin,
        title,
        price: { current: currentPrice, currency: config.currency },
        rating,
        reviews_count: reviewsCount,
        image,
        url: `https://${config.domain}/dp/${asin}`,
      });
      rank++;
    }
  }

  // Fallback: simpler ASIN extraction if zg pattern didn't work
  if (items.length === 0) {
    const asinPattern = /href="[^"]*\/dp\/([A-Z0-9]{10})[^"]*"/g;
    const seen = new Set<string>();
    let m;
    rank = 1;
    while ((m = asinPattern.exec(html)) !== null && rank <= 50) {
      const asin = m[1];
      if (!seen.has(asin)) {
        seen.add(asin);
        items.push({
          rank,
          asin,
          title: null,
          price: { current: null, currency: config.currency },
          rating: null,
          reviews_count: null,
          image: null,
          url: `https://${config.domain}/dp/${asin}`,
        });
        rank++;
      }
    }
  }

  const proxyMeta = await getProxyMeta(config.country);

  return {
    category: category,
    marketplace: marketplace.toUpperCase(),
    category_url: categoryUrl,
    items,
    meta: { proxy: proxyMeta },
  };
}

// ─── REVIEWS SCRAPER ─────────────────────────────────

export async function scrapeReviews(
  asin: string,
  marketplace: string = 'US',
  sort: string = 'recent',
  page: number = 1,
  limit: number = 10,
): Promise<ReviewsResponse> {
  const config = getMarketplaceConfig(marketplace);

  // Map sort param to Amazon's sort values
  const sortMap: Record<string, string> = {
    recent: 'recent',
    helpful: 'helpful',
    top: 'helpful',
    positive: 'recent',
  };
  const amazonSort = sortMap[sort] || 'recent';

  const url = `https://${config.domain}/product-reviews/${asin}?sortBy=${amazonSort}&pageNumber=${page}&pageSize=${Math.min(limit, 10)}`;
  const headers = getMarketplaceHeaders(marketplace);

  let html = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await proxyFetch(url, { headers, maxRetries: 1, timeoutMs: 45_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
    if (!isCaptcha(html)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    else throw new Error('CAPTCHA block on reviews');
  }

  const reviews: Review[] = [];

  // Extract individual reviews
  const reviewPattern = /id="([^"]+)"[^>]*class="[^"]*review[^"]*"([\s\S]*?)(?=<div[^>]*id="[^"]*"[^>]*class="[^"]*review[^"]*"|<\/div>\s*<\/div>\s*<\/div>\s*<div[^>]*class="[^"]*paginationBar)/g;

  let match;
  while ((match = reviewPattern.exec(html)) !== null && reviews.length < limit) {
    const reviewId = match[1];
    const chunk = match[2];

    // Rating from star icon
    const starMatch = chunk.match(/(\d)\s+out of 5 stars/) ||
      chunk.match(/class="a-icon-alt"[^>]*>(\d)/);
    const rating = starMatch ? parseInt(starMatch[1]) : null;

    // Title
    const titleMatch = chunk.match(/class="[^"]*review-title[^"]*"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
    const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])).trim() : null;

    // Body
    const bodyMatch = chunk.match(/class="[^"]*review-text[^"]*"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
    const body = bodyMatch ? decodeHtmlEntities(stripTags(bodyMatch[1])).trim() : null;

    // Author
    const authorMatch = chunk.match(/class="[^"]*a-profile-name[^"]*"[^>]*>([^<]+)</);
    const author = authorMatch ? authorMatch[1].trim() : null;

    // Date
    const dateMatch = chunk.match(/class="[^"]*review-date[^"]*"[^>]*>[\s\S]*?on\s+([^<]+)</);
    const dateRaw = dateMatch ? dateMatch[1].trim() : null;

    // Verified purchase
    const verified = chunk.includes('Verified Purchase') || chunk.includes('Verified purchase');

    // Helpful votes
    const helpfulMatch = chunk.match(/([\d,]+)\s+people?\s+found this helpful/i);
    const helpfulVotes = helpfulMatch ? parseInt(helpfulMatch[1].replace(/,/g, '')) : null;

    if (rating !== null || title || body) {
      reviews.push({
        id: reviewId || null,
        author,
        author_url: null,
        rating,
        title,
        body,
        date: dateRaw,
        date_raw: dateRaw,
        verified_purchase: verified,
        helpful_votes: helpfulVotes,
        images: [],
      });
    }
  }

  // Overall rating
  const avgRatingMatch = html.match(/(\d+\.?\d*)\s+out of 5<\/span>/);
  const avgRating = avgRatingMatch ? parseFloat(avgRatingMatch[1]) : null;

  // Total reviews count
  const totalMatch = html.match(/([\d,]+)\s+global\s+ratings?/i) ||
    html.match(/([\d,]+)\s+total\s+ratings?/i);
  const totalReviews = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

  // Rating distribution
  const distribution: Record<string, number> = {};
  const distPattern = /(\d)\s+star[^%]*(\d+)%/g;
  let distMatch;
  while ((distMatch = distPattern.exec(html)) !== null) {
    distribution[`${distMatch[1]}_star`] = parseInt(distMatch[2]);
  }

  const proxyMeta = await getProxyMeta(config.country);

  return {
    asin,
    marketplace: marketplace.toUpperCase(),
    total_reviews: totalReviews,
    average_rating: avgRating,
    rating_distribution: distribution,
    sort,
    page,
    reviews,
    meta: { proxy: proxyMeta },
  };
}
