import { proxyFetch } from '../proxy';

// ─── Google Discover Feed Intelligence Scraper ───
// Google Discover is mobile-only, requires mobile UA + carrier IP

interface DiscoverArticle {
  position: number;
  title: string;
  source: string;
  sourceUrl: string;
  url: string;
  snippet: string;
  imageUrl: string;
  contentType: 'article' | 'video' | 'web_story' | 'unknown';
  publishedAt: string;
  category: string;
  engagement: { hasVideoPreview: boolean; format: string };
}

interface DiscoverFeed {
  country: string;
  category: string | null;
  timestamp: string;
  discover_feed: DiscoverArticle[];
  metadata: { feedLength: number; scrapedAt: string; proxyCountry: string; proxyCarrier: string };
}

const COUNTRY_DOMAINS: Record<string, { domain: string; hl: string; gl: string }> = {
  US: { domain: 'www.google.com', hl: 'en', gl: 'us' },
  UK: { domain: 'www.google.co.uk', hl: 'en', gl: 'uk' },
  GB: { domain: 'www.google.co.uk', hl: 'en', gl: 'uk' },
  DE: { domain: 'www.google.de', hl: 'de', gl: 'de' },
  FR: { domain: 'www.google.fr', hl: 'fr', gl: 'fr' },
  ES: { domain: 'www.google.es', hl: 'es', gl: 'es' },
  PL: { domain: 'www.google.pl', hl: 'pl', gl: 'pl' },
};

const CATEGORY_TOPICS: Record<string, string> = {
  technology: '/m/07c1v',
  science: '/m/06mq7',
  business: '/m/09s1f',
  entertainment: '/m/02jjt',
  sports: '/m/06ntj',
  health: '/m/0kt51',
  news: '/m/05jhg',
  world: '/m/098wr',
};

const MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.101 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.101 Mobile Safari/537.36',
];

function randomUA(): string {
  return MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
}

function detectContentType(html: string): 'article' | 'video' | 'web_story' | 'unknown' {
  if (html.includes('video') || html.includes('youtube.com') || html.includes('youtu.be')) return 'video';
  if (html.includes('web-story') || html.includes('amp-story')) return 'web_story';
  if (html.includes('article') || html.includes('news')) return 'article';
  return 'unknown';
}

function cleanText(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function extractArticlesFromHtml(html: string): Partial<DiscoverArticle>[] {
  const articles: Partial<DiscoverArticle>[] = [];

  // Google Discover renders as cards — try multiple extraction patterns

  // Pattern 1: data-hveid card blocks (standard Discover)
  const cardBlocks = html.split(/data-hveid="/);
  for (let i = 1; i < cardBlocks.length; i++) {
    const block = cardBlocks[i];
    const urlMatch = block.match(/href="(https?:\/\/(?!www\.google)[^"]+)"/);
    if (!urlMatch) continue;

    const url = urlMatch[1];
    const titleMatch = block.match(/role="heading"[^>]*>([^<]+)/) || block.match(/<h[34][^>]*>([^<]+)/) || block.match(/>([^<]{20,120})<\/a>/);
    if (!titleMatch) continue;

    const sourceMatch = block.match(/class="[^"]*source[^"]*"[^>]*>([^<]+)/) || block.match(/<cite[^>]*>([^<]+)/) || block.match(/data-original-domain="([^"]+)/);
    const snippetMatch = block.match(/class="[^"]*snippet[^"]*"[^>]*>([^<]+)/) || block.match(/<span[^>]*>([^<]{50,200})<\/span>/);
    const imageMatch = block.match(/src="(https:\/\/[^"]*(?:lh3\.googleusercontent|encrypted-tbn|gstatic)[^"]+)"/) || block.match(/data-src="(https:\/\/[^"]+)"/);
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/) || block.match(/(\d+ (?:hours?|minutes?|days?) ago)/);

    const source = sourceMatch ? cleanText(sourceMatch[1]) : new URL(url).hostname.replace('www.', '');

    articles.push({
      title: cleanText(titleMatch[1]),
      source,
      sourceUrl: `https://${new URL(url).hostname}`,
      url,
      snippet: snippetMatch ? cleanText(snippetMatch[1]) : '',
      imageUrl: imageMatch ? imageMatch[1] : '',
      contentType: detectContentType(block),
      publishedAt: timeMatch ? timeMatch[1] : new Date().toISOString(),
      engagement: { hasVideoPreview: block.includes('video') || block.includes('youtube'), format: 'standard' }
    });
  }

  // Pattern 2: JSON-LD structured data
  const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const m of jsonLdMatches) {
    try {
      const ld = JSON.parse(m[1]);
      const items = Array.isArray(ld) ? ld : ld.itemListElement || [ld];
      for (const item of items) {
        if (item.url && item.name && !articles.find(a => a.url === item.url)) {
          articles.push({
            title: item.name || item.headline,
            source: item.publisher?.name || item.author?.name || '',
            sourceUrl: item.publisher?.url || '',
            url: item.url,
            snippet: item.description || '',
            imageUrl: item.image?.url || item.thumbnailUrl || '',
            contentType: item['@type']?.includes('Video') ? 'video' : 'article',
            publishedAt: item.datePublished || new Date().toISOString(),
            engagement: { hasVideoPreview: false, format: 'standard' }
          });
        }
      }
    } catch {}
  }

  return articles;
}

export async function getDiscoverFeed(country: string = 'US', category?: string): Promise<DiscoverFeed> {
  const config = COUNTRY_DOMAINS[country.toUpperCase()] || COUNTRY_DOMAINS.US;

  // Google Discover is served at the root Google page for mobile UAs
  // The feed appears at google.com/discover or as the default mobile homepage
  let feedUrl = `https://${config.domain}/?hl=${config.hl}&gl=${config.gl}`;

  // If category specified, use topic parameter
  if (category && CATEGORY_TOPICS[category.toLowerCase()]) {
    feedUrl = `https://${config.domain}/discover/topics${CATEGORY_TOPICS[category.toLowerCase()]}?hl=${config.hl}&gl=${config.gl}`;
  }

  const headers = {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': config.hl === 'en' ? 'en-US,en;q=0.9' : `${config.hl}-${config.gl.toUpperCase()},${config.hl};q=0.9,en;q=0.5`,
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': '"Android"',
  };

  const resp = await proxyFetch(feedUrl, { headers });
  const html = await resp.text();

  const rawArticles = extractArticlesFromHtml(html);

  // Also try Google News as fallback (it surfaces Discover-like content)
  if (rawArticles.length < 5) {
    const newsUrl = `https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=${config.hl}&gl=${config.gl.toUpperCase()}&ceid=${config.gl.toUpperCase()}:${config.hl}`;
    if (category && CATEGORY_TOPICS[category.toLowerCase()]) {
      // use category-specific news topic
    }
    try {
      const newsResp = await proxyFetch(newsUrl, { headers });
      const newsHtml = await newsResp.text();
      const newsArticles = extractArticlesFromHtml(newsHtml);
      for (const article of newsArticles) {
        if (!rawArticles.find(a => a.url === article.url)) rawArticles.push(article);
      }
    } catch {}
  }

  const discover_feed: DiscoverArticle[] = rawArticles.slice(0, 20).map((a, i) => ({
    position: i + 1,
    title: a.title || '',
    source: a.source || '',
    sourceUrl: a.sourceUrl || '',
    url: a.url || '',
    snippet: a.snippet || '',
    imageUrl: a.imageUrl || '',
    contentType: a.contentType || 'article',
    publishedAt: a.publishedAt || new Date().toISOString(),
    category: category || 'general',
    engagement: a.engagement || { hasVideoPreview: false, format: 'standard' }
  }));

  return {
    country: country.toUpperCase(),
    category: category || null,
    timestamp: new Date().toISOString(),
    discover_feed,
    metadata: {
      feedLength: discover_feed.length,
      scrapedAt: new Date().toISOString(),
      proxyCountry: country.toUpperCase(),
      proxyCarrier: 'Mobile'
    }
  };
}
