/**
 * Ad Spy Scraper — Proxies.sx Marketplace Service
 * Bounty: Ad Spy ($200)
 *
 * Monitors Google search ads for competitor intelligence.
 * Tracks: advertiser, ad copy, landing page, position, keywords.
 * Uses Proxies.sx mobile proxies for geo-specific search results.
 *
 * Endpoints:
 *   GET /api/adspy/search?keyword=laptops&country=US
 *   GET /api/adspy/competitor?domain=nike.com&country=US
 */

import { proxyFetch } from '../proxy';

export interface AdResult {
  advertiser: string;
  title: string;
  description: string;
  displayUrl: string;
  landingUrl: string;
  position: 'top' | 'bottom';
  rank: number;
  keyword: string;
  country: string;
  scrapedAt: string;
}

export interface AdSpyResponse {
  keyword: string;
  country: string;
  totalAds: number;
  topAds: number;
  bottomAds: number;
  results: AdResult[];
  meta: { proxy: { ip: string; country: string; type: string } };
}

export const SERVICE_NAME = 'ad-spy';
export const PRICE_USDC = 0.005;
export const DESC = 'Spy on Google search ads. Track ad copy, landing pages, and competitor keywords across countries. Real mobile IP fingerprint.';

function extractAdsFromHTML(html: string, keyword: string, country: string): AdResult[] {
  const results: AdResult[] = [];

  // Google search ads appear in specific HTML patterns:
  // - Top ads: <div data-text-ad="1"> or <div class="uEierd">
  // - Bottom ads: similar but lower in page
  
  // Pattern 1: Text ad containers
  const adBlockRegex = /<div[^>]*(?:data-text-ad|class="[^"]*ad[^"]*")[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*data-text-ad|\s*$)/gi;
  const matches = html.match(adBlockRegex) || [];

  // Pattern 2: Try to find ad blocks by common Google ads markup
  const adBlocks = html.split(/<div[^>]*class="[^"]*(?:uEierd|pla-unit|commercial-unit)[^"]*"[^>]*>/i);
  
  // Also try span-based ad markup
  const citeMatches = html.match(/<cite[^>]*>([^<]+)<\/cite>/gi) || [];
  
  let position: 'top' | 'bottom' = 'top';
  let topDone = false;

  // Parse ad blocks
  for (let i = 1; i < adBlocks.length; i++) {
    const block = adBlocks[i];
    
    // Extract display URL
    const displayMatch = block.match(/<cite[^>]*>([^<]+)<\/cite>/i) || 
                         block.match(/<span[^>]*class="[^"]*VuuXrf[^"]*"[^>]*>([^<]+)<\/span>/i);
    
    // Extract title
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
                      block.match(/<span[^>]*role="heading"[^>]*>([\s\S]*?)<\/span>/i);
    
    // Extract description  
    const descMatch = block.match(/<div[^>]*class="[^"]*MUxGbd[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     block.match(/<div[^>]*data-snf[^>]*>([\s\S]*?)<\/div>/i);
    
    // Extract landing URL
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    
    if (displayMatch || titleMatch) {
      // Switch to bottom ads after first group
      if (!topDone && i > 2 && !displayMatch) {
        position = 'bottom';
        topDone = true;
      }

      results.push({
        advertiser: displayMatch ? displayMatch[1].replace(/<[^>]+>/g, '').trim() : 'Unknown',
        title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 200) : '',
        displayUrl: displayMatch ? displayMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        landingUrl: linkMatch ? linkMatch[1] : '',
        position,
        rank: results.length + 1,
        keyword,
        country,
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}

export async function searchAds(keyword: string, country: string = 'US'): Promise<AdSpyResponse> {
  const countryDomain: Record<string, string> = {
    US: 'google.com', UK: 'google.co.uk', DE: 'google.de',
    FR: 'google.fr', ES: 'google.es', JP: 'google.co.jp',
  };

  const domain = countryDomain[country] || 'google.com';
  const url = `https://www.${domain}/search?q=${encodeURIComponent(keyword)}&gl=${country}`;

  const result = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!result.ok) {
    return { keyword, country, totalAds: 0, topAds: 0, bottomAds: 0, results: [], 
      meta: { proxy: { ip: 'unavailable', country, type: 'mobile' } } };
  }

  const ads = extractAdsFromHTML(result.text || '', keyword, country);
  const topAds = ads.filter(a => a.position === 'top').length;

  return {
    keyword,
    country,
    totalAds: ads.length,
    topAds,
    bottomAds: ads.length - topAds,
    results: ads,
    meta: { proxy: { ip: 'proxies.sx-mobile', country, type: 'mobile' } },
  };
}

export async function spyOnCompetitor(domain: string, country: string = 'US'): Promise<AdSpyResponse> {
  // Search for brand keywords to find their ads
  const brandName = domain.replace(/https?:\/\//, '').replace(/www\./, '').split('.')[0];
  const keywords = [brandName, `${brandName} competitor`, `${brandName} alternative`];
  
  const allAds: AdResult[] = [];
  for (const kw of keywords) {
    const result = await searchAds(kw, country);
    allAds.push(...result.results.filter(a => 
      a.displayUrl.toLowerCase().includes(brandName.toLowerCase()) ||
      a.landingUrl.toLowerCase().includes(domain.toLowerCase().replace(/https?:\/\//, ''))
    ));
  }

  return {
    keyword: `competitor:${domain}`,
    country,
    totalAds: allAds.length,
    topAds: allAds.filter(a => a.position === 'top').length,
    bottomAds: allAds.filter(a => a.position === 'bottom').length,
    results: allAds,
    meta: { proxy: { ip: 'proxies.sx-mobile', country, type: 'mobile' } },
  };
}
