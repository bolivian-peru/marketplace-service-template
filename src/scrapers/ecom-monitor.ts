/**
 * E-Commerce Price & Stock Monitor
 *
 * Minimal, dependency-free HTML extraction using regex heuristics.
 * Uses mobile proxy fetch (proxy.ts) for better block resistance.
 *
 * Supported (best-effort): Amazon, eBay
 */

import { proxyFetch } from '../proxy';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Retailer = 'amazon' | 'ebay' | 'walmart' | 'target' | 'unknown';
export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';

export interface ProductChange {
  priceChanged: boolean;
  availabilityChanged: boolean;
  previousPrice: number | null;
  previousAvailability: Availability | null;
}

export interface ProductSnapshot {
  url: string;
  retailer: Retailer;
  title: string | null;
  price: number | null;
  currency: string | null;
  availability: Availability;
  seller: string | null;
  reviewCount: number | null;
  bsr: string | null;
  fetchedAt: string;
  errors: string[];
  change: ProductChange | null;
}

interface HistoryRecord {
  url: string;
  retailer: Retailer;
  price: number | null;
  currency: string | null;
  availability: Availability;
  fetchedAt: string;
}

// Simple local history store (for demo + change detection).
// In production you’d use SQLite/Redis/etc.
const HISTORY_PATH = '/tmp/ecom-monitor-history.json';

function detectRetailer(url: string): Retailer {
  const u = url.toLowerCase();
  if (u.includes('amazon.')) return 'amazon';
  if (u.includes('ebay.')) return 'ebay';
  if (u.includes('walmart.')) return 'walmart';
  if (u.includes('target.')) return 'target';
  return 'unknown';
}

function numFromText(s: string): number | null {
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseAmazon(html: string): {
  title: string | null;
  price: number | null;
  currency: string | null;
  availability: Availability;
  seller: string | null;
  reviewCount: number | null;
  bsr: string | null;
  errors: string[];
} {
  const errors: string[] = [];

  const title = (html.match(/<span[^>]+id="productTitle"[^>]*>([^<]+)<\/span>/i)?.[1] || null)?.trim() || null;

  // price heuristics
  const wholeFrac = html.match(
    /<span[^>]+class="a-price-whole"[^>]*>([^<]+)<\/span>\s*<span[^>]+class="a-price-fraction"[^>]*>([^<]+)<\/span>/i,
  );
  const priceToPay = html.match(/"priceToPay"[\s\S]{0,600}?"amount"\s*:\s*"?([0-9\.]+)"?/i);
  const dollar = html.match(/\$\s*([0-9]+(?:\.[0-9]{2})?)/);

  let price: number | null = null;
  if (wholeFrac) price = numFromText(`${wholeFrac[1]}.${wholeFrac[2]}`);
  else if (priceToPay) price = numFromText(priceToPay[1]);
  else if (dollar) price = numFromText(dollar[1]);

  const currency = html.includes('$') ? 'USD' : null;

  // availability heuristics
  let availability: Availability = 'unknown';
  const availText = html
    .match(/<div[^>]+id="availability"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i)?.[1]
    ?.trim();
  if (availText) {
    if (/in stock/i.test(availText)) availability = 'in_stock';
    else if (/out of stock|currently unavailable/i.test(availText)) availability = 'out_of_stock';
  }

  const seller = html
    .match(/<div[^>]+id="merchant-info"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;

  const reviewCount = numFromText(html.match(/id="acrCustomerReviewText"[^>]*>([^<]+)<\/span>/i)?.[1] || '')
    ?? numFromText(html.match(/"ratingCount"\s*:\s*"([0-9,]+)"/i)?.[1] || '');

  // best sellers rank (best-effort)
  const bsrBlock = html.match(/Best Sellers Rank[\s\S]{0,3000}?<\/tr>/i)?.[0]
    || html.match(/Best Sellers Rank[\s\S]{0,500}?\#\d[\s\S]{0,200}/i)?.[0]
    || null;
  const bsr = bsrBlock
    ? bsrBlock.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    : null;

  if (!title) errors.push('amazon:title_not_found');
  if (price === null) errors.push('amazon:price_not_found');
  if (availability === 'unknown') errors.push('amazon:availability_unknown');

  return { title, price, currency, availability, seller, reviewCount, bsr, errors };
}

function parseEbay(html: string): {
  title: string | null;
  price: number | null;
  currency: string | null;
  availability: Availability;
  seller: string | null;
  reviewCount: number | null;
  bsr: string | null;
  errors: string[];
} {
  const errors: string[] = [];

  const title = (html.match(/<h1[^>]*class="x-item-title__mainTitle"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i)?.[1]
    || html
      .match(/<h1[^>]*id="itemTitle"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, ' ')
    || null)?.replace(/\s+/g, ' ').trim() || null;

  const priceRaw = html.match(/itemprop="price"[^>]*content="([0-9\.]+)"/i)?.[1]
    || html.match(/class="x-price-primary"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i)?.[1]
    || null;
  const price = priceRaw ? numFromText(priceRaw) : null;

  const currency = html.match(/itemprop="priceCurrency"[^>]*content="([A-Z]{3})"/i)?.[1]
    || (html.includes('$') ? 'USD' : null);

  let availability: Availability = 'unknown';
  if (/out of stock|sold out/i.test(html)) availability = 'out_of_stock';
  if (/in stock|available/i.test(html)) availability = 'in_stock';

  const seller = html.match(/class="x-sellercard-atf__info__about-seller"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)?.[1]
    || html.match(/class="mbg-nw"[^>]*>([^<]+)<\/span>/i)?.[1]
    || null;

  const reviewCount = numFromText(html.match(/([0-9,]+)\s+product ratings/i)?.[1] || '');

  if (!title) errors.push('ebay:title_not_found');
  if (price === null) errors.push('ebay:price_not_found');

  return { title, price, currency, availability, seller: seller?.trim() || null, reviewCount, bsr: null, errors };
}

async function readHistory(): Promise<Record<string, HistoryRecord>> {
  try {
    if (!existsSync(HISTORY_PATH)) return {};
    const txt = await readFile(HISTORY_PATH, 'utf8');
    return JSON.parse(txt) || {};
  } catch {
    return {};
  }
}

async function writeHistory(h: Record<string, HistoryRecord>) {
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(h, null, 2));
}

export async function scrapeProduct(url: string, opts: { alertOnChange: boolean }): Promise<ProductSnapshot> {
  const retailer = detectRetailer(url);
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];

  const history = await readHistory();
  const prev = history[url] || null;

  let html = '';
  try {
    const res = await proxyFetch(url, { timeoutMs: 45_000, maxRetries: 2 });
    if (!res.ok) errors.push(`http:${res.status}`);
    html = await res.text();
  } catch (e: any) {
    errors.push(`fetch_failed:${e?.message || String(e)}`);
  }

  let parsed = {
    title: null as string | null,
    price: null as number | null,
    currency: null as string | null,
    availability: 'unknown' as Availability,
    seller: null as string | null,
    reviewCount: null as number | null,
    bsr: null as string | null,
    errors: [] as string[],
  };

  if (html) {
    try {
      if (retailer === 'amazon') parsed = parseAmazon(html);
      else if (retailer === 'ebay') parsed = parseEbay(html);
      else errors.push(`unsupported_retailer:${retailer}`);
    } catch (e: any) {
      errors.push(`parse_failed:${e?.message || String(e)}`);
    }
  }

  const change: ProductChange | null = opts.alertOnChange
    ? {
        previousPrice: prev?.price ?? null,
        previousAvailability: prev?.availability ?? null,
        priceChanged: prev ? prev.price !== parsed.price : false,
        availabilityChanged: prev ? prev.availability !== parsed.availability : false,
      }
    : null;

  // update history
  history[url] = {
    url,
    retailer,
    price: parsed.price,
    currency: parsed.currency,
    availability: parsed.availability,
    fetchedAt,
  };

  const keys = Object.keys(history);
  if (keys.length > 500) {
    for (const k of keys.slice(0, keys.length - 500)) delete history[k];
  }
  await writeHistory(history);

  return {
    url,
    retailer,
    title: parsed.title,
    price: parsed.price,
    currency: parsed.currency,
    availability: parsed.availability,
    seller: parsed.seller,
    reviewCount: parsed.reviewCount,
    bsr: parsed.bsr,
    fetchedAt,
    errors: [...errors, ...parsed.errors].filter(Boolean),
    change,
  };
}
