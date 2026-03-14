/**
 * Amazon Product & BSR Tracker Scraper (Bounty #72)
 * ──────────────────────────────────────────────────
 * Scrapes Amazon product listings, Best Sellers Rank (BSR),
 * pricing data, and review sentiment via mobile proxy.
 *
 * Endpoints:
 *   - Product search by keyword
 *   - BSR tracking per ASIN
 *   - Price history / comparison
 *   - Review sentiment analysis
 */

import { proxyFetch } from '../proxy';
import { scoreSentiment, aggregateSentiment } from '../analysis/sentiment';

// ─── TYPES ──────────────────────────────────────────

export interface AmazonProduct {
  asin: string;
  title: string;
  url: string;
  price: number | null;
  currency: string;
  original_price: number | null;
  rating: number | null;
  reviews_count: number | null;
  image: string | null;
  is_prime: boolean;
  is_sponsored: boolean;
  seller: string | null;
  badge: string | null;
}

export interface AmazonSearchResult {
  query: string;
  page: number;
  total_results: number;
  products: AmazonProduct[];
}

export interface BSREntry {
  category: string;
  rank: number;
}

export interface BSRData {
  asin: string;
  title: string;
  url: string;
  bsr: BSREntry[];
  main_category: string | null;
  main_rank: number | null;
  price: number | null;
  currency: string;
  rating: number | null;
  reviews_count: number | null;
  availability: string | null;
  tracked_at: string;
}

export interface PricePoint {
  source: string;
  price: number | null;
  currency: string;
  condition: string;
  seller: string | null;
  is_prime: boolean;
  url: string;
}

export interface PriceComparison {
  asin: string;
  title: string;
  current_price: number | null;
  currency: string;
  original_price: number | null;
  discount_pct: number | null;
  buy_box_seller: string | null;
  offers: PricePoint[];
  price_range: { low: number | null; high: number | null };
  tracked_at: string;
}

export interface ReviewBreakdown {
  '5': number;
  '4': number;
  '3': number;
  '2': number;
  '1': number;
}

export interface ReviewSentimentResult {
  asin: string;
  title: string;
  rating: number | null;
  total_reviews: number | null;
  rating_breakdown: ReviewBreakdown;
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative';
    positive_pct: number;
    neutral_pct: number;
    negative_pct: number;
  };
  top_positive: string[];
  top_negative: string[];
  common_themes: string[];
  analyzed_reviews: number;
  tracked_at: string;
}

// ─── HELPERS ────────────────────────────────────────

const AMAZON_BASE = 'https://www.amazon.com';

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBetween(html: string, start: string, end: string): string | null {
  const i = html.indexOf(start);
  if (i === -1) return null;
  const j = html.indexOf(end, i + start.length);
  if (j === -1) return null;
  return html.slice(i + start.length, j).trim();
}

function extractAllBetween(html: string, start: string, end: string): string[] {
  const results: string[] = [];
  let pos = 0;
  while (pos < html.length) {
    const i = html.indexOf(start, pos);
    if (i === -1) break;
    const j = html.indexOf(end, i + start.length);
    if (j === -1) break;
    results.push(html.slice(i + start.length, j).trim());
    pos = j + end.length;
  }
  return results;
}

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function extractASIN(url: string): string | null {
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

async function fetchAmazonPage(path: string, domain: string = 'www.amazon.com'): Promise<string> {
  const url = `https://${domain}${path}`;
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Amazon returned ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

// ─── PRODUCT SEARCH ─────────────────────────────────

export async function searchProducts(
  keyword: string,
  page: number = 1,
  department: string = 'aps',
): Promise<AmazonSearchResult> {
  const encodedKeyword = encodeURIComponent(keyword);
  const path = `/s?k=${encodedKeyword}&i=${department}&page=${page}&ref=nb_sb_noss`;

  const html = await fetchAmazonPage(path);
  const products: AmazonProduct[] = [];

  // Extract search result items from data-component-type="s-search-result"
  const resultBlocks = html.split('data-asin="').slice(1);

  for (const block of resultBlocks) {
    const asinEnd = block.indexOf('"');
    if (asinEnd === -1) continue;
    const asin = block.slice(0, asinEnd).trim();
    if (!asin || asin.length !== 10) continue;

    // Extract product title
    const titleMatch = block.match(/class="a-size-[^"]*\s+a-color-base\s+a-text-normal"[^>]*>([^<]+)</);
    const altTitleMatch = block.match(/class="a-size-base-plus a-color-base a-text-normal"[^>]*>([^<]+)</);
    const h2Match = block.match(/<h2[^>]*>.*?<span[^>]*>([^<]+)<\/span>/s);
    const title = cleanText(
      titleMatch?.[1] || altTitleMatch?.[1] || h2Match?.[1] || '',
    );
    if (!title) continue;

    // Extract price
    const priceWhole = extractBetween(block, 'class="a-price-whole">', '<');
    const priceFraction = extractBetween(block, 'class="a-price-fraction">', '<');
    let price: number | null = null;
    if (priceWhole) {
      const whole = priceWhole.replace(/[,.\s]/g, '');
      const fraction = priceFraction?.replace(/\D/g, '') || '00';
      price = parseFloat(`${whole}.${fraction}`);
    }

    // Original price (strikethrough)
    const origPriceText = extractBetween(block, 'class="a-price a-text-price"', '</span>');
    const originalPrice = origPriceText ? parsePrice(origPriceText) : null;

    // Rating
    const ratingMatch = block.match(/class="a-icon-alt">(\d+\.?\d*)\s+out\s+of\s+5/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Review count
    const reviewMatch = block.match(/aria-label="([\d,]+)\s+rating/i) ||
                        block.match(/"a-size-base\s+s-underline-text">([^<]+)</);
    let reviewsCount: number | null = null;
    if (reviewMatch) {
      reviewsCount = parseInt(reviewMatch[1].replace(/[,\s]/g, ''));
    }

    // Image
    const imgMatch = block.match(/class="s-image"[^>]*src="([^"]+)"/);
    const image = imgMatch ? imgMatch[1] : null;

    // Prime
    const isPrime = block.includes('a-icon-prime') || block.includes('aria-label="Amazon Prime"');

    // Sponsored
    const isSponsored = block.includes('Sponsored') || block.includes('AdHolder');

    // Seller
    const sellerMatch = block.match(/class="a-size-small\s+a-color-secondary">by\s+([^<]+)/i);
    const seller = sellerMatch ? cleanText(sellerMatch[1]) : null;

    // Badge (Best Seller, Amazon's Choice, etc.)
    const badgeMatch = block.match(/class="a-badge-text"[^>]*>([^<]+)/);
    const badge = badgeMatch ? cleanText(badgeMatch[1]) : null;

    products.push({
      asin,
      title,
      url: `${AMAZON_BASE}/dp/${asin}`,
      price,
      currency: 'USD',
      original_price: originalPrice,
      rating,
      reviews_count: reviewsCount,
      image,
      is_prime: isPrime,
      is_sponsored: isSponsored,
      seller,
      badge,
    });
  }

  // Extract total result count
  const totalMatch = html.match(/(\d[\d,]*)\s+results?\s+for/i) ||
                     html.match(/"resultCount":"(\d+)"/);
  const totalResults = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : products.length;

  return {
    query: keyword,
    page,
    total_results: totalResults,
    products,
  };
}

// ─── BSR TRACKING ───────────────────────────────────

export async function trackBSR(asin: string): Promise<BSRData> {
  const path = `/dp/${asin}`;
  const html = await fetchAmazonPage(path);

  // Extract title
  const titleRaw = extractBetween(html, 'id="productTitle"', '</span>') ||
                   extractBetween(html, 'id="title"', '</span>');
  const title = cleanText(titleRaw?.replace(/^[^>]*>/, '') || asin);

  // Extract BSR entries
  const bsrEntries: BSREntry[] = [];
  let mainCategory: string | null = null;
  let mainRank: number | null = null;

  // Pattern 1: Best Sellers Rank table/list
  const bsrSection = extractBetween(html, 'Best Sellers Rank', '</table>') ||
                     extractBetween(html, 'Best Sellers Rank', '</ul>') ||
                     extractBetween(html, 'salesRank', '</div>');

  if (bsrSection) {
    // Match patterns like "#1,234 in Category Name"
    const rankPattern = /#([\d,]+)\s+in\s+([^<(]+)/g;
    let match: RegExpExecArray | null;
    while ((match = rankPattern.exec(bsrSection)) !== null) {
      const rank = parseInt(match[1].replace(/,/g, ''));
      const category = cleanText(match[2]);
      if (category && rank > 0) {
        bsrEntries.push({ category, rank });
        if (!mainRank || rank < mainRank) {
          mainRank = rank;
          mainCategory = category;
        }
      }
    }
  }

  // Pattern 2: Detail page metadata (JSON-LD or inline)
  if (bsrEntries.length === 0) {
    const rankDetailMatch = html.match(/Best\s+Sellers\s+Rank:?\s*#?([\d,]+)\s+in\s+([^<\n(]+)/i);
    if (rankDetailMatch) {
      const rank = parseInt(rankDetailMatch[1].replace(/,/g, ''));
      const category = cleanText(rankDetailMatch[2]);
      if (rank > 0) {
        bsrEntries.push({ category, rank });
        mainRank = rank;
        mainCategory = category;
      }
    }
  }

  // Extract price
  const priceText = extractBetween(html, 'class="a-price-whole">', '<') ||
                    extractBetween(html, 'priceAmount":', ',') ||
                    extractBetween(html, '"price":"', '"');
  const price = parsePrice(priceText);

  // Extract rating
  const ratingMatch = html.match(/(\d+\.?\d*)\s+out\s+of\s+5\s+stars?/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  // Review count
  const reviewMatch = html.match(/(\d[\d,]*)\s+(?:global\s+)?ratings?/i) ||
                      html.match(/id="acrCustomerReviewText"[^>]*>([^<]+)/);
  let reviewsCount: number | null = null;
  if (reviewMatch) {
    reviewsCount = parseInt(reviewMatch[1].replace(/[,\s]/g, ''));
  }

  // Availability
  const availabilityRaw = extractBetween(html, 'id="availability"', '</div>');
  const availability = availabilityRaw ? cleanText(availabilityRaw.replace(/<[^>]+>/g, '')) : null;

  return {
    asin,
    title,
    url: `${AMAZON_BASE}/dp/${asin}`,
    bsr: bsrEntries,
    main_category: mainCategory,
    main_rank: mainRank,
    price,
    currency: 'USD',
    rating,
    reviews_count: reviewsCount,
    availability,
    tracked_at: new Date().toISOString(),
  };
}

// ─── PRICE HISTORY / COMPARISON ─────────────────────

export async function comparePrices(asin: string): Promise<PriceComparison> {
  const path = `/dp/${asin}`;
  const html = await fetchAmazonPage(path);

  // Extract title
  const titleRaw = extractBetween(html, 'id="productTitle"', '</span>') ||
                   extractBetween(html, 'id="title"', '</span>');
  const title = cleanText(titleRaw?.replace(/^[^>]*>/, '') || asin);

  // Current price
  const priceWhole = extractBetween(html, 'class="a-price-whole">', '<');
  const priceFraction = extractBetween(html, 'class="a-price-fraction">', '<');
  let currentPrice: number | null = null;
  if (priceWhole) {
    const whole = priceWhole.replace(/[,.\s]/g, '');
    const fraction = priceFraction?.replace(/\D/g, '') || '00';
    currentPrice = parseFloat(`${whole}.${fraction}`);
  }

  // Original / list price
  const listPriceText = extractBetween(html, 'class="a-text-price"', '</span>');
  const originalPrice = listPriceText ? parsePrice(listPriceText) : null;

  // Discount percentage
  let discountPct: number | null = null;
  if (currentPrice && originalPrice && originalPrice > currentPrice) {
    discountPct = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }
  const savingsMatch = html.match(/Save\s+(\d+)%/i);
  if (!discountPct && savingsMatch) {
    discountPct = parseInt(savingsMatch[1]);
  }

  // Buy box seller
  const sellerMatch = html.match(/id="sellerProfileTriggerId"[^>]*>([^<]+)/) ||
                      html.match(/Sold by[^<]*<[^>]*>([^<]+)/) ||
                      html.match(/Ships from and sold by\s+([^<.]+)/);
  const buyBoxSeller = sellerMatch ? cleanText(sellerMatch[1]) : null;

  // Collect all visible offers/prices
  const offers: PricePoint[] = [];

  // Main buy box offer
  if (currentPrice !== null) {
    offers.push({
      source: 'Buy Box',
      price: currentPrice,
      currency: 'USD',
      condition: 'New',
      seller: buyBoxSeller || 'Amazon.com',
      is_prime: html.includes('a-icon-prime'),
      url: `${AMAZON_BASE}/dp/${asin}`,
    });
  }

  // Other sellers / "New & Used" offers
  const offerBlocks = extractAllBetween(html, 'class="a-section a-padding-none"', '</div>');
  for (const ob of offerBlocks) {
    const offerPrice = parsePrice(ob);
    if (offerPrice && offerPrice !== currentPrice) {
      const condMatch = ob.match(/(New|Used|Renewed|Refurbished|Collectible)/i);
      const offerSeller = extractBetween(ob, 'Sold by', '<') || extractBetween(ob, 'seller">', '<');
      offers.push({
        source: 'Other Offer',
        price: offerPrice,
        currency: 'USD',
        condition: condMatch ? condMatch[1] : 'New',
        seller: offerSeller ? cleanText(offerSeller) : null,
        is_prime: ob.includes('a-icon-prime'),
        url: `${AMAZON_BASE}/dp/${asin}?th=1`,
      });
    }
  }

  // New & Used count link pricing
  const otherNewMatch = html.match(/(\d+)\s+New\s+from\s+\$([\d,.]+)/i);
  if (otherNewMatch) {
    offers.push({
      source: 'Other New',
      price: parseFloat(otherNewMatch[2].replace(/,/g, '')),
      currency: 'USD',
      condition: 'New',
      seller: `${otherNewMatch[1]} sellers`,
      is_prime: false,
      url: `${AMAZON_BASE}/gp/offer-listing/${asin}?condition=new`,
    });
  }

  const otherUsedMatch = html.match(/(\d+)\s+Used\s+from\s+\$([\d,.]+)/i);
  if (otherUsedMatch) {
    offers.push({
      source: 'Used',
      price: parseFloat(otherUsedMatch[2].replace(/,/g, '')),
      currency: 'USD',
      condition: 'Used',
      seller: `${otherUsedMatch[1]} sellers`,
      is_prime: false,
      url: `${AMAZON_BASE}/gp/offer-listing/${asin}?condition=used`,
    });
  }

  // Price range across all offers
  const allPrices = offers.map(o => o.price).filter((p): p is number => p !== null);
  const priceRange = {
    low: allPrices.length > 0 ? Math.min(...allPrices) : null,
    high: allPrices.length > 0 ? Math.max(...allPrices) : null,
  };

  return {
    asin,
    title,
    current_price: currentPrice,
    currency: 'USD',
    original_price: originalPrice,
    discount_pct: discountPct,
    buy_box_seller: buyBoxSeller,
    offers,
    price_range: priceRange,
    tracked_at: new Date().toISOString(),
  };
}

// ─── REVIEW SENTIMENT ANALYSIS ──────────────────────

export async function analyzeReviewSentiment(asin: string): Promise<ReviewSentimentResult> {
  // Fetch the product page for basic info
  const productPath = `/dp/${asin}`;
  const productHtml = await fetchAmazonPage(productPath);

  const titleRaw = extractBetween(productHtml, 'id="productTitle"', '</span>') ||
                   extractBetween(productHtml, 'id="title"', '</span>');
  const title = cleanText(titleRaw?.replace(/^[^>]*>/, '') || asin);

  const ratingMatch = productHtml.match(/(\d+\.?\d*)\s+out\s+of\s+5\s+stars?/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  const reviewCountMatch = productHtml.match(/(\d[\d,]*)\s+(?:global\s+)?ratings?/i);
  const totalReviews = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : null;

  // Extract rating breakdown
  const breakdown: ReviewBreakdown = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
  for (const star of ['5', '4', '3', '2', '1'] as const) {
    const pctMatch = productHtml.match(new RegExp(`${star}\\s+star[^\\d]*(\\d+)%`, 'i'));
    if (pctMatch) {
      breakdown[star] = parseInt(pctMatch[1]);
    }
  }

  // Fetch reviews page
  const reviewPath = `/product-reviews/${asin}?sortBy=recent&pageNumber=1`;
  let reviewHtml: string;
  try {
    reviewHtml = await fetchAmazonPage(reviewPath);
  } catch {
    reviewHtml = '';
  }

  // Extract individual review texts
  const reviewTexts: string[] = [];
  const reviewBlocks = reviewHtml.split('review-text-content').slice(1);
  for (const rb of reviewBlocks) {
    const text = extractBetween(rb, '<span>', '</span>');
    if (text) {
      const cleaned = cleanText(text);
      if (cleaned.length > 10) {
        reviewTexts.push(cleaned);
      }
    }
  }

  // Also try extracting from data-hook pattern
  if (reviewTexts.length === 0) {
    const altBlocks = reviewHtml.split('data-hook="review-body"').slice(1);
    for (const ab of altBlocks) {
      const text = extractBetween(ab, '<span>', '</span>');
      if (text) {
        const cleaned = cleanText(text);
        if (cleaned.length > 10) {
          reviewTexts.push(cleaned);
        }
      }
    }
  }

  // Analyze sentiment
  const sentiment = aggregateSentiment(reviewTexts);

  // Extract top positive/negative snippets
  const topPositive: string[] = [];
  const topNegative: string[] = [];

  for (const text of reviewTexts.slice(0, 50)) {
    const score = scoreSentiment(text);
    if (score.overall === 'positive' && topPositive.length < 3) {
      topPositive.push(text.slice(0, 200));
    } else if (score.overall === 'negative' && topNegative.length < 3) {
      topNegative.push(text.slice(0, 200));
    }
  }

  // Extract common themes (frequently mentioned nouns/phrases)
  const themes = extractCommonThemes(reviewTexts);

  return {
    asin,
    title,
    rating,
    total_reviews: totalReviews,
    rating_breakdown: breakdown,
    sentiment: {
      overall: sentiment.overall,
      positive_pct: sentiment.positive,
      neutral_pct: sentiment.neutral,
      negative_pct: sentiment.negative,
    },
    top_positive: topPositive,
    top_negative: topNegative,
    common_themes: themes,
    analyzed_reviews: reviewTexts.length,
    tracked_at: new Date().toISOString(),
  };
}

// ─── THEME EXTRACTION ───────────────────────────────

function extractCommonThemes(texts: string[]): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'is', 'it', 'this', 'that', 'was', 'are', 'be',
    'has', 'had', 'have', 'been', 'will', 'would', 'could', 'should',
    'may', 'can', 'do', 'does', 'did', 'not', 'no', 'just', 'very',
    'so', 'than', 'too', 'its', 'my', 'your', 'i', 'me', 'we', 'they',
    'them', 'you', 'he', 'she', 'his', 'her', 'our', 'their', 'what',
    'which', 'who', 'when', 'where', 'how', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only',
    'own', 'same', 'as', 'from', 'if', 'about', 'up', 'out', 'one',
    'two', 'get', 'got', 'like', 'much', 'also', 'back', 'after',
    'use', 'used', 'using', 'because', 'any', 'these', 'those',
    'then', 'there', 'here', 'over', 'well', 'even', 'really',
    'still', 'way', 'into', 'thing', 'things', 'being', 'been',
    'made', 'make', 'makes', 'product', 'item', 'bought', 'buy',
  ]);

  const wordFreq = new Map<string, number>();
  const bigramFreq = new Map<string, number>();

  for (const text of texts.slice(0, 100)) {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    const seen = new Set<string>();
    for (const word of words) {
      if (!seen.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        seen.add(word);
      }
    }

    // Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (!seen.has(bigram)) {
        bigramFreq.set(bigram, (bigramFreq.get(bigram) || 0) + 1);
        seen.add(bigram);
      }
    }
  }

  // Combine single words and bigrams, sort by frequency
  const combined: [string, number][] = [
    ...Array.from(wordFreq.entries()).filter(([_, count]) => count >= 3),
    ...Array.from(bigramFreq.entries()).filter(([_, count]) => count >= 2),
  ];

  combined.sort((a, b) => b[1] - a[1]);

  return combined.slice(0, 10).map(([theme]) => theme);
}
