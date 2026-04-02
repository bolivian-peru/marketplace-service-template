/**
 * Google Discover Feed Scraper (Bounty #52)
 * ───────────────────────────────────────────
 * Scrapes Google Discover feed from mobile browsers via proxy.
 * Google Discover is MOBILE-ONLY — no desktop version exists.
 */

import { proxyFetch, getProxy } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

export interface DiscoverArticle {
  position: number;
  title: string;
  source: string;
  sourceUrl: string;
  url: string;
  snippet: string;
  imageUrl: string | null;
  contentType: string;
  publishedAt: string | null;
  category: string;
  engagement: {
    hasVideoPreview: boolean;
    format: string;
  };
}

export interface DiscoverFeedResponse {
  country: string;
  category: string;
  timestamp: string;
  discover_feed: DiscoverArticle[];
  metadata: {
    feedLength: number;
    scrapedAt: string;
    proxyCountry: string;
    proxyCarrier: string;
  };
}

const MAX_HTML_BYTES = 2_000_000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const MAX_SNIPPET_LENGTH = 500;
const MAX_SOURCE_LENGTH = 120;

function sanitizeText(value: unknown, maxLen: number): string {
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

function resolveGoogleUrl(rawUrl: string): string | null {
  if (rawUrl.includes('/url?')) {
    const match = rawUrl.match(/[?&]q=([^&]+)/);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch { return null; }
    }
  }
  if (rawUrl.startsWith('http')) return rawUrl;
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildDiscoverUrl(country: string, category?: string): string {
  const cc = country.toLowerCase();
  // Google Discover is accessed via Google app / Chrome mobile newsfeed
  // Try news feed URL with geo parameter
  const base = `https://www.google.com/webmasters/tools/google-discover-feed?hl=en&gl=${cc}`;
  return base;
}

/**
 * Parse Google Discover feed HTML
 * Discover content appears in structured JSON-LD or HTML microdata
 */
function parseDiscoverFeed(html: string, country: string, category: string): DiscoverArticle[] {
  const articles: DiscoverArticle[] = [];

  // Strategy 1: Parse JSON-LD structured data (most reliable for Discover)
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'ItemList' || item['@type'] === 'NewsArticle') {
          const listItems = item.itemListElement || [item];
          for (const li of listItems) {
            const article = parseJsonLdArticle(li, articles.length + 1);
            if (article) articles.push(article);
          }
        }
      }
    } catch { /* not JSON, skip */ }
  }

  // Strategy 2: Parse Google Discover card blocks
  // Discover articles appear in divs with specific classes
  const discoverBlockPattern = /<div[^>]*class="[^"]*(?:mR2gOd|kA9Krf|YVvtgd|Z4EEX|INl8Dc)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:mR2gOd|kA9Krf|YVvtgd|Z4EEX|INl8Dc)|$)/gi;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = discoverBlockPattern.exec(html)) !== null && articles.length < 25) {
    const block = blockMatch[1];
    const article = parseDiscoverBlock(block, articles.length + 1);
    if (article) articles.push(article);
  }

  // Strategy 3: Generic article cards — look for title + source + URL patterns
  if (articles.length === 0) {
    // Pattern: <a href="/url?q=...google.com..." ...>Article Title</a>
    const articlePattern = /<a[^>]*href="(\/url\?q=[^"]+)"[^>]*>([^<]{10,})<\/a>[\s\S]*?src="([^"]+)"[\s\S]*?<span[^>]*class="[^"]*"[^>]*>([^<]{3,})<\/span>/gi;
    let match;
    while ((match = articlePattern.exec(html)) !== null && articles.length < 25) {
      const url = resolveGoogleUrl(match[1]);
      if (!url) continue;
      const title = sanitizeText(stripTags(match[2]), MAX_TITLE_LENGTH);
      if (!title) continue;
      const imageUrl = match[3] && match[3].startsWith('http') ? match[3].slice(0, MAX_URL_LENGTH) : null;
      const source = sanitizeText(stripTags(match[4]), MAX_SOURCE_LENGTH) || extractDomain(url);

      articles.push({
        position: articles.length + 1,
        title,
        source,
        sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(source)}&hl=en&gl=${country}`,
        url,
        snippet: '',
        imageUrl,
        contentType: detectContentType(blockMatch?.[1] || '', imageUrl),
        publishedAt: null,
        category: category || 'general',
        engagement: { hasVideoPreview: false, format: 'standard' },
      });
    }
  }

  // Strategy 4: Parse any article-like blocks with title/source/time
  if (articles.length === 0) {
    const genericPattern = /<a[^>]*href="(\/url\?q=[^"]+)"[^>]*>([^<]{10,300})<\/a>/gi;
    let match;
    while ((match = genericPattern.exec(html)) !== null && articles.length < 25) {
      const url = resolveGoogleUrl(match[1]);
      if (!url) continue;
      const title = sanitizeText(stripTags(match[2]), MAX_TITLE_LENGTH);
      if (!title || title.length < 5) continue;
      // Skip nav links
      if (/^(?:more|next|back|sign in|sign up|learn more|read more)/i.test(title)) continue;

      // Look for source and image nearby
      const afterLink = html.substring(match.index, match.index + 500);
      const srcMatch = afterLink.match(/src="([^"]+)"[^>]*>/);
      const imgMatch = afterLink.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
      const imageUrl = (srcMatch || imgMatch)?.[1];
      const srcTextMatch = afterLink.match(/>([A-Z][^<]{3,50})<\/a>[\s\S]{0,100}?(?:\d+\s+(?:min|hour|day|ago)|(?:Today|Yesterday))/i);
      const source = srcTextMatch
        ? sanitizeText(stripTags(srcTextMatch[1]), MAX_SOURCE_LENGTH)
        : extractDomain(url);

      articles.push({
        position: articles.length + 1,
        title,
        source,
        sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(source)}&hl=en&gl=${country}`,
        url,
        snippet: '',
        imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl.slice(0, MAX_URL_LENGTH) : null,
        contentType: 'article',
        publishedAt: null,
        category: category || 'general',
        engagement: { hasVideoPreview: false, format: 'standard' },
      });
    }
  }

  return articles;
}

function parseJsonLdArticle(item: any, position: number): DiscoverArticle | null {
  const url = typeof item.url === 'string' ? item.url : typeof item.mainEntityOfPage === 'string' ? item.mainEntityOfPage : null;
  const title = typeof item.name === 'string' ? item.name : typeof item.headline === 'string' ? item.headline : null;
  if (!url || !title) return null;

  const image = item.image
    ? (typeof item.image === 'string' ? item.image : Array.isArray(item.image) ? item.image[0] : item.image.url)
    : null;

  const author = item.author?.name || null;
  const source = author || extractDomain(url);
  const contentType = item['@type'] || 'article';

  return {
    position,
    title: sanitizeText(title, MAX_TITLE_LENGTH),
    source: sanitizeText(source, MAX_SOURCE_LENGTH),
    sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(source)}&hl=en`,
    url: url.slice(0, MAX_URL_LENGTH),
    snippet: sanitizeText(item.description || '', MAX_SNIPPET_LENGTH),
    imageUrl: image ? String(image).slice(0, MAX_URL_LENGTH) : null,
    contentType,
    publishedAt: item.datePublished || item.dateCreated || null,
    category: Array.isArray(item.articleSection) ? item.articleSection[0] : item.articleSection || 'general',
    engagement: { hasVideoPreview: false, format: 'standard' },
  };
}

function parseDiscoverBlock(block: string, position: number): DiscoverArticle | null {
  // Extract link
  const linkMatch = block.match(/<a[^>]*href="(\/url\?q=[^"]+)"[^>]*>/i)
    || block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
  if (!linkMatch) return null;

  const url = resolveGoogleUrl(linkMatch[1]);
  if (!url) return null;

  // Extract title
  const titleMatch = block.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i)
    || block.match(/aria-label="([^"]{10,300})"/i)
    || block.match(/title="([^"]{10,300})"/i);
  const title = titleMatch ? sanitizeText(stripTags(titleMatch[1]), MAX_TITLE_LENGTH) : null;
  if (!title) return null;

  // Extract image
  const imgMatch = block.match(/<img[^>]*src="([^"]+)"[^>]*>/i)
    || block.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i);
  const imageUrl = imgMatch ? imgMatch[1].slice(0, MAX_URL_LENGTH) : null;

  // Extract source
  const sourceMatch = block.match(/>([A-Z][a-zA-Z\s]{2,40})<\/a>[\s\S]{0,200}?(?:Today|Yesterday|\d+\s+(?:hour|min|day))/i)
    || block.match(/class="[^"]*C IssaOSrq[^"]*"[^>]*>([^<]{3,50})</i);
  const source = sourceMatch ? sanitizeText(stripTags(sourceMatch[1]), MAX_SOURCE_LENGTH) : extractDomain(url);

  // Extract snippet
  const snippetMatch = block.match(/class="[^"]*(?:aCOpRe|st)[^"]*"[^>]*>([\s\S]{20,300})</i)
    || block.match(/<p[^>]*>([\s\S]{20,300})<\/p>/i);
  const snippet = snippetMatch ? sanitizeText(stripTags(snippetMatch[1]), MAX_SNIPPET_LENGTH) : '';

  // Extract timestamp
  const timeMatch = block.match(/(\d+)\s+(minute|hour|day|week)s?\s+ago/i)
    || block.match(/(Today|Yesterday)/i);

  // Determine content type
  const contentType = detectContentType(block, imageUrl);

  return {
    position,
    title,
    source,
    sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(source)}&hl=en`,
    url,
    snippet,
    imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : null,
    contentType,
    publishedAt: timeMatch ? new Date().toISOString() : null,
    category: 'general',
    engagement: {
      hasVideoPreview: /video|play|youtube|vimeo/i.test(block),
      format: contentType === 'video' ? 'video' : 'standard',
    },
  };
}

function detectContentType(block: string, imageUrl: string | null): string {
  if (/video|youtube|vimeo|play button|duration|watch/i.test(block)) return 'video';
  if (/web story|story|stories/i.test(block)) return 'webstory';
  if (/image|photo|picture|gallery/i.test(block)) return 'image';
  if (/\.jpg|\.jpeg|\.png|\.gif|\.webp/i.test(imageUrl || '')) return 'article';
  return 'article';
}

/**
 * Scrape Google Discover feed for a given country
 */
export async function scrapeDiscoverFeed(
  country: string = 'US',
  category: string = 'news',
): Promise<DiscoverFeedResponse> {
  const safeCountry = country.toUpperCase().slice(0, 2);
  const userAgent = getRandomUserAgent();
  const proxy = getProxy();

  // Build the Discover URL — uses Google's mobile news feed endpoint
  // Note: Google Discover is accessed through Chrome mobile / Google app
  // We try the web master tools discover feed first
  let url = `https://www.google.com/webmasters/tools/google-discover-feed?hl=en&gl=${safeCountry}&category=${encodeURIComponent(category)}`;

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
    'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
  };

  let html: string;
  let response: Response;

  // Try discover feed URL first
  try {
    response = await proxyFetch(url, {
      timeoutMs: 30_000,
      maxRetries: 1,
      headers,
    });

    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > MAX_HTML_BYTES) throw new Error('Payload too large');
      html = await blob.text();
    } else {
      // Fallback: try direct Google news with mobile params
      url = `https://www.google.com/search?q=discover&hl=en&gl=${safeCountry}&tbm=nws&tbs=mr:1`;
      response = await proxyFetch(url, {
        timeoutMs: 30_000,
        maxRetries: 1,
        headers,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size > MAX_HTML_BYTES) throw new Error('Payload too large');
      html = await blob.text();
    }
  } catch (err) {
    // Last resort: use mobile Google news search
    url = `https://www.google.com/search?q=&hl=en&gl=${safeCountry}&tbm=nws&tbs=mr:1&pws=0&gbv=1`;
    response = await proxyFetch(url, {
      timeoutMs: 30_000,
      maxRetries: 1,
      headers,
    });
    if (!response.ok) throw new Error(`Google Discover fetch failed: HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > MAX_HTML_BYTES) throw new Error('Payload too large');
    html = await blob.text();
  }

  // Check for challenges
  if (html.includes('captcha') || html.includes('unusual traffic')) {
    throw new Error('Google blocked the request — proxy IP may be flagged');
  }

  const articles = parseDiscoverFeed(html, safeCountry, category);

  const scrapedAt = new Date().toISOString();

  return {
    country: safeCountry,
    category,
    timestamp: scrapedAt,
    discover_feed: articles,
    metadata: {
      feedLength: articles.length,
      scrapedAt,
      proxyCountry: proxy.country,
      proxyCarrier: proxy.host || 'mobile',
    },
  };
}
