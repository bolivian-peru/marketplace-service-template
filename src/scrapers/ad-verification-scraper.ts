/**
 * Mobile Ad Verification & Creative Intelligence Scraper (Bounty #53)
 * ────────────────────────────────────────────────────────────────────
 * Shows exactly what ads appear for a given search query or URL
 * from a real mobile device on a real carrier network.
 *
 * Verifies geo-targeted ads are showing and captures competitor creatives.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface SearchAd {
  position: number;
  title: string;
  description: string;
  displayUrl: string;
  targetUrl: string;
  advertiser: string | null;
  extensions: string[];
  isTopAd: boolean;
}

export interface SearchAdResult {
  query: string;
  country: string;
  totalAds: number;
  topAds: SearchAd[];
  bottomAds: SearchAd[];
  organicResults: number;
}

export interface DisplayAd {
  adNetwork: string;
  size: string | null;
  advertiser: string | null;
  targetUrl: string | null;
  type: 'banner' | 'native' | 'video' | 'interstitial' | 'unknown';
}

export interface DisplayAdResult {
  url: string;
  country: string;
  totalAds: number;
  ads: DisplayAd[];
}

export interface AdvertiserInfo {
  domain: string;
  country: string;
  adsFound: number;
  adFormats: string[];
  lastSeen: string | null;
}

// ─── ERROR CLASS ────────────────────────────────────

export class AdVerificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AdVerificationError';
  }
  get httpStatus(): number {
    switch (this.code) {
      case 'captcha_detected': return 503;
      case 'rate_limited': return 503;
      case 'invalid_input': return 400;
      default: return 500;
    }
  }
  get shouldNotCharge(): boolean {
    return ['captcha_detected', 'rate_limited', 'scrape_failed'].includes(this.code);
  }
}

// ─── CONSTANTS ──────────────────────────────────────

const GOOGLE_DOMAINS: Record<string, string> = {
  US: 'www.google.com', DE: 'www.google.de', GB: 'www.google.co.uk',
  FR: 'www.google.fr', ES: 'www.google.es',
};

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ─── SCRAPING FUNCTIONS ─────────────────────────────

/**
 * Get search ads for a query from a specific country
 */
export async function getSearchAds(query: string, country: string = 'US'): Promise<SearchAdResult> {
  if (!query) throw new AdVerificationError('invalid_input', 'Search query is required');

  const normalizedCountry = country.toUpperCase();
  const domain = GOOGLE_DOMAINS[normalizedCountry] || GOOGLE_DOMAINS.US;
  const url = `https://${domain}/search?q=${encodeURIComponent(query)}&gl=${normalizedCountry.toLowerCase()}&hl=en`;

  console.log(`[ADS] Fetching search ads: ${url}`);

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    if (response.status === 429) throw new AdVerificationError('rate_limited', 'Google rate limited');
    throw new AdVerificationError('scrape_failed', `Google returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.length < 10000) {
    throw new AdVerificationError('captcha_detected', 'Google CAPTCHA triggered');
  }

  const topAds: SearchAd[] = [];
  const bottomAds: SearchAd[] = [];

  // Parse sponsored/ad results
  // Google marks ads with "Sponsored" label or specific CSS classes
  const adBlocks = html.split(/(?:Sponsored|Ad\s*·)/i);

  let position = 1;
  for (let i = 1; i < adBlocks.length; i++) {
    const block = adBlocks[i].slice(0, 2000);

    // Extract ad title - usually in a heading
    const titleMatch = block.match(/<h3[^>]*>([^<]+)<\/h3>/) ||
                       block.match(/<div[^>]*role="heading"[^>]*>([^<]+)/);
    if (!titleMatch) continue;

    // Extract display URL
    const urlMatch = block.match(/(?:class="[^"]*"[^>]*>)?((?:https?:\/\/)?[\w.-]+(?:\/[\w.-]*)*)/);

    // Extract description
    const descMatch = block.match(/<div[^>]*class="[^"]*"[^>]*>([^<]{20,200})/);

    // Extract target URL
    const hrefMatch = block.match(/href="(https?:\/\/[^"]+)"/);

    // Extensions (sitelinks, callouts, etc.)
    const extensions: string[] = [];
    const extMatches = block.matchAll(/<a[^>]*class="[^"]*sitelink[^"]*"[^>]*>([^<]+)/g);
    for (const em of extMatches) extensions.push(cleanText(em[1]));

    const isTop = i < 4; // First few ads are typically top ads

    const ad: SearchAd = {
      position: position++,
      title: cleanText(titleMatch[1]),
      description: descMatch ? cleanText(descMatch[1]) : '',
      displayUrl: urlMatch ? cleanText(urlMatch[1]) : '',
      targetUrl: hrefMatch ? hrefMatch[1] : '',
      advertiser: null,
      extensions,
      isTopAd: isTop,
    };

    if (isTop) topAds.push(ad);
    else bottomAds.push(ad);
  }

  // Count organic results
  const organicCount = (html.match(/class="g"/g) || []).length;

  return {
    query,
    country: normalizedCountry,
    totalAds: topAds.length + bottomAds.length,
    topAds,
    bottomAds,
    organicResults: organicCount,
  };
}

/**
 * Get display ads on a webpage
 */
export async function getDisplayAds(pageUrl: string, country: string = 'US'): Promise<DisplayAdResult> {
  if (!pageUrl) throw new AdVerificationError('invalid_input', 'URL is required');

  console.log(`[ADS] Fetching display ads: ${pageUrl}`);

  const response = await proxyFetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new AdVerificationError('scrape_failed', `Page returned ${response.status}`);
  }

  const html = await response.text();
  const ads: DisplayAd[] = [];

  // Detect ad networks from script/iframe sources
  const adNetworks: Record<string, string> = {
    'googlesyndication': 'Google AdSense',
    'googleadservices': 'Google Ads',
    'doubleclick': 'Google DoubleClick',
    'googletag': 'Google Publisher Tag',
    'facebook.com/tr': 'Facebook Pixel',
    'amazon-adsystem': 'Amazon Ads',
    'criteo': 'Criteo',
    'taboola': 'Taboola',
    'outbrain': 'Outbrain',
    'media.net': 'Media.net',
    'adnxs': 'AppNexus',
    'pubmatic': 'PubMatic',
    'rubiconproject': 'Rubicon',
  };

  for (const [pattern, network] of Object.entries(adNetworks)) {
    const count = (html.match(new RegExp(pattern, 'gi')) || []).length;
    if (count > 0) {
      ads.push({
        adNetwork: network,
        size: null,
        advertiser: null,
        targetUrl: null,
        type: network.includes('Taboola') || network.includes('Outbrain') ? 'native' : 'banner',
      });
    }
  }

  // Detect ad iframe sizes
  const iframeMatches = html.matchAll(/width[=:]\s*["']?(\d+)["']?\s*(?:;|,|\s)?\s*height[=:]\s*["']?(\d+)["']?/gi);
  const adSizes = new Set<string>();
  for (const m of iframeMatches) {
    const w = parseInt(m[1]), h = parseInt(m[2]);
    // Common ad sizes
    if ((w === 300 && h === 250) || (w === 728 && h === 90) || (w === 320 && h === 50) ||
        (w === 160 && h === 600) || (w === 300 && h === 600) || (w === 970 && h === 250)) {
      adSizes.add(`${w}x${h}`);
    }
  }

  return {
    url: pageUrl,
    country: country.toUpperCase(),
    totalAds: ads.length,
    ads,
  };
}

/**
 * Get advertiser info from Google Ads Transparency Center
 */
export async function getAdvertiserInfo(domain: string, country: string = 'US'): Promise<AdvertiserInfo> {
  if (!domain) throw new AdVerificationError('invalid_input', 'Domain is required');

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const url = `https://adstransparency.google.com/?domain=${encodeURIComponent(cleanDomain)}&region=${country.toLowerCase()}`;

  console.log(`[ADS] Checking advertiser: ${url}`);

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html',
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    throw new AdVerificationError('scrape_failed', `Google Ads Transparency returned ${response.status}`);
  }

  const html = await response.text();

  // Extract any ad format info
  const adFormats: string[] = [];
  if (html.includes('text')) adFormats.push('text');
  if (html.includes('image') || html.includes('display')) adFormats.push('display');
  if (html.includes('video')) adFormats.push('video');
  if (html.includes('shopping')) adFormats.push('shopping');

  return {
    domain: cleanDomain,
    country: country.toUpperCase(),
    adsFound: adFormats.length > 0 ? 1 : 0,
    adFormats: adFormats.length > 0 ? adFormats : ['unknown'],
    lastSeen: null,
  };
}
