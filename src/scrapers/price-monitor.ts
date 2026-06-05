/**
 * E-Commerce Price & Stock Monitor
 * ─────────────────────────────────
 * Scrapes product pages to extract pricing, availability, and metadata.
 * Supports major e-commerce platforms via structured data + CSS fallbacks.
 *
 * Bounty: Wave 2 — $50 E-Commerce Price & Stock Monitor
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ───────────────────────────────────────────

export interface PriceResult {
  /** Product name / title */
  name: string;
  /** Current price as a float (e.g. 29.99) */
  price: number | null;
  /** Currency code (USD, EUR, GBP, etc.) */
  currency: string;
  /** Original/strikethrough price if on sale */
  originalPrice: number | null;
  /** Stock availability */
  stockStatus: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  /** Product image URL */
  image: string | null;
  /** Product page URL */
  url: string;
  /** Store/retailer name */
  store: string;
  /** Brand name if available */
  brand: string | null;
  /** Product rating (0-5) if available */
  rating: number | null;
  /** Number of reviews */
  reviewCount: number | null;
  /** Timestamp of this check (ISO 8601) */
  checkedAt: string;
  /** Whether a discount/sale is active */
  onSale: boolean;
}

export interface PriceMonitorResponse {
  query: string;
  results: PriceResult[];
  totalFound: number;
}

// ─── STORE DETECTION ─────────────────────────────────

const STORE_PATTERNS: Record<string, { name: string; selectors: string[] }> = {
  amazon: {
    name: 'Amazon',
    selectors: ['#productTitle', '#title', '[data-automation-id="title"]'],
  },
  ebay: {
    name: 'eBay',
    selectors: ['.it-ttl', '#itemTitle', '[data-testid="x-item-title"]'],
  },
  walmart: {
    name: 'Walmart',
    selectors: ['[data-testid="product-title"]', '.prod-ProductTitle', 'h1.prod-ProductTitle'],
  },
  aliexpress: {
    name: 'AliExpress',
    selectors: ['.product-title-text', '[data-pl="product-title"]'],
  },
  etsy: {
    name: 'Etsy',
    selectors: ['[data-buy-box-region="title"]', '.wt-text-title-01'],
  },
  target: {
    name: 'Target',
    selectors: ['[data-test="product-title"]', 'h1[data-test="product-title"]'],
  },
};

function detectStore(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  for (const [key, store] of Object.entries(STORE_PATTERNS)) {
    if (hostname.includes(key)) return store.name;
  }
  // Check for Shopify
  if (hostname.includes('myshopify.com')) return 'Shopify Store';
  return hostname.replace('www.', '').split('.')[0];
}

// ─── EXTRACTION HELPERS ──────────────────────────────

/**
 * Extract data from JSON-LD structured data (schema.org/Product)
 */
function extractFromJsonLd(html: string): Partial<PriceResult> | null {
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(jsonLdRegex)];

  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);

      // Handle @graph arrays
      const items = data['@graph'] || [data];
      for (const item of items) {
        if (item['@type'] === 'Product') {
          const offer = item.offers;
          const aggregateRating = item.aggregateRating;

          let price: number | null = null;
          let currency = 'USD';
          let originalPrice: number | null = null;
          let stockStatus: PriceResult['stockStatus'] = 'unknown';

          if (offer) {
            const off = Array.isArray(offer) ? offer[0] : offer;
            if (off.price) {
              price = parseFloat(off.price);
              currency = off.priceCurrency || 'USD';
            }
            // Check for high/low price
            if (!price && off.highPrice) {
              price = parseFloat(off.highPrice);
            }
            if (off.price && off.highPrice && parseFloat(off.price) < parseFloat(off.highPrice)) {
              price = parseFloat(off.price);
              originalPrice = parseFloat(off.highPrice);
            }

            const availability = off.availability || '';
            if (availability.includes('InStock') || availability.includes('instock')) {
              stockStatus = 'in_stock';
            } else if (availability.includes('OutOfStock') || availability.includes('soldout')) {
              stockStatus = 'out_of_stock';
            } else if (availability.includes('LimitedAvailability')) {
              stockStatus = 'limited';
            }
          }

          let rating: number | null = null;
          let reviewCount: number | null = null;
          if (aggregateRating) {
            if (aggregateRating.ratingValue) rating = parseFloat(aggregateRating.ratingValue);
            if (aggregateRating.reviewCount) reviewCount = parseInt(aggregateRating.reviewCount);
          }

          return {
            name: item.name || '',
            price,
            currency,
            originalPrice,
            stockStatus,
            image: item.image || null,
            brand: item.brand?.name || item.brand || null,
            rating,
            reviewCount,
          };
        }
      }
    } catch {
      // Skip invalid JSON-LD
    }
  }
  return null;
}

// ─── PRICE EXTRACTION ───────────────────────────────

/**
 * Extract price from HTML using common patterns
 */
function extractPriceFromHtml(html: string): { price: number | null; originalPrice: number | null; currency: string } {
  // Currency symbols to look for
  const pricePatterns = [
    // $XX.XX format
    /(?:price|cost|now|total)[\s:]*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/i,
    // $XX.XX near "price" element
    /(?:data-price|itemprop="price"|class="[^"]*price[^"]*")[^>]*>\s*(?:[$€£¥])?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/i,
    // Generic currency amount
    /(?:[$€£¥])\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g,
  ];

  let price: number | null = null;
  let originalPrice: number | null = null;

  // Try data attributes first (most reliable)
  const dataPriceMatch = html.match(/data-price(?:-amount)?=["'](\d+\.?\d*)["']/i);
  if (dataPriceMatch) {
    price = parseFloat(dataPriceMatch[1]);
  }

  // Try meta tags
  const metaPrice = html.match(/<meta[^>]+property="product:price:amount"[^>]+content="(\d+\.?\d*)"[^>]*>/i);
  if (metaPrice && !price) {
    price = parseFloat(metaPrice[1]);
  }

  // If no data attribute, try regex patterns
  if (!price) {
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(new RegExp(pattern.source, 'gi'))];
      for (const m of matches) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (val > 0.01 && val < 1000000) {
          price = val;
          break;
        }
      }
      if (price) break;
    }
  }

  // Try to find original/strikethrough price
  const strikethroughMatch = html.match(/(?:was|list|reg|original|rrp|msrp)[\s:]*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/i);
  const salePrice = html.match(/<s[^>]*>\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/i);
  if (strikethroughMatch) originalPrice = parseFloat(strikethroughMatch[1].replace(/,/g, ''));
  else if (salePrice && price) {
    const sp = parseFloat(salePrice[1].replace(/,/g, ''));
    if (sp > price) originalPrice = sp;
  }

  // Detect currency
  let currency = 'USD';
  if (html.includes('€') || html.includes('&euro;')) currency = 'EUR';
  else if (html.includes('£') || html.includes('&pound;')) currency = 'GBP';
  else if (html.includes('¥') || html.includes('&yen;')) currency = 'JPY';
  else if (html.includes('₹')) currency = 'INR';

  return { price, originalPrice, currency };
}

/**
 * Extract stock status from HTML
 */
function extractStockStatus(html: string): PriceResult['stockStatus'] {
  const lower = html.toLowerCase();

  const outPatterns = [
    /out of stock/i, /sold out/i, /currently unavailable/i,
    /no longer available/i, /temporarily out/i,
  ];
  for (const p of outPatterns) {
    if (p.test(lower)) return 'out_of_stock';
  }

  const limitedPatterns = [
    /only \d+ left/i, /low stock/i, /hurry/i,
    /almost gone/i, /selling fast/i,
  ];
  for (const p of limitedPatterns) {
    if (p.test(lower)) return 'limited';
  }

  const inStockPatterns = [
    /in stock/i, /add to cart/i, /add to basket/i,
    /buy now/i, /available/i, /ships/i,
  ];
  for (const p of inStockPatterns) {
    if (p.test(lower)) return 'in_stock';
  }

  return 'unknown';
}

/**
 * Extract product title from HTML
 */
function extractTitle(html: string, url: string): string {
  // Try meta og:title
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"[^>]*>/i);
  if (ogTitle && ogTitle[1].trim()) return decodeHtmlEntities(ogTitle[1].trim());

  // Try <title> tag
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    let t = titleTag[1]
      .replace(/\s+/g, ' ')
      .replace(/\s*[-–|]\s*(?:Amazon|eBay|Walmart|Etsy|Target|AliExpress|Shop).*$/, '')
      .trim();
    if (t.length > 5) return decodeHtmlEntities(t);
  }

  // Try h1
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const t = h1Match[1].replace(/<[^>]+>/g, '').trim();
    if (t.length > 3) return decodeHtmlEntities(t);
  }

  // Fallback: use URL
  const pathParts = new URL(url).pathname.split('/').filter(Boolean);
  return pathParts[pathParts.length - 1]?.replace(/[-_]/g, ' ') || 'Unknown Product';
}

// ─── MAIN SCRAPER ────────────────────────────────────

/**
 * Scrape a single product page for price and stock info
 */
export async function scrapeProductPrice(url: string): Promise<PriceResult> {
  const store = detectStore(url);
  const checkedAt = new Date().toISOString();

  const response = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 30_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Product page returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (html.length < 500) {
    throw new Error('Page returned minimal content — possibly blocked or JavaScript-rendered');
  }

  // Try JSON-LD first (most reliable)
  const jsonLd = extractFromJsonLd(html);

  // HTML fallback extraction
  const { price, originalPrice, currency } = extractPriceFromHtml(html);
  const stockStatus = extractStockStatus(html);
  const title = jsonLd?.name || extractTitle(html, url);

  const image = jsonLd?.image ||
    (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"[^>]*>/i) || [])[1] ||
    null;

  const brand = jsonLd?.brand || null;
  const rating = jsonLd?.rating || null;
  const reviewCount = jsonLd?.reviewCount || null;

  const finalPrice = jsonLd?.price ?? price;
  const finalOriginalPrice = jsonLd?.originalPrice ?? originalPrice;

  return {
    name: title,
    price: finalPrice,
    currency: jsonLd?.currency || currency,
    originalPrice: finalOriginalPrice,
    stockStatus: jsonLd?.stockStatus !== 'unknown' ? jsonLd!.stockStatus! : stockStatus,
    image,
    url,
    store,
    brand,
    rating,
    reviewCount,
    checkedAt,
    onSale: finalOriginalPrice !== null && finalPrice !== null && finalOriginalPrice > finalPrice,
  };
}

/**
 * Scrape multiple products from a list of URLs
 */
export async function monitorPrices(urls: string[]): Promise<PriceMonitorResponse> {
  const results = await Promise.allSettled(
    urls.map(url => scrapeProductPrice(url))
  );

  const successful: PriceResult[] = [];
  const failed: string[] = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      successful.push(r.value);
    } else {
      failed.push(urls[i]);
    }
  });

  return {
    query: urls.join(', '),
    results: successful,
    totalFound: successful.length,
  };
}
