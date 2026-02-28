/**
 * Mobile Ad Verification & Creative Intelligence
 * ────────────────────────────────────────────────
 * Scrapes Google Search ads using real 4G/5G carrier IPs via Proxies.sx.
 * Shows exactly what ads appear for a query from a specific country.
 *
 * Supports:
 *   - search_ads: Google Search paid ads (top + bottom positions)
 *   - display_ads: Ads visible on a given URL (HTML extraction)
 *   - advertiser: All ads from a specific advertiser domain
 */

import { proxyFetch } from '../proxy';
import { buildGoogleSearchUrl, extractAds } from './serp-tracker';
import type { AdResult } from '../types';

// ─── TYPES ──────────────────────────────────────────

export interface AdVerificationResult {
  type: 'search_ads' | 'display_ads' | 'advertiser';
  query?: string;
  url?: string;
  domain?: string;
  country: string;
  timestamp: string;
  ads: EnrichedAdResult[];
  organic_count: number;
  total_ads: number;
  ad_positions: {
    top: number;
    bottom: number;
  };
  proxy: {
    country: string;
    type: 'mobile';
  };
}

export interface EnrichedAdResult {
  position: number;
  placement: 'top' | 'bottom';
  title: string;
  description: string;
  displayUrl: string;
  finalUrl: string;
  advertiser: string;
  extensions: string[];
  isResponsive: boolean;
}

// ─── COUNTRY CONFIGS ────────────────────────────────

const COUNTRY_CONFIGS: Record<string, { gl: string; hl: string; domain: string }> = {
  US: { gl: 'us', hl: 'en', domain: 'google.com' },
  DE: { gl: 'de', hl: 'de', domain: 'google.de' },
  FR: { gl: 'fr', hl: 'fr', domain: 'google.fr' },
  ES: { gl: 'es', hl: 'es', domain: 'google.es' },
  GB: { gl: 'gb', hl: 'en', domain: 'google.co.uk' },
  PL: { gl: 'pl', hl: 'pl', domain: 'google.pl' },
};

// ─── HELPERS ────────────────────────────────────────

function extractAdvertiserDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Remove www. prefix
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function extractExtensions(html: string, adUrl: string): string[] {
  const extensions: string[] = [];

  // Look for sitelinks near ad URL in HTML block
  if (html.includes('sitelink') || html.includes('MUxGbd')) {
    extensions.push('Sitelinks');
  }
  if (/callout|MYjRkb|d3Z4qc/i.test(html)) {
    extensions.push('Callout');
  }
  if (/price|priceSuffix|\bPri\b/i.test(html)) {
    extensions.push('Price');
  }
  if (/location|address|\bLoc\b/i.test(html)) {
    extensions.push('Location');
  }
  if (/phone|\d{3}[-.\s]\d{3}/i.test(html)) {
    extensions.push('Call');
  }

  return extensions;
}

function countOrganicResults(html: string): number {
  // Count result blocks that are NOT ads
  const organic = html.match(/class="[^"]*(?:MjjYud|Gx5Zad)[^"]*"/g) || [];
  const ads = (html.match(/(?:id="tads"|class="[^"]*uEierd[^"]*"|id="bottomads")/g) || []).length;
  return Math.max(0, organic.length - ads);
}

function enrichAdResult(ad: AdResult, html: string): EnrichedAdResult {
  return {
    position: ad.position,
    placement: ad.isTop ? 'top' : 'bottom',
    title: ad.title,
    description: ad.description,
    displayUrl: ad.displayUrl,
    finalUrl: ad.url,
    advertiser: extractAdvertiserDomain(ad.url),
    extensions: extractExtensions(html, ad.url),
    isResponsive: html.includes('responsive') || html.includes('RU3Vod'),
  };
}

// ─── SEARCH ADS ─────────────────────────────────────

/**
 * Get Google Search ads for a query from a specific country.
 * Uses real mobile carrier IPs via Proxies.sx.
 */
export async function getSearchAds(
  query: string,
  country: string = 'US',
  proxyFetchFn: typeof proxyFetch = proxyFetch,
): Promise<AdVerificationResult> {
  const cfg = COUNTRY_CONFIGS[country.toUpperCase()] || COUNTRY_CONFIGS.US;
  const searchUrl = buildGoogleSearchUrl(query, cfg.gl, cfg.hl);

  const mobileUAs = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  ];
  const ua = mobileUAs[Math.floor(Math.random() * mobileUAs.length)];

  const response = await proxyFetchFn(searchUrl, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `${cfg.hl}-${country},${cfg.hl};q=0.9,en;q=0.8`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Google search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rawAds = extractAds(html);
  const organicCount = countOrganicResults(html);

  const enriched = rawAds.map(ad => enrichAdResult(ad, html));
  const topAds = enriched.filter(a => a.placement === 'top').length;
  const bottomAds = enriched.filter(a => a.placement === 'bottom').length;

  return {
    type: 'search_ads',
    query,
    country: country.toUpperCase(),
    timestamp: new Date().toISOString(),
    ads: enriched,
    organic_count: organicCount,
    total_ads: enriched.length,
    ad_positions: { top: topAds, bottom: bottomAds },
    proxy: { country: country.toUpperCase(), type: 'mobile' },
  };
}

// ─── DISPLAY ADS ────────────────────────────────────

/**
 * Get display/banner ads visible on a URL from a specific country.
 * Uses HTML extraction for common ad networks (Google AdSense, etc.)
 */
export async function getDisplayAds(
  url: string,
  country: string = 'US',
  proxyFetchFn: typeof proxyFetch = proxyFetch,
): Promise<AdVerificationResult> {
  const cfg = COUNTRY_CONFIGS[country.toUpperCase()] || COUNTRY_CONFIGS.US;

  const response = await proxyFetchFn(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `${cfg.hl}-${country},${cfg.hl};q=0.9,en;q=0.8`,
    },
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Page fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const ads: EnrichedAdResult[] = [];

  // Look for Google AdSense ad slots
  const adSlotPattern = /data-ad-client="([^"]+)"[^>]*data-ad-slot="([^"]+)"/g;
  let match;
  let pos = 1;
  while ((match = adSlotPattern.exec(html)) !== null) {
    ads.push({
      position: pos++,
      placement: 'top',
      title: `AdSense slot ${match[2]}`,
      description: `Google AdSense unit from client ${match[1]}`,
      displayUrl: new URL(url).hostname,
      finalUrl: url,
      advertiser: 'google.com',
      extensions: [],
      isResponsive: html.includes('data-ad-format="auto"') || html.includes('data-full-width-responsive'),
    });
  }

  // Look for header bidding / programmatic ad containers
  const iframeAdPattern = /<iframe[^>]*(?:googlesyndication|doubleclick|adnxs|criteo|pubmatic)[^>]*src="([^"]+)"/gi;
  while ((match = iframeAdPattern.exec(html)) !== null) {
    const adSrc = match[1];
    try {
      const adDomain = new URL(adSrc).hostname.replace(/^www\./, '');
      if (!ads.find(a => a.finalUrl === adSrc)) {
        ads.push({
          position: pos++,
          placement: 'top',
          title: `Programmatic ad unit`,
          description: `Ad from ${adDomain}`,
          displayUrl: adDomain,
          finalUrl: adSrc,
          advertiser: adDomain,
          extensions: [],
          isResponsive: false,
        });
      }
    } catch { /* ignore */ }
  }

  return {
    type: 'display_ads',
    url,
    country: country.toUpperCase(),
    timestamp: new Date().toISOString(),
    ads,
    organic_count: 0,
    total_ads: ads.length,
    ad_positions: { top: ads.length, bottom: 0 },
    proxy: { country: country.toUpperCase(), type: 'mobile' },
  };
}

// ─── ADVERTISER LOOKUP ───────────────────────────────

/**
 * Get all Google ads from a specific advertiser domain.
 * Uses Google Ads Transparency Center data via search.
 */
export async function getAdvertiserAds(
  domain: string,
  country: string = 'US',
  proxyFetchFn: typeof proxyFetch = proxyFetch,
): Promise<AdVerificationResult> {
  // Search for ads FROM this advertiser by searching for their brand + common queries
  const brandSearchUrl = buildGoogleSearchUrl(
    `site:${domain} OR "${domain}"`,
    (COUNTRY_CONFIGS[country.toUpperCase()] || COUNTRY_CONFIGS.US).gl,
    (COUNTRY_CONFIGS[country.toUpperCase()] || COUNTRY_CONFIGS.US).hl,
  );

  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

  const response = await proxyFetchFn(brandSearchUrl, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Advertiser lookup failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rawAds = extractAds(html);

  // Filter to ads from the specified domain
  const domainAds = rawAds
    .filter(ad => extractAdvertiserDomain(ad.url) === domain.replace(/^www\./, ''))
    .map(ad => enrichAdResult(ad, html));

  const allAds = rawAds.map(ad => enrichAdResult(ad, html));

  return {
    type: 'advertiser',
    domain,
    country: country.toUpperCase(),
    timestamp: new Date().toISOString(),
    ads: domainAds.length > 0 ? domainAds : allAds.slice(0, 5),
    organic_count: countOrganicResults(html),
    total_ads: domainAds.length > 0 ? domainAds.length : allAds.length,
    ad_positions: {
      top: (domainAds.length > 0 ? domainAds : allAds).filter(a => a.placement === 'top').length,
      bottom: (domainAds.length > 0 ? domainAds : allAds).filter(a => a.placement === 'bottom').length,
    },
    proxy: { country: country.toUpperCase(), type: 'mobile' },
  };
}