/**
 * Mobile Ad Verification Scraper (Bounty #53)
 * ───────────────────────────────────────────
 * Captures Google search ads and display ads from real mobile devices
 * on real carrier networks. Uses serp-tracker.ts infrastructure.
 */

import { proxyFetch, getProxy } from '../proxy';
import { extractAds, buildGoogleSearchUrl, getRandomUserAgent } from './serp-tracker';

export interface AdVerificationResult {
  type: 'search_ads' | 'display_ads' | 'advertiser';
  query?: string;
  url?: string;
  domain?: string;
  country: string;
  timestamp: string;
  ads: AdInfo[];
  organic_count: number;
  total_ads: number;
  ad_positions: {
    top: number;
    bottom: number;
  };
  proxy: { country: string; carrier: string; type: 'mobile' };
  payment: { txHash: string; amount: number; verified: boolean; network?: string };
}

export interface AdInfo {
  position: number;
  placement: 'top' | 'bottom' | 'sidebar';
  title: string;
  description: string;
  displayUrl: string;
  finalUrl: string;
  advertiser: string;
  extensions: string[];
  isResponsive: boolean;
}

// ─── HELPERS ────────────────────────────────────────

function sanitizeText(value: unknown, maxLen: number = 500): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function inferAdvertiser(title: string, displayUrl: string): string {
  // Extract brand name from ad title (first few words before common patterns)
  const brandPatterns = [
    /^(NordVPN|ExpressVPN|Surfshark|CyberGhost|Atlas VPN|PrivateVPN|HMA|IPVanish|TunnelBear|BulletVPN)/i,
    /^(Google|Apple|Microsoft|Amazon|Facebook|Meta|TikTok|Snap)/i,
    /^(Booking\.com| Expedia|Trivago|Kayak|Hotel|Hilton|Marriott|Airbnb)/i,
  ];
  for (const pattern of brandPatterns) {
    const match = title.match(pattern);
    if (match) return match[1];
  }
  return extractDomain(displayUrl);
}

function detectExtensions(block: string): string[] {
  const extensions: string[] = [];
  if (/sitelink|sitelinks/i.test(block)) extensions.push('Sitelinks');
  if (/callout|callouts/i.test(block)) extensions.push('Callout');
  if (/price|pricing|\$/i.test(block)) extensions.push('Price');
  if (/location|address/i.test(block)) extensions.push('Location');
  if (/phone|call/i.test(block)) extensions.push('Phone');
  if (/app install|download/i.test(block)) extensions.push('AppInstall');
  if (/rating|review|stars/i.test(block)) extensions.push('Rating');
  if (/snippet|snippets/i.test(block)) extensions.push('StructuredSnippets');
  return extensions;
}

function buildDisplayAdsUrl(url: string, country: string): string {
  return `${url}?hl=en&gl=${country}&utm_source=detect`;
}

// ─── GOOGLE SEARCH ADS ────────────────────────────────

/**
 * Capture Google search ads for a query from a specific country
 */
export async function captureSearchAds(
  query: string,
  country: string = 'US',
  language: string = 'en',
): Promise<AdVerificationResult> {
  const proxy = getProxy();
  const safeCountry = country.toUpperCase().slice(0, 2);
  const safeLang = language.toLowerCase().slice(0, 2);

  const url = buildGoogleSearchUrl(query, safeCountry, safeLang);

  console.log(`[AdVerification] Fetching search ads for "${query}" in ${safeCountry}: ${url}`);

  const fetchHeaders: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': `${safeLang},en;q=0.9`,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
  };

  const response = await proxyFetch(url, {
    timeoutMs: 45_000,
    maxRetries: 2,
    headers: fetchHeaders,
  });

  if (!response.ok) {
    throw new Error(`Google returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') || html.includes('unusual traffic')) {
    throw new Error('Google CAPTCHA detected — mobile proxy may be flagged');
  }

  const rawAds = extractAds(html);

  // Separate top vs bottom ads
  const topAds = rawAds.filter(a => a.isTop).slice(0, 4);
  const bottomAds = rawAds.filter(a => !a.isTop).slice(0, 3);

  // Count organic results (rough estimate)
  const organicCount = Math.max(5, html.split(/<div[^>]*class="[^"]*(?:g| organic)/i).length - 1);

  // Format ads into our schema
  const formattedAds: AdInfo[] = [];

  for (let i = 0; i < topAds.length; i++) {
    const ad = topAds[i];
    formattedAds.push({
      position: i + 1,
      placement: 'top',
      title: sanitizeText(ad.title),
      description: sanitizeText(ad.description),
      displayUrl: ad.displayUrl,
      finalUrl: ad.url,
      advertiser: inferAdvertiser(ad.title, ad.displayUrl),
      extensions: [],
      isResponsive: true,
    });
  }

  for (let i = 0; i < bottomAds.length; i++) {
    const ad = bottomAds[i];
    formattedAds.push({
      position: i + 1,
      placement: 'bottom',
      title: sanitizeText(ad.title),
      description: sanitizeText(ad.description),
      displayUrl: ad.displayUrl,
      finalUrl: ad.url,
      advertiser: inferAdvertiser(ad.title, ad.displayUrl),
      extensions: [],
      isResponsive: true,
    });
  }

  return {
    type: 'search_ads',
    query,
    country: safeCountry,
    timestamp: new Date().toISOString(),
    ads: formattedAds,
    organic_count: organicCount,
    total_ads: formattedAds.length,
    ad_positions: {
      top: topAds.length,
      bottom: bottomAds.length,
    },
    proxy: {
      country: proxy.country,
      carrier: proxy.host || 'mobile',
      type: 'mobile',
    },
    payment: { txHash: '', amount: 0, verified: false },
  };
}

// ─── DISPLAY ADS (URL) ────────────────────────────────

/**
 * Capture display/banner ads from a URL (from the perspective of a mobile user in a country)
 */
export async function captureDisplayAds(
  targetUrl: string,
  country: string = 'US',
): Promise<AdVerificationResult> {
  const proxy = getProxy();
  const safeCountry = country.toUpperCase().slice(0, 2);

  const userAgent = getRandomUserAgent();

  // Use proxy to fetch the target URL and look for ads
  // The ads we want to capture are Google Ads on the page
  const response = await proxyFetch(targetUrl, {
    timeoutMs: 30_000,
    maxRetries: 1,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'DNT': '1',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch target URL: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Extract Google Ads from the page
  const ads: AdInfo[] = [];

  // Google AdSense patterns
  const googleAdPatterns = [
    // Google Ads in iframes
    /googleads?\s*=\s*"([^"]+)"/gi,
    /data-ad[_-]?(?:slot|client|unit)[^=]*=\s*"([^"]+)"/gi,
    // Google Publisher Tags
    /googletag\.display\("([^"]+)"\)/gi,
  ];

  const seenUrls = new Set<string>();

  // Look for ad containers
  const adContainerPattern = /<ins[^>]*class="[^"]*ads-by-google[^"]*"[^>]*>([\s\S]*?)<\/ins>/gi;
  let match: RegExpExecArray | null;
  while ((match = adContainerPattern.exec(html)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<a[^>]*>([^<]{5,200})</i) || block.match(/title="([^"]{5,200})"/i);
    const urlMatch = block.match(/href="([^"]+)"[^>]*>/i);
    if (urlMatch) {
      const finalUrl = urlMatch[1];
      if (seenUrls.has(finalUrl)) continue;
      seenUrls.add(finalUrl);
      const title = titleMatch ? sanitizeText(titleMatch[1]) : extractDomain(finalUrl);
      ads.push({
        position: ads.length + 1,
        placement: 'top',
        title,
        description: '',
        displayUrl: extractDomain(finalUrl),
        finalUrl,
        advertiser: inferAdvertiser(title, extractDomain(finalUrl)),
        extensions: [],
        isResponsive: true,
      });
    }
  }

  // Also look for Google Ads iframe patterns
  const iframePattern = /<iframe[^>]*src="[^"]*(?:googlesyndication|googleadservices|doubleclick)[^"]*"[^>]*>/gi;
  while ((match = iframePattern.exec(html)) !== null) {
    const iframe = match[0];
    const adUrlMatch = iframe.match(/src="([^"]+)"/i);
    if (adUrlMatch && adUrlMatch[1]) {
      let adUrl = adUrlMatch[1];
      // Try to extract destination URL
      const destMatch = adUrl.match(/(?:url|dest|click)=([^&]+)/i);
      if (destMatch) {
        try { adUrl = decodeURIComponent(destMatch[1]); } catch { /* ignore */ }
      }
      if (seenUrls.has(adUrl)) continue;
      seenUrls.add(adUrl);
      ads.push({
        position: ads.length + 1,
        placement: 'top',
        title: extractDomain(adUrl),
        description: 'Display/Banner Ad',
        displayUrl: extractDomain(adUrl),
        finalUrl: adUrl,
        advertiser: extractDomain(adUrl),
        extensions: [],
        isResponsive: false,
      });
    }
  }

  // Look for any adsense-related links
  if (ads.length === 0) {
    const adsenseLinkPattern = /<a[^>]*href="([^"]*(?:doubleclick|googlesyndication|googleadservices|adclick|adservice)[^"]*)"[^>]*>([\s\S]{5,200}?)<\/a>/gi;
    while ((match = adsenseLinkPattern.exec(html)) !== null) {
      let finalUrl = match[1];
      const destMatch = finalUrl.match(/(?:url|dest)=([^&]+)/i);
      if (destMatch) {
        try { finalUrl = decodeURIComponent(destMatch[1]); } catch { /* ignore */ }
      }
      if (seenUrls.has(finalUrl)) continue;
      seenUrls.add(finalUrl);
      const title = sanitizeText(match[2]);
      ads.push({
        position: ads.length + 1,
        placement: 'top',
        title: title || extractDomain(finalUrl),
        description: '',
        displayUrl: extractDomain(finalUrl),
        finalUrl,
        advertiser: extractDomain(finalUrl),
        extensions: [],
        isResponsive: false,
      });
    }
  }

  return {
    type: 'display_ads',
    url: targetUrl,
    country: safeCountry,
    timestamp: new Date().toISOString(),
    ads,
    organic_count: 0,
    total_ads: ads.length,
    ad_positions: {
      top: ads.length,
      bottom: 0,
    },
    proxy: {
      country: proxy.country,
      carrier: proxy.host || 'mobile',
      type: 'mobile',
    },
    payment: { txHash: '', amount: 0, verified: false },
  };
}

// ─── ADVERTISER LOOKUP (Google Ads Transparency) ────

/**
 * Look up an advertiser's ads via Google Ads Transparency Center
 */
export async function lookupAdvertiser(
  domain: string,
  country: string = 'US',
): Promise<AdVerificationResult> {
  const proxy = getProxy();
  const safeCountry = country.toUpperCase().slice(0, 2);
  const userAgent = getRandomUserAgent();

  // Google Ads Transparency Center
  const url = `https://ads.google.com/TransparencyCenter/home?ocid=${encodeURIComponent(domain)}&hl=en&gl=${safeCountry}`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 1,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'DNT': '1',
    },
  });

  // If transparency center is not accessible, fall back to search
  if (!response.ok) {
    // Do a search for the advertiser's ads
    return captureSearchAds(`site:google.com ${domain} ads`, safeCountry);
  }

  const html = await response.text();

  const ads: AdInfo[] = [];
  const seenUrls = new Set<string>();

  // Parse ad entries from transparency center
  const adEntryPattern = /<div[^>]*class="[^"]*(?:ad-entry|ad-card)[^"]*"[^>]*>([\s\S]*?)<\/div>(?=<div[^>]*class="[^"]*(?:ad-entry|ad-card)|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = adEntryPattern.exec(html)) !== null && ads.length < 20) {
    const block = match[1];
    const titleMatch = block.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i) || block.match(/title="([^"]{5,200})"/i);
    const urlMatch = block.match(/href="(https?:\/\/[^"]+)"[^>]*>/i);
    if (urlMatch) {
      const finalUrl = urlMatch[1];
      if (seenUrls.has(finalUrl)) continue;
      seenUrls.add(finalUrl);
      const title = titleMatch ? sanitizeText(titleMatch[1]) : extractDomain(finalUrl);
      ads.push({
        position: ads.length + 1,
        placement: 'top',
        title,
        description: '',
        displayUrl: extractDomain(finalUrl),
        finalUrl,
        advertiser: domain,
        extensions: [],
        isResponsive: true,
      });
    }
  }

  return {
    type: 'advertiser',
    domain,
    country: safeCountry,
    timestamp: new Date().toISOString(),
    ads,
    organic_count: 0,
    total_ads: ads.length,
    ad_positions: { top: ads.length, bottom: 0 },
    proxy: {
      country: proxy.country,
      carrier: proxy.host || 'mobile',
      type: 'mobile',
    },
    payment: { txHash: '', amount: 0, verified: false },
  };
}
