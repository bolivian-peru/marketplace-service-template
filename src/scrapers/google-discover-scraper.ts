/**
 * Google Discover Feed Intelligence Scraper (Bounty #52)
 * ──────────────────────────────────────────────────────
 * Captures Google Discover feed content as seen from real mobile
 * devices. Google Discover is exclusively mobile — no desktop, no API.
 * Only accessible through real mobile carrier IPs.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────

export interface DiscoverCard {
  position: number;
  title: string;
  source: string;
  url: string;
  snippet: string;
  imageUrl: string | null;
  publishedAt: string | null;
  category: string | null;
}

export interface DiscoverFeedResult {
  country: string;
  category: string;
  cards: DiscoverCard[];
  timestamp: string;
}

// ─── ERROR CLASS ────────────────────────────────────

export class DiscoverError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DiscoverError';
  }
  get httpStatus(): number {
    switch (this.code) {
      case 'captcha_detected': return 503;
      case 'rate_limited': return 503;
      case 'invalid_input': return 400;
      default: return 500;
    }
  }
  get shouldNotCharge(): boolean {
    return ['captcha_detected', 'rate_limited', 'scrape_failed'].includes(this.code);
  }
}

// ─── CONSTANTS ──────────────────────────────────────

const COUNTRY_DOMAINS: Record<string, string> = {
  US: 'www.google.com', DE: 'www.google.de', GB: 'www.google.co.uk',
  FR: 'www.google.fr', ES: 'www.google.es', PL: 'www.google.pl',
};

const MOBILE_UAS: Record<string, string> = {
  US: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  DE: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  GB: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
};

// ─── HELPERS ────────────────────────────────────────

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ─── SCRAPING ───────────────────────────────────────

/**
 * Fetch Google Discover feed for a country.
 * Google Discover appears on the mobile Google homepage and in Google News.
 */
export async function getDiscoverFeed(country: string = 'US', category: string = 'general'): Promise<DiscoverFeedResult> {
  const normalizedCountry = country.toUpperCase();
  const domain = COUNTRY_DOMAINS[normalizedCountry] || COUNTRY_DOMAINS.US;
  const ua = MOBILE_UAS[normalizedCountry] || MOBILE_UAS.US;

  // Google Discover content also appears via Google News
  const categoryPaths: Record<string, string> = {
    general: '',
    technology: '/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB',
    science: '/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB',
    business: '/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
    sports: '/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
    entertainment: '/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
    health: '/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ',
    news: '',
  };

  const catPath = categoryPaths[category.toLowerCase()] || '';
  const url = catPath
    ? `https://news.google.com${catPath}?hl=en-${normalizedCountry}&gl=${normalizedCountry}&ceid=${normalizedCountry}:en`
    : `https://news.google.com/?hl=en-${normalizedCountry}&gl=${normalizedCountry}&ceid=${normalizedCountry}:en`;

  console.log(`[DISCOVER] Fetching: ${url}`);

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': `en-${normalizedCountry},en;q=0.9`,
    },
    maxRetries: 2,
    timeoutMs: 25_000,
  });

  if (!response.ok) {
    if (response.status === 429) throw new DiscoverError('rate_limited', 'Google rate limited');
    throw new DiscoverError('scrape_failed', `Google returned ${response.status}`);
  }

  const html = await response.text();

  if (html.includes('captcha') && html.length < 5000) {
    throw new DiscoverError('captcha_detected', 'Google CAPTCHA triggered');
  }

  const cards: DiscoverCard[] = [];

  // Parse Google News article cards
  // Pattern 1: article tags with data attributes
  const articleMatches = html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g);
  let position = 1;
  for (const m of articleMatches) {
    const article = m[1];
    const titleMatch = article.match(/<a[^>]*class="[^"]*JtKRv[^"]*"[^>]*>([^<]+)/);
    const sourceMatch = article.match(/<a[^>]*class="[^"]*wEwyrc[^"]*"[^>]*>([^<]+)/) ||
                        article.match(/<div[^>]*class="[^"]*vr1PYe[^"]*"[^>]*>([^<]+)/);
    const urlMatch = article.match(/<a[^>]*href="\.\/articles\/([^"?]+)/);
    const timeMatch = article.match(/<time[^>]*datetime="([^"]+)"/);
    const imgMatch = article.match(/src="(https:\/\/[^"]+)"/);

    if (titleMatch) {
      cards.push({
        position: position++,
        title: cleanText(titleMatch[1]),
        source: sourceMatch ? cleanText(sourceMatch[1]) : '',
        url: urlMatch ? `https://news.google.com/articles/${urlMatch[1]}` : '',
        snippet: '',
        imageUrl: imgMatch ? imgMatch[1] : null,
        publishedAt: timeMatch ? timeMatch[1] : null,
        category: category !== 'general' ? category : null,
      });
    }
  }

  // Fallback: try simpler patterns
  if (cards.length === 0) {
    const linkMatches = html.matchAll(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/g);
    for (const m of linkMatches) {
      const url = m[1];
      const title = cleanText(m[2]);
      if (url.includes('google.com') || url.includes('javascript:') || title.length < 15) continue;
      if (cards.some(c => c.title === title)) continue;
      cards.push({
        position: position++,
        title,
        source: new URL(url).hostname.replace('www.', ''),
        url,
        snippet: '',
        imageUrl: null,
        publishedAt: null,
        category: category !== 'general' ? category : null,
      });
      if (cards.length >= 30) break;
    }
  }

  return {
    country: normalizedCountry,
    category,
    cards,
    timestamp: new Date().toISOString(),
  };
}
