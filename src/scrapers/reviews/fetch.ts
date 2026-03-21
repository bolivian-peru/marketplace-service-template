/**
 * Google Reviews — HTTP Fetching & URL Builders
 */

import { proxyFetch } from '../../proxy';

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

export function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

// ─── URL BUILDERS ───────────────────────────────────

export function buildPlaceUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}&hl=en`;
}

export function buildReviewsUrl(placeId: string, sort: string = 'newest'): string {
  const sortMap: Record<string, string> = {
    'relevant': '1',
    'newest': '2',
    'highest': '3',
    'lowest': '4',
  };
  const sortParam = sortMap[sort] || '2';
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}&hl=en&sort=${sortParam}`;
}

export function buildSearchUrl(query: string, location: string): string {
  const searchTerm = encodeURIComponent(`${query} in ${location}`);
  return `https://www.google.com/maps/search/${searchTerm}?hl=en`;
}

export function buildLocalSearchUrl(query: string, location: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query + ' in ' + location)}&tbm=lcl&gbv=1&hl=en`;
}

// ─── HTML FETCHING ──────────────────────────────────

export async function fetchGoogleMapsPage(url: string): Promise<string> {
  console.log(`[REVIEWS] Fetching: ${url}`);

  const response = await proxyFetch(url, {
    timeoutMs: 45000,
    maxRetries: 2,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (!response.ok) {
    throw new Error(`Google returned HTTP ${response.status}`);
  }

  const html = await response.text();
  console.log(`[REVIEWS] HTML length: ${html.length}`);

  if (html.includes('captcha') || html.includes('unusual traffic')) {
    throw new Error('Google CAPTCHA detected. Mobile proxy may be flagged — try a different proxy region.');
  }

  return html;
}
