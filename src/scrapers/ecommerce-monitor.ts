/**
 * E-Commerce Price & Stock Monitor
 * Extracts product price, availability, seller, ratings, review count, and identifiers
 * from Amazon, Walmart, Target, eBay, and generic product pages.
 */

import { proxyFetch, getProxy } from '../proxy';

export type SupportedStore = 'amazon' | 'walmart' | 'target' | 'ebay' | 'generic';

export interface ProductCheckInput {
  url: string;
  expectedPrice?: number;
  currency?: string;
}

export interface ProductSnapshot {
  url: string;
  store: SupportedStore;
  title: string | null;
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  availability: string | null;
  seller: string | null;
  rating: number | null;
  reviewCount: number | null;
  sku: string | null;
  asin: string | null;
  gtin: string | null;
  image: string | null;
  canonicalUrl: string | null;
  observedAt: string;
  proxy: {
    country: string;
    type: 'mobile';
  };
  signals: {
    captchaDetected: boolean;
    loginWallDetected: boolean;
    parseConfidence: 'high' | 'medium' | 'low';
    priceBelowExpected?: boolean;
    priceDelta?: number;
  };
}

export interface BatchProductSnapshot {
  results: ProductSnapshot[];
  failures: Array<{ url: string; error: string; status?: number }>;
  resultCount: number;
  failureCount: number;
  observedAt: string;
}

const MAX_HTML_BYTES = 900_000;

export function detectStore(url: string): SupportedStore {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  if (host.includes('amazon.')) return 'amazon';
  if (host.includes('walmart.')) return 'walmart';
  if (host.includes('target.')) return 'target';
  if (host.includes('ebay.')) return 'ebay';
  return 'generic';
}

export async function checkProduct(input: ProductCheckInput): Promise<ProductSnapshot> {
  validateProductUrl(input.url);
  const proxy = getProxy();
  const response = await proxyFetch(input.url, {
    timeoutMs: 35_000,
    maxRetries: 2,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/ld+json;q=0.8,*/*;q=0.7',
      'Cache-Control': 'no-cache',
    },
  });

  if (response.status === 429) {
    const err: any = new Error('rate_limited');
    err.status = 503;
    throw err;
  }
  if (response.status === 403) {
    const err: any = new Error('auth_required_or_blocked');
    err.status = 403;
    throw err;
  }
  if (!response.ok) {
    const err: any = new Error(`target_http_${response.status}`);
    err.status = response.status;
    throw err;
  }

  const raw = await response.text();
  const html = raw.slice(0, MAX_HTML_BYTES);
  const store = detectStore(input.url);
  const captchaDetected = detectCaptcha(html);
  const loginWallDetected = detectLoginWall(html);

  if (captchaDetected) {
    const err: any = new Error('captcha_detected');
    err.status = 503;
    throw err;
  }

  const jsonLdProducts = extractJsonLdProducts(html);
  const primary = jsonLdProducts[0] || {};
  const meta = extractMeta(html);
  const text = stripTags(html).replace(/\s+/g, ' ').slice(0, 40_000);

  const price = firstNumber([
    priceFromJsonLd(primary),
    metaPrice(meta),
    storeSpecificPrice(store, html),
    regexPrice(text),
  ]);
  const title = firstString([
    stringValue(primary.name),
    meta['og:title'],
    meta['twitter:title'],
    extractTitle(html),
  ]);
  const availability = firstString([
    availabilityFromJsonLd(primary),
    storeSpecificAvailability(store, html, text),
  ]);
  const inStock = normalizeStock(availability, text);
  const rating = firstNumber([
    ratingFromJsonLd(primary),
    storeSpecificRating(store, html, text),
  ]);
  const reviewCount = firstInteger([
    reviewCountFromJsonLd(primary),
    storeSpecificReviewCount(store, html, text),
  ]);
  const asin = store === 'amazon' ? extractAsin(input.url, html) : null;
  const canonicalUrl = firstString([meta['canonical'], meta['og:url'], extractCanonical(html)]);

  const confidence = title && price !== null && (availability || inStock !== null)
    ? 'high'
    : title && (price !== null || availability)
      ? 'medium'
      : 'low';

  return {
    url: input.url,
    store,
    title: cleanTitle(title),
    price,
    currency: firstString([
      stringValue(primary.offers?.priceCurrency),
      meta['product:price:currency'],
      input.currency,
      inferCurrency(input.url),
    ]),
    inStock,
    availability,
    seller: firstString([sellerFromJsonLd(primary), storeSpecificSeller(store, html, text)]),
    rating,
    reviewCount,
    sku: firstString([stringValue(primary.sku), meta['product:retailer_item_id']]),
    asin,
    gtin: firstString([stringValue(primary.gtin13), stringValue(primary.gtin14), stringValue(primary.gtin), meta['product:gtin']]),
    image: firstString([stringValue(primary.image), Array.isArray(primary.image) ? stringValue(primary.image[0]) : null, meta['og:image']]),
    canonicalUrl,
    observedAt: new Date().toISOString(),
    proxy: { country: proxy.country, type: 'mobile' },
    signals: {
      captchaDetected,
      loginWallDetected,
      parseConfidence: confidence,
      ...(input.expectedPrice !== undefined && price !== null ? {
        priceBelowExpected: price <= input.expectedPrice,
        priceDelta: Number((price - input.expectedPrice).toFixed(2)),
      } : {}),
    },
  };
}

export async function checkProductsBatch(inputs: ProductCheckInput[]): Promise<BatchProductSnapshot> {
  const results: ProductSnapshot[] = [];
  const failures: Array<{ url: string; error: string; status?: number }> = [];

  for (const input of inputs.slice(0, 10)) {
    try {
      results.push(await checkProduct(input));
    } catch (err: any) {
      failures.push({ url: input.url, error: err.message || 'unknown_error', status: err.status });
    }
  }

  return {
    results,
    failures,
    resultCount: results.length,
    failureCount: failures.length,
    observedAt: new Date().toISOString(),
  };
}

function validateProductUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('invalid_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported_protocol');
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    throw new Error('private_network_url_blocked');
  }
}

function extractJsonLdProducts(html: string): any[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => decodeEntities(m[1].trim()))
    .flatMap(parseJsonLd)
    .flatMap(expandGraph)
    .filter((x: any) => {
      const type = Array.isArray(x?.['@type']) ? x['@type'].join(' ') : x?.['@type'];
      return typeof type === 'string' && /product/i.test(type);
    });
  return blocks;
}

function parseJsonLd(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function expandGraph(node: any): any[] {
  if (!node) return [];
  const out = [node];
  if (Array.isArray(node['@graph'])) out.push(...node['@graph']);
  return out;
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s+([^>]+)>/gi)) {
    const attrs = attrsToObject(m[1]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content) meta[key] = decodeEntities(attrs.content);
  }
  const canonical = extractCanonical(html);
  if (canonical) meta.canonical = canonical;
  return meta;
}

function attrsToObject(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z_:.-]+)\s*=\s*(["'])(.*?)\2/g)) attrs[m[1].toLowerCase()] = m[3];
  return attrs;
}

function priceFromJsonLd(p: any): number | null {
  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  return parsePrice(offers?.price ?? offers?.lowPrice ?? offers?.highPrice);
}
function availabilityFromJsonLd(p: any): string | null {
  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  return stringValue(offers?.availability)?.split('/').pop() || null;
}
function ratingFromJsonLd(p: any): number | null { return parsePrice(p.aggregateRating?.ratingValue ?? p.review?.reviewRating?.ratingValue); }
function reviewCountFromJsonLd(p: any): number | null { return parseIntSafe(p.aggregateRating?.reviewCount ?? p.aggregateRating?.ratingCount); }
function sellerFromJsonLd(p: any): string | null {
  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  return stringValue(offers?.seller?.name || offers?.seller);
}
function metaPrice(meta: Record<string, string>): number | null { return parsePrice(meta['product:price:amount'] || meta['og:price:amount'] || meta.price); }

function storeSpecificPrice(store: SupportedStore, html: string): number | null {
  const patterns: RegExp[] = store === 'amazon'
    ? [/a-price-whole[^>]*>\s*([\d,.]+)/i, /"priceAmount"\s*:\s*([\d.]+)/i, /"displayPrice"\s*:\s*"([^\"]+)"/i]
    : store === 'walmart'
      ? [/"priceString"\s*:\s*"([^\"]+)"/i, /"currentPrice"\s*:\s*\{[^}]*"price"\s*:\s*([\d.]+)/i]
      : store === 'target'
        ? [/"current_retail"\s*:\s*([\d.]+)/i, /"formatted_current_price"\s*:\s*"([^\"]+)"/i]
        : store === 'ebay'
          ? [/"convertedCurrentPrice"\s*:\s*\{[^}]*"value"\s*:\s*"?([\d.]+)/i, /x-price-primary[^>]*>[\s\S]*?\$([\d,.]+)/i]
          : [];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    const price = parsePrice(m?.[1]);
    if (price !== null) return price;
  }
  return null;
}

function storeSpecificAvailability(store: SupportedStore, html: string, text: string): string | null {
  const candidates = [
    html.match(/availability[^>]*>[\s\S]{0,300}?<span[^>]*>(.*?)<\/span>/i)?.[1],
    text.match(/\b(In Stock|Out of Stock|Currently unavailable|Available now|Only \d+ left|Sold out)\b/i)?.[1],
  ];
  return firstString(candidates.map(stripTags));
}
function storeSpecificRating(_store: SupportedStore, html: string, text: string): number | null {
  return firstNumber([
    parsePrice(html.match(/([\d.]+)\s*out of\s*5 stars/i)?.[1]),
    parsePrice(text.match(/([\d.]+)\s*out of\s*5/i)?.[1]),
  ]);
}
function storeSpecificReviewCount(_store: SupportedStore, html: string, text: string): number | null {
  return firstInteger([
    parseIntSafe(html.match(/([\d,]+)\s*(?:ratings|reviews)/i)?.[1]),
    parseIntSafe(text.match(/([\d,]+)\s*(?:ratings|reviews)/i)?.[1]),
  ]);
}
function storeSpecificSeller(_store: SupportedStore, _html: string, text: string): string | null {
  return firstString([
    text.match(/Sold by\s+([^|]{2,80})/i)?.[1],
    text.match(/Seller\s+([^|]{2,80})/i)?.[1],
  ]);
}

function extractAsin(url: string, html: string): string | null {
  const path = new URL(url).pathname;
  return firstString([
    path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1],
    html.match(/"asin"\s*:\s*"([A-Z0-9]{10})"/i)?.[1],
  ]);
}

function normalizeStock(availability: string | null, text: string): boolean | null {
  const hay = `${availability || ''} ${text.slice(0, 3000)}`.toLowerCase();
  if (/out of stock|currently unavailable|sold out|unavailable/.test(hay)) return false;
  if (/in stock|available|only \d+ left|add to cart|buy now/.test(hay)) return true;
  return null;
}

function detectCaptcha(html: string): boolean { return /captcha|robot check|verify you are human|unusual traffic|automated requests/i.test(html); }
function detectLoginWall(html: string): boolean { return /sign in to continue|login required|create an account to continue/i.test(html); }
function extractTitle(html: string): string | null { return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim() || null; }
function extractCanonical(html: string): string | null { return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || null; }
function stripTags(s: any): string { return typeof s === 'string' ? decodeEntities(s.replace(/<[^>]+>/g, ' ')).trim() : ''; }
function decodeEntities(s: string): string { return s.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' '); }
function parsePrice(v: any): number | null {
  if (v === undefined || v === null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
function parseIntSafe(v: any): number | null { const n = parseInt(String(v ?? '').replace(/,/g, ''), 10); return Number.isFinite(n) ? n : null; }
function stringValue(v: any): string | null { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function firstString(values: Array<any>): string | null { return values.map(stringValue).find(Boolean) || null; }
function firstNumber(values: Array<any>): number | null { return values.find(v => typeof v === 'number' && Number.isFinite(v)) ?? null; }
function firstInteger(values: Array<any>): number | null { return values.find(v => Number.isInteger(v)) ?? null; }
function cleanTitle(title: string | null): string | null { return title ? title.replace(/\s*[|:-]\s*(Amazon|Walmart|Target|eBay).*$/i, '').trim() : null; }
function regexPrice(text: string): number | null { return parsePrice(text.match(/(?:USD|US\$|\$)\s*([\d,.]+(?:\.\d{2})?)/i)?.[1]); }
function inferCurrency(url: string): string | null {
  const host = new URL(url).hostname;
  if (/\.co\.uk$/.test(host)) return 'GBP';
  if (/\.de$|\.fr$|\.it$|\.es$/.test(host)) return 'EUR';
  return 'USD';
}
