/**
 * Shared Extraction Helpers
 * ─────────────────────────
 * Reusable functions for extracting data from HTML.
 * Used by Google Maps scraper and other services.
 */

import type { BusinessHours } from '../types';

// ─── HTML DECODING ──────────────────────────────────

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function decodeUnicodeEscapes(str: string): string {
  try {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => 
      String.fromCharCode(parseInt(code, 16))
    ).replace(/\\x([0-9a-fA-F]{2})/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
  } catch {
    return str;
  }
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── PHONE EXTRACTION ───────────────────────────────

export function extractPhoneFromText(text: string): string | null {
  const patterns = [
    /(\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/,
    /(\(\d{3}\)\s*\d{3}[-.]?\d{4})/,
    /(?:phone|tel|call)[:\s]*(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i,
    /href="tel:([^"]+)"/,
    /(\d{3}[-.\s]\d{3}[-.\s]\d{4})/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

// ─── ADDRESS EXTRACTION ─────────────────────────────

export function extractAddressFromText(text: string): string | null {
  const patterns = [
    /(\d+\s+[\w\s]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Pl|Place)[^,<]*,\s*[\w\s]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i,
    /(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2}\s*\d{5})/i,
    /(?:address|location)[:\s]*([^<]+(?:St|Ave|Rd|Blvd|Dr)[^<]*)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 10 && match[1].length < 150) {
      return decodeHtmlEntities(match[1].trim());
    }
  }
  return null;
}

// ─── WEBSITE EXTRACTION ─────────────────────────────

export function extractWebsiteFromText(text: string): string | null {
  const pattern = /href="(https?:\/\/(?!(?:www\.)?google\.com|maps\.google|gstatic|youtube)[^\s"]+)"/i;
  const match = text.match(pattern);
  if (match && !match[1].includes('google.com')) {
    return match[1];
  }
  return null;
}

// ─── RATING EXTRACTION ──────────────────────────────

export function extractRatingFromText(text: string): number | null {
  const match = text.match(/(\d\.?\d?)\s*(?:\(|stars?|rating)/i);
  if (match) {
    const rating = parseFloat(match[1]);
    if (rating >= 1 && rating <= 5) return rating;
  }
  return null;
}

export function extractRatingFromContext(text: string): number | null {
  const patterns = [
    /(\d\.\d)\s*\(/,
    /rating[:\s]*(\d\.\d)/i,
    /(\d\.\d)\s*stars?/i,
    />(\d\.\d)<\/span>/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const rating = parseFloat(match[1]);
      if (rating >= 1 && rating <= 5) return rating;
    }
  }
  return null;
}

// ─── REVIEW COUNT EXTRACTION ────────────────────────

export function extractReviewCountFromText(text: string): number | null {
  const match = text.match(/\((\d{1,3}(?:,\d{3})*)\)/);
  if (match) return parseInt(match[1].replace(/,/g, ''));
  return null;
}

export function extractReviewCountFromContext(text: string): number | null {
  const patterns = [
    /\((\d{1,3}(?:,\d{3})*)\s*(?:reviews?|review)?\)/i,
    /(\d{1,3}(?:,\d{3})*)\s*reviews?/i,
    /(\d+)\s*Google\s*reviews?/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseInt(match[1].replace(/,/g, ''));
  }
  return null;
}

// ─── PRICE LEVEL EXTRACTION ─────────────────────────

export function extractPriceLevel(text: string): string | null {
  const match = text.match(/(\${1,4})(?:\s|·|•|-|<)/);
  return match ? match[1] : null;
}

// ─── CATEGORIES EXTRACTION ──────────────────────────

export function extractCategoriesFromText(text: string): string[] {
  const categories: string[] = [];
  const pattern = /·\s*([A-Za-z\s&]+?)(?:\s*·|\s*<|$)/g;
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const cat = match[1].trim();
    if (cat.length > 2 && cat.length < 40 && isValidCategory(cat)) {
      categories.push(cat);
    }
  }
  return categories;
}

export function isValidCategory(cat: string): boolean {
  const invalidCategories = [
    /^\d+$/,
    /^open/i,
    /^closed/i,
    /^\$+$/,
    /^reviews?$/i,
    /^rating/i,
    /^stars?$/i,
    /^more/i,
    /^less/i,
  ];
  
  for (const pattern of invalidCategories) {
    if (pattern.test(cat)) return false;
  }
  
  return /[a-zA-Z]/.test(cat);
}

// ─── COORDINATES EXTRACTION ─────────────────────────

export function extractCoordsFromContext(text: string): { latitude: number; longitude: number } | null {
  const match = text.match(/@(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng };
    }
  }
  return null;
}

// ─── EMAIL EXTRACTION ───────────────────────────────

export function extractEmails(text: string): string[] {
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailPattern) || [];
  return matches.filter(email => 
    !email.includes('example.com') && 
    !email.includes('google.com') &&
    !email.includes('gstatic.com') &&
    !email.endsWith('.png') &&
    !email.endsWith('.jpg')
  );
}

// ─── HOURS EXTRACTION ───────────────────────────────

export function extractHours(html: string, businessName: string): BusinessHours | null {
  const hours: BusinessHours = {};
  
  const hoursPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[:\s]*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?|Closed|Open 24 hours)/gi;
  
  let match;
  while ((match = hoursPattern.exec(html)) !== null) {
    const day = match[1];
    const time = match[2];
    hours[day] = time;
  }

  return Object.keys(hours).length > 0 ? hours : null;
}

// ─── CATEGORIES FROM HTML ───────────────────────────

export function extractCategories(html: string, businessName: string): string[] {
  const categories: string[] = [];
  const escapedName = escapeRegex(businessName);
  
  const categoryPattern = new RegExp(`${escapedName}[\\s\\S]{0,300}?(?:·|•|\\|)\\s*([A-Za-z\\s&]+?)(?:·|•|\\||<|$)`, 'i');
  const match = html.match(categoryPattern);
  
  if (match && match[1]) {
    const cat = match[1].trim();
    if (cat.length > 2 && cat.length < 50 && !/^\d+$/.test(cat)) {
      categories.push(cat);
    }
  }

  return categories;
}
