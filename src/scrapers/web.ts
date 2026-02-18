/**
 * Web Trend Scraper
 * ─────────────────
 * Two sources:
 *   1. DuckDuckGo HTML search - no API key, scrape HTML results
 *   2. Google Trends RSS feed - public, no auth, gives real trending topics
 *
 * Both route through the mobile proxy for IP trust.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // domain name
  platform: 'web';
}

export interface TrendingTopic {
  title: string;
  traffic: string | null; // e.g. "200K+ searches"
  articles: { title: string; url: string; source: string }[];
  platform: 'web';
}

// ─── CONSTANTS ──────────────────────────────────────

const DDG_URL = 'https://html.duckduckgo.com/html/';
const TRENDS_RSS_URL = 'https://trends.google.com/trends/trendingsearches/daily/rss';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ─── HELPERS ────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse DuckDuckGo HTML search results.
 * DDG's HTML endpoint is stable and doesn't require JS rendering.
 */
function parseDdgResults(html: string, limit: number): WebResult[] {
  const results: WebResult[] = [];

  // DDG result blocks: <div class="result__body">
  // Title in <a class="result__a"> and snippet in <a class="result__snippet">
  const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null && results.length < limit) {
    const rawUrl = match[1];
    const rawTitle = match[2];
    const rawSnippet = match[3];

    // DDG wraps URLs in a redirect - extract the actual URL
    let url = rawUrl;
    const uddg = rawUrl.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1]);
      } catch {
        // keep original
      }
    }

    const title = stripHtml(rawTitle);
    const snippet = stripHtml(rawSnippet);

    if (!title || !url) continue;

    results.push({
      title,
      url,
      snippet,
      source: extractDomain(url),
      platform: 'web',
    });
  }

  return results;
}

/**
 * Parse Google Trends daily RSS feed.
 * Format: <item><title>...</title><ht:approx_traffic>...</ht:approx_traffic>
 * <ht:news_item><ht:news_item_title>...</ht:news_item_title><ht:news_item_url>...
 */
function parseTrendsRss(xml: string, limit: number): TrendingTopic[] {
  const topics: TrendingTopic[] = [];

  // Extract items
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(xml)) !== null && topics.length < limit) {
    const block = itemMatch[1];

    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]?.trim()
      ?? block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim()
      ?? '';

    const traffic = block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1]?.trim() ?? null;

    if (!title) continue;

    // Extract news articles inside this trending item
    const articles: TrendingTopic['articles'] = [];
    const newsPattern = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/g;
    let newsMatch: RegExpExecArray | null;

    while ((newsMatch = newsPattern.exec(block)) !== null) {
      const newsBlock = newsMatch[1];
      const newsTitle = newsBlock.match(/<ht:news_item_title><!\[CDATA\[([\s\S]*?)\]\]><\/ht:news_item_title>/)?.[1]?.trim()
        ?? newsBlock.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/)?.[1]?.trim()
        ?? '';
      const newsUrl = newsBlock.match(/<ht:news_item_url><!\[CDATA\[([\s\S]*?)\]\]><\/ht:news_item_url>/)?.[1]?.trim()
        ?? newsBlock.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/)?.[1]?.trim()
        ?? '';
      const newsSource = newsBlock.match(/<ht:news_item_source>([\s\S]*?)<\/ht:news_item_source>/)?.[1]?.trim() ?? '';

      if (newsTitle && newsUrl) {
        articles.push({ title: newsTitle, url: newsUrl, source: newsSource });
      }
    }

    topics.push({
      title,
      traffic,
      articles,
      platform: 'web',
    });
  }

  return topics;
}

// ─── PUBLIC API ─────────────────────────────────────

/**
 * Search the web via DuckDuckGo for a topic.
 * Returns parsed results with title, URL, snippet, and source domain.
 */
export async function searchWeb(
  topic: string,
  limit: number = 20,
): Promise<WebResult[]> {
  const params = new URLSearchParams({
    q: topic,
    kl: 'us-en', // US locale
    kp: '-2',    // safe search off (we're doing research)
  });

  const response = await proxyFetch(`${DDG_URL}?${params}`, {
    method: 'GET',
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://duckduckgo.com/',
    },
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    throw new Error(`DDG search failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseDdgResults(html, limit);
}

/**
 * Fetch trending topics from Google Trends daily RSS feed.
 * No auth required. Returns trending search topics with traffic estimates.
 */
export async function getTrendingWeb(
  country: string = 'US',
  limit: number = 20,
): Promise<TrendingTopic[]> {
  const url = `${TRENDS_RSS_URL}?geo=${country.toUpperCase()}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    timeoutMs: 15_000,
  });

  if (!response.ok) {
    throw new Error(`Google Trends RSS failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return parseTrendsRss(xml, limit);
}
