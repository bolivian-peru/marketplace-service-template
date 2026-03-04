import { proxyFetch } from '../proxy';

export type AmazonMarketplace = 'US' | 'UK' | 'DE';

interface MarketplaceConfig {
  code: AmazonMarketplace;
  domain: string;
  currency: string;
  country: string;
}

const MARKETPLACES: Record<AmazonMarketplace, MarketplaceConfig> = {
  US: { code: 'US', domain: 'www.amazon.com', currency: 'USD', country: 'US' },
  UK: { code: 'UK', domain: 'www.amazon.co.uk', currency: 'GBP', country: 'GB' },
  DE: { code: 'DE', domain: 'www.amazon.de', currency: 'EUR', country: 'DE' },
};

export interface AmazonProductData {
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
  };
  rating: number | null;
  reviews_count: number;
  buy_box: {
    seller: string | null;
    is_amazon: boolean;
    fulfilled_by: string | null;
  };
  availability: string | null;
  brand: string | null;
  images: string[];
}

export interface AmazonSearchItem {
  asin: string;
  title: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviews_count: number;
  url: string;
}

export interface AmazonReviewItem {
  id: string;
  title: string;
  rating: number | null;
  author: string | null;
  date: string | null;
  body: string;
}

export function normalizeMarketplace(input?: string | null): AmazonMarketplace {
  const value = (input || 'US').trim().toUpperCase();
  if (value === 'GB') return 'UK';
  if (value in MARKETPLACES) return value as AmazonMarketplace;
  throw new Error('Invalid marketplace. Supported: US, UK, DE');
}

function getMarketplaceConfig(marketplace: AmazonMarketplace): MarketplaceConfig {
  return MARKETPLACES[marketplace];
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(text: string): string {
  return decodeHtml(text.replace(/<[^>]+>/g, ' '));
}

function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/[^\d.,]/g, '').trim();
  if (!normalized) return null;

  // Handles both 1,299.99 and 1.299,99
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  let value = normalized;
  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      value = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      value = normalized.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    value = normalized.replace(',', '.');
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m?.[1]?.trim() || null;
}

function parseRating(text: string): number | null {
  const fromAria = firstMatch(text, /aria-label="([0-9]+(?:[.,][0-9]+)?)\s*(?:out of|von)?\s*5\s*stars?"/i);
  if (fromAria) return parseNumber(fromAria);

  const fromText = firstMatch(text, /([0-9]+(?:[.,][0-9]+)?)\s*(?:out of|von)?\s*5\s*stars?/i);
  return parseNumber(fromText);
}

function parseReviewsCount(text: string): number {
  const value = firstMatch(text, /id="acrCustomerReviewText"[^>]*>\s*([^<]+)\s*</i)
    || firstMatch(text, /([0-9][0-9.,]*)\s+ratings?/i)
    || firstMatch(text, /([0-9][0-9.,]*)\s+global ratings?/i);

  if (!value) return 0;
  const digitsOnly = value.replace(/[^\d]/g, '');
  if (!digitsOnly) return 0;
  const parsed = Number(digitsOnly);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePrice(html: string): { current: number | null; was: number | null; discount_pct: number | null } {
  const currentRaw =
    firstMatch(html, /class="a-offscreen">\s*([^<]+)\s*<\/span>/i)
    || firstMatch(html, /id="priceblock_ourprice"[^>]*>\s*([^<]+)\s*</i)
    || firstMatch(html, /id="priceblock_dealprice"[^>]*>\s*([^<]+)\s*</i);

  const wasRaw =
    firstMatch(html, /data-a-strike="true"[^>]*>\s*<span class="a-offscreen">\s*([^<]+)\s*<\/span>/i)
    || firstMatch(html, /List Price:\s*<span[^>]*>\s*([^<]+)\s*</i);

  const current = parseNumber(currentRaw);
  const was = parseNumber(wasRaw);
  let discount_pct: number | null = null;

  if (current && was && was > current) {
    discount_pct = Math.round(((was - current) / was) * 100);
  }

  return { current, was, discount_pct };
}

function parseBsr(html: string): { rank: number | null; category: string | null; sub_category_ranks: Array<{ category: string; rank: number }> } {
  const rankRaw = firstMatch(html, /Best Sellers Rank[^#]*#\s*([0-9][0-9,]*)/i)
    || firstMatch(html, /#\s*([0-9][0-9,]*)\s+in\s+/i);
  const category = firstMatch(html, /Best Sellers Rank[^#]*#\s*[0-9][0-9,]*\s+in\s+([^<(\n]+)/i)
    || firstMatch(html, /#\s*[0-9][0-9,]*\s+in\s+([^<(\n]+)/i);

  const sub_category_ranks: Array<{ category: string; rank: number }> = [];
  const subRegex = /#\s*([0-9][0-9,]*)\s+in\s+([^<(\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = subRegex.exec(html)) && sub_category_ranks.length < 3) {
    const r = parseNumber(m[1]);
    if (!r) continue;
    const cat = stripTags(m[2]);
    sub_category_ranks.push({ category: cat, rank: Math.floor(r) });
  }

  const rank = parseNumber(rankRaw || undefined);
  return {
    rank: rank ? Math.floor(rank) : null,
    category: category ? stripTags(category) : null,
    sub_category_ranks,
  };
}

function parseBuyBox(html: string): { seller: string | null; is_amazon: boolean; fulfilled_by: string | null } {
  const seller = firstMatch(html, /Sold by\s*<[^>]+>\s*([^<]+)\s*<\/a>/i)
    || firstMatch(html, /id="sellerProfileTriggerId"[^>]*>\s*([^<]+)\s*</i)
    || firstMatch(html, /Sold by\s*<span[^>]*>\s*([^<]+)\s*<\/span>/i);

  const fulfilledBy = firstMatch(html, /Ships from\s*<[^>]+>\s*([^<]+)\s*<\/span>/i)
    || firstMatch(html, /Fulfilled by\s*<[^>]+>\s*([^<]+)\s*<\/span>/i);

  const normSeller = seller ? stripTags(seller) : null;
  return {
    seller: normSeller,
    is_amazon: !!normSeller && /amazon/i.test(normSeller),
    fulfilled_by: fulfilledBy ? stripTags(fulfilledBy) : null,
  };
}

function parseImages(html: string): string[] {
  const dynamicRaw = firstMatch(html, /data-a-dynamic-image='([^']+)'/i)
    || firstMatch(html, /data-a-dynamic-image="([^"]+)"/i);

  if (!dynamicRaw) return [];

  try {
    const parsed = JSON.parse(dynamicRaw.replace(/&quot;/g, '"'));
    return Object.keys(parsed).slice(0, 8);
  } catch {
    return [];
  }
}

export async function fetchAmazonProduct(asin: string, marketplace: AmazonMarketplace): Promise<AmazonProductData> {
  const cfg = getMarketplaceConfig(marketplace);
  const url = `https://${cfg.domain}/dp/${encodeURIComponent(asin)}`;

  const res = await proxyFetch(url, { timeoutMs: 45_000, maxRetries: 2 });
  if (!res.ok) {
    throw new Error(`Amazon product request failed: ${res.status}`);
  }

  const html = await res.text();
  if (/captcha|validateCaptcha|robot check/i.test(html)) {
    throw new Error('Amazon anti-bot challenge encountered (CAPTCHA)');
  }

  const title = stripTags(
    firstMatch(html, /id="productTitle"[^>]*>\s*([\s\S]*?)\s*<\/span>/i)
      || firstMatch(html, /<title>\s*([\s\S]*?)\s*<\/title>/i)
      || 'Unknown product',
  );

  const availability = firstMatch(html, /id="availability"[^>]*>\s*<span[^>]*>\s*([\s\S]*?)\s*<\/span>/i);
  const brand = firstMatch(html, /Brand\s*<\/span>\s*<\/td>\s*<td[^>]*>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/i)
    || firstMatch(html, /id="bylineInfo"[^>]*>\s*([^<]+)\s*</i);

  const price = parsePrice(html);
  const bsr = parseBsr(html);
  const rating = parseRating(html);
  const reviews_count = parseReviewsCount(html);
  const buy_box = parseBuyBox(html);
  const images = parseImages(html);

  return {
    asin,
    title,
    price: {
      current: price.current,
      currency: cfg.currency,
      was: price.was,
      discount_pct: price.discount_pct,
    },
    bsr,
    rating,
    reviews_count,
    buy_box,
    availability: availability ? stripTags(availability) : null,
    brand: brand ? stripTags(brand) : null,
    images,
  };
}

export async function searchAmazonProducts(
  query: string,
  category: string | undefined,
  marketplace: AmazonMarketplace,
  limit = 20,
): Promise<AmazonSearchItem[]> {
  const cfg = getMarketplaceConfig(marketplace);
  const params = new URLSearchParams({ k: query });
  if (category) params.set('i', category);

  const url = `https://${cfg.domain}/s?${params.toString()}`;
  const res = await proxyFetch(url, { timeoutMs: 45_000, maxRetries: 2 });
  if (!res.ok) throw new Error(`Amazon search failed: ${res.status}`);

  const html = await res.text();
  if (/captcha|validateCaptcha|robot check/i.test(html)) {
    throw new Error('Amazon anti-bot challenge encountered (CAPTCHA)');
  }

  const out: AmazonSearchItem[] = [];
  const itemRegex = /<div[^>]+data-component-type="s-search-result"[^>]*data-asin="([A-Z0-9]{10})"[\s\S]*?<\/div>\s*<\/div>/gi;

  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(html)) && out.length < limit) {
    const block = m[0];
    const asin = m[1];

    const title = stripTags(
      firstMatch(block, /<h2[^>]*>\s*<a[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i)
        || firstMatch(block, /aria-label="([^"]+)"/i)
        || 'Unknown item',
    );

    const price = parseNumber(firstMatch(block, /class="a-offscreen">\s*([^<]+)\s*<\/span>/i));
    const rating = parseRating(block);
    const reviewsCount = Math.floor(parseNumber(firstMatch(block, /aria-label="([0-9.,]+)\s+ratings?/i) || undefined) || 0);

    out.push({
      asin,
      title,
      price,
      currency: cfg.currency,
      rating,
      reviews_count: reviewsCount,
      url: `https://${cfg.domain}/dp/${asin}`,
    });
  }

  return out;
}

export async function fetchAmazonBestsellers(
  category: string | undefined,
  marketplace: AmazonMarketplace,
  limit = 20,
): Promise<AmazonSearchItem[]> {
  const cfg = getMarketplaceConfig(marketplace);
  const slug = (category || '').trim().replace(/\s+/g, '-').toLowerCase();
  const path = slug ? `/gp/bestsellers/${encodeURIComponent(slug)}` : '/gp/bestsellers';

  const res = await proxyFetch(`https://${cfg.domain}${path}`, { timeoutMs: 45_000, maxRetries: 2 });
  if (!res.ok) throw new Error(`Amazon bestsellers failed: ${res.status}`);

  const html = await res.text();
  if (/captcha|validateCaptcha|robot check/i.test(html)) {
    throw new Error('Amazon anti-bot challenge encountered (CAPTCHA)');
  }

  const out: AmazonSearchItem[] = [];

  const rowRegex = /<div[^>]+zg-grid-general-faceout[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(html)) && out.length < limit) {
    const block = m[1];
    const asin = firstMatch(block, /\/dp\/([A-Z0-9]{10})/i) || '';
    if (!asin) continue;

    const title = stripTags(firstMatch(block, /alt="([^"]+)"/i) || 'Unknown item');
    const price = parseNumber(firstMatch(block, /class="p13n-sc-price"[^>]*>\s*([^<]+)\s*</i));
    const rating = parseRating(block);

    out.push({
      asin,
      title,
      price,
      currency: cfg.currency,
      rating,
      reviews_count: 0,
      url: `https://${cfg.domain}/dp/${asin}`,
    });
  }

  return out;
}

export async function fetchAmazonReviews(
  asin: string,
  sort: 'recent' | 'helpful',
  limit: number,
  marketplace: AmazonMarketplace,
): Promise<AmazonReviewItem[]> {
  const cfg = getMarketplaceConfig(marketplace);
  const sortBy = sort === 'helpful' ? 'helpful' : 'recent';
  const url = `https://${cfg.domain}/product-reviews/${encodeURIComponent(asin)}?sortBy=${sortBy}`;

  const res = await proxyFetch(url, { timeoutMs: 45_000, maxRetries: 2 });
  if (!res.ok) throw new Error(`Amazon reviews failed: ${res.status}`);

  const html = await res.text();
  if (/captcha|validateCaptcha|robot check/i.test(html)) {
    throw new Error('Amazon anti-bot challenge encountered (CAPTCHA)');
  }

  const out: AmazonReviewItem[] = [];
  const blockRegex = /<div[^>]+data-hook="review"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) && out.length < limit) {
    const id = m[1];
    const block = m[2];

    const title = stripTags(firstMatch(block, /data-hook="review-title"[^>]*>\s*([\s\S]*?)\s*<\/a>/i) || '');
    const rating = parseRating(block);
    const author = firstMatch(block, /class="a-profile-name"[^>]*>\s*([^<]+)\s*</i);
    const date = firstMatch(block, /data-hook="review-date"[^>]*>\s*([^<]+)\s*</i);
    const body = stripTags(firstMatch(block, /data-hook="review-body"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || '');

    out.push({
      id,
      title,
      rating,
      author: author ? stripTags(author) : null,
      date: date ? stripTags(date) : null,
      body,
    });
  }

  return out;
}
