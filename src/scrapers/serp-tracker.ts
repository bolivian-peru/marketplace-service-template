/**
 * Mobile SERP Tracker
 * ───────────────────
 * Scrapes Google mobile search results using real 4G/5G carrier IPs.
 * Extracts: organic results, ads, People Also Ask, featured snippets,
 * AI Overviews, map packs, knowledge panel, and related searches.
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

import type {
  OrganicResult,
  Sitelink,
  AdResult,
  PeopleAlsoAsk,
  FeaturedSnippet,
  AiOverview,
  MapPackResult,
  KnowledgePanel,
  SerpResponse,
} from '../types';

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

// ─── GOOGLE SEARCH URL BUILDER ──────────────────────

/**
 * Build Google search URL with mobile-specific parameters
 * Uses &gbv=1 to force basic HTML version (no JS required)
 */
export function buildGoogleSearchUrl(
  query: string,
  country: string = 'us',
  language: string = 'en',
  location?: string,
  start: number = 0,
): string {
  const params = new URLSearchParams({
    q: location ? `${query} ${location}` : query,
    hl: language,
    gl: country,
    num: '10',
    ie: 'UTF-8',
    oe: 'UTF-8',
    pws: '0',      // Disable personalized results
    gbv: '1',      // Force basic HTML (no JavaScript)
    nfpr: '1',     // No auto-correction
    complete: '0', // No autocomplete
  });

  if (start > 0) {
    params.set('start', String(start));
  }

  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * Check if a URL is a real external URL (not internal Google stuff)
 */
function isRealExternalUrl(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith('http')) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Block all Google-owned domains
    if (hostname.endsWith('google.com') || hostname.endsWith('google.co.uk') ||
        hostname.endsWith('google.ca') || hostname.endsWith('google.de') ||
        hostname.endsWith('gstatic.com') || hostname.endsWith('googleapis.com') ||
        hostname.endsWith('googleusercontent.com') || hostname.endsWith('googlesyndication.com') ||
        hostname.endsWith('googleadservices.com') || hostname.endsWith('googletagmanager.com') ||
        hostname.endsWith('google-analytics.com') || hostname.endsWith('youtube.com') ||
        hostname.endsWith('doubleclick.net') || hostname.endsWith('goo.gl') ||
        hostname === 'localhost') {
      return false;
    }
  } catch {
    return false;
  }

  if (url.includes('/httpservice/')) return false;
  return true;
}

/**
 * Resolve a Google redirect URL to the actual destination URL
 */
function resolveGoogleUrl(url: string): string | null {
  // Handle /url?q= redirects
  if (url.includes('/url?')) {
    const match = url.match(/[?&](?:q|url)=([^&]+)/);
    if (match) {
      const decoded = decodeURIComponent(match[1]);
      if (isRealExternalUrl(decoded)) return decoded;
    }
    return null;
  }
  // Direct external URLs
  if (isRealExternalUrl(url)) return url;
  return null;
}

// ─── HTML PARSING UTILITIES ─────────────────────────

/**
 * Strip HTML tags from a string
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Extract text content between HTML patterns
 */
function extractText(html: string, startPattern: RegExp, endPattern: RegExp): string | null {
  const startMatch = startPattern.exec(html);
  if (!startMatch) return null;

  const afterStart = html.substring(startMatch.index + startMatch[0].length);
  const endMatch = endPattern.exec(afterStart);
  if (!endMatch) return null;

  return stripTags(afterStart.substring(0, endMatch.index)).trim();
}

/**
 * Extract all matches of a pattern from HTML
 */
function extractAllMatches(html: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    matches.push(match);
  }
  return matches;
}

// ─── SERP EXTRACTION FUNCTIONS ──────────────────────

/**
 * Extract organic search results from HTML
 * Uses multiple strategies for both JS-rendered and basic HTML modes
 */
export function extractOrganicResults(html: string): OrganicResult[] {
  const results: OrganicResult[] = [];
  const seenUrls = new Set<string>();

  function addResult(url: string, title: string, snippet: string, blockHtml?: string): boolean {
    const resolved = resolveGoogleUrl(url);
    if (!resolved || seenUrls.has(resolved)) return false;
    if (!title || title.length < 3) return false;
    // Skip titles that are just "Cached" or navigation
    if (/^(?:cached|similar|translate|more results|sign in|help)$/i.test(title)) return false;

    seenUrls.add(resolved);
    results.push({
      position: results.length + 1,
      title: decodeHtmlEntities(title),
      url: resolved,
      displayUrl: extractDisplayUrl(resolved),
      snippet: decodeHtmlEntities(snippet),
      sitelinks: blockHtml ? extractSitelinks(blockHtml) : [],
      date: extractDate(snippet),
      cached: blockHtml ? /cache:/i.test(blockHtml) : false,
    });
    return true;
  }

  // Strategy 1: Standard result blocks (JS-rendered pages)
  const resultBlockPattern = /<div[^>]*class="[^"]*(?:MjjYud|Gx5Zad|g\b)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:MjjYud|Gx5Zad|g\b)|<footer|$)/gi;
  const blocks = extractAllMatches(html, resultBlockPattern);

  for (const block of blocks) {
    const parsed = parseOrganicBlock(block[1]);
    if (parsed) addResult(parsed.url, parsed.title, parsed.snippet, block[1]);
  }

  // Strategy 2: Basic HTML mode — <h3 class="r"><a href="/url?q=...">Title</a></h3>
  if (results.length === 0) {
    const basicPattern = /<h3[^>]*class="[^"]*r[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>[\s\S]*?(?:<span[^>]*class="[^"]*(?:st|aCOpRe)[^"]*"[^>]*>([\s\S]*?)<\/span>)?/gi;
    const basicMatches = extractAllMatches(html, basicPattern);

    for (const match of basicMatches) {
      addResult(match[1], stripTags(match[2]), stripTags(match[3] || ''));
    }
  }

  // Strategy 3: gbv=1 basic mode — links inside <div class="g"> blocks
  if (results.length === 0) {
    const gBlockPattern = /<div class="g">([\s\S]*?)<\/div>\s*(?=<div class="g">|$)/gi;
    const gBlocks = extractAllMatches(html, gBlockPattern);

    for (const gBlock of gBlocks) {
      const linkMatch = gBlock[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const snippetMatch = gBlock[1].match(/<span[^>]*class="[^"]*st[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
        || gBlock[1].match(/<div[^>]*class="[^"]*s[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      addResult(linkMatch[1], stripTags(linkMatch[2]), stripTags(snippetMatch?.[1] || ''), gBlock[1]);
    }
  }

  // Strategy 4: Any <a href="/url?q=..."> with following content (broadest fallback)
  if (results.length === 0) {
    const urlPattern = /<a[^>]*href="(\/url\?q=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const urlMatches = extractAllMatches(html, urlPattern);

    for (const match of urlMatches) {
      const title = stripTags(match[2]).trim();
      // Find snippet: look ahead up to 500 chars for a text block
      const afterLink = html.substring(match.index + match[0].length, match.index + match[0].length + 1000);
      const snippetMatch = afterLink.match(/<(?:span|div|td)[^>]*>([\s\S]{20,300}?)<\/(?:span|div|td)>/i);
      const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : '';
      addResult(match[1], title, snippet);
    }
  }

  // Strategy 5: Direct external links (last resort — any https link with title text)
  if (results.length === 0) {
    const directPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const directMatches = extractAllMatches(html, directPattern);

    for (const match of directMatches) {
      const title = stripTags(match[2]).trim();
      if (title.length < 5 || title.length > 200) continue;
      // Skip navigation-like links
      if (/^(?:here|click|next|prev|more|sign|log|help|learn|about)/i.test(title)) continue;
      addResult(match[1], title, '');
    }
  }

  return results;
}

/**
 * Extract date from snippet text
 */
function extractDate(text: string): string | null {
  const datePattern = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b)/i;
  const match = text.match(datePattern);
  return match ? match[1] : null;
}

/**
 * Parse an individual organic result block
 */
function parseOrganicBlock(blockHtml: string): OrganicResult | null {
  // Extract URL - look for main link (including /url?q= redirects)
  const linkPattern = /<a[^>]*href="((?:\/url\?q=|https?:\/\/)[^"]+)"[^>]*>/i;
  const linkMatch = blockHtml.match(linkPattern);
  if (!linkMatch) return null;

  const url = resolveGoogleUrl(linkMatch[1]) || '';
  if (!url) return null;

  // Extract title - typically in h3 or role="heading"
  const titlePatterns = [
    /<h3[^>]*>([^<]+)<\/h3>/i,
    /<div[^>]*role="heading"[^>]*>([^<]+)<\/div>/i,
    /<h3[^>]*>([\s\S]*?)<\/h3>/i,
    /<a[^>]*href="[^"]*"[^>]*><div[^>]*>([^<]+)<\/div>/i,
  ];

  let title = '';
  for (const pattern of titlePatterns) {
    const titleMatch = blockHtml.match(pattern);
    if (titleMatch) {
      title = stripTags(titleMatch[1]).trim();
      if (title.length > 2) break;
    }
  }

  if (!title) return null;

  // Extract snippet
  const snippetPatterns = [
    /<div[^>]*class="[^"]*(?:VwiC3b|IsZvec|s3v9rd)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class="[^"]*(?:aCOpRe|st)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*data-sncf="[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  let snippet = '';
  for (const pattern of snippetPatterns) {
    const snippetMatch = blockHtml.match(pattern);
    if (snippetMatch) {
      snippet = decodeHtmlEntities(stripTags(snippetMatch[1])).trim();
      if (snippet.length > 10) break;
    }
  }

  return {
    position: 0, // Will be set by caller
    title: decodeHtmlEntities(title),
    url,
    displayUrl: extractDisplayUrl(url),
    snippet,
    sitelinks: extractSitelinks(blockHtml),
    date: extractDate(snippet),
    cached: /cache:/i.test(blockHtml),
  };
}

/**
 * Extract display URL from full URL
 */
function extractDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`.substring(0, 80);
  } catch {
    return url.substring(0, 80);
  }
}

/**
 * Extract sitelinks from a result block
 */
function extractSitelinks(blockHtml: string): Sitelink[] {
  const sitelinks: Sitelink[] = [];

  // Pattern for inline sitelinks
  const sitelinkPattern = /<a[^>]*class="[^"]*(?:fl|sitelink)[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;

  while ((match = sitelinkPattern.exec(blockHtml)) !== null) {
    const url = match[1];
    const title = stripTags(match[2]).trim();
    if (title && !url.includes('google.com')) {
      sitelinks.push({ title: decodeHtmlEntities(title), url });
    }
  }

  return sitelinks;
}

/**
 * Extract ad results from HTML
 */
export function extractAds(html: string): AdResult[] {
  const ads: AdResult[] = [];
  const seenUrls = new Set<string>();

  // Top ads section
  const topAdsPattern = /<div[^>]*(?:id="tads"|class="[^"]*(?:uEierd|mnr-c)[^"]*")[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*(?:id="(?:res|search|center_col)"|class="[^"]*(?:MjjYud|hlcw0c)[^"]*"))/gi;
  const topMatch = topAdsPattern.exec(html);

  if (topMatch) {
    const topAds = parseAdSection(topMatch[1], true);
    for (const ad of topAds) {
      if (!seenUrls.has(ad.url)) {
        seenUrls.add(ad.url);
        ad.position = ads.length + 1;
        ads.push(ad);
      }
    }
  }

  // Bottom ads section
  const bottomAdsPattern = /<div[^>]*id="bottomads"[^>]*>([\s\S]*?)<\/div>\s*(?=<footer|$)/gi;
  const bottomMatch = bottomAdsPattern.exec(html);

  if (bottomMatch) {
    const bottomAds = parseAdSection(bottomMatch[1], false);
    for (const ad of bottomAds) {
      if (!seenUrls.has(ad.url)) {
        seenUrls.add(ad.url);
        ad.position = ads.length + 1;
        ads.push(ad);
      }
    }
  }

  // Fallback: look for sponsored labels
  if (ads.length === 0) {
    const sponsoredPattern = /(?:Sponsored|Ad)\s*(?:·|•)?[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<div[^>]*>([\s\S]*?)<\/div>)?/gi;
    let match;
    while ((match = sponsoredPattern.exec(html)) !== null) {
      let url = match[1];
      if (url.startsWith('/aclk') || url.includes('googleadservices')) {
        const realUrlMatch = url.match(/(?:adurl|dest)=([^&]+)/);
        if (realUrlMatch) url = decodeURIComponent(realUrlMatch[1]);
      }
      if (seenUrls.has(url) || !isRealExternalUrl(url)) continue;

      seenUrls.add(url);
      ads.push({
        position: ads.length + 1,
        title: decodeHtmlEntities(stripTags(match[2])),
        url,
        displayUrl: extractDisplayUrl(url),
        description: match[3] ? decodeHtmlEntities(stripTags(match[3])) : '',
        isTop: true,
      });
    }
  }

  // Filter out any ads with internal/non-real URLs
  return ads.filter(ad => isRealExternalUrl(ad.url));
}

/**
 * Parse ads from an ad section HTML
 */
function parseAdSection(sectionHtml: string, isTop: boolean): AdResult[] {
  const ads: AdResult[] = [];

  const adPattern = /<a[^>]*(?:data-rw|class="[^"]*(?:sVXRqc|Krnil)[^"]*")[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = adPattern.exec(sectionHtml)) !== null) {
    let url = match[1];
    const content = match[2];

    // Resolve Google redirect
    if (url.startsWith('/aclk') || url.includes('googleadservices')) {
      const realUrlMatch = url.match(/(?:adurl|dest)=([^&]+)/);
      if (realUrlMatch) url = decodeURIComponent(realUrlMatch[1]);
      else continue;
    }

    if (!isRealExternalUrl(url)) continue;

    const title = stripTags(content).trim();
    if (!title) continue;

    // Look for description after this ad
    const adIndex = sectionHtml.indexOf(match[0]);
    const afterAd = sectionHtml.substring(adIndex + match[0].length, adIndex + match[0].length + 500);
    const descMatch = afterAd.match(/<div[^>]*>([\s\S]*?)<\/div>/);
    const description = descMatch ? decodeHtmlEntities(stripTags(descMatch[1])) : '';

    ads.push({
      position: 0,
      title: decodeHtmlEntities(title),
      url,
      displayUrl: extractDisplayUrl(url),
      description,
      isTop,
    });
  }

  return ads;
}

/**
 * Extract People Also Ask questions
 */
export function extractPeopleAlsoAsk(html: string): PeopleAlsoAsk[] {
  const questions: PeopleAlsoAsk[] = [];
  const seenQuestions = new Set<string>();

  // Pattern 1: Standard PAA with data-q attribute
  const paaPattern = /data-q="([^"]+)"[\s\S]*?(?:<div[^>]*class="[^"]*(?:wDYxhc|LGOjhe)[^"]*"[^>]*>([\s\S]*?)<\/div>)?[\s\S]*?(?:<a[^>]*href="([^"]+)")?/gi;
  let match;

  while ((match = paaPattern.exec(html)) !== null) {
    const question = decodeHtmlEntities(match[1]);
    if (seenQuestions.has(question.toLowerCase())) continue;
    seenQuestions.add(question.toLowerCase());

    const snippet = match[2] ? decodeHtmlEntities(stripTags(match[2])).trim() : null;
    let url = match[3] || null;
    if (url?.includes('google.com')) url = null;

    questions.push({ question, snippet, url });
  }

  // Pattern 2: aria-expanded PAA sections
  if (questions.length === 0) {
    const ariaPattern = /aria-expanded="[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
    while ((match = ariaPattern.exec(html)) !== null) {
      const text = decodeHtmlEntities(match[1].trim());
      // Filter: PAA questions usually end with ? or are question-like
      if (text.length > 15 && text.length < 200 && !seenQuestions.has(text.toLowerCase())) {
        // Verify it looks like a question
        if (/\?$|^(?:what|how|why|when|where|which|who|is|are|can|do|does|will|should)/i.test(text)) {
          seenQuestions.add(text.toLowerCase());
          questions.push({ question: text, snippet: null, url: null });
        }
      }
    }
  }

  // Pattern 3: Related questions with jsname attributes
  if (questions.length === 0) {
    const jsnamePattern = /<div[^>]*jsname="[^"]*"[^>]*class="[^"]*(?:related-question|CBv0Pd)[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]{15,200})<\/span>/gi;
    while ((match = jsnamePattern.exec(html)) !== null) {
      const text = decodeHtmlEntities(match[1].trim());
      if (!seenQuestions.has(text.toLowerCase())) {
        seenQuestions.add(text.toLowerCase());
        questions.push({ question: text, snippet: null, url: null });
      }
    }
  }

  return questions;
}

/**
 * Extract featured snippet
 */
export function extractFeaturedSnippet(html: string): FeaturedSnippet | null {
  // Pattern 1: Featured snippet with class
  const fsPatterns = [
    /<div[^>]*class="[^"]*(?:IZ6rdc|xpdopen|kno-rdesc|LGOjhe|ayqGOc)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i,
    /<div[^>]*class="[^"]*(?:mod|wDYxhc)[^"]*"[^>]*data-md="[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*data-tts="answers"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of fsPatterns) {
    const match = html.match(pattern);
    if (match) {
      const content = match[1];
      const text = decodeHtmlEntities(stripTags(content)).trim();

      if (text.length < 20) continue;

      // Extract URL from the snippet block
      const urlMatch = content.match(/<a[^>]*href="(https?:\/\/(?!google\.com)[^"]+)"/i);
      const url = urlMatch ? urlMatch[1] : '';

      // Extract title
      const titleMatch = content.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i) ||
                         content.match(/<a[^>]*>([^<]+)<\/a>/i);
      const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : '';

      // Determine type
      let type: 'paragraph' | 'list' | 'table' | 'unknown' = 'paragraph';
      if (/<[uo]l/i.test(content)) type = 'list';
      else if (/<table/i.test(content)) type = 'table';

      return { text: text.substring(0, 500), url, title, type };
    }
  }

  return null;
}

/**
 * Extract AI Overview content
 */
export function extractAiOverview(html: string): AiOverview | null {
  // AI Overviews typically appear in specific containers
  const aiPatterns = [
    /<div[^>]*class="[^"]*(?:wSMpvd|SoJBgd|YsSBbe|KuSmQb|JMWMJ)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
    /<div[^>]*data-attrid="[^"]*ai[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*(?:mod)[^"]*"[^>]*>[\s\S]*?(?:AI Overview|AI-generated)([\s\S]*?)<\/div>\s*<\/div>/i,
  ];

  for (const pattern of aiPatterns) {
    const match = html.match(pattern);
    if (match) {
      const content = match[1];
      const text = decodeHtmlEntities(stripTags(content)).trim();

      if (text.length < 30) continue;

      // Extract source URLs
      const sources: { title: string; url: string }[] = [];
      const sourcePattern = /<a[^>]*href="(https?:\/\/(?!google\.com)[^"]+)"[^>]*>([^<]*)<\/a>/gi;
      let sourceMatch;
      while ((sourceMatch = sourcePattern.exec(content)) !== null) {
        const sourceTitle = stripTags(sourceMatch[2]).trim();
        if (sourceTitle) {
          sources.push({ title: decodeHtmlEntities(sourceTitle), url: sourceMatch[1] });
        }
      }

      return { text: text.substring(0, 1000), sources };
    }
  }

  return null;
}

/**
 * Extract map pack results
 */
export function extractMapPack(html: string): MapPackResult[] {
  const results: MapPackResult[] = [];
  const seenNames = new Set<string>();

  // Pattern 1: Local results with cXedhc class
  const mapPatterns = [
    /<div[^>]*class="[^"]*(?:VkpGBb|rllt__link|cXedhc|X7jIDe)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    /<div[^>]*data-cid="[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
  ];

  for (const mapPattern of mapPatterns) {
    let match;
    while ((match = mapPattern.exec(html)) !== null) {
      const cardHtml = match[1];

      // Extract name
      const namePatterns = [
        /<span[^>]*class="[^"]*(?:OSrXXb|dbg0pd|SPZz6b)[^"]*"[^>]*>([^<]+)<\/span>/i,
        /<div[^>]*role="heading"[^>]*>([^<]+)<\/div>/i,
        /aria-label="([^"]{3,60})"/i,
      ];

      let name = '';
      for (const namePattern of namePatterns) {
        const nameMatch = cardHtml.match(namePattern);
        if (nameMatch) {
          name = decodeHtmlEntities(nameMatch[1].trim());
          break;
        }
      }

      if (!name || name.length < 2 || seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());

      // Extract rating
      let rating: number | null = null;
      const ratingMatch = cardHtml.match(/(\d\.\d)\s*(?:\(|stars?)/i);
      if (ratingMatch) {
        const parsed = parseFloat(ratingMatch[1]);
        if (parsed >= 1 && parsed <= 5) rating = parsed;
      }

      // Extract review count
      let reviewCount: number | null = null;
      const reviewMatch = cardHtml.match(/\((\d{1,3}(?:,\d{3})*)\)/);
      if (reviewMatch) reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));

      // Extract category
      const catMatch = cardHtml.match(/·\s*([A-Za-z\s&]+?)(?:\s*·|\s*<|$)/);
      const category = catMatch ? catMatch[1].trim() : null;

      // Extract address
      const addrMatch = cardHtml.match(/(\d+\s+[^<,]+(?:St|Ave|Rd|Blvd|Dr)[^<]*)/i);
      const address = addrMatch ? decodeHtmlEntities(addrMatch[1].trim()) : null;

      // Extract phone
      const phoneMatch = cardHtml.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
      const phone = phoneMatch ? phoneMatch[1].trim() : null;

      results.push({ name, address, rating, reviewCount, category, phone });
    }

    if (results.length > 0) break;
  }

  return results;
}

/**
 * Extract knowledge panel
 */
export function extractKnowledgePanel(html: string): KnowledgePanel | null {
  // Knowledge panel container patterns
  const kpPatterns = [
    /<div[^>]*class="[^"]*(?:kp-wholepage|knowledge-panel|kno-result|osrp-blk)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
    /<div[^>]*data-attrid="title"[^>]*>([\s\S]*?)<\/div>[\s\S]*?(?:<div[^>]*data-attrid="subtitle"[^>]*>([\s\S]*?)<\/div>)?[\s\S]*?(?:<div[^>]*data-attrid="description"[^>]*>([\s\S]*?)<\/div>)?/i,
  ];

  for (const pattern of kpPatterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const content = match[0];

    // Extract title
    const titleMatch = content.match(/data-attrid="title"[^>]*>([^<]+)</i) ||
                       content.match(/<h2[^>]*class="[^"]*(?:qrShPb|kno-ecr-pt)[^"]*"[^>]*>([^<]+)/i);
    if (!titleMatch) continue;

    const title = decodeHtmlEntities(titleMatch[1].trim());
    if (title.length < 2) continue;

    // Extract type/subtitle
    const typeMatch = content.match(/data-attrid="subtitle"[^>]*>([^<]+)</i) ||
                     content.match(/<div[^>]*class="[^"]*(?:wwUB2c|YhemCb)[^"]*"[^>]*>([^<]+)/i);
    const type = typeMatch ? decodeHtmlEntities(typeMatch[1].trim()) : null;

    // Extract description
    const descMatch = content.match(/data-attrid="description"[^>]*>[\s\S]*?<span[^>]*>([^<]+)/i) ||
                     content.match(/<div[^>]*class="[^"]*(?:kno-rdesc|LGOjhe)[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)/i);
    const description = descMatch ? decodeHtmlEntities(descMatch[1].trim()) : null;

    // Extract URL
    const urlMatch = content.match(/<a[^>]*href="(https?:\/\/(?!google\.com)[^"]+)"[^>]*class="[^"]*(?:ruhjFe|ab_button)[^"]*"/i);
    const url = urlMatch ? urlMatch[1] : null;

    // Extract attributes (key-value pairs)
    const attributes: Record<string, string> = {};
    const attrPattern = /data-attrid="(?:kc:\/[^"]*?\/)?([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(content)) !== null) {
      const key = attrMatch[1].replace(/_/g, ' ').trim();
      const value = decodeHtmlEntities(attrMatch[2].trim());
      if (key && value && key !== 'title' && key !== 'subtitle' && key !== 'description') {
        attributes[key] = value;
      }
    }

    return { title, type, description, url, attributes };
  }

  return null;
}

/**
 * Extract related searches
 */
export function extractRelatedSearches(html: string): string[] {
  const searches: string[] = [];
  const seenSearches = new Set<string>();

  // Pattern 1: Related searches section
  const relatedPatterns = [
    /<a[^>]*class="[^"]*(?:k8XOCe|s75CSd|BVG0Nb)[^"]*"[^>]*>[\s\S]*?<div[^>]*>([^<]+)<\/div>/gi,
    /<p[^>]*class="[^"]*(?:s6JM6d|r2fjmd)[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi,
    /<a[^>]*href="\/search\?q=[^"]*"[^>]*class="[^"]*"[^>]*>([^<]+)<\/a>/gi,
  ];

  for (const pattern of relatedPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const search = decodeHtmlEntities(match[1].trim());
      if (search.length > 2 && search.length < 100 && !seenSearches.has(search.toLowerCase())) {
        seenSearches.add(search.toLowerCase());
        searches.push(search);
      }
    }
    if (searches.length > 0) break;
  }

  return searches;
}

/**
 * Extract total results count
 */
export function extractTotalResults(html: string): string | null {
  const patterns = [
    /About\s+([\d,]+)\s+results/i,
    /(?:About\s+)?([\d,]+)\s+results/i,
    /"resultStats"[^>]*>About\s+([\d,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// ─── MAIN SCRAPING FUNCTION ─────────────────────────

/**
 * Scrape Google mobile SERP for a query
 */
export async function scrapeMobileSERP(
  query: string,
  country: string = 'us',
  language: string = 'en',
  location?: string,
  start: number = 0,
): Promise<SerpResponse> {
  const url = buildGoogleSearchUrl(query, country, language, location, start);
  const userAgent = getRandomUserAgent();

  console.log(`[SERP] Fetching: ${url}`);

  const fetchHeaders: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': `${language},en;q=0.9`,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    // Google consent cookie — bypasses the "Before you continue" page
    'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
  };

  const response = await proxyFetch(url, {
    timeoutMs: 45000,
    maxRetries: 2,
    headers: fetchHeaders,
  });

  if (!response.ok) {
    throw new Error(`Google returned HTTP ${response.status}`);
  }

  const html = await response.text();

  console.log(`[SERP] HTML length: ${html.length}`);

  // Check for CAPTCHA
  if (html.includes('captcha') || html.includes('unusual traffic') || html.includes('detected unusual')) {
    throw new Error('Google CAPTCHA detected. Mobile proxy may be flagged — try a different proxy region.');
  }

  // Check for Google Security Gateway challenge (shouldn't happen with mobile proxies)
  if (html.includes('knitsail') || html.includes('/httpservice/retry/enablejs')) {
    throw new Error('Google served a security challenge. The proxy IP may be flagged — try rotating to a new IP.');
  }

  // Extract all SERP features
  const organic = extractOrganicResults(html);
  const ads = extractAds(html);
  const peopleAlsoAsk = extractPeopleAlsoAsk(html);
  const featuredSnippet = extractFeaturedSnippet(html);
  const aiOverview = extractAiOverview(html);
  const mapPack = extractMapPack(html);
  const knowledgePanel = extractKnowledgePanel(html);
  const relatedSearches = extractRelatedSearches(html);
  const totalResults = extractTotalResults(html);

  console.log(`[SERP] Results: ${organic.length} organic, ${ads.length} ads, ${peopleAlsoAsk.length} PAA, ${mapPack.length} map pack`);

  return {
    query,
    country,
    language,
    location: location || null,
    totalResults,
    organic,
    ads,
    peopleAlsoAsk,
    featuredSnippet,
    aiOverview,
    mapPack,
    knowledgePanel,
    relatedSearches,
  };
}
