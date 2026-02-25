import { proxyFetch } from '../proxy';

// ─── Amazon Product & BSR Tracker Scraper ───

interface AmazonProduct {
  asin: string;
  title: string;
  price: { current: number; currency: string; was: number | null; discount_pct: number | null };
  bsr: { rank: number | null; category: string; sub_category_ranks: Array<{ category: string; rank: number }> };
  rating: number;
  reviews_count: number;
  buy_box: { seller: string; is_amazon: boolean; fulfilled_by: string };
  availability: string;
  brand: string;
  images: string[];
  url: string;
}

interface AmazonSearchResult {
  asin: string;
  title: string;
  price: number;
  rating: number;
  reviews_count: number;
  image: string;
  url: string;
  sponsored: boolean;
}

interface AmazonReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  date: string;
  verified: boolean;
  helpful_votes: number;
}

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  IT: 'www.amazon.it',
  CA: 'www.amazon.ca',
  JP: 'www.amazon.co.jp',
  AU: 'www.amazon.com.au',
  IN: 'www.amazon.in'
};

const AMAZON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
};

function getDomain(marketplace: string): string {
  return MARKETPLACE_DOMAINS[marketplace.toUpperCase()] || MARKETPLACE_DOMAINS.US;
}

function extractText(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  return m ? m[1].trim().replace(/<[^>]+>/g, '').trim() : '';
}

function extractNum(html: string, pattern: RegExp): number {
  const text = extractText(html, pattern);
  return parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
}

export async function getAmazonProduct(asin: string, marketplace: string = 'US'): Promise<AmazonProduct | null> {
  const domain = getDomain(marketplace);
  const url = `https://${domain}/dp/${asin}`;
  const resp = await proxyFetch(url, { headers: { ...AMAZON_HEADERS, 'Accept-Language': marketplace === 'DE' ? 'de-DE,de;q=0.9' : marketplace === 'FR' ? 'fr-FR,fr;q=0.9' : 'en-US,en;q=0.9' } });
  const html = await resp.text();

  if (!html || html.includes('captcha') || html.length < 5000) return null;

  const title = extractText(html, /id="productTitle"[^>]*>([^<]+)/) || extractText(html, /<title>([^<]+)/);

  // Price extraction
  const priceWhole = extractText(html, /class="a-price-whole"[^>]*>([^<]+)/);
  const priceFraction = extractText(html, /class="a-price-fraction"[^>]*>([^<]+)/);
  const currentPrice = parseFloat(`${priceWhole}${priceFraction}`.replace(/[^0-9.]/g, '')) || 0;
  const wasPrice = extractNum(html, /class="a-text-price"[^>]*><span[^>]*>([^<]+)/);
  const discountPct = wasPrice > 0 ? Math.round((1 - currentPrice / wasPrice) * 100) : null;
  const currency = marketplace === 'US' ? 'USD' : marketplace === 'UK' ? 'GBP' : marketplace === 'DE' ? 'EUR' : 'USD';

  // BSR extraction
  let bsrRank: number | null = null;
  let bsrCategory = '';
  const subRanks: Array<{ category: string; rank: number }> = [];
  const bsrMatch = html.match(/Best Sellers Rank.*?#([\d,]+).*?(?:in\s+)?([^<(]+)/s);
  if (bsrMatch) {
    bsrRank = parseInt(bsrMatch[1].replace(/,/g, ''));
    bsrCategory = bsrMatch[2].trim();
  }
  const subRankMatches = html.matchAll(/#([\d,]+)\s+in\s+([^<(]+)/g);
  let skipFirst = true;
  for (const m of subRankMatches) {
    if (skipFirst) { skipFirst = false; continue; }
    if (subRanks.length < 5) subRanks.push({ category: m[2].trim(), rank: parseInt(m[1].replace(/,/g, '')) });
  }

  // Rating + reviews
  const rating = extractNum(html, /class="a-icon-alt"[^>]*>([\d.]+) out of/);
  const reviewsCount = extractNum(html, /id="acrCustomerReviewText"[^>]*>([\d,]+)/);

  // Buy box
  const seller = extractText(html, /id="sellerProfileTriggerId"[^>]*>([^<]+)/) || extractText(html, /Sold by[^<]*<[^>]*>([^<]+)/) || 'Amazon';
  const isAmazon = seller.toLowerCase().includes('amazon');
  const fulfilledBy = html.includes('Fulfilled by Amazon') || html.includes('Ships from Amazon') ? 'Amazon' : seller;

  // Availability
  const availability = extractText(html, /id="availability"[^>]*>\s*<span[^>]*>([^<]+)/) || 'Unknown';

  // Brand
  const brand = extractText(html, /id="bylineInfo"[^>]*>([^<]+)/) || extractText(html, /"brand"\s*:\s*"([^"]+)/);

  // Images
  const images: string[] = [];
  const imgMatches = html.matchAll(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
  for (const m of imgMatches) { if (images.length < 5) images.push(m[1]); }
  if (images.length === 0) {
    const mainImg = html.match(/id="landingImage"[^>]*src="([^"]+)"/);
    if (mainImg) images.push(mainImg[1]);
  }

  return {
    asin, title: title.replace(/Amazon\.com\s*:\s*/, '').trim(),
    price: { current: currentPrice, currency, was: wasPrice || null, discount_pct: discountPct },
    bsr: { rank: bsrRank, category: bsrCategory, sub_category_ranks: subRanks },
    rating, reviews_count: reviewsCount,
    buy_box: { seller: seller.replace(/Visit the |Brand: /g, ''), is_amazon: isAmazon, fulfilled_by: fulfilledBy },
    availability: availability.trim(), brand: brand.replace(/Visit the |Brand: /g, '').trim(),
    images, url
  };
}

export async function searchAmazon(query: string, marketplace: string = 'US', category?: string): Promise<AmazonSearchResult[]> {
  const domain = getDomain(marketplace);
  let searchUrl = `https://${domain}/s?k=${encodeURIComponent(query)}`;
  if (category) searchUrl += `&i=${encodeURIComponent(category)}`;

  const resp = await proxyFetch(searchUrl, { headers: AMAZON_HEADERS });
  const html = await resp.text();
  const results: AmazonSearchResult[] = [];

  // Parse search result cards
  const cardMatches = html.matchAll(/data-asin="([A-Z0-9]{10})"(.*?)(?=data-asin="|$)/gs);
  for (const card of cardMatches) {
    if (results.length >= 20) break;
    const [, asin, cardHtml] = card;
    if (!asin || asin === 'undefined') continue;

    const cardTitle = extractText(cardHtml, /class="a-size-[^"]*a-color-base a-text-normal"[^>]*>([^<]+)/) || extractText(cardHtml, /class="a-text-normal"[^>]*>\s*<span[^>]*>([^<]+)/);
    if (!cardTitle) continue;

    const priceW = extractText(cardHtml, /class="a-price-whole">([^<]+)/);
    const priceF = extractText(cardHtml, /class="a-price-fraction">([^<]+)/);
    const price = parseFloat(`${priceW}${priceF}`.replace(/[^0-9.]/g, '')) || 0;
    const cardRating = extractNum(cardHtml, /class="a-icon-alt">([\d.]+) out of/);
    const cardReviews = extractNum(cardHtml, /aria-label="[\d,]+"[^>]*>([\d,]+)/);
    const image = cardHtml.match(/src="(https:\/\/m\.media-amazon\.com[^"]+)"/) || cardHtml.match(/src="(https:\/\/images-[^"]+)"/);
    const sponsored = cardHtml.includes('Sponsored') || cardHtml.includes('AdHolder');

    results.push({
      asin, title: cardTitle, price, rating: cardRating, reviews_count: cardReviews,
      image: image ? image[1] : '', url: `https://${domain}/dp/${asin}`, sponsored
    });
  }

  return results;
}

export async function getAmazonBestsellers(category: string = 'electronics', marketplace: string = 'US'): Promise<AmazonSearchResult[]> {
  const domain = getDomain(marketplace);
  const url = `https://${domain}/gp/bestsellers/${category}`;
  const resp = await proxyFetch(url, { headers: AMAZON_HEADERS });
  const html = await resp.text();
  const results: AmazonSearchResult[] = [];

  const itemMatches = html.matchAll(/data-asin="([A-Z0-9]{10})"(.*?)(?=data-asin="|class="zg-grid-general-faceout"|$)/gs);
  for (const item of itemMatches) {
    if (results.length >= 20) break;
    const [, asin, itemHtml] = item;
    if (!asin) continue;
    const itemTitle = extractText(itemHtml, /class="_cDEzb_p13n-sc-css-line-clamp-[^"]*"[^>]*>([^<]+)/) || extractText(itemHtml, /class="a-link-normal"[^>]*title="([^"]+)/);
    if (!itemTitle) continue;
    const price = extractNum(itemHtml, /class="a-price"[^>]*>.*?class="a-offscreen">([^<]+)/s);
    const cardRating = extractNum(itemHtml, /class="a-icon-alt">([\d.]+)/);
    const reviews = extractNum(itemHtml, /class="a-size-small">([\d,]+)/);
    const image = itemHtml.match(/src="(https:\/\/[^"]+\.jpg[^"]*)"/);
    results.push({ asin, title: itemTitle, price, rating: cardRating, reviews_count: reviews, image: image ? image[1] : '', url: `https://${domain}/dp/${asin}`, sponsored: false });
  }

  return results;
}

export async function getAmazonReviews(asin: string, marketplace: string = 'US', sort: string = 'recent', limit: number = 10): Promise<AmazonReview[]> {
  const domain = getDomain(marketplace);
  const sortParam = sort === 'helpful' ? 'helpful' : 'recent';
  const url = `https://${domain}/product-reviews/${asin}?sortBy=${sortParam}&pageNumber=1`;
  const resp = await proxyFetch(url, { headers: AMAZON_HEADERS });
  const html = await resp.text();
  const reviews: AmazonReview[] = [];

  const reviewBlocks = html.split(/id="customer_review-/);
  for (let i = 1; i < reviewBlocks.length && reviews.length < limit; i++) {
    const block = reviewBlocks[i];
    const id = block.match(/^([A-Z0-9]+)/)?.[1] || `review-${i}`;
    const reviewRating = extractNum(block, /class="a-icon-alt">([\d.]+) out of/);
    const reviewTitle = extractText(block, /data-hook="review-title"[^>]*>(?:<[^>]+>)*([^<]+)/);
    const body = extractText(block, /data-hook="review-body"[^>]*>(?:<[^>]+>)*\s*([\s\S]*?)\s*<\/span>/);
    const author = extractText(block, /class="a-profile-name"[^>]*>([^<]+)/);
    const date = extractText(block, /data-hook="review-date"[^>]*>([^<]+)/);
    const verified = block.includes('Verified Purchase');
    const helpful = extractNum(block, /(\d+) (?:people|person) found this helpful/);

    reviews.push({ id, rating: reviewRating, title: reviewTitle, body: body.substring(0, 500), author, date, verified, helpful_votes: helpful });
  }

  return reviews;
}
