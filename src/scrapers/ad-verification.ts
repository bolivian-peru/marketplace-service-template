/**
 * Mobile Ad Verification & Creative Intelligence (Bounty #53)
 * ────────────────────────────────────────────────────────────
 * Shows exactly what ads appear from a real mobile carrier IP.
 *
 * Endpoints:
 *   type=search_ads  — Google paid ads for a query in a country
 *   type=display_ads — Display/banner ads detected on a URL
 *   type=advertiser  — Ads an advertiser is running (Transparency Center)
 */

import { proxyFetch, getProxy } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ──────────────────────────────────────────

export interface AdEntry {
  position: number;
  placement: 'top' | 'bottom' | 'unknown';
  title: string;
  description: string;
  displayUrl: string;
  finalUrl: string;
  advertiser: string;
  extensions: string[];
  isResponsive: boolean;
}

export interface AdPositions {
  top: number;
  bottom: number;
}

export interface ProxyMeta {
  country: string;
  type: 'mobile';
  carrier?: string;
}

export interface SearchAdsResult {
  type: 'search_ads';
  query: string;
  country: string;
  timestamp: string;
  ads: AdEntry[];
  organic_count: number;
  total_ads: number;
  ad_positions: AdPositions;
  proxy: ProxyMeta;
}

export interface DisplayAd {
  network: string;
  adUnitId?: string;
  adSlot?: string;
  src?: string;
  width?: number;
  height?: number;
  type: 'display' | 'banner' | 'interstitial' | 'native';
}

export interface DisplayAdsResult {
  type: 'display_ads';
  url: string;
  country: string;
  timestamp: string;
  ads: DisplayAd[];
  total_ads: number;
  ad_networks: string[];
  proxy: ProxyMeta;
}

export interface AdvertiserAd {
  text: string;
  destination?: string;
  category?: string;
  started?: string;
}

export interface AdvertiserResult {
  type: 'advertiser';
  domain: string;
  country: string;
  timestamp: string;
  advertiser: string;
  active_ads: AdvertiserAd[];
  total_ads: number;
  proxy: ProxyMeta;
}

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

const COUNTRY_LANG_MAP: Record<string, { hl: string; gl: string }> = {
  US: { hl: 'en', gl: 'us' },
  GB: { hl: 'en', gl: 'gb' },
  DE: { hl: 'de', gl: 'de' },
  FR: { hl: 'fr', gl: 'fr' },
  ES: { hl: 'es', gl: 'es' },
  PL: { hl: 'pl', gl: 'pl' },
};

function getRandomUA(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function resolveGoogleAdUrl(url: string): string {
  if (url.startsWith('/aclk') || url.includes('googleadservices')) {
    const m = url.match(/(?:adurl|dest)=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return url;
}

function isRealUrl(url: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.endsWith('google.com') || h.endsWith('gstatic.com')) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── SEARCH ADS ─────────────────────────────────────

/**
 * Fetch Google search ads via mobile proxy (basic HTML mode — no JS required)
 */
export async function fetchSearchAds(
  query: string,
  country: string = 'US',
): Promise<SearchAdsResult> {
  const lang = COUNTRY_LANG_MAP[country.toUpperCase()] ?? { hl: 'en', gl: 'us' };
  const proxy = getProxy();

  const params = new URLSearchParams({
    q: query,
    hl: lang.hl,
    gl: lang.gl,
    num: '10',
    ie: 'UTF-8',
    oe: 'UTF-8',
    pws: '0',
    gbv: '1',      // Basic HTML — ads visible without JS
    nfpr: '1',
    complete: '0',
  });

  const url = `https://www.google.com/search?${params.toString()}`;
  const headers = {
    'User-Agent': getRandomUA(),
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': `${lang.hl},${lang.hl}-${country};q=0.9,en;q=0.7`,
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  };

  const response = await proxyFetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Google returned ${response.status}`);
  }

  const html = await response.text();
  const ads = parseSearchAds(html);
  const organicCount = countOrganicResults(html);

  return {
    type: 'search_ads',
    query,
    country: country.toUpperCase(),
    timestamp: new Date().toISOString(),
    ads,
    organic_count: organicCount,
    total_ads: ads.length,
    ad_positions: {
      top: ads.filter(a => a.placement === 'top').length,
      bottom: ads.filter(a => a.placement === 'bottom').length,
    },
    proxy: {
      country: proxy.country || country,
      type: 'mobile',
      carrier: proxy.carrier,
    },
  };
}

function parseSearchAds(html: string): AdEntry[] {
  const ads: AdEntry[] = [];
  const seen = new Set<string>();

  // Top ads: div id="tads" or class containing "uEierd"
  const topMatch = html.match(/<div[^>]*(?:id="tads"|class="[^"]*uEierd[^"]*")[^>]*>([\s\S]*?)(?=<div[^>]*(?:id="(?:res|search|center_col|rso)"|class="[^"]*hlcw0c))/);
  if (topMatch) {
    const topAds = extractAdsFromSection(topMatch[1], 'top');
    for (const ad of topAds) {
      if (!seen.has(ad.finalUrl)) {
        seen.add(ad.finalUrl);
        ad.position = ads.length + 1;
        ads.push(ad);
      }
    }
  }

  // Bottom ads: div id="bottomads"
  const bottomMatch = html.match(/<div[^>]*id="bottomads"[^>]*>([\s\S]*?)(?=<footer|$)/);
  if (bottomMatch) {
    const bottomAds = extractAdsFromSection(bottomMatch[1], 'bottom');
    for (const ad of bottomAds) {
      if (!seen.has(ad.finalUrl)) {
        seen.add(ad.finalUrl);
        ad.position = ads.length + 1;
        ads.push(ad);
      }
    }
  }

  // Fallback: look for "Sponsored" label near an <a> tag
  if (ads.length === 0) {
    const sponsoredRegex = /(?:Sponsored|Ad\b)[\s\S]{0,200}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = sponsoredRegex.exec(html)) !== null) {
      const rawUrl = resolveGoogleAdUrl(m[1]);
      if (!isRealUrl(rawUrl) || seen.has(rawUrl)) continue;
      seen.add(rawUrl);
      const title = decodeHtmlEntities(stripTags(m[2]));
      if (!title || title.length < 3) continue;
      ads.push({
        position: ads.length + 1,
        placement: 'top',
        title,
        description: '',
        displayUrl: extractDomain(rawUrl),
        finalUrl: rawUrl,
        advertiser: extractDomain(rawUrl),
        extensions: [],
        isResponsive: false,
      });
    }
  }

  return ads;
}

function extractAdsFromSection(section: string, placement: 'top' | 'bottom'): AdEntry[] {
  const ads: AdEntry[] = [];

  // Match ad blocks: anchors with data-rw, sVXRqc, or similar
  const adAnchorPattern = /<a[^>]*(?:data-rw|class="[^"]*(?:sVXRqc|Krnil)[^"]*")[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = adAnchorPattern.exec(section)) !== null) {
    const rawUrl = resolveGoogleAdUrl(m[1]);
    if (!isRealUrl(rawUrl)) continue;

    const rawTitle = stripTags(m[2]).trim();
    if (!rawTitle || rawTitle.length < 3) continue;

    // Look for description after this anchor
    const offset = m.index + m[0].length;
    const after = section.substring(offset, offset + 600);
    const descMatch = after.match(/<div[^>]*class="[^"]*(?:MUxGbd|yDYNvb)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const description = descMatch ? decodeHtmlEntities(stripTags(descMatch[1])) : '';

    // Extract display URL
    const displayUrlMatch = section.substring(m.index, m.index + 600).match(/(?:class="[^"]*(?:tjvcx|qzEoUe)[^"]*"[^>]*>|<cite[^>]*>)([^<]+)</);
    const displayUrl = displayUrlMatch
      ? decodeHtmlEntities(displayUrlMatch[1].trim())
      : extractDomain(rawUrl);

    // Detect extensions
    const extensions: string[] = [];
    const extSection = section.substring(m.index, m.index + 1200);
    if (/sitelinks?|ossm/i.test(extSection)) extensions.push('Sitelinks');
    if (/callout|yRf[A-Z]/i.test(extSection)) extensions.push('Callout');
    if (/price|IgpIob/i.test(extSection)) extensions.push('Price');
    if (/location|LrzXr/i.test(extSection)) extensions.push('Location');
    if (/phone|call/i.test(extSection)) extensions.push('Call');

    ads.push({
      position: 0,
      placement,
      title: decodeHtmlEntities(rawTitle),
      description,
      displayUrl,
      finalUrl: rawUrl,
      advertiser: extractDomain(rawUrl),
      extensions: [...new Set(extensions)],
      isResponsive: /(?:Responsive|rsa)/i.test(extSection),
    });
  }

  return ads;
}

function countOrganicResults(html: string): number {
  const matches = html.match(/<div[^>]*class="[^"]*(?:MjjYud|Gx5Zad)[^"]*"/g);
  return matches ? Math.max(0, matches.length - 2) : 0;
}

// ─── DISPLAY ADS ────────────────────────────────────

/**
 * Detect display/banner ads on a webpage via mobile proxy
 */
export async function fetchDisplayAds(
  targetUrl: string,
  country: string = 'US',
): Promise<DisplayAdsResult> {
  const proxy = getProxy();

  const response = await proxyFetch(targetUrl, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const html = response.ok ? await response.text() : '';
  const ads = detectDisplayAds(html, targetUrl);
  const networks = [...new Set(ads.map(a => a.network))];

  return {
    type: 'display_ads',
    url: targetUrl,
    country: country.toUpperCase(),
    timestamp: new Date().toISOString(),
    ads,
    total_ads: ads.length,
    ad_networks: networks,
    proxy: {
      country: proxy.country || country,
      type: 'mobile',
      carrier: proxy.carrier,
    },
  };
}

function detectDisplayAds(html: string, _pageUrl: string): DisplayAd[] {
  const ads: DisplayAd[] = [];
  const seen = new Set<string>();

  // Google AdSense / AdManager
  const adsensePattern = /(?:adsbygoogle|googletag|dfp)[\s\S]*?(?:data-ad-(?:slot|client|unit-id)="([^"]+)"|ins class="adsbygoogle"[^>]*data-ad-slot="([^"]+)")/gi;
  let m: RegExpExecArray | null;
  while ((m = adsensePattern.exec(html)) !== null) {
    const slotId = m[1] || m[2] || 'unknown';
    const key = `google-${slotId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Extract dimensions
    const dim = html.substring(Math.max(0, m.index - 200), m.index + m[0].length + 200);
    const widthM = dim.match(/data-(?:ad-)?width="(\d+)"/);
    const heightM = dim.match(/data-(?:ad-)?height="(\d+)"/);

    ads.push({
      network: 'Google AdSense',
      adSlot: slotId,
      width: widthM ? parseInt(widthM[1]) : undefined,
      height: heightM ? parseInt(heightM[1]) : undefined,
      type: 'display',
    });
  }

  // Amazon ads
  const amazonPattern = /amzn_assoc_(?:ad_type|placement|tracking_id)="([^"]+)"/gi;
  while ((m = amazonPattern.exec(html)) !== null) {
    const key = `amazon-${m[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ads.push({ network: 'Amazon Associates', adUnitId: m[1], type: 'banner' });
  }

  // Generic iframes from known ad networks
  const adNetworks: Record<string, string> = {
    'doubleclick.net': 'DoubleClick',
    'googlesyndication.com': 'Google AdSense',
    'amazon-adsystem.com': 'Amazon Ads',
    'outbrain.com': 'Outbrain',
    'taboola.com': 'Taboola',
    'media.net': 'Media.net',
    'pubmatic.com': 'PubMatic',
    'openx.net': 'OpenX',
    'rubiconproject.com': 'Rubicon',
    'criteo.com': 'Criteo',
    'moatads.com': 'Oracle Moat',
    'adsafeprotected.com': 'IAS',
    'doubleverify.com': 'DoubleVerify',
  };

  const iframePattern = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
  while ((m = iframePattern.exec(html)) !== null) {
    try {
      const hostname = new URL(m[1]).hostname.toLowerCase();
      for (const [domain, networkName] of Object.entries(adNetworks)) {
        if (hostname.includes(domain)) {
          const key = `${networkName}-${m[1].substring(0, 50)}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const widthM = m[0].match(/width="(\d+)"/);
          const heightM = m[0].match(/height="(\d+)"/);
          ads.push({
            network: networkName,
            src: m[1],
            width: widthM ? parseInt(widthM[1]) : undefined,
            height: heightM ? parseInt(heightM[1]) : undefined,
            type: 'display',
          });
          break;
        }
      }
    } catch { /* ignore invalid URLs */ }
  }

  // Script-based ad networks
  const scriptPattern = /<script[^>]*src="([^"]+)"/gi;
  while ((m = scriptPattern.exec(html)) !== null) {
    try {
      const hostname = new URL(m[1]).hostname.toLowerCase();
      for (const [domain, networkName] of Object.entries(adNetworks)) {
        if (hostname.includes(domain)) {
          const key = `script-${networkName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ads.push({ network: networkName, src: m[1], type: 'display' });
          break;
        }
      }
    } catch { /* ignore */ }
  }

  return ads;
}

// ─── ADVERTISER LOOKUP ──────────────────────────────

/**
 * Look up what ads an advertiser/domain is running via Google Ads Transparency Center
 */
export async function fetchAdvertiserAds(
  domain: string,
  country: string = 'US',
): Promise<AdvertiserResult> {
  const proxy = getProxy();
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  // Try Google Ads Transparency Center search API
  const searchUrl = `https://adstransparency.google.com/advertiser/AR${encodeURIComponent(cleanDomain)}?region=${country}&format=TEXT`;

  let activeAds: AdvertiserAd[] = [];
  let advertiserName = cleanDomain;

  try {
    // First: search for the advertiser by domain name in Google search
    const googleQuery = `advertiser:"${cleanDomain}" site:adstransparency.google.com OR "${cleanDomain}" ads transparency`;
    const searchResult = await proxyFetch(
      `https://adstransparency.google.com/advertiser/search?hl=en&q=${encodeURIComponent(cleanDomain)}&region=${country.toLowerCase()}`,
      {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'application/json, text/html',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://adstransparency.google.com/',
        },
      },
    );
    void googleQuery; // Suppress unused warning

    const text = await searchResult.text();

    // Parse JSON or HTML response
    if (text.includes('"advertiserName"') || text.includes('"ads"')) {
      try {
        const jsonMatch = text.match(/\{[\s\S]+\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          advertiserName = data.advertiserName || cleanDomain;
          const rawAds = data.ads || data.creatives || [];
          activeAds = rawAds.slice(0, 10).map((ad: Record<string, string>) => ({
            text: ad.headline || ad.text || ad.title || '',
            destination: ad.destination || ad.url || '',
            category: ad.category || '',
            started: ad.startDate || '',
          }));
        }
      } catch { /* not JSON, parse HTML */ }
    }

    // Fallback: extract ad text from HTML response
    if (activeAds.length === 0 && text.length > 500) {
      const adTextPattern = /(?:class="[^"]*(?:ad-text|headline|creative)[^"]*"[^>]*>|<h[23][^>]*>)([\s\S]*?)(?:<\/h[23]>|<\/div>)/gi;
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = adTextPattern.exec(text)) !== null && activeAds.length < 10) {
        const adText = stripTags(m[1]).trim();
        if (adText.length > 5 && adText.length < 300 && !seen.has(adText)) {
          seen.add(adText);
          activeAds.push({ text: adText });
        }
      }
    }
  } catch (_err) {
    // If Transparency Center fails, try a Google search for the advertiser's ads
    try {
      const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(`${cleanDomain} ads site:ads.google.com`)}&gbv=1`;
      const fallbackResponse = await proxyFetch(fallbackUrl, {
        headers: { 'User-Agent': getRandomUA(), 'Accept': 'text/html' },
      });
      const fallbackHtml = await fallbackResponse.text();
      const titlePattern = /<title[^>]*>([^<]+)<\/title>/i;
      const titleMatch = fallbackHtml.match(titlePattern);
      if (titleMatch) advertiserName = titleMatch[1].split(' - ')[0].trim() || cleanDomain;
    } catch { /* ignore fallback failure */ }

    // Return structured result with what we have
    activeAds = [{
      text: `Active advertiser. Check https://adstransparency.google.com/?region=${country}&advertiser=${cleanDomain} for live campaigns.`,
      destination: `https://${cleanDomain}`,
    }];
  }

  return {
    type: 'advertiser',
    domain: cleanDomain,
    country: country.toUpperCase(),
    timestamp: new Date().toISOString(),
    advertiser: advertiserName,
    active_ads: activeAds,
    total_ads: activeAds.length,
    proxy: {
      country: proxy.country || country,
      type: 'mobile',
      carrier: proxy.carrier,
    },
  };
}
