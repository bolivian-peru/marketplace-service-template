/**
 * Google Discover Feed Intelligence Scraper
 * ──────────────────────────────────────────
 * Scrapes trending content from Google News / Discover-like feeds.
 * Strategies: Google News HTML -> Google News RSS -> Google Search news tab.
 * Accepts proxyFetch as parameter — fully self-contained, no project imports.
 */

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface DiscoverItem {
  position: number;
  title: string;
  source: string;
  sourceUrl: string;
  url: string;
  snippet: string;
  imageUrl: string;
  contentType: 'article' | 'video' | 'web_story';
  publishedAt: string;
  category: string;
  engagement: { hasVideoPreview: boolean; format: string };
}

export interface DiscoverFeedResult {
  country: string;
  category: string;
  discover_feed: DiscoverItem[];
  metadata: { feedLength: number; scrapedAt: string; proxyCountry: string };
}

// ─── CONSTANTS ──────────────────────────────────────

const MOBILE_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

const TOPIC_IDS: Record<string, string> = {
  technology: 'CAAQIggKIhZDQkFTRWhNS0FKTW',
  science: 'CAAQIggKIhZDQkFTRWhNS0FKTk',
  business: 'CAAQJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
  entertainment: 'CAAQJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
  sports: 'CAAQJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
  health: 'CAAQIggKIhZDQkFTRWhNS0FKTk',
  world: 'CAAQJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
  news: 'CAAQJggK', top: 'CAAQJggK',
};

// ─── HELPERS ────────────────────────────────────────

const strip = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&#x2F;/g, '/');
const randUA = () => MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];

function headers(cc: string): Record<string, string> {
  return {
    'User-Agent': randUA(), Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': `en-${cc},en;q=0.9`, DNT: '1', Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyNDA1MDYtMF9SQzIaAmVuIAEaBgiA_LiuBg',
  };
}

function resolveNewsUrl(href: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('./')) return `https://news.google.com/${href.slice(2)}`;
  if (href.startsWith('/')) return `https://news.google.com${href}`;
  if (href.startsWith('articles/')) return `https://news.google.com/${href}`;
  return '';
}

function contentType(ctx: string): 'article' | 'video' | 'web_story' {
  const l = ctx.toLowerCase();
  if (l.includes('youtube.com') || l.includes('video') || l.includes('watch')) return 'video';
  if (l.includes('web-story') || l.includes('amp-story')) return 'web_story';
  return 'article';
}

function img(h: string): string {
  const ss = h.match(/srcset="([^"]+)"/i);
  if (ss) { const u = ss[1].split(',').map(s => s.trim().split(/\s+/)[0]); return u[u.length - 1] || ''; }
  return (h.match(/(?:src|data-src)="(https?:\/\/[^"]+)"/i) || [])[1] || '';
}

function src(h: string): string {
  for (const p of [/<a[^>]*data-n-tid="[^"]*"[^>]*>([^<]+)/i, /class="[^"]*(?:vr1PYe|SVJrMe|wEwyrc|a7P8l)[^"]*"[^>]*>([^<]+)/i]) {
    const m = h.match(p); if (m) { const s = strip(m[1]); if (s.length > 1 && s.length < 80) return decode(s); }
  }
  return '';
}

function time(h: string): string {
  return (h.match(/<time[^>]*datetime="([^"]+)"/i) || h.match(/<time[^>]*>([^<]+)/i)
    || h.match(/(\d+\s+(?:hour|minute|day|week|month)s?\s+ago)/i)
    || h.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}\b)/i) || [])[1]?.trim() || '';
}

function snip(h: string): string {
  for (const p of [/class="[^"]*(?:GI74Re|xBbh9|Rai5ob)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i, /<p[^>]*>([\s\S]{20,300}?)<\/p>/i]) {
    const m = h.match(p); if (m) { const t = decode(strip(m[1])); if (t.length > 15) return t.slice(0, 300); }
  }
  return '';
}

function mkItem(pos: number, title: string, url: string, ctx: string, cat: string, fmt: string): DiscoverItem {
  const hasVideo = /video|youtube/i.test(ctx);
  return { position: pos, title, source: src(ctx), sourceUrl: '', url, snippet: snip(ctx),
    imageUrl: img(ctx), contentType: contentType(ctx), publishedAt: time(ctx), category: cat,
    engagement: { hasVideoPreview: hasVideo, format: fmt } };
}

// ─── STRATEGY 1: GOOGLE NEWS HTML ───────────────────

function parseNewsHtml(html: string, cat: string): DiscoverItem[] {
  const items: DiscoverItem[] = [];
  const seen = new Set<string>();
  const titlePats = [
    /<a[^>]*href="([^"]*)"[^>]*class="[^"]*(?:JtKRv|DY5T1d|VDXfz|ipQwMb|gPFEn)[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    /<h[34][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[34]>/i,
    /<a[^>]*href="([^"]*(?:articles|story)[^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
  ];

  // Try <article> blocks, then broad link scan
  const blockRes = [/<article[^>]*>([\s\S]*?)<\/article>/gi, /<a[^>]*href="([^"]*(?:articles|story)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi];
  for (const blockRe of blockRes) {
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null) {
      const block = m[0];
      for (const tp of titlePats) {
        const tm = block.match(tp);
        if (!tm) continue;
        const url = resolveNewsUrl(tm[1]), title = decode(strip(tm[2]));
        if (!url || title.length < 10 || seen.has(url)) continue;
        seen.add(url);
        items.push(mkItem(items.length + 1, title, url, block, cat, 'html'));
        break;
      }
    }
    if (items.length > 0) break;
  }
  return items;
}

// ─── STRATEGY 2: GOOGLE NEWS RSS ────────────────────

function parseRss(xml: string, cat: string): DiscoverItem[] {
  const items: DiscoverItem[] = [];
  const seen = new Set<string>();
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = decode(strip((b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || ''));
    const url = (b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]?.trim() || '';
    if (!title || title.length < 10 || !url || seen.has(url)) continue;
    seen.add(url);

    const desc = (b.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || [])[1] || '';
    const srcM = b.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    const pubDate = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim() || '';

    items.push({
      position: items.length + 1, title,
      source: srcM ? decode(strip(srcM[2])) : '', sourceUrl: srcM ? srcM[1] : '', url,
      snippet: decode(strip(desc)).slice(0, 300),
      imageUrl: (desc.match(/<img[^>]*src="([^"]+)"/i) || [])[1] || '',
      contentType: /video|youtube/i.test(b) ? 'video' : 'article',
      publishedAt: pubDate, category: cat,
      engagement: { hasVideoPreview: /video|youtube/i.test(b), format: 'rss' },
    });
  }
  return items;
}

// ─── STRATEGY 3: GOOGLE SEARCH NEWS TAB ─────────────

function parseSearchNews(html: string, cat: string): DiscoverItem[] {
  const items: DiscoverItem[] = [];
  const seen = new Set<string>();
  const re = /<div[^>]*class="[^"]*(?:SoaBEf|WlydOe|JJZKK|MjjYud)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:SoaBEf|WlydOe|JJZKK|MjjYud)|\s*$)/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const b = m[0];
    let url = (b.match(/<a[^>]*href="(https?:\/\/(?!google\.com|gstatic)[^"]+)"/i) || [])[1] || '';
    if (!url) {
      const q = (b.match(/\/url\?q=(https?:\/\/[^&"]+)/i) || [])[1];
      url = q ? decodeURIComponent(q) : '';
    }
    if (!url || seen.has(url) || url.includes('google.com')) continue;

    const title = decode(strip((b.match(/<div[^>]*role="heading"[^>]*>([^<]+)/i)
      || b.match(/<h[34][^>]*>([^<]+)/i) || b.match(/class="[^"]*(?:mCBkyc|BNeawe|n0jPhd)[^"]*"[^>]*>([^<]+)/i) || [])[1] || ''));
    if (!title || title.length < 10) continue;
    seen.add(url);

    const pubAt = (b.match(/class="[^"]*(?:r0bn4c|WG9SHc|OSrXXb)[^"]*"[^>]*>([^<]+)/i)
      || b.match(/<time[^>]*>([^<]+)/i) || b.match(/(\d+\s+(?:hours?|minutes?|days?|weeks?)\s+ago)/i) || [])[1]?.trim() || '';
    const source = decode((b.match(/class="[^"]*(?:CEMjEf|WF4CUc|NUnG9d)[^"]*"[^>]*>([^<]+)/i) || [])[1]?.trim() || '');

    items.push({ position: items.length + 1, title, source, sourceUrl: '', url,
      snippet: snip(b), imageUrl: img(b), contentType: contentType(b),
      publishedAt: pubAt, category: cat,
      engagement: { hasVideoPreview: /video|youtube/i.test(b), format: 'search' } });
  }
  return items;
}

// ─── MAIN EXPORT ────────────────────────────────────

export async function getDiscoverFeed(
  country: string, category: string, proxyFetch: ProxyFetchFn,
): Promise<DiscoverFeedResult> {
  const cc = country.toUpperCase(), cat = category.toLowerCase();
  const topicId = TOPIC_IDS[cat] || TOPIC_IDS.news;
  const hdrs = headers(cc);
  const items: DiscoverItem[] = [], seen = new Set<string>();

  const add = (list: DiscoverItem[]) => {
    for (const it of list) { if (seen.has(it.url)) continue; seen.add(it.url); it.position = items.length + 1; items.push(it); }
  };

  // Strategy 1: Google News HTML
  try {
    const url = `https://news.google.com/topics/${topicId}?hl=en-${cc}&gl=${cc}&ceid=${cc}:en`;
    console.log(`[Discover] S1: News HTML — ${url}`);
    const r = await proxyFetch(url, { headers: hdrs, maxRetries: 2, timeoutMs: 30_000 });
    if (r.ok) {
      const h = await r.text();
      if (!h.includes('captcha') && !h.includes('unusual traffic')) { add(parseNewsHtml(h, cat)); }
    }
  } catch (e: any) { console.log(`[Discover] S1 failed: ${e?.message}`); }

  // Strategy 2: Google News RSS
  if (items.length < 5) {
    try {
      const url = `https://news.google.com/rss/topics/${topicId}?hl=en-${cc}&gl=${cc}&ceid=${cc}:en`;
      console.log(`[Discover] S2: News RSS — ${url}`);
      const r = await proxyFetch(url, { headers: { ...hdrs, Accept: 'application/rss+xml,text/xml,*/*' }, maxRetries: 2, timeoutMs: 25_000 });
      if (r.ok) add(parseRss(await r.text(), cat));
    } catch (e: any) { console.log(`[Discover] S2 failed: ${e?.message}`); }
  }

  // Strategy 3: Google Search news tab
  if (items.length < 5) {
    try {
      const q = cat === 'news' || cat === 'top' ? 'latest news' : `${cat} news`;
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=nws&hl=en&gl=${cc.toLowerCase()}&num=20`;
      console.log(`[Discover] S3: Search news — ${url}`);
      const r = await proxyFetch(url, { headers: hdrs, maxRetries: 1, timeoutMs: 25_000 });
      if (r.ok) { const h = await r.text(); if (!h.includes('captcha')) add(parseSearchNews(h, cat)); }
    } catch (e: any) { console.log(`[Discover] S3 failed: ${e?.message}`); }
  }

  console.log(`[Discover] Total items: ${items.length}`);
  return { country: cc, category: cat, discover_feed: items,
    metadata: { feedLength: items.length, scrapedAt: new Date().toISOString(), proxyCountry: cc } };
}