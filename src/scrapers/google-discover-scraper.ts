import { proxyFetch, getProxy } from '../proxy';

export interface DiscoverItem {
  position: number;
  title: string;
  source: string;
  sourceUrl: string | null;
  url: string;
  snippet: string;
  imageUrl: string | null;
  contentType: 'article' | 'video' | 'web_story';
  publishedAt: string | null;
  category: string;
  engagement: {
    hasVideoPreview: boolean;
    format: 'standard' | 'video' | 'web_story';
  };
}

export interface DiscoverFeedResult {
  country: string;
  category: string;
  timestamp: string;
  discover_feed: DiscoverItem[];
  metadata: {
    feedLength: number;
    scrapedAt: string;
    proxyCountry: string;
    proxyCarrier: string;
  };
}

const COUNTRY_LANG: Record<string, string> = {
  US: 'en',
  GB: 'en',
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  PL: 'pl',
};

function decodeHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(input: string, tag: string): string {
  const m = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m?.[1]?.trim() || '';
}

function detectContentType(url: string, title: string): DiscoverItem['contentType'] {
  const low = `${url} ${title}`.toLowerCase();
  if (low.includes('youtube.com') || low.includes('/video') || low.includes('watch?v=')) return 'video';
  if (low.includes('webstory') || low.includes('/stories/')) return 'web_story';
  return 'article';
}

function extractImage(itemXml: string, description: string): string | null {
  const media = itemXml.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1];
  if (media) return media;
  const img = description.match(/<img[^>]*src=["']([^"']+)["']/i)?.[1];
  return img || null;
}

export function parseGoogleNewsRss(rss: string, category: string): DiscoverItem[] {
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  return items.map((itemXml, idx) => {
    const title = decodeHtml(extractTag(itemXml, 'title'));
    const url = decodeHtml(extractTag(itemXml, 'link'));
    const source = decodeHtml(extractTag(itemXml, 'source')) || 'Unknown';
    const descriptionRaw = extractTag(itemXml, 'description');
    const snippet = decodeHtml(descriptionRaw).slice(0, 280);
    const pubDateRaw = decodeHtml(extractTag(itemXml, 'pubDate'));
    const publishedAt = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;
    const imageUrl = extractImage(itemXml, descriptionRaw);
    const contentType = detectContentType(url, title);

    return {
      position: idx + 1,
      title,
      source,
      sourceUrl: null,
      url,
      snippet,
      imageUrl,
      contentType,
      publishedAt,
      category,
      engagement: {
        hasVideoPreview: contentType === 'video',
        format: contentType === 'article' ? 'standard' : contentType,
      },
    };
  });
}

export async function scrapeGoogleDiscover(country: string, category: string, limit: number = 20): Promise<DiscoverFeedResult> {
  const upperCountry = country.toUpperCase();
  const lang = COUNTRY_LANG[upperCountry] || 'en';
  const q = encodeURIComponent(category || 'news');
  const feedUrl = `https://news.google.com/rss/search?q=${q}&hl=${lang}-${upperCountry}&gl=${upperCountry}&ceid=${upperCountry}:${lang}`;

  const response = await proxyFetch(feedUrl, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers: {
      Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Discover feed request failed: ${response.status}`);
  }

  const rss = await response.text();
  const parsed = parseGoogleNewsRss(rss, category || 'general').slice(0, Math.max(1, Math.min(limit, 50)));
  const proxy = getProxy();

  return {
    country: upperCountry,
    category: category || 'general',
    timestamp: new Date().toISOString(),
    discover_feed: parsed,
    metadata: {
      feedLength: parsed.length,
      scrapedAt: new Date().toISOString(),
      proxyCountry: proxy.country || upperCountry,
      proxyCarrier: process.env.PROXY_CARRIER || 'unknown',
    },
  };
}
