/**
 * Price Monitor Scraper
 * ─────────────────────
 * Scrapes e-commerce sites (Amazon, eBay, etc.) for price tracking.
 * Supports price history, alert thresholds, and x402 micropayments.
 */

import { proxyFetch, getProxy } from '../proxy';
import type { PriceData, PriceAlert, ProductInfo } from '../types';

// ─── PRICE STORAGE (In-Memory + File-Based) ─────────────

interface PriceHistoryEntry {
  currentPrice: number;
  originalPrice: number | null;
  discountPercent: number | null;
  availability: string;
  timestamp: string;
  currency: string;
}

interface ProductPriceData {
  url: string;
  asin?: string;
  lastChecked: string;
  priceHistory: PriceHistoryEntry[];
  current: PriceHistoryEntry;
  alerts: PriceAlert[];
  alertThresholds: { targetPrice: number; createdAt: string }[];
}

// In-memory cache
const priceCache = new Map<string, ProductPriceData>();

// ─── SITE DETECTION ──────────────────────────────────────

type SupportedSite = 'amazon' | 'ebay' | 'walmart' | 'target' | 'bestbuy' | 'unknown';

function detectSite(url: string): SupportedSite {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes('amazon.')) return 'amazon';
  if (hostname.includes('ebay.')) return 'ebay';
  if (hostname.includes('walmart.')) return 'walmart';
  if (hostname.includes('target.')) return 'target';
  if (hostname.includes('bestbuy.')) return 'bestbuy';
  return 'unknown';
}

// ─── PRICE EXTRACTION HELPERS ─────────────────────────────

function extractPrice(text: string): number | null {
  // Match various price formats: $19.99, $1,299.99, €19.99, £19.99
  const patterns = [
    /\$\s*([\d,]+\.?\d*)/,
    /USD\s*([\d,]+\.?\d*)/i,
    /€\s*([\d,]+\.?\d*)/,
    /£\s*([\d,]+\.?\d*)/,
    /([\d,]+\.?\d*)\s*\$/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const cleaned = match[1].replace(/,/g, '');
      const price = parseFloat(cleaned);
      if (!isNaN(price) && price > 0) {
        return price;
      }
    }
  }
  return null;
}

function extractDiscountPercent(original: number, current: number): number | null {
  if (original <= 0 || current <= 0 || current >= original) return null;
  return Math.round(((original - current) / original) * 100);
}

function extractAvailability(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('out of stock') || lower.includes('unavailable') || lower.includes('sold out')) {
    return 'out_of_stock';
  }
  if (lower.includes('limited') || lower.includes('few left') || lower.includes('only')) {
    return 'limited_stock';
  }
  if (lower.includes('in stock') || lower.includes('available') || lower.includes('add to cart')) {
    return 'in_stock';
  }
  return 'unknown';
}

// ─── AMAZON SCRAPER ─────────────────────────────────────

async function scrapeAmazon(url: string): Promise<ProductInfo> {
  const response = await proxyFetch(url, { timeoutMs: 30000 });
  const html = await response.text();
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) || 
                     html.match(/"name"\s*:\s*"([^"]+)"/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Product';
  
  // Extract current price (multiple patterns for Amazon's varying HTML)
  let currentPrice: number | null = null;
  const pricePatterns = [
    /class="a-price-whole"[^>]*>([^<]+)<[^>]*class="a-price-decimal"[^>]*>[^<]*<[^>]*class="a-price-fraction"[^>]*>([^<]+)</,
    /"price"\s*:\s*"?([\d.]+)"?/,
    /priceblock(?:Deal)?price\s*[^>]*>([\d.,]+)/,
    /class="a-offscreen"[^>]*>([\$£€][\d.,]+)/,
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      currentPrice = extractPrice(match[0]);
      if (currentPrice) break;
    }
  }
  
  // Extract original price (was price)
  let originalPrice: number | null = null;
  const originalPatterns = [
    /class="a-text-price"[^>]*>[\s\S]*?<span[^>]*>([\$£€][\d.,]+)<\/span>/,
    /"listPrice"\s*:\s*"?([\d.]+)"?/,
    /strike-through[^>]*>([\$£€][\d.,]+)/,
  ];
  
  for (const pattern of originalPatterns) {
    const match = html.match(pattern);
    if (match) {
      originalPrice = extractPrice(match[1]);
      if (originalPrice) break;
    }
  }
  
  // Extract ASIN
  const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/) || 
                    url.match(/\/gp\/product\/([A-Z0-9]{10})/) ||
                    html.match(/"ASIN"\s*:\s*"([A-Z0-9]{10})"/);
  const asin = asinMatch ? asinMatch[1] : undefined;
  
  // Extract availability
  const availability = extractAvailability(html);
  
  // Extract rating
  const ratingMatch = html.match(/"ratingValue"\s*:\s*"([\d.]+)"/) ||
                      html.match(/class="a-icon-alt"[^>]*>([^<]+)</);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
  
  // Extract review count
  const reviewMatch = html.match(/"reviewCount"\s*:\s*"([\d,]+)"/) ||
                      html.match(/class="a-size-base"[^>]*>\s*([\d,]+)\s+review/);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null;
  
  // Extract image
  const imageMatch = html.match(/"image"\s*:\s*"(https:\/\/[^"]+\.jpg[^"]*)"/) ||
                     html.match(/id="landingImage"[^>]*src="([^"]+)"/);
  const image = imageMatch ? imageMatch[1] : null;
  
  return {
    title,
    currentPrice,
    originalPrice,
    discountPercent: currentPrice && originalPrice ? extractDiscountPercent(originalPrice, currentPrice) : null,
    currency: 'USD',
    url,
    asin,
    availability,
    rating,
    reviewCount,
    image,
    site: 'amazon',
  };
}

// ─── EBAY SCRAPER ────────────────────────────────────────

async function scrapeEbay(url: string): Promise<ProductInfo> {
  const response = await proxyFetch(url, { timeoutMs: 30000 });
  const html = await response.text();
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) ||
                    html.match(/"name"\s*:\s*"([^"]+)"/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Product';
  
  // Extract current price
  let currentPrice: number | null = null;
  const pricePatterns = [
    /class="x-price-primary"[^>]*>([\$£€][\d.,]+)/,
    /class="notranslate"[^>]*>([\$£€][\d.,]+)/,
    /"price"\s*:\s*([\d.]+)/,
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      currentPrice = extractPrice(match[0]);
      if (currentPrice) break;
    }
  }
  
  // Extract original price
  let originalPrice: number | null = null;
  const originalPatterns = [
    /class="x-price-was"[^>]*>([\$£€][\d.,]+)/,
    /class="vi-originalPrice"[^>]*>([\$£€][\d.,]+)/,
  ];
  
  for (const pattern of originalPatterns) {
    const match = html.match(pattern);
    if (match) {
      originalPrice = extractPrice(match[1]);
      if (originalPrice) break;
    }
  }
  
  // Extract item ID
  const itemIdMatch = url.match(/\/itm\/(\d+)/) ||
                      html.match(/"itemId"\s*:\s*"(\d+)"/);
  const itemId = itemIdMatch ? itemIdMatch[1] : undefined;
  
  // Extract availability
  const availability = extractAvailability(html);
  
  return {
    title,
    currentPrice,
    originalPrice,
    discountPercent: currentPrice && originalPrice ? extractDiscountPercent(originalPrice, currentPrice) : null,
    currency: 'USD',
    url,
    itemId,
    availability,
    site: 'ebay',
  };
}

// ─── GENERIC SCRAPER ─────────────────────────────────────

async function scrapeGeneric(url: string): Promise<ProductInfo> {
  const response = await proxyFetch(url, { timeoutMs: 30000 });
  const html = await response.text();
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Product';
  
  // Extract price (generic patterns)
  let currentPrice: number | null = null;
  const pricePatterns = [
    /class="price"[^>]*>([\$£€][\d.,]+)/i,
    /class="product-price"[^>]*>([\$£€][\d.,]+)/i,
    /data-price="([\d.]+)"/,
    /"price"\s*:\s*"([\d.]+)"/,
    /[\$£€]([\d,]+\.?\d*)/,
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      currentPrice = extractPrice(match[0]);
      if (currentPrice) break;
    }
  }
  
  // Extract original price
  let originalPrice: number | null = null;
  const originalPatterns = [
    /class="original-price"[^>]*>([\$£€][\d.,]+)/i,
    /class="was-price"[^>]*>([\$£€][\d.,]+)/i,
    /"listPrice"\s*:\s*"([\d.]+)"/,
  ];
  
  for (const pattern of originalPatterns) {
    const match = html.match(pattern);
    if (match) {
      originalPrice = extractPrice(match[1]);
      if (originalPrice) break;
    }
  }
  
  return {
    title,
    currentPrice,
    originalPrice,
    discountPercent: currentPrice && originalPrice ? extractDiscountPercent(originalPrice, currentPrice) : null,
    currency: 'USD',
    url,
    availability: extractAvailability(html),
    site: detectSite(url),
  };
}

// ─── MAIN SCRAPER FUNCTION ────────────────────────────────

export async function scrapeProduct(url: string): Promise<ProductInfo> {
  const site = detectSite(url);
  
  switch (site) {
    case 'amazon':
      return scrapeAmazon(url);
    case 'ebay':
      return scrapeEbay(url);
    default:
      return scrapeGeneric(url);
  }
}

// ─── PRICE HISTORY MANAGEMENT ─────────────────────────────

export function getPriceHistory(identifier: string): PriceHistoryEntry[] {
  const cached = priceCache.get(identifier);
  return cached ? cached.priceHistory : [];
}

export function updatePriceHistory(identifier: string, data: ProductInfo): void {
  const entry: PriceHistoryEntry = {
    currentPrice: data.currentPrice || 0,
    originalPrice: data.originalPrice,
    discountPercent: data.discountPercent,
    availability: data.availability,
    timestamp: new Date().toISOString(),
    currency: data.currency,
  };
  
  const cached = priceCache.get(identifier);
  if (cached) {
    cached.priceHistory.push(entry);
    cached.lastChecked = new Date().toISOString();
    cached.current = entry;
    // Keep only last 365 entries
    if (cached.priceHistory.length > 365) {
      cached.priceHistory = cached.priceHistory.slice(-365);
    }
  } else {
    priceCache.set(identifier, {
      url: data.url,
      asin: data.asin,
      lastChecked: new Date().toISOString(),
      priceHistory: [entry],
      current: entry,
      alerts: [],
      alertThresholds: [],
    });
  }
}

// ─── ALERT MANAGEMENT ────────────────────────────────────

export function addPriceAlert(identifier: string, targetPrice: number): PriceAlert {
  const alertId = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const alert: PriceAlert = {
    id: alertId,
    targetPrice,
    createdAt: new Date().toISOString(),
    triggered: false,
    triggeredAt: null,
  };
  
  const cached = priceCache.get(identifier);
  if (cached) {
    cached.alertThresholds.push({ targetPrice, createdAt: alert.createdAt });
    cached.alerts.push(alert);
  }
  
  return alert;
}

export function getAlerts(identifier: string): PriceAlert[] {
  const cached = priceCache.get(identifier);
  return cached ? cached.alerts : [];
}

export function checkPriceAlerts(identifier: string, currentPrice: number): PriceAlert[] {
  const cached = priceCache.get(identifier);
  if (!cached) return [];
  
  const triggeredAlerts: PriceAlert[] = [];
  
  for (const alert of cached.alerts) {
    if (!alert.triggered && currentPrice <= alert.targetPrice) {
      alert.triggered = true;
      alert.triggeredAt = new Date().toISOString();
      triggeredAlerts.push(alert);
    }
  }
  
  return triggeredAlerts;
}

export function removeAlert(identifier: string, alertId: string): boolean {
  const cached = priceCache.get(identifier);
  if (!cached) return false;
  
  const alertIndex = cached.alerts.findIndex(a => a.id === alertId);
  if (alertIndex === -1) return false;
  
  cached.alerts.splice(alertIndex, 1);
  return true;
}

// ─── UTILITY ─────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ─── BULK SCRAPING ───────────────────────────────────────

export async function scrapeMultiple(urls: string[]): Promise<ProductInfo[]> {
  const results: ProductInfo[] = [];
  
  for (const url of urls) {
    try {
      const product = await scrapeProduct(url);
      results.push(product);
      // Update history
      const identifier = extractIdentifier(url);
      updatePriceHistory(identifier, product);
    } catch (error) {
      console.error(`Failed to scrape ${url}:`, error);
      results.push({
        url,
        title: 'Error fetching product',
        currentPrice: null,
        originalPrice: null,
        discountPercent: null,
        currency: 'USD',
        availability: 'error',
        site: detectSite(url),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  return results;
}

// ─── IDENTIFIER EXTRACTION ───────────────────────────────

export function extractIdentifier(input: string): string {
  // Check if it's an ASIN
  const asinMatch = input.match(/^([A-Z0-9]{10})$/i);
  if (asinMatch) {
    return `amazon:${asinMatch[1]}`;
  }
  
  // It's a URL
  const site = detectSite(input);
  if (site === 'amazon') {
    const amazonAsin = input.match(/\/dp\/([A-Z0-9]{10})/i) ||
                      input.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (amazonAsin) {
      return `amazon:${amazonAsin[1]}`;
    }
  }
  
  return input;
}
