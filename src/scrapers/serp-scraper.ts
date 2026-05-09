/**
 * SERP (Search Engine Results Page) Scraper
 * ───────────────────────────────────────────
 * Extracts organic search results from Google via mobile proxy.
 * Parses: title, URL, snippet, position, rich results.
 *
 * Uses Proxies.sx mobile proxy network for anti-detection.
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

export interface SerpResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  isAd: boolean;
  isCached: boolean;
  isRelated: boolean;
  richResultType?: string; // video, news, image, local, shopping
  site?: string;
  date?: string; // "2 hours ago", "Jan 15, 2025"
}

export interface SerpResponse {
  keyword: string;
  results: SerpResult[];
  totalResults: number;
  searchTime: number;
  domain: string;
  locale: string;
  proxy: { country: string; type: string };
}

// Google SERP mobile URL builder
function buildSerpUrl(keyword: string, locale: string = 'en', country: string = 'us'): string {
  const params = new URLSearchParams({
    q: keyword,
    gl: country,
    hl: locale,
    lr: `lang_${locale}`,
  });
  return `https://www.google.com/search?${params.toString()}&nbj=1`;
}

/**
 * Clean Google redirect URL back to original
 */
function cleanGoogleUrl(href: string): string {
  if (!href) return '';
  try {
    if (href.includes('google.com/url') || href.includes('google.com/search')) {
      const url = new URL(href, 'https://www.google.com');
      const direct = url.searchParams.get('url');
      if (direct) return direct;
    }
    // Filter out Google internal links
    if (href.includes('google.com') && !href.includes('google.com/search')) {
      const url = new URL(href, 'https://www.google.com');
      return url.searchParams.get('url') || href;
    }
  } catch { /* ignore */ }
  return href;
}

/**
 * Extract site name from URL for display
 */
function extractSite(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Parse date hint from snippet (e.g. "2 hours ago", "Jan 15")
 */
function extractDate(text: string): string | undefined {
  const datePatterns = [
    /(\d+\s*(hours?|days?|weeks?|months?|years?)\s*ago)/i,
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4})/i,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i,
    /(\d{4})/,
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Scrape Google SERP results through mobile proxy
 */
export async function scrapeSERP(
  keyword: string,
  locale: string = 'en',
  country: string = 'us',
): Promise<SerpResponse> {
  const startTime = Date.now();
  const url = buildSerpUrl(keyword, locale, country);

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `${locale}-${country.toUpperCase()},${locale};q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    timeoutMs: 20_000,
  });

  const html = await response.text();

  return parseSerpHtml(html, keyword, locale, country, Date.now() - startTime);
}

/**
 * Parse raw SERP HTML into structured results
 */
export function parseSerpHtml(
  html: string,
  keyword: string,
  locale: string,
  country: string,
  searchTimeMs: number,
): SerpResponse {
  // Dynamic import cheerio-like parser or use regex
  // Since this is Node, we use the built-in DOM-style parsing via regex
  const results: SerpResult[] = [];

  // ── Method: Parse individual result blocks ──────────────────
  // Google SERP results appear in various container formats.
  // We parse both desktop and mobile HTML structures.

  // Try VINE container (new Google format)
  const vineMatches = html.match(/<div class="vWNYee[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g) || [];

  // Try traditional g class
  const gMatches = html.match(/<div class="g\b[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) || [];

  // Try MjjYud (AI overview results)
  const aiMatches = html.match(/<div class="MjjYud[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) || [];

  const allMatches = [...vineMatches, ...gMatches, ...aiMatches];
  const seenUrls = new Set<string>();

  for (const block of allMatches) {
    if (results.length >= 50) break;

    // Extract title + link
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
                       block.match(/data-sncf="([^"]+)"/);
    let title = '';
    if (titleMatch) {
      // Strip HTML tags
      title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    const linkMatch = block.match(/href="(https?:\/\/[^"]+)"/) ||
                      block.match(/data-url="([^"]+)"/) ||
                      block.match(/url=([^&"\s]+)/);
    let url = linkMatch ? decodeURIComponent(linkMatch[1]) : '';
    url = cleanGoogleUrl(url);

    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    // Skip Google internal URLs
    if (url.includes('google.com/search') ||
        url.includes('google.com/url') ||
        url.includes('google.co') && !url.match(/\.(com|org|net)\//)) {
      continue;
    }

    // Extract snippet
    const snippetMatch = block.match(/<span[^>]*class="[^"]*(?:VwiC3b|IsZvec|aCOpRe)[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
                        block.match(/aria-label="([^"]+)"/);
    let snippet = snippetMatch
      ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, '').trim())
      : '';

    // Detect result type
    const isAd = /\b(ads?|sponsored|promo)\b/i.test(block) ||
                 /class="[^"]*compArticle[^"]*"/.test(block) ||
                 block.includes('data-adv-id');
    const isCached = /cached|webcache/i.test(block);
    const isRelated = /related:|people also ask/i.test(block);
    let richResultType: string | undefined;
    if (/video:|youtube/i.test(block)) richResultType = 'video';
    else if (/news:|published/i.test(block)) richResultType = 'news';
    else if (/shopping:|product/i.test(block)) richResultType = 'shopping';
    else if (/class="[^"]*local[^"]*"/i.test(block)) richResultType = 'local';

    if (!title && !snippet) continue;

    results.push({
      position: results.length + 1,
      title,
      url,
      displayUrl: extractSite(url),
      snippet: snippet.substring(0, 300),
      isAd,
      isCached,
      isRelated,
      richResultType,
      site: extractSite(url),
      date: extractDate(snippet),
    });
  }

  // ── Extract search metadata ──────────────────────────────
  const statsMatch = html.match(/About ([\d,]+) results?/i) ||
                     html.match(/([\d,]+)\s*results?/i);
  const totalResults = statsMatch
    ? parseInt(statsMatch[1].replace(/,/g, ''), 10)
    : results.length;

  return {
    keyword,
    results: results.filter(r => !r.isAd && !r.isRelated),
    totalResults,
    searchTime: Math.round(searchTimeMs / 1000 * 100) / 100,
    domain: 'google.com',
    locale,
    proxy: { country, type: 'mobile' },
  };
}
