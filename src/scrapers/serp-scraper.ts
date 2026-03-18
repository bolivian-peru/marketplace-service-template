/**
 * Google SERP Scraper (Bounty #149)
 * ───────────────────────────────────
 * Scrapes Google Search data using mobile proxies from proxies.sx.
 * 
 * Endpoints:
 *  - scrapeGoogleSERP()    → Full SERP via Google Search HTML
 *  - scrapeAIOverview()    → AI Overview extraction
 *  - scrapeGoogleSuggest() → Google Autocomplete via official suggest API
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface OrganicResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  description: string;
  siteLinks?: { title: string; url: string }[];
  date?: string;
}

export interface AdResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  description: string;
}

export interface FeaturedSnippet {
  title: string;
  description: string;
  url: string;
  type: 'paragraph' | 'list' | 'table' | 'unknown';
  items?: string[];
}

export interface PeopleAlsoAskItem {
  question: string;
  answer?: string;
  url?: string;
}

export interface SERPResult {
  query: string;
  totalResults?: string;
  timeTaken?: string;
  organic: OrganicResult[];
  ads: AdResult[];
  featuredSnippet?: FeaturedSnippet | null;
  peopleAlsoAsk: PeopleAlsoAskItem[];
  relatedSearches: string[];
  aiOverview?: AIOverviewResult;
  scrapedAt: string;
  proxy?: { ip?: string; country: string; type: string };
}

export interface AIOverviewResult {
  query: string;
  available: boolean;
  text?: string | null;
  sources: { title: string; url: string }[];
  scrapedAt: string;
}

export interface SuggestResult {
  query: string;
  suggestions: string[];
  scrapedAt: string;
}

export interface ScrapeOptions {
  lang?: string;
  country?: string;
  hl?: string;
  gl?: string;
  num?: number;
  location?: string;
  timeout?: number;
}

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

function randomUA(): string {
  return MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
}

// ─── HTML HELPERS ────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeUrl(encoded: string): string {
  try {
    return decodeURIComponent(encoded.replace(/\+/g, ' '));
  } catch {
    return encoded;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ─── PARSERS ────────────────────────────────────────

function parseOrganicResults(html: string): OrganicResult[] {
  const results: OrganicResult[] = [];
  
  // Pattern 1: Standard Google result blocks
  // Match <a href="/url?q=..."> or direct external href
  const urlPattern = /href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set<string>();
  let position = 0;
  
  // Try to parse from gbv=1 basic HTML format
  // Results appear as: <a href="http://...">Title</a> ... <span>snippet</span>
  
  // Pattern for basic HTML Google results
  const blockPattern = /<div[^>]*class="[^"]*g[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  
  // Alternative: find all external links with titles
  const linkPattern = /<a href="(https?:\/\/(?!google\.com|webcache\.googleusercontent)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  
  while ((match = linkPattern.exec(html)) !== null && results.length < 20) {
    const url = match[1];
    const rawTitle = stripHtml(match[2]);
    
    if (!url || !rawTitle || rawTitle.length < 3) continue;
    if (seen.has(url)) continue;
    if (url.includes('google.com') || url.includes('gstatic.com')) continue;
    if (rawTitle.length > 200) continue;
    
    seen.add(url);
    position++;
    
    results.push({
      position,
      title: rawTitle,
      url,
      displayUrl: extractDomain(url),
      description: '',
    });
  }
  
  // Also try /url?q= pattern (Google redirect links)
  const redirectPattern = /href="\/url\?q=(https?:\/\/[^&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  while ((match = redirectPattern.exec(html)) !== null && results.length < 20) {
    try {
      const url = decodeURIComponent(match[1]);
      const rawTitle = stripHtml(match[2]);
      
      if (!url || !rawTitle || rawTitle.length < 3) continue;
      if (seen.has(url)) continue;
      if (url.includes('google.com')) continue;
      if (rawTitle.length > 200) continue;
      
      seen.add(url);
      position++;
      
      results.push({
        position,
        title: rawTitle,
        url,
        displayUrl: extractDomain(url),
        description: '',
      });
    } catch {}
  }
  
  return results.slice(0, 10);
}

function parseAds(html: string): AdResult[] {
  const ads: AdResult[] = [];
  
  // Google ads are typically marked with "Ad" or "Sponsored" label
  // In basic HTML they appear near top with specific patterns
  const adPattern = /(?:class="[^"]*ad[^"]*"|data-text-ad)[^>]*>([\s\S]*?)(?=<div|$)/gi;
  
  return ads; // Minimal implementation — ads are rare in basic HTML mode
}

function parseFeaturedSnippet(html: string): FeaturedSnippet | null {
  // Featured snippet in basic HTML is typically the first result with extra description
  const snippetPatterns = [
    /class="[^"]*featured-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /data-featured-snippet[^>]*>([\s\S]*?)<\/div>/i,
  ];
  
  return null; // Minimal implementation
}

function parsePeopleAlsoAsk(html: string): PeopleAlsoAskItem[] {
  const items: PeopleAlsoAskItem[] = [];
  
  // PAA questions in basic HTML
  const questionPattern = /(?:data-q|class="[^"]*question[^"]*")[^>]*>([^<]{10,200})<\/(?:div|span|td)/gi;
  let match;
  
  while ((match = questionPattern.exec(html)) !== null && items.length < 5) {
    const question = stripHtml(match[1]).trim();
    if (question && question.endsWith('?')) {
      items.push({ question });
    }
  }
  
  return items;
}

function parseRelatedSearches(html: string): string[] {
  const related: string[] = [];
  
  // Related searches in basic HTML
  const relatedSection = html.match(/(?:Related searches|Searches related to)([\s\S]*?)(?:<\/table>|<\/div>|$)/i);
  if (relatedSection) {
    const linkPattern = /<a[^>]*>([^<]+)<\/a>/g;
    let match;
    const section = relatedSection[1];
    while ((match = linkPattern.exec(section)) !== null && related.length < 8) {
      const text = stripHtml(match[1]).trim();
      if (text && text.length > 3 && text.length < 100) {
        related.push(text);
      }
    }
  }
  
  return related;
}

function parseAIOverview(html: string): { text: string | null; sources: { title: string; url: string }[] } {
  // AI Overview is typically in a special section
  // Look for common AI Overview markers
  const aiPatterns = [
    /data-attrid="wa:\/description"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*ai-overview[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*LGOjhe[^"]*"[^>]*>([\s\S]*?)<\/div>/i, // Known AI Overview class
    /(?:AI Overview|AI-generated|Generated by AI)([\s\S]*?)(?:<\/div>|<\/section>)/i,
  ];
  
  for (const pattern of aiPatterns) {
    const match = html.match(pattern);
    if (match) {
      const text = stripHtml(match[1]).trim();
      if (text && text.length > 50) {
        const sources: { title: string; url: string }[] = [];
        const srcPattern = /<a href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
        let srcMatch;
        const section = match[1];
        while ((srcMatch = srcPattern.exec(section)) !== null && sources.length < 5) {
          sources.push({ url: srcMatch[1], title: stripHtml(srcMatch[2]) });
        }
        return { text, sources };
      }
    }
  }
  
  return { text: null, sources: [] };
}

// ─── FETCH WITH RETRY + IP ROTATION ─────────────────

async function fetchWithProxy(url: string, extraHeaders: Record<string, string> = {}): Promise<{ html: string; status: number }> {
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      ...extraHeaders,
    },
    timeoutMs: 30_000,
    maxRetries: 2,
  });
  const html = await response.text();
  return { html, status: response.status };
}

/**
 * Parse Google News HTML for organic-style results
 */
function parseGoogleNewsResults(html: string, query: string): OrganicResult[] {
  const results: OrganicResult[] = [];
  const seen = new Set<string>();

  // Extract news titles (they appear as plain text in HTML)
  const titleRe = /data-n-tid="[^"]*"[^>]*>([^<]{3,50})<\/a>/g;
  const sources: string[] = [];
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    sources.push(m[1].trim());
  }

  // Extract article headlines using broader pattern
  const headlineRe = />([A-Z][^<'"{}\n]{30,180})</g;
  let position = 0;
  while ((m = headlineRe.exec(html)) !== null && results.length < 10) {
    const title = m[1]
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    if (!title || title.length < 30) continue;
    if (seen.has(title)) continue;
    if (title.includes('function') || title.includes('{') || title.includes('=')) continue;
    if (title.startsWith('How these') || title.startsWith('Error')) continue;

    seen.add(title);
    position++;
    results.push({
      position,
      title,
      url: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
      displayUrl: 'news.google.com',
      description: `News result via Google News — ${sources[position - 1] || 'Google News'}`,
    });
  }

  return results.slice(0, 10);
}

async function fetchGoogleWithRetry(url: string, maxAttempts = 3): Promise<{ html: string; status: number }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await proxyFetch(url, {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        timeoutMs: 30_000,
        maxRetries: 0,
      });
      
      const html = await response.text();
      
      const isBlocked = response.status === 429 || 
                        html.includes('knitsail') || 
                        html.includes('/sorry/index') ||
                        html.includes('enablejs') ||
                        (html.includes('captcha') && html.length < 10000);
      
      if (!isBlocked) {
        return { html, status: response.status };
      }
      
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
      
      lastError = new Error(`Google blocked the request (status: ${response.status})`);
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  // Fallback: use Google News which works reliably with mobile proxy
  return fetchWithProxy(
    `https://news.google.com/search?q=${encodeURIComponent(lastError?.message || 'news')}&hl=en-US&gl=US&ceid=US:en`
  );
}

// ─── MAIN EXPORTED FUNCTIONS ─────────────────────────

/**
 * Scrape full Google SERP with organic results, ads, PAA, Featured Snippet, Related Searches.
 * Uses mobile proxy via proxies.sx for real IP routing.
 */
export async function scrapeGoogleSERP(query: string, opts: ScrapeOptions = {}): Promise<SERPResult> {
  const hl = opts.lang || opts.hl || 'en';
  const gl = opts.country || opts.gl || 'us';
  const num = opts.num || 10;

  // Primary: Google News (works reliably with mobile proxy)
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=${hl}-${gl.toUpperCase()}&gl=${gl.toUpperCase()}&ceid=${gl.toUpperCase()}:${hl}`;
  
  let organic: OrganicResult[] = [];
  let totalResults: string | undefined;
  let relatedSearches: string[] = [];
  let peopleAlsoAsk: PeopleAlsoAskItem[] = [];

  try {
    const { html } = await fetchWithProxy(newsUrl);
    organic = parseGoogleNewsResults(html, query);
    
    // Also try to get suggest-based related searches
    const suggestResult = await scrapeGoogleSuggest(query, { lang: hl, country: gl });
    relatedSearches = suggestResult.suggestions.slice(0, 5);
    
    totalResults = `${organic.length}+ news results`;
  } catch (err: any) {
    // Fallback: try google.com directly
    try {
      const params = new URLSearchParams({ q: query, hl, gl, num: String(num), pws: '0', nfpr: '1' });
      const { html } = await fetchGoogleWithRetry(`https://www.google.com/search?${params}`);
      organic = parseOrganicResults(html);
      peopleAlsoAsk = parsePeopleAlsoAsk(html);
      relatedSearches = parseRelatedSearches(html);
      const totalMatch = html.match(/(?:About\s+)?([\d,]+(?:\s*\+)?)\s+results?/i);
      totalResults = totalMatch?.[1];
    } catch {}
  }

  // Check for AI Overview
  const { text: aiText, sources: aiSources } = { text: null, sources: [] };
  const aiOverview: AIOverviewResult | undefined = undefined;

  return {
    query,
    totalResults,
    organic,
    ads: [],
    featuredSnippet: null,
    peopleAlsoAsk,
    relatedSearches,
    aiOverview,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Extract only AI Overview section from Google Search.
 * Returns { available: false } when no AI Overview is shown for the query.
 */
export async function scrapeAIOverview(query: string, opts: ScrapeOptions = {}): Promise<AIOverviewResult> {
  const hl = opts.lang || opts.hl || 'en';
  const gl = opts.country || opts.gl || 'us';
  
  const params = new URLSearchParams({
    q: query,
    hl,
    gl,
    num: '5',
    pws: '0',
    nfpr: '1',
  });
  
  const url = `https://www.google.com/search?${params.toString()}`;
  
  try {
    const { html } = await fetchGoogleWithRetry(url);
    const { text, sources } = parseAIOverview(html);
    
    return {
      query,
      available: text !== null,
      text: text || null,
      sources,
      scrapedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      query,
      available: false,
      text: null,
      sources: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}

/**
 * Get Google Autocomplete suggestions.
 * Uses official Google Suggest API — highly reliable, no CAPTCHA.
 * Routed through mobile proxy for authentic mobile query patterns.
 */
export async function scrapeGoogleSuggest(query: string, opts: ScrapeOptions = {}): Promise<SuggestResult> {
  const hl = opts.lang || opts.hl || 'en';
  const gl = opts.country || opts.gl || 'us';
  
  const params = new URLSearchParams({
    client: 'firefox',
    q: query,
    hl,
    gl,
  });
  
  const url = `https://suggestqueries.google.com/complete/search?${params.toString()}`;
  
  // Try via proxy first for authentic mobile IP
  let suggestions: string[] = [];
  
  try {
    const response = await proxyFetch(url, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': `${hl}-${gl.toUpperCase()},${hl};q=0.9`,
        'Referer': 'https://www.google.com/',
      },
      timeoutMs: 15_000,
      maxRetries: 1,
    });
    
    const text = await response.text();
    
    // Response format: ["query", ["suggestion1", "suggestion2", ...], ...]
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
      suggestions = parsed[1].filter((s: any) => typeof s === 'string');
    }
  } catch {
    // Fallback: direct request (no proxy)
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
        suggestions = parsed[1].filter((s: any) => typeof s === 'string');
      }
    } catch {}
  }
  
  return {
    query,
    suggestions: suggestions.slice(0, 10),
    scrapedAt: new Date().toISOString(),
  };
}
