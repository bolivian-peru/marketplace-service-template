/**
 * Web Trend Scraper
 *
 * Sources:
 * 1) DuckDuckGo HTML search
 * 2) Google Trends daily RSS feed
 */

import { proxyFetch } from '../proxy';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  platform: 'web';
}

export interface TrendingTopic {
  title: string;
  traffic: string | null;
  articles: { title: string; url: string; source: string }[];
  platform: 'web';
}

const DDG_URL = 'https://html.duckduckgo.com/html/';
const TRENDS_RSS_URL = 'https://trends.google.com/trends/trendingsearches/daily/rss';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const MAX_TOPIC_LENGTH = 200;
const MAX_LIMIT = 50;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const MAX_SNIPPET_LENGTH = 500;
const MAX_SOURCE_LENGTH = 120;
const MAX_ARTICLES_PER_TOPIC = 5;
const MAX_DDG_RESPONSE_BYTES = 1_500_000;
const MAX_TRENDS_RESPONSE_BYTES = 1_000_000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString().slice(0, MAX_URL_LENGTH);
  } catch {
    return null;
  }
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return sanitizeText(hostname, MAX_SOURCE_LENGTH) || 'unknown';
  } catch {
    return 'unknown';
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDdgResults(html: string, limit: number): WebResult[] {
  const results: WebResult[] = [];
  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null && results.length < safeLimit) {
    const rawUrl = match[1];
    const rawTitle = match[2];
    const rawSnippet = match[3];

    let decodedUrl = rawUrl;
    const wrappedTarget = rawUrl.match(/[?&]uddg=([^&]+)/);
    if (wrappedTarget) {
      try {
        decodedUrl = decodeURIComponent(wrappedTarget[1]);
      } catch {
        decodedUrl = rawUrl;
      }
    }

    const normalizedUrl = normalizeHttpUrl(decodedUrl);
    if (!normalizedUrl) continue;

    const title = sanitizeText(stripHtml(rawTitle), MAX_TITLE_LENGTH);
    const snippet = sanitizeText(stripHtml(rawSnippet), MAX_SNIPPET_LENGTH);
    if (!title) continue;

    results.push({
      title,
      url: normalizedUrl,
      snippet,
      source: extractDomain(normalizedUrl),
      platform: 'web',
    });
  }

  return results;
}

function parseTrendsRss(xml: string, limit: number): TrendingTopic[] {
  const topics: TrendingTopic[] = [];
  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(xml)) !== null && topics.length < safeLimit) {
    const block = itemMatch[1];

    const rawTitle = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
      ?? block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
      ?? '';

    const title = sanitizeText(rawTitle, MAX_TITLE_LENGTH);
    const trafficRaw = block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1] ?? null;
    const traffic = trafficRaw ? sanitizeText(trafficRaw, 32) : null;

    if (!title) continue;

    const articles: TrendingTopic['articles'] = [];
    const newsPattern = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/g;
    let newsMatch: RegExpExecArray | null;

    while ((newsMatch = newsPattern.exec(block)) !== null && articles.length < MAX_ARTICLES_PER_TOPIC) {
      const newsBlock = newsMatch[1];
      const rawNewsTitle = newsBlock.match(/<ht:news_item_title><!\[CDATA\[([\s\S]*?)\]\]><\/ht:news_item_title>/)?.[1]
        ?? newsBlock.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/)?.[1]
        ?? '';
      const rawNewsUrl = newsBlock.match(/<ht:news_item_url><!\[CDATA\[([\s\S]*?)\]\]><\/ht:news_item_url>/)?.[1]
        ?? newsBlock.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/)?.[1]
        ?? '';
      const rawSource = newsBlock.match(/<ht:news_item_source>([\s\S]*?)<\/ht:news_item_source>/)?.[1] ?? '';

      const newsTitle = sanitizeText(rawNewsTitle, MAX_TITLE_LENGTH);
      const newsUrl = normalizeHttpUrl(rawNewsUrl);
      const newsSource = sanitizeText(rawSource, MAX_SOURCE_LENGTH);

      if (newsTitle && newsUrl) {
        articles.push({ title: newsTitle, url: newsUrl, source: newsSource || 'unknown' });
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

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Upstream payload too large: ${contentLength} bytes`);
    }
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new Error(`Upstream payload too large: ${body.byteLength} bytes`);
  }

  return new TextDecoder().decode(body);
}

function sanitizeCountry(country: string): string {
  const normalized = sanitizeText(country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return 'US';
  return normalized;
}

export async function searchWeb(
  topic: string,
  limit: number = 20,
): Promise<WebResult[]> {
  const safeTopic = sanitizeText(topic, MAX_TOPIC_LENGTH);
  if (!safeTopic) return [];

  const safeLimit = clamp(limit, 1, MAX_LIMIT);

  const params = new URLSearchParams({
    q: safeTopic,
    kl: 'us-en',
    kp: '-2',
  });

  const response = await proxyFetch(`${DDG_URL}?${params}`, {
    method: 'GET',
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://duckduckgo.com/',
    },
    timeoutMs: 20_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`DDG search failed: ${response.status} ${response.statusText}`);
  }

  const html = await readBodyWithLimit(response, MAX_DDG_RESPONSE_BYTES);
  return parseDdgResults(html, safeLimit);
}

export async function getTrendingWeb(
  country: string = 'US',
  limit: number = 20,
): Promise<TrendingTopic[]> {
  const safeCountry = sanitizeCountry(country);
  const safeLimit = clamp(limit, 1, MAX_LIMIT);
  const url = `${TRENDS_RSS_URL}?geo=${safeCountry}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    timeoutMs: 15_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Google Trends RSS failed: ${response.status} ${response.statusText}`);
  }

  const xml = await readBodyWithLimit(response, MAX_TRENDS_RESPONSE_BYTES);
  return parseTrendsRss(xml, safeLimit);
}
