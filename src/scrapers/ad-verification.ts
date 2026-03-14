/**
 * Mobile Ad Verification & Creative Intelligence
 * ────────────────────────────────────────────────
 * Scrapes ad creatives from Google Search and web pages using real 4G/5G
 * carrier IPs. Extracts ad copy, extensions, positions, ad networks,
 * brand safety signals, and viewability estimates.
 *
 * Uses Proxies.sx mobile proxies for authentic carrier-level ad targeting.
 */

import { proxyFetch, getProxy } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';
import type {
  AdCreative,
  DisplayAd,
  BrandSafetyScore,
  BrandSafetyCategory,
  BrandSafetyRisk,
  ViewabilityEstimate,
  DetectedAdNetwork,
  AdvertiserIntel,
} from '../types/ad-verification';

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

// ─── COUNTRY → GOOGLE DOMAIN MAPPING ───────────────

const COUNTRY_DOMAINS: Record<string, string> = {
  US: 'www.google.com',
  GB: 'www.google.co.uk',
  DE: 'www.google.de',
  FR: 'www.google.fr',
  ES: 'www.google.es',
  PL: 'www.google.pl',
};

const COUNTRY_LANGUAGES: Record<string, string> = {
  US: 'en',
  GB: 'en',
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  PL: 'pl',
};

const CARRIER_NAMES: Record<string, string> = {
  US: 'T-Mobile',
  GB: 'Vodafone',
  DE: 'Deutsche Telekom',
  FR: 'Orange',
  ES: 'Movistar',
  PL: 'Play',
};

// ─── HTML UTILITIES ─────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function extractAllMatches(html: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    matches.push(match);
  }
  return matches;
}

function extractDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`.substring(0, 80);
  } catch {
    return url.substring(0, 80);
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isExternalUrl(url: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (
      hostname.endsWith('google.com') ||
      hostname.endsWith('gstatic.com') ||
      hostname.endsWith('googleapis.com') ||
      hostname.endsWith('googleusercontent.com') ||
      hostname.endsWith('googlesyndication.com') ||
      hostname.endsWith('googleadservices.com') ||
      hostname.endsWith('doubleclick.net') ||
      hostname === 'localhost'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveGoogleRedirectUrl(url: string): string | null {
  if (url.includes('/aclk') || url.includes('googleadservices')) {
    const realUrlMatch = url.match(/(?:adurl|dest|url)=([^&]+)/);
    if (realUrlMatch) {
      const decoded = decodeURIComponent(realUrlMatch[1]);
      if (decoded.startsWith('http')) return decoded;
    }
    return null;
  }
  if (url.includes('/url?')) {
    const match = url.match(/[?&](?:q|url)=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  if (url.startsWith('http')) return url;
  return null;
}

// ─── AD EXTENSION DETECTION ────────────────────────

function detectExtensions(blockHtml: string): string[] {
  const extensions: string[] = [];

  // Sitelink extensions
  const sitelinkPattern = /<a[^>]*class="[^"]*(?:fl|sitelink|rIGyde)[^"]*"[^>]*>/gi;
  if (sitelinkPattern.test(blockHtml)) extensions.push('Sitelinks');

  // Callout extensions
  if (/(?:callout|YhemCb|qLYAZd)/i.test(blockHtml) || /(?:Free|Official|Trusted|Secure|Fast)/i.test(blockHtml)) {
    extensions.push('Callout');
  }

  // Structured snippet
  if (/(?:structured.?snippet|Extensions|Features|Types|Brands)/i.test(blockHtml)) {
    extensions.push('Structured Snippet');
  }

  // Call extension (phone number in ad)
  if (/(?:tel:|phone|call\s*now|\(\d{3}\))/i.test(blockHtml)) {
    extensions.push('Call');
  }

  // Location extension
  if (/(?:location|nearby|miles|km|address|map)/i.test(blockHtml)) {
    extensions.push('Location');
  }

  // Price extension
  if (/(?:price|from\s*\$|\$\d+|starting\s*at|per\s*month|\/mo)/i.test(blockHtml)) {
    extensions.push('Price');
  }

  // App extension
  if (/(?:app\s*store|google\s*play|download\s*app|install)/i.test(blockHtml)) {
    extensions.push('App');
  }

  // Promotion extension
  if (/(?:promotion|discount|off|sale|coupon|deal|save\s*\d)/i.test(blockHtml)) {
    extensions.push('Promotion');
  }

  // Seller ratings
  if (/(?:seller.?rating|★|☆|\d\.\d\s*\(\d+\))/i.test(blockHtml)) {
    extensions.push('Seller Rating');
  }

  return [...new Set(extensions)];
}

// ─── SEARCH AD EXTRACTION ──────────────────────────

function extractSearchAds(html: string): { ads: AdCreative[]; topCount: number; bottomCount: number } {
  const ads: AdCreative[] = [];
  const seenUrls = new Set<string>();
  let topCount = 0;
  let bottomCount = 0;

  // Strategy 1: Top ads section (tads div)
  const topAdsMatch = html.match(/<div[^>]*(?:id="tads"|class="[^"]*(?:uEierd|mnr-c|tads)[^"]*")[^>]*>([\s\S]*?)(?=<div[^>]*(?:id="(?:res|search|center_col|rso)"|class="[^"]*(?:MjjYud|hlcw0c)[^"]*"))/i);
  if (topAdsMatch) {
    const topAds = parseAdBlocks(topAdsMatch[1], 'top');
    for (const ad of topAds) {
      if (!seenUrls.has(ad.finalUrl)) {
        seenUrls.add(ad.finalUrl);
        ad.position = ads.length + 1;
        ads.push(ad);
        topCount++;
      }
    }
  }

  // Strategy 2: Bottom ads section
  const bottomAdsMatch = html.match(/<div[^>]*id="bottomads"[^>]*>([\s\S]*?)(?=<footer|<\/body|$)/i);
  if (bottomAdsMatch) {
    const bottomAds = parseAdBlocks(bottomAdsMatch[1], 'bottom');
    for (const ad of bottomAds) {
      if (!seenUrls.has(ad.finalUrl)) {
        seenUrls.add(ad.finalUrl);
        ad.position = ads.length + 1;
        ads.push(ad);
        bottomCount++;
      }
    }
  }

  // Strategy 3: Sponsored label detection (fallback)
  if (ads.length === 0) {
    const sponsoredPattern = /(?:Sponsored|Ad|Anzeige|Annonce|Anuncio|Reklama)\s*(?:·|•)?[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = sponsoredPattern.exec(html)) !== null) {
      let url = resolveGoogleRedirectUrl(match[1]);
      if (!url || seenUrls.has(url)) continue;

      const title = decodeHtmlEntities(stripTags(match[2]));
      if (!title || title.length < 3) continue;

      seenUrls.add(url);

      // Look for description after the link
      const afterIdx = match.index + match[0].length;
      const afterText = html.substring(afterIdx, afterIdx + 800);
      const descMatch = afterText.match(/<div[^>]*>([\s\S]*?)<\/div>/);
      const description = descMatch ? decodeHtmlEntities(stripTags(descMatch[1])).substring(0, 300) : '';

      ads.push({
        position: ads.length + 1,
        placement: 'top',
        title,
        description,
        displayUrl: extractDisplayUrl(url),
        finalUrl: url,
        advertiser: extractDomain(url),
        extensions: detectExtensions(html.substring(match.index, afterIdx + 800)),
        isResponsive: true,
        adNetwork: 'google-ads',
        adFormat: 'search',
      });
      topCount++;
    }
  }

  return { ads, topCount, bottomCount };
}

function parseAdBlocks(sectionHtml: string, placement: 'top' | 'bottom'): AdCreative[] {
  const ads: AdCreative[] = [];

  // Pattern: Individual ad blocks within the section
  const adBlockPattern = /<div[^>]*class="[^"]*(?:uEierd|mnr-c|Krnil|xpdopen)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:uEierd|mnr-c|Krnil|xpdopen)|$)/gi;
  const blocks = extractAllMatches(sectionHtml, adBlockPattern);

  // If no structured blocks found, parse the whole section
  const blocksToProcess = blocks.length > 0 ? blocks.map(b => b[1]) : [sectionHtml];

  for (const block of blocksToProcess) {
    // Find ad links
    const linkPattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    let bestUrl = '';
    let bestTitle = '';

    while ((linkMatch = linkPattern.exec(block)) !== null) {
      const rawUrl = linkMatch[1];
      const resolved = resolveGoogleRedirectUrl(rawUrl);
      if (!resolved || !isExternalUrl(resolved)) continue;

      const title = decodeHtmlEntities(stripTags(linkMatch[2]));
      if (title.length > bestTitle.length && title.length > 3) {
        bestTitle = title;
        bestUrl = resolved;
      }
    }

    if (!bestUrl || !bestTitle) continue;

    // Extract description
    const descPatterns = [
      /<div[^>]*class="[^"]*(?:MUxGbd|yDYNvb|lyLwlc|VwiC3b)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<span[^>]*class="[^"]*(?:MUxGbd|yDYNvb|r0bn4c)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ];

    let description = '';
    for (const dp of descPatterns) {
      const descMatch = block.match(dp);
      if (descMatch) {
        description = decodeHtmlEntities(stripTags(descMatch[1])).substring(0, 300);
        if (description.length > 10) break;
      }
    }

    // Detect if responsive search ad (RSA) — multiple headlines pattern
    const isResponsive = (block.match(/<h3/gi) || []).length > 1 || /responsive/i.test(block);

    ads.push({
      position: 0,
      placement,
      title: bestTitle.substring(0, 200),
      description,
      displayUrl: extractDisplayUrl(bestUrl),
      finalUrl: bestUrl,
      advertiser: extractDomain(bestUrl),
      extensions: detectExtensions(block),
      isResponsive,
      adNetwork: 'google-ads',
      adFormat: 'search',
    });
  }

  return ads;
}

// ─── DISPLAY AD EXTRACTION ─────────────────────────

function extractDisplayAds(html: string): DisplayAd[] {
  const ads: DisplayAd[] = [];
  const seenUrls = new Set<string>();

  // Detect ad iframes
  const iframePattern = /<iframe[^>]*(?:src|data-src)="([^"]*(?:doubleclick|googlesyndication|adservice|ad-|banner|adsense)[^"]*)"[^>]*(?:width="(\d+)"[^>]*height="(\d+)")?[^>]*>/gi;
  let match;
  while ((match = iframePattern.exec(html)) !== null) {
    const src = match[1];
    if (seenUrls.has(src)) continue;
    seenUrls.add(src);

    const width = match[2];
    const height = match[3];

    ads.push({
      position: ads.length + 1,
      type: 'banner',
      advertiser: extractAdNetworkFromUrl(src),
      landingUrl: null,
      adNetwork: detectAdNetworkName(src),
      dimensions: width && height ? `${width}x${height}` : null,
      isTracked: true,
      trackingPixels: [src],
    });
  }

  // Detect ad divs with common ad container patterns
  const adDivPattern = /<div[^>]*(?:id|class)="[^"]*(?:ad-|ads-|advert|banner|sponsor|promoted|dfp-|gpt-ad|adsense|ad_unit|ad-slot|adsbygoogle)[^"]*"[^>]*>([\s\S]*?)(?=<\/div>\s*<(?:div|section|article|main|footer))/gi;
  while ((match = adDivPattern.exec(html)) !== null) {
    const adContent = match[1];

    // Find ad links within the container
    const adLinkMatch = adContent.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    const landingUrl = adLinkMatch ? adLinkMatch[1] : null;

    // Find tracking pixels
    const trackingPixels = extractTrackingPixels(adContent);

    // Detect ad type
    let adType: DisplayAd['type'] = 'banner';
    if (/<video/i.test(adContent)) adType = 'video';
    else if (/(?:native|content-ad|promoted-content)/i.test(match[0])) adType = 'native';

    // Extract dimensions from style
    const styleMatch = adContent.match(/(?:width|min-width)\s*:\s*(\d+)px[\s\S]*?(?:height|min-height)\s*:\s*(\d+)px/i);
    const dimensions = styleMatch ? `${styleMatch[1]}x${styleMatch[2]}` : null;

    ads.push({
      position: ads.length + 1,
      type: adType,
      advertiser: landingUrl && isExternalUrl(landingUrl) ? extractDomain(landingUrl) : null,
      landingUrl: landingUrl && isExternalUrl(landingUrl) ? landingUrl : null,
      adNetwork: detectAdNetworkName(adContent),
      dimensions,
      isTracked: trackingPixels.length > 0,
      trackingPixels,
    });
  }

  // Detect adsbygoogle (AdSense) containers
  const adsensePattern = /<ins[^>]*class="adsbygoogle"[^>]*(?:data-ad-slot="([^"]*)")?[^>]*>/gi;
  while ((match = adsensePattern.exec(html)) !== null) {
    ads.push({
      position: ads.length + 1,
      type: 'banner',
      advertiser: null,
      landingUrl: null,
      adNetwork: 'google-adsense',
      dimensions: null,
      isTracked: true,
      trackingPixels: [],
    });
  }

  return ads;
}

function extractTrackingPixels(html: string): string[] {
  const pixels: string[] = [];
  const seen = new Set<string>();

  // 1x1 tracking pixels
  const imgPattern = /<img[^>]*src="([^"]+)"[^>]*(?:width="1"|height="1"|style="[^"]*display\s*:\s*none)[^>]*>/gi;
  let match;
  while ((match = imgPattern.exec(html)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      pixels.push(match[1]);
    }
  }

  // Script-based tracking
  const scriptSrcPattern = /<script[^>]*src="([^"]*(?:track|pixel|beacon|analytics|impression|click)[^"]*)"[^>]*>/gi;
  while ((match = scriptSrcPattern.exec(html)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      pixels.push(match[1]);
    }
  }

  return pixels;
}

function extractAdNetworkFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── AD NETWORK DETECTION ──────────────────────────

const AD_NETWORK_SIGNATURES: Record<string, { patterns: RegExp[]; type: DetectedAdNetwork['type'] }> = {
  'google-ads': {
    patterns: [/googleadservices|googlesyndication|google.*\/aclk|adservice\.google|pagead2/i],
    type: 'search',
  },
  'google-adsense': {
    patterns: [/adsbygoogle|adsense|pagead.*\/show_ads/i],
    type: 'display',
  },
  'google-dfp': {
    patterns: [/doubleclick\.net|dfp|googletag|gpt\.js|securepubads/i],
    type: 'programmatic',
  },
  'meta-ads': {
    patterns: [/facebook\.com\/tr|fbevents|connect\.facebook|fbcdn.*ad/i],
    type: 'social',
  },
  'amazon-ads': {
    patterns: [/amazon-adsystem|aax\.amazon|assoc-amazon/i],
    type: 'display',
  },
  'criteo': {
    patterns: [/criteo\.com|criteo\.net/i],
    type: 'programmatic',
  },
  'taboola': {
    patterns: [/taboola\.com|cdn\.taboola/i],
    type: 'native',
  },
  'outbrain': {
    patterns: [/outbrain\.com|outbrainimg/i],
    type: 'native',
  },
  'applovin': {
    patterns: [/applovin\.com|applvn/i],
    type: 'display',
  },
  'unity-ads': {
    patterns: [/unityads|unity3d.*ads/i],
    type: 'video',
  },
  'prebid': {
    patterns: [/prebid|pbjs|hb_adid/i],
    type: 'programmatic',
  },
  'bing-ads': {
    patterns: [/bingads|bat\.bing|ads\.microsoft/i],
    type: 'search',
  },
  'twitter-ads': {
    patterns: [/ads-twitter|ads\.twitter|t\.co.*ads/i],
    type: 'social',
  },
  'tiktok-ads': {
    patterns: [/analytics\.tiktok|ads\.tiktok/i],
    type: 'social',
  },
  'mediavine': {
    patterns: [/mediavine\.com|mv-script/i],
    type: 'display',
  },
  'ezoic': {
    patterns: [/ezoic\.com|ezodn\.com/i],
    type: 'display',
  },
  'adthrive': {
    patterns: [/adthrive|raptive\.com/i],
    type: 'display',
  },
};

function detectAdNetworkName(content: string): string {
  for (const [name, config] of Object.entries(AD_NETWORK_SIGNATURES)) {
    for (const pattern of config.patterns) {
      if (pattern.test(content)) return name;
    }
  }
  return 'unknown';
}

export function detectAdNetworks(html: string): DetectedAdNetwork[] {
  const networks: Map<string, DetectedAdNetwork> = new Map();

  for (const [name, config] of Object.entries(AD_NETWORK_SIGNATURES)) {
    for (const pattern of config.patterns) {
      if (pattern.test(html)) {
        if (!networks.has(name)) {
          // Extract tracking domains for this network
          const trackingDomains: Set<string> = new Set();
          const domainPattern = /(?:src|href)="(?:https?:)?\/\/([^"\/]+)/gi;
          let domainMatch;
          while ((domainMatch = domainPattern.exec(html)) !== null) {
            const domain = domainMatch[1].toLowerCase();
            for (const p of config.patterns) {
              if (p.test(domain)) {
                trackingDomains.add(domain);
              }
            }
          }

          // Count pixels/scripts for this network
          let pixelCount = 0;
          const pixelPattern = new RegExp(config.patterns.map(p => p.source).join('|'), 'gi');
          let pixelMatch;
          while ((pixelMatch = pixelPattern.exec(html)) !== null) {
            pixelCount++;
          }

          networks.set(name, {
            name,
            type: config.type,
            trackingDomains: Array.from(trackingDomains),
            pixelCount: Math.min(pixelCount, 100),
          });
        }
        break;
      }
    }
  }

  return Array.from(networks.values());
}

// ─── BRAND SAFETY SCORING ──────────────────────────

const BRAND_SAFETY_KEYWORDS: Record<BrandSafetyCategory, RegExp[]> = {
  adult: [
    /\b(?:porn|xxx|adult\s*content|nsfw|nude|sex\s*(?:video|chat|cam)|escort|strip\s*club)\b/i,
  ],
  violence: [
    /\b(?:kill|murder|gore|violent|blood\s*(?:bath|shed)|massacre|assault|shooting)\b/i,
  ],
  'hate-speech': [
    /\b(?:hate\s*group|supremac|racist|extremis|radicali[sz]|xenophob)\b/i,
  ],
  drugs: [
    /\b(?:buy\s*(?:weed|cocaine|heroin|meth)|drug\s*dealer|narco|illegal\s*substance)\b/i,
  ],
  gambling: [
    /\b(?:online\s*casino|bet(?:ting|365)|poker\s*online|slot\s*machine|gambl(?:ing|e)\s*online)\b/i,
  ],
  weapons: [
    /\b(?:buy\s*(?:gun|rifle|ammo)|illegal\s*weapon|firearm\s*sale|ghost\s*gun)\b/i,
  ],
  misinformation: [
    /\b(?:fake\s*news|conspiracy\s*theor|hoax|disinformation|propaganda\s*site)\b/i,
  ],
  piracy: [
    /\b(?:torrent|pirat(?:ed?|ing)|crack(?:ed|s)|serial\s*key|free\s*download\s*full|warez)\b/i,
  ],
  spam: [
    /\b(?:click\s*here\s*now|earn\s*money\s*fast|act\s*now|limited\s*offer|miracle\s*cure)\b/i,
  ],
  safe: [],
};

export function scoreBrandSafety(html: string): BrandSafetyScore {
  const pageText = stripTags(html).toLowerCase();
  const categories: BrandSafetyCategory[] = [];
  const flags: string[] = [];

  const pageContent = {
    hasAdultContent: false,
    hasViolentContent: false,
    hasHateSpeech: false,
    hasDrugContent: false,
    hasGamblingContent: false,
    hasMisinformation: false,
  };

  for (const [category, patterns] of Object.entries(BRAND_SAFETY_KEYWORDS)) {
    if (category === 'safe') continue;
    for (const pattern of patterns) {
      const matches = pageText.match(new RegExp(pattern.source, 'gi'));
      if (matches && matches.length > 0) {
        categories.push(category as BrandSafetyCategory);
        flags.push(`${category}: ${matches.length} signal(s) detected`);

        switch (category) {
          case 'adult': pageContent.hasAdultContent = true; break;
          case 'violence': pageContent.hasViolentContent = true; break;
          case 'hate-speech': pageContent.hasHateSpeech = true; break;
          case 'drugs': pageContent.hasDrugContent = true; break;
          case 'gambling': pageContent.hasGamblingContent = true; break;
          case 'misinformation': pageContent.hasMisinformation = true; break;
        }
        break;
      }
    }
  }

  if (categories.length === 0) {
    categories.push('safe');
  }

  // Calculate score (0-100, higher is safer)
  const penaltyWeights: Record<string, number> = {
    adult: 30,
    violence: 25,
    'hate-speech': 30,
    drugs: 25,
    gambling: 15,
    weapons: 20,
    misinformation: 20,
    piracy: 15,
    spam: 10,
  };

  let score = 100;
  for (const cat of categories) {
    score -= penaltyWeights[cat] || 0;
  }
  score = Math.max(0, score);

  let overall: BrandSafetyRisk;
  if (score >= 80) overall = 'low';
  else if (score >= 60) overall = 'medium';
  else if (score >= 30) overall = 'high';
  else overall = 'critical';

  return { overall, score, categories, flags, pageContent };
}

// ─── VIEWABILITY ESTIMATION ────────────────────────

export function estimateViewability(html: string, adCount: number): ViewabilityEstimate {
  const hasLazyLoading = /loading="lazy"|data-lazy|lazyload|IntersectionObserver/i.test(html);
  const hasInfiniteScroll = /infinite.?scroll|load.?more|endless/i.test(html);
  const mobileOptimized = /viewport.*width=device-width|@media.*max-width|responsive/i.test(html);

  // Estimate page load time based on content size and resource count
  const scriptCount = (html.match(/<script/gi) || []).length;
  const imageCount = (html.match(/<img/gi) || []).length;
  const totalResources = scriptCount + imageCount;

  let estimatedLoadTime: 'fast' | 'medium' | 'slow';
  if (totalResources < 20 && html.length < 200_000) estimatedLoadTime = 'fast';
  else if (totalResources < 50 && html.length < 500_000) estimatedLoadTime = 'medium';
  else estimatedLoadTime = 'slow';

  // Estimate viewability score
  // Base score starts at 70 (industry average for mobile)
  let score = 70;

  // Mobile optimization bonus
  if (mobileOptimized) score += 10;

  // Lazy loading can reduce viewability for below-fold ads
  if (hasLazyLoading) score -= 5;

  // Infinite scroll reduces viewability
  if (hasInfiniteScroll) score -= 10;

  // High ad density reduces viewability (ad clutter)
  if (adCount > 5) score -= 10;
  else if (adCount > 3) score -= 5;

  // Slow load time reduces viewability
  if (estimatedLoadTime === 'slow') score -= 10;
  else if (estimatedLoadTime === 'medium') score -= 5;

  score = Math.max(0, Math.min(100, score));

  // Above fold is assumed for first 2 ads
  const aboveFold = adCount > 0;
  const adDensity = adCount;
  const estimatedViewRate = score / 100;

  return {
    score,
    aboveFold,
    adDensity,
    estimatedViewRate,
    pageLoadFactors: {
      hasLazyLoading,
      hasInfiniteScroll,
      estimatedLoadTime,
      mobileOptimized,
    },
  };
}

// ─── ORGANIC RESULT COUNTING ────────────────────────

function countOrganicResults(html: string): number {
  // Count organic result blocks
  const patterns = [
    /<div[^>]*class="[^"]*(?:MjjYud|g\b|Gx5Zad)[^"]*"[^>]*>/gi,
    /<h3[^>]*class="[^"]*r[^"]*"[^>]*>/gi,
  ];

  let maxCount = 0;
  for (const p of patterns) {
    const matches = html.match(p);
    if (matches && matches.length > maxCount) {
      maxCount = matches.length;
    }
  }

  return maxCount || 10; // Default assumption
}

// ─── ADVERTISER INTELLIGENCE ────────────────────────

export async function lookupAdvertiser(
  domain: string,
  country: string = 'US',
): Promise<AdvertiserIntel> {
  const transparencyUrl = `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}&region=${country.toLowerCase()}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ads`)}&gl=${country.toLowerCase()}&hl=${COUNTRY_LANGUAGES[country] || 'en'}&gbv=1`;

  let adCount = 0;
  let adFormats: string[] = [];
  let verifiedByGoogle: boolean | null = null;
  let name: string | null = null;

  try {
    const response = await proxyFetch(searchUrl, {
      timeoutMs: 30000,
      maxRetries: 1,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': `${COUNTRY_LANGUAGES[country] || 'en'},en;q=0.9`,
        'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
      },
    });

    if (response.ok) {
      const html = await response.text();

      // Count ads from this domain
      const domainEscaped = domain.replace(/\./g, '\\.');
      const domainPattern = new RegExp(domainEscaped, 'gi');
      const domainMatches = html.match(domainPattern);
      adCount = domainMatches ? domainMatches.length : 0;

      // Try to extract advertiser name from knowledge panel or title
      const nameMatch = html.match(new RegExp(`${domainEscaped}[^<]*?(?:·|-)\\s*([^<·-]+)`, 'i'));
      if (nameMatch) name = decodeHtmlEntities(nameMatch[1]).trim();

      // Detect ad formats
      if (/(?:shopping|product)/i.test(html)) adFormats.push('shopping');
      if (/(?:video|youtube)/i.test(html)) adFormats.push('video');
      if (/(?:app|install|download)/i.test(html)) adFormats.push('app-install');
      adFormats.push('search'); // Assume search if they appear
    }
  } catch (err) {
    console.error(`[AD-VERIFY] Advertiser lookup failed for ${domain}:`, err);
  }

  // Query Google Ads Transparency Center
  try {
    const transparencyResponse = await proxyFetch(
      `https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?f.req=%5B%22${encodeURIComponent(domain)}%22%5D`,
      {
        timeoutMs: 15000,
        maxRetries: 1,
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'application/json',
        },
      },
    );

    if (transparencyResponse.ok) {
      verifiedByGoogle = true;
      const text = await transparencyResponse.text();
      // Simple count of ad entries
      const adEntries = text.match(/\"adCreative\"/gi);
      if (adEntries) adCount = Math.max(adCount, adEntries.length);
    }
  } catch {
    // Transparency Center may not be accessible via proxy; that's OK
  }

  return {
    domain,
    name,
    verifiedByGoogle,
    adCount,
    adFormats: [...new Set(adFormats)],
    regions: [country],
    lastSeen: new Date().toISOString(),
    transparencyUrl,
  };
}

// ─── MAIN SCRAPING FUNCTIONS ────────────────────────

/**
 * Scrape search ads for a query from a specific country using mobile proxy.
 */
export async function scrapeSearchAds(
  query: string,
  country: string = 'US',
): Promise<{
  ads: AdCreative[];
  organicCount: number;
  topCount: number;
  bottomCount: number;
  adNetworks: DetectedAdNetwork[];
  brandSafety: BrandSafetyScore;
  viewability: ViewabilityEstimate;
}> {
  const googleDomain = COUNTRY_DOMAINS[country] || 'www.google.com';
  const language = COUNTRY_LANGUAGES[country] || 'en';

  const params = new URLSearchParams({
    q: query,
    hl: language,
    gl: country.toLowerCase(),
    num: '10',
    ie: 'UTF-8',
    oe: 'UTF-8',
    pws: '0',
    nfpr: '1',
    complete: '0',
  });

  const url = `https://${googleDomain}/search?${params.toString()}`;
  const userAgent = getRandomUserAgent();

  console.log(`[AD-VERIFY] Search ads fetch: ${url}`);

  const response = await proxyFetch(url, {
    timeoutMs: 45000,
    maxRetries: 2,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `${language},en;q=0.9`,
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
    },
  });

  if (!response.ok) {
    throw new Error(`Google returned HTTP ${response.status}`);
  }

  const html = await response.text();

  // Check for CAPTCHA
  if (html.includes('captcha') || html.includes('unusual traffic') || html.includes('detected unusual')) {
    throw new Error('Google CAPTCHA detected. Mobile proxy may be flagged.');
  }

  if (html.includes('knitsail') || html.includes('/httpservice/retry/enablejs')) {
    throw new Error('Google served a security challenge. The proxy IP may be flagged.');
  }

  const { ads, topCount, bottomCount } = extractSearchAds(html);
  const organicCount = countOrganicResults(html);
  const adNetworks = detectAdNetworks(html);
  const brandSafety = scoreBrandSafety(html);
  const viewability = estimateViewability(html, ads.length);

  console.log(`[AD-VERIFY] Found ${ads.length} search ads (${topCount} top, ${bottomCount} bottom)`);

  return { ads, organicCount, topCount, bottomCount, adNetworks, brandSafety, viewability };
}

/**
 * Scrape display/banner ads from a webpage using mobile proxy.
 */
export async function scrapeDisplayAds(
  targetUrl: string,
  country: string = 'US',
): Promise<{
  ads: DisplayAd[];
  adNetworks: DetectedAdNetwork[];
  brandSafety: BrandSafetyScore;
  viewability: ViewabilityEstimate;
}> {
  console.log(`[AD-VERIFY] Display ads fetch: ${targetUrl}`);

  // Validate URL
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP/HTTPS URLs are supported');
    }
    // SSRF protection
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new Error('Internal/private URLs are not allowed');
    }
  } catch (err: any) {
    if (err.message.includes('not allowed') || err.message.includes('Only HTTP')) throw err;
    throw new Error('Invalid URL provided');
  }

  const response = await proxyFetch(targetUrl, {
    timeoutMs: 45000,
    maxRetries: 2,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `${COUNTRY_LANGUAGES[country] || 'en'},en;q=0.9`,
      'DNT': '1',
    },
  });

  if (!response.ok) {
    throw new Error(`Target URL returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const ads = extractDisplayAds(html);
  const adNetworks = detectAdNetworks(html);
  const brandSafety = scoreBrandSafety(html);
  const viewability = estimateViewability(html, ads.length);

  console.log(`[AD-VERIFY] Found ${ads.length} display ads, ${adNetworks.length} ad networks`);

  return { ads, adNetworks, brandSafety, viewability };
}
