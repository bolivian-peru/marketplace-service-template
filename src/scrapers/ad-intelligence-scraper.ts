import { proxyFetch } from '../proxy';
import { scrapeMobileSERP } from './serp-tracker';

const SUPPORTED_COUNTRIES = new Set(['US', 'DE', 'FR', 'ES', 'GB', 'PL']);

const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  US: 'en',
  GB: 'en',
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  PL: 'pl',
};

const AD_NETWORK_PATTERNS: Array<{ network: string; pattern: RegExp }> = [
  { network: 'google', pattern: /(doubleclick|googlesyndication|googleadservices|adservice\.google)/i },
  { network: 'meta', pattern: /(facebook\.com\/tr|connect\.facebook\.net)/i },
  { network: 'amazon', pattern: /(amazon-adsystem)/i },
  { network: 'taboola', pattern: /(taboola)/i },
  { network: 'outbrain', pattern: /(outbrain)/i },
  { network: 'xandr', pattern: /(adnxs)/i },
  { network: 'criteo', pattern: /(criteo)/i },
];

export interface SearchAdsResult {
  type: 'search_ads';
  query: string;
  country: string;
  timestamp: string;
  ads: Array<{
    position: number;
    placement: 'top' | 'bottom';
    title: string;
    description: string;
    displayUrl: string;
    finalUrl: string;
    advertiser: string;
    extensions: string[];
    isResponsive: boolean;
  }>;
  organic_count: number;
  total_ads: number;
  ad_positions: {
    top: number;
    bottom: number;
  };
}

export interface DisplayAdsResult {
  type: 'display_ads';
  url: string;
  country: string;
  timestamp: string;
  ads: Array<{
    slot: number;
    network: string;
    creativeType: 'iframe' | 'script' | 'image';
    sourceUrl: string;
  }>;
  total_ads: number;
  network_breakdown: Record<string, number>;
}

export interface AdvertiserLookupResult {
  type: 'advertiser';
  domain: string;
  country: string;
  timestamp: string;
  transparency_url: string;
  ads_found: Array<{
    advertiser: string;
    headline: string;
    targetUrl: string;
  }>;
  total_ads: number;
}

function toAbsoluteUrl(candidate: string, base: string): string {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return candidate;
  }
}

function classifyNetwork(url: string): string {
  for (const entry of AD_NETWORK_PATTERNS) {
    if (entry.pattern.test(url)) return entry.network;
  }

  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '').split('.').slice(-2).join('.');
  } catch {
    return 'unknown';
  }
}

export function normalizeCountry(country: string | undefined): string {
  const normalized = (country || 'US').trim().toUpperCase();
  if (!SUPPORTED_COUNTRIES.has(normalized)) {
    throw new Error('Unsupported country. Use one of: US, DE, FR, ES, GB, PL');
  }
  return normalized;
}

export function normalizeDomain(domain: string | undefined): string {
  if (!domain) throw new Error('Missing required parameter: domain');
  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) {
    throw new Error('Invalid domain format. Example: nordvpn.com');
  }
  return cleaned;
}

function extractAdvertiser(displayUrl: string, finalUrl: string): string {
  const seed = finalUrl || displayUrl;
  try {
    const host = new URL(seed.startsWith('http') ? seed : `https://${seed}`).hostname;
    return host.replace(/^www\./, '').split('.')[0] || 'unknown';
  } catch {
    return (displayUrl || 'unknown').replace(/^www\./, '').split('.')[0] || 'unknown';
  }
}

export async function fetchSearchAds(query: string, country: string): Promise<SearchAdsResult> {
  const normalizedCountry = normalizeCountry(country);
  const language = COUNTRY_TO_LANGUAGE[normalizedCountry] || 'en';
  const serp = await scrapeMobileSERP(query, normalizedCountry.toLowerCase(), language);

  const ads = serp.ads.map((ad) => ({
    position: ad.position,
    placement: ad.isTop ? 'top' as const : 'bottom' as const,
    title: ad.title,
    description: ad.description,
    displayUrl: ad.displayUrl,
    finalUrl: ad.url,
    advertiser: extractAdvertiser(ad.displayUrl, ad.url),
    extensions: [],
    isResponsive: true,
  }));

  return {
    type: 'search_ads',
    query,
    country: normalizedCountry,
    timestamp: new Date().toISOString(),
    ads,
    organic_count: serp.organic.length,
    total_ads: ads.length,
    ad_positions: {
      top: ads.filter((ad) => ad.placement === 'top').length,
      bottom: ads.filter((ad) => ad.placement === 'bottom').length,
    },
  };
}

export async function fetchDisplayAds(targetUrl: string, country: string): Promise<DisplayAdsResult> {
  const normalizedCountry = normalizeCountry(country);

  const response = await proxyFetch(targetUrl, {
    timeoutMs: 45_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch target URL (${response.status})`);
  }

  const html = await response.text();
  const adMap = new Map<string, { creativeType: 'iframe' | 'script' | 'image'; sourceUrl: string }>();

  const iframeMatches = html.matchAll(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi);
  for (const match of iframeMatches) {
    const sourceUrl = toAbsoluteUrl(match[1], targetUrl);
    if (AD_NETWORK_PATTERNS.some((entry) => entry.pattern.test(sourceUrl))) {
      adMap.set(`iframe:${sourceUrl}`, { creativeType: 'iframe', sourceUrl });
    }
  }

  const scriptMatches = html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi);
  for (const match of scriptMatches) {
    const sourceUrl = toAbsoluteUrl(match[1], targetUrl);
    if (AD_NETWORK_PATTERNS.some((entry) => entry.pattern.test(sourceUrl))) {
      adMap.set(`script:${sourceUrl}`, { creativeType: 'script', sourceUrl });
    }
  }

  const imageMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
  for (const match of imageMatches) {
    const sourceUrl = toAbsoluteUrl(match[1], targetUrl);
    if (AD_NETWORK_PATTERNS.some((entry) => entry.pattern.test(sourceUrl))) {
      adMap.set(`image:${sourceUrl}`, { creativeType: 'image', sourceUrl });
    }
  }

  const ads = Array.from(adMap.values()).map((entry, index) => ({
    slot: index + 1,
    network: classifyNetwork(entry.sourceUrl),
    creativeType: entry.creativeType,
    sourceUrl: entry.sourceUrl,
  }));

  const network_breakdown: Record<string, number> = {};
  for (const ad of ads) {
    network_breakdown[ad.network] = (network_breakdown[ad.network] || 0) + 1;
  }

  return {
    type: 'display_ads',
    url: targetUrl,
    country: normalizedCountry,
    timestamp: new Date().toISOString(),
    ads,
    total_ads: ads.length,
    network_breakdown,
  };
}

export async function fetchAdvertiserAds(domain: string, country: string): Promise<AdvertiserLookupResult> {
  const normalizedCountry = normalizeCountry(country);
  const normalizedDomain = normalizeDomain(domain);

  const transparencyUrl = `https://adstransparency.google.com/?region=${normalizedCountry}&domain=${encodeURIComponent(normalizedDomain)}`;
  const response = await proxyFetch(transparencyUrl, {
    timeoutMs: 45_000,
    maxRetries: 2,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch advertiser data (${response.status})`);
  }

  const html = await response.text();
  const adsFound: Array<{ advertiser: string; headline: string; targetUrl: string }> = [];
  const seen = new Set<string>();

  const jsonLikePattern = /"headline"\s*:\s*"([^"]{2,140})"[\s\S]{0,220}?"(?:targetUrl|landingPage)"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/gi;
  for (const match of html.matchAll(jsonLikePattern)) {
    const headline = match[1].replace(/\\u0026/g, '&').trim();
    const targetUrl = match[2].replace(/\\\//g, '/').trim();
    const key = `${headline}|${targetUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    adsFound.push({
      advertiser: normalizedDomain,
      headline,
      targetUrl,
    });
  }

  return {
    type: 'advertiser',
    domain: normalizedDomain,
    country: normalizedCountry,
    timestamp: new Date().toISOString(),
    transparency_url: transparencyUrl,
    ads_found: adsFound,
    total_ads: adsFound.length,
  };
}
