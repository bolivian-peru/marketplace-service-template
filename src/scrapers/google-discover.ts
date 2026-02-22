/**
 * Google Discover / Trends / News Scraper
 * ────────────────────────────────────────
 * Scrapes Google News RSS, Google Trends RSS, and Trends Daily API
 * to provide trending topics, news search, and category-based feeds.
 *
 * Data sources:
 * 1. Google Trends RSS   — real-time trending with traffic volumes
 * 2. Google News RSS     — article search by keyword or category
 * 3. Google Trends Daily — JSON daily trends (XSSI-prefixed)
 *
 * No XML library required — uses regex-based XML parsing.
 */

import { proxyFetch } from '../proxy';

export class ScraperError extends Error {
  constructor(message: string, public statusCode: number, public retryable: boolean) {
    super(message);
    this.name = 'ScraperError';
  }
}

// ─── TYPES ──────────────────────────────────────────

export interface DiscoverArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  snippet: string;
  category: string;
  imageUrl: string;
  traffic: number;
  relatedQueries: string[];
}

export interface DiscoverSearchResult {
  articles: DiscoverArticle[];
  query: string;
  resultCount: number;
  geo: string;
}

export interface TrendingResult {
  trends: DiscoverArticle[];
  geo: string;
  resultCount: number;
  date: string;
}

// ─── CONSTANTS ──────────────────────────────────────

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_GEO = 'US';

/**
 * Google News topic IDs (base64-encoded topic tokens).
 * These are stable identifiers used in the Google News RSS topic URLs.
 */
const CATEGORY_TOPIC_IDS: Record<string, string> = {
  technology:    'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB',
  business:      'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
  entertainment: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
  sports:        'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
  science:       'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB',
  health:        'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ',
  world:         'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB',
};

// ─── FETCH HELPER ───────────────────────────────────

/**
 * Fetch URL text, trying proxy first, falling back to direct fetch.
 */
async function textFetch(url: string): Promise<string> {
  try {
    const r = await proxyFetch(url, { timeoutMs: 15000 });
    return await r.text();
  } catch {
    const r = await fetch(url, {
      headers: {
        'User-Agent': MOBILE_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    return await r.text();
  }
}

// ─── HTML ENTITY DECODING ───────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#x27;': "'",
  '&#x2F;': '/',
  '&#x60;': '`',
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&hellip;': '\u2026',
  '&laquo;': '\u00AB',
  '&raquo;': '\u00BB',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
};

function decodeEntities(text: string): string {
  let result = text;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char);
  }
  // Numeric entities: &#123; and &#x1A;
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10)),
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16)),
  );
  return result;
}

// ─── XML PARSING HELPERS ────────────────────────────

/**
 * Extract the text content of the first occurrence of <tag>...</tag>.
 * Returns empty string if not found.
 */
function xmlTag(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(pattern);
  return match ? decodeEntities(match[1].trim()) : '';
}

/**
 * Extract all occurrences of <tag>...</tag> as an array of inner XML strings.
 */
function xmlItems(xml: string, tag: string): string[] {
  const items: string[] = [];
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

/**
 * Extract an attribute value from an XML/HTML tag string.
 */
function xmlAttr(xml: string, tag: string, attr: string): string {
  const pattern = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const match = xml.match(pattern);
  return match ? decodeEntities(match[1]) : '';
}

/**
 * Strip all XML/HTML tags from a string.
 */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

// ─── TRAFFIC VOLUME PARSING ─────────────────────────

/**
 * Parse traffic volume strings from Google Trends.
 * Handles formats: "200K+", "5M+", "500,000+", "2,000,000+", "10K+"
 * Returns a numeric estimate.
 */
function parseTraffic(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[+,\s]/g, '').trim();

  // Handle suffix multipliers: K, M, B
  const suffixMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KkMmBb])?$/);
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1]);
    const suffix = (suffixMatch[2] || '').toUpperCase();
    switch (suffix) {
      case 'K': return Math.round(num * 1_000);
      case 'M': return Math.round(num * 1_000_000);
      case 'B': return Math.round(num * 1_000_000_000);
      default:  return Math.round(num);
    }
  }

  // Plain number (commas already stripped)
  const plain = parseInt(cleaned, 10);
  return Number.isFinite(plain) ? plain : 0;
}

// ─── HELPER: CLAMP LIMIT ───────────────────────────

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
}

function sanitizeGeo(geo: string | undefined): string {
  if (!geo || typeof geo !== 'string') return DEFAULT_GEO;
  return geo.trim().toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '') || DEFAULT_GEO;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── GOOGLE TRENDS RSS (Trending Topics) ────────────

/**
 * Fetch real-time trending topics from Google Trends RSS feed.
 * Feed URL: https://trends.google.com/trending/rss?geo={geo}
 *
 * The RSS contains <item> elements with:
 *   <title>, <ht:approx_traffic>, <ht:picture>, <ht:news_item> (nested),
 *   <pubDate>, <link>, and related query data.
 */
async function fetchTrendsRSS(geo: string, limit: number): Promise<DiscoverArticle[]> {
  const url = `https://trends.google.com/trending/rss?geo=${geo}`;
  console.log(`[discover] Fetching Trends RSS: ${url}`);

  const xml = await textFetch(url);
  if (!xml || xml.length < 100) {
    console.warn('[discover] Empty or short Trends RSS response');
    return [];
  }

  const items = xmlItems(xml, 'item');
  const articles: DiscoverArticle[] = [];

  for (const item of items) {
    if (articles.length >= limit) break;

    const title = stripTags(xmlTag(item, 'title'));
    if (!title) continue;

    const link = xmlTag(item, 'link');
    const pubDate = xmlTag(item, 'pubDate');
    const trafficRaw = xmlTag(item, 'ht:approx_traffic');
    const traffic = parseTraffic(trafficRaw);
    const imageUrl = xmlTag(item, 'ht:picture') || xmlAttr(item, 'ht:picture', 'url');

    // Extract nested news items for snippet, source, and URL
    const newsItems = xmlItems(item, 'ht:news_item');
    let snippet = '';
    let source = '';
    let articleUrl = link;

    if (newsItems.length > 0) {
      const firstNews = newsItems[0];
      const newsTitle = stripTags(xmlTag(firstNews, 'ht:news_item_title'));
      const newsSnippet = stripTags(xmlTag(firstNews, 'ht:news_item_snippet'));
      source = stripTags(xmlTag(firstNews, 'ht:news_item_source'));
      const newsUrl = xmlTag(firstNews, 'ht:news_item_url');
      if (newsUrl) articleUrl = newsUrl;
      snippet = newsSnippet || newsTitle || '';
    }

    // Extract related queries from additional news items' titles
    const relatedQueries: string[] = [];
    for (let i = 1; i < newsItems.length; i++) {
      const relTitle = stripTags(xmlTag(newsItems[i], 'ht:news_item_title'));
      if (relTitle && relTitle !== title) {
        relatedQueries.push(relTitle);
      }
    }

    articles.push({
      title,
      url: articleUrl || link || '',
      source,
      publishedAt: pubDate || '',
      snippet,
      category: 'trending',
      imageUrl: imageUrl || '',
      traffic,
      relatedQueries,
    });
  }

  return articles;
}

// ─── GOOGLE NEWS RSS (Search) ───────────────────────

/**
 * Search Google News via RSS.
 * Feed URL: https://news.google.com/rss/search?q={query}&hl=en-US&gl={geo}&ceid={geo}:en
 *
 * Returns <item> elements with <title>, <link>, <pubDate>, <description>, <source>.
 */
async function fetchNewsRSS(
  query: string,
  geo: string,
  limit: number,
): Promise<DiscoverArticle[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=${geo}&ceid=${geo}:en`;
  console.log(`[discover] Fetching News RSS: ${url}`);

  const xml = await textFetch(url);
  if (!xml || xml.length < 100) {
    console.warn('[discover] Empty or short News RSS response');
    return [];
  }

  const items = xmlItems(xml, 'item');
  const articles: DiscoverArticle[] = [];
  const seenUrls = new Set<string>();

  for (const item of items) {
    if (articles.length >= limit) break;

    const title = stripTags(xmlTag(item, 'title'));
    if (!title) continue;

    const link = xmlTag(item, 'link');
    if (!link || seenUrls.has(link)) continue;
    seenUrls.add(link);

    const pubDate = xmlTag(item, 'pubDate');
    const description = stripTags(xmlTag(item, 'description'));

    // <source url="...">Source Name</source>
    const source = stripTags(xmlTag(item, 'source'));
    const sourceUrl = xmlAttr(item, 'source', 'url');

    articles.push({
      title,
      url: link,
      source: source || '',
      publishedAt: pubDate || '',
      snippet: description || '',
      category: query,
      imageUrl: '',
      traffic: 0,
      relatedQueries: [],
    });
  }

  return articles;
}

// ─── GOOGLE NEWS RSS (Category) ─────────────────────

/**
 * Fetch Google News articles by category using topic IDs.
 * Feed URL: https://news.google.com/rss/topics/{topicId}?hl=en-US&gl={geo}&ceid={geo}:en
 */
async function fetchCategoryRSS(
  category: string,
  geo: string,
  limit: number,
): Promise<DiscoverArticle[]> {
  const topicId = CATEGORY_TOPIC_IDS[category.toLowerCase()];
  if (!topicId) {
    console.warn(`[discover] Unknown category: ${category}`);
    return [];
  }

  const url = `https://news.google.com/rss/topics/${topicId}?hl=en-US&gl=${geo}&ceid=${geo}:en`;
  console.log(`[discover] Fetching Category RSS: ${url}`);

  const xml = await textFetch(url);
  if (!xml || xml.length < 100) {
    console.warn('[discover] Empty or short Category RSS response');
    return [];
  }

  const items = xmlItems(xml, 'item');
  const articles: DiscoverArticle[] = [];
  const seenUrls = new Set<string>();

  for (const item of items) {
    if (articles.length >= limit) break;

    const title = stripTags(xmlTag(item, 'title'));
    if (!title) continue;

    const link = xmlTag(item, 'link');
    if (!link || seenUrls.has(link)) continue;
    seenUrls.add(link);

    const pubDate = xmlTag(item, 'pubDate');
    const description = stripTags(xmlTag(item, 'description'));
    const source = stripTags(xmlTag(item, 'source'));

    articles.push({
      title,
      url: link,
      source: source || '',
      publishedAt: pubDate || '',
      snippet: description || '',
      category: category.toLowerCase(),
      imageUrl: '',
      traffic: 0,
      relatedQueries: [],
    });
  }

  return articles;
}

// ─── GOOGLE TRENDS DAILY API ────────────────────────

/**
 * Fetch daily trends from the Google Trends internal API.
 * URL: https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-300&geo={geo}&ns=15
 *
 * Response is prefixed with ")]}',\n" (XSSI protection) which must be stripped.
 * Returns JSON with trendingSearchesDays[].trendingSearches[].
 */
async function fetchDailyTrendsAPI(geo: string): Promise<DiscoverArticle[]> {
  const url = `https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-300&geo=${geo}&ns=15`;
  console.log(`[discover] Fetching Daily Trends API: ${url}`);

  const raw = await textFetch(url);
  if (!raw || raw.length < 50) {
    console.warn('[discover] Empty Daily Trends API response');
    return [];
  }

  // Strip XSSI prefix: )]}',\n
  let jsonStr = raw;
  const xssiIdx = raw.indexOf('\n');
  if (xssiIdx !== -1 && xssiIdx < 20) {
    jsonStr = raw.substring(xssiIdx + 1);
  }

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[discover] Failed to parse Daily Trends JSON:', err);
    return [];
  }

  const articles: DiscoverArticle[] = [];
  const days = data?.default?.trendingSearchesDays;
  if (!Array.isArray(days)) return articles;

  for (const day of days) {
    const searches = day?.trendingSearches;
    if (!Array.isArray(searches)) continue;

    for (const search of searches) {
      const title = search?.title?.query || '';
      if (!title) continue;

      const trafficRaw = search?.formattedTraffic || '';
      const traffic = parseTraffic(trafficRaw);

      const imageUrl = search?.image?.imageUrl || search?.image?.newsUrl || '';

      // Extract related queries
      const relatedQueries: string[] = [];
      if (Array.isArray(search?.relatedQueries)) {
        for (const rq of search.relatedQueries) {
          if (rq?.query) relatedQueries.push(rq.query);
        }
      }

      // Extract from nested articles array
      let snippet = '';
      let source = '';
      let articleUrl = '';
      let publishedAt = '';

      if (Array.isArray(search?.articles) && search.articles.length > 0) {
        const firstArticle = search.articles[0];
        snippet = firstArticle?.snippet || '';
        source = firstArticle?.source || '';
        articleUrl = firstArticle?.url || '';
        publishedAt = firstArticle?.timeAgo || '';

        // Collect titles from other articles as related queries
        for (let i = 1; i < search.articles.length; i++) {
          const relTitle = search.articles[i]?.title;
          if (relTitle && !relatedQueries.includes(relTitle)) {
            relatedQueries.push(relTitle);
          }
        }
      }

      articles.push({
        title,
        url: articleUrl || `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}&geo=${geo}`,
        source,
        publishedAt,
        snippet,
        category: 'daily',
        imageUrl: imageUrl || '',
        traffic,
        relatedQueries,
      });
    }
  }

  return articles;
}

// ─── EXPORTED FUNCTIONS ─────────────────────────────

/**
 * Search Google News articles by keyword.
 *
 * @param query - Search keywords
 * @param limit - Max results (default: 25, max: 100)
 * @param geo   - ISO 2-letter country code (default: "US")
 */
export async function searchGoogleNews(
  query: string,
  limit?: number,
  geo?: string,
): Promise<DiscoverSearchResult> {
  const safeGeo = sanitizeGeo(geo);
  const safeLimit = clampLimit(limit);
  const safeQuery = query.trim().slice(0, 200);

  if (!safeQuery) {
    return { articles: [], query: '', resultCount: 0, geo: safeGeo };
  }

  console.log(`[discover] searchGoogleNews: query="${safeQuery}" limit=${safeLimit} geo=${safeGeo}`);

  try {
    const articles = await fetchNewsRSS(safeQuery, safeGeo, safeLimit);
    return {
      articles,
      query: safeQuery,
      resultCount: articles.length,
      geo: safeGeo,
    };
  } catch (err: any) {
    console.error('[discover] searchGoogleNews failed:', err.message);
    throw new Error(`Google News search failed: ${err.message}`);
  }
}

/**
 * Get real-time trending topics from Google Trends RSS.
 *
 * @param limit - Max results (default: 25, max: 100)
 * @param geo   - ISO 2-letter country code (default: "US")
 */
export async function getTrendingTopics(
  limit?: number,
  geo?: string,
): Promise<TrendingResult> {
  const safeGeo = sanitizeGeo(geo);
  const safeLimit = clampLimit(limit);

  console.log(`[discover] getTrendingTopics: limit=${safeLimit} geo=${safeGeo}`);

  try {
    const trends = await fetchTrendsRSS(safeGeo, safeLimit);
    return {
      trends,
      geo: safeGeo,
      resultCount: trends.length,
      date: todayISO(),
    };
  } catch (err: any) {
    console.error('[discover] getTrendingTopics failed:', err.message);
    throw new Error(`Trending topics fetch failed: ${err.message}`);
  }
}

/**
 * Get daily trending searches from the Google Trends internal API.
 *
 * @param geo - ISO 2-letter country code (default: "US")
 */
export async function getDailyTrends(
  geo?: string,
): Promise<TrendingResult> {
  const safeGeo = sanitizeGeo(geo);

  console.log(`[discover] getDailyTrends: geo=${safeGeo}`);

  try {
    const trends = await fetchDailyTrendsAPI(safeGeo);
    return {
      trends,
      geo: safeGeo,
      resultCount: trends.length,
      date: todayISO(),
    };
  } catch (err: any) {
    console.error('[discover] getDailyTrends failed:', err.message);
    throw new Error(`Daily trends fetch failed: ${err.message}`);
  }
}

/**
 * Get Google News articles by category.
 *
 * @param category - One of: technology, business, entertainment, sports, science, health, world
 * @param limit    - Max results (default: 25, max: 100)
 * @param geo      - ISO 2-letter country code (default: "US")
 */
export async function getCategoryNews(
  category: string,
  limit?: number,
  geo?: string,
): Promise<DiscoverSearchResult> {
  const safeGeo = sanitizeGeo(geo);
  const safeLimit = clampLimit(limit);
  const safeCategory = category.toLowerCase().trim();

  const validCategories = Object.keys(CATEGORY_TOPIC_IDS);
  if (!validCategories.includes(safeCategory)) {
    throw new Error(
      `Invalid category "${category}". Valid categories: ${validCategories.join(', ')}`,
    );
  }

  console.log(`[discover] getCategoryNews: category="${safeCategory}" limit=${safeLimit} geo=${safeGeo}`);

  try {
    const articles = await fetchCategoryRSS(safeCategory, safeGeo, safeLimit);
    return {
      articles,
      query: safeCategory,
      resultCount: articles.length,
      geo: safeGeo,
    };
  } catch (err: any) {
    console.error('[discover] getCategoryNews failed:', err.message);
    throw new Error(`Category news fetch failed: ${err.message}`);
  }
}
