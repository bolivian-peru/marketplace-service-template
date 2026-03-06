import { proxyFetch } from '../proxy';

export type OddsPoint = {
  source: 'polymarket' | 'kalshi' | 'metaculus';
  yes?: number;
  no?: number;
  median?: number;
  volume24h?: number;
  liquidity?: number;
  forecasters?: number;
  marketId: string;
  title: string;
  url?: string;
};

function toNum(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function keywordMatch(text: string, query?: string) {
  if (!query) return true;
  const stop = new Set(['the', 'and', 'or', 'in', 'on', 'for', 'to', 'of', 'by', 'will', 'market', 'markets']);
  const qs = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(k => !stop.has(k))
    .filter(k => k.length >= 3)
    .slice(0, 6);
  if (!qs.length) return true;
  const t = text.toLowerCase();
  const matches = qs.filter(k => t.includes(k));
  return matches.length >= Math.min(2, qs.length);
}

export async function fetchPolymarketOdds(limit = 10, query?: string): Promise<OddsPoint[]> {
  const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=${Math.max(1, Math.min(limit * 5, 100))}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`polymarket_http_${r.status}`);
  const data = await r.json() as any[];

  const out: OddsPoint[] = [];
  for (const e of data ?? []) {
    const title = String(e?.title ?? e?.question ?? 'unknown');
    if (!keywordMatch(title, query)) continue;
    const yes = toNum(e?.outcomes?.[0]?.price ?? e?.markets?.[0]?.outcomes?.[0]?.price);
    const no = toNum(e?.outcomes?.[1]?.price ?? e?.markets?.[0]?.outcomes?.[1]?.price);
    out.push({
      source: 'polymarket',
      marketId: String(e?.id ?? e?.slug ?? e?.ticker ?? 'unknown'),
      title,
      yes,
      no,
      volume24h: toNum(e?.volume24hr ?? e?.volumeNum),
      liquidity: toNum(e?.liquidityNum),
      url: e?.slug ? `https://polymarket.com/event/${e.slug}` : undefined,
    });
  }
  return out;
}

export async function fetchKalshiOdds(limit = 10, query?: string): Promise<OddsPoint[]> {
  const max = Math.max(1, Math.min(limit * 8, 200));
  const urls = [
    `https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=${max}`,
    `https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=${max}`,
  ];

  const out: OddsPoint[] = [];

  for (const url of urls) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) continue;
    const data = await r.json() as any;

    if (Array.isArray(data?.markets)) {
      for (const m of data.markets) {
        const title = String(m?.title ?? m?.subtitle ?? m?.ticker ?? 'unknown');
        if (!keywordMatch(title, query)) continue;
        const yesRaw = toNum(m?.yes_ask ?? m?.yes_bid ?? m?.last_price ?? m?.last_price_yes);
        const yes = yesRaw !== undefined && yesRaw > 1 ? yesRaw / 100 : yesRaw;
        const no = yes !== undefined ? Number((1 - yes).toFixed(4)) : undefined;
        out.push({
          source: 'kalshi',
          marketId: String(m?.ticker ?? m?.id ?? 'unknown'),
          title,
          yes,
          no,
          volume24h: toNum(m?.volume_24h ?? m?.volume),
          liquidity: toNum(m?.open_interest),
          url: m?.ticker ? `https://kalshi.com/markets/${m.ticker}` : undefined,
        });
      }
    }

    if (!out.length && Array.isArray(data?.events)) {
      for (const e of data.events) {
        const m = e?.markets?.[0];
        const title = String(e?.title ?? m?.title ?? 'unknown');
        if (!keywordMatch(title, query)) continue;
        const yesRaw = toNum(m?.yes_bid ?? m?.yes_ask ?? m?.last_price);
        const yes = yesRaw !== undefined && yesRaw > 1 ? yesRaw / 100 : yesRaw;
        const no = yes !== undefined ? Number((1 - yes).toFixed(4)) : undefined;
        out.push({
          source: 'kalshi',
          marketId: String(m?.ticker ?? e?.event_ticker ?? e?.id ?? 'unknown'),
          title,
          yes,
          no,
          volume24h: toNum(m?.volume),
          liquidity: toNum(m?.open_interest),
          url: m?.ticker ? `https://kalshi.com/markets/${m.ticker}` : undefined,
        });
      }
    }

    if (out.length) break;
  }

  return out.slice(0, limit);
}

export async function fetchMetaculusForecasts(limit = 10, query?: string): Promise<OddsPoint[]> {
  const max = Math.max(1, Math.min(limit * 5, 100));
  const out: OddsPoint[] = [];

  // Try official API first (may require auth on some environments).
  try {
    const url = `https://www.metaculus.com/api2/questions/?status=open&limit=${max}`;
    const r = await fetch(url, { headers: { accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) {
      const data = await r.json() as any;
      for (const q of data?.results ?? []) {
        const title = String(q?.title ?? 'unknown');
        if (!keywordMatch(title, query)) continue;
        const median = toNum(q?.community_prediction?.full?.q2 ?? q?.community_prediction?.q2);
        out.push({
          source: 'metaculus',
          marketId: String(q?.id ?? 'unknown'),
          title,
          median,
          forecasters: toNum(q?.nr_forecasters),
          url: q?.page_url ? `https://www.metaculus.com${q.page_url}` : undefined,
        });
      }
      if (out.length) return out.slice(0, limit);
    }
  } catch {
    // fall through to HTML fallback
  }

  // Fallback: scrape public question feed via jina mirror to avoid auth wall.
  const q = encodeURIComponent((query || 'election').trim());
  const fallbackUrl = `https://r.jina.ai/http://www.metaculus.com/questions/?search=${q}`;
  const fr = await fetch(fallbackUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!fr.ok) return [];
  const txt = await fr.text();

  // Parse markdown sections beginning with #### question title.
  const blocks = txt.split('\n#### ').slice(1);
  for (const b of blocks) {
    if (out.length >= limit) break;
    const lines = b.split('\n').map((x) => x.trim()).filter(Boolean);
    const title = lines[0] || 'unknown';
    if (!keywordMatch(title, query)) continue;

    const link = b.match(/\(http:\/\/www\.metaculus\.com\/questions\/(\d+)\/[^)]+\)/);
    const forecastersMatch = b.match(/\*\*(\d[\d.,kK]*)\*\*\s+forecasters/i);
    const pctMatch = b.match(/(\d{1,3}(?:\.\d+)?)%/);

    let forecasters: number | undefined;
    if (forecastersMatch) {
      const raw = forecastersMatch[1].toLowerCase();
      forecasters = raw.includes('k') ? Number(raw.replace('k', '')) * 1000 : Number(raw.replace(/,/g, ''));
    }

    const median = pctMatch ? Number(pctMatch[1]) / 100 : undefined;
    out.push({
      source: 'metaculus',
      marketId: link?.[1] || String(out.length + 1),
      title,
      median,
      forecasters,
      url: link ? `https://www.metaculus.com/questions/${link[1]}/` : undefined,
    });
  }

  return out.slice(0, limit);
}

export type SentimentSample = {
  platform: 'reddit' | 'x' | 'tiktok';
  text: string;
  score: number;
  author?: string;
  url?: string;
};

export async function fetchRedditSentiment(topic: string, limit = 20): Promise<SentimentSample[]> {
  const q = encodeURIComponent(topic.trim());
  const urls = [
    `https://www.reddit.com/search.json?q=${q}&sort=new&limit=${Math.max(1, Math.min(limit, 50))}`,
    `https://r.jina.ai/http://www.reddit.com/search.json?q=${q}&sort=new&limit=${Math.max(1, Math.min(limit, 50))}`,
  ];

  let data: any = null;
  for (const url of urls) {
    try {
      const r = await proxyFetch(url, { timeoutMs: 20000, maxRetries: 2, headers: { 'User-Agent': 'reddit-signal-bot/1.0' } });
      if (!r.ok) continue;
      const text = await r.text();
      data = text.trim().startsWith('{') ? JSON.parse(text) : null;
      if (data) break;
    } catch {
      // continue
    }
  }

  const out: SentimentSample[] = [];
  for (const c of data?.data?.children ?? []) {
    const d = c?.data;
    const text = `${d?.title ?? ''} ${d?.selftext ?? ''}`.trim();
    if (!text) continue;
    out.push({
      platform: 'reddit',
      text: text.slice(0, 500),
      score: Number(d?.score ?? 0),
      author: d?.author,
      url: d?.permalink ? `https://reddit.com${d.permalink}` : undefined,
    });
  }
  return out;
}

async function fetchDuckDuckGoSamples(topic: string, site: string, platform: 'x' | 'reddit' | 'tiktok', limit = 20): Promise<SentimentSample[]> {
  const q = encodeURIComponent(`${topic} site:${site}`);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;

  let html = '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (r.ok) html = await r.text();
  } catch {
    // noop
  }

  if (!html) {
    const r = await proxyFetch(url, {
      timeoutMs: 20000,
      maxRetries: 2,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!r.ok) return [];
    html = await r.text();
  }

  const out: SentimentSample[] = [];
  const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) && out.length < Math.max(1, Math.min(limit, 50))) {
    const href = m[1] || '';
    const text = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ platform, text: text.slice(0, 500), score: 1, url: href || undefined });
  }

  return out;
}

export async function fetchXSentiment(topic: string, limit = 20): Promise<SentimentSample[]> {
  const q = encodeURIComponent(topic.trim());
  const rssUrls = [
    `https://nitter.net/search/rss?f=tweets&q=${q}`,
    `https://nitter.poast.org/search/rss?f=tweets&q=${q}`,
    `https://r.jina.ai/http://nitter.net/search/rss?f=tweets&q=${q}`,
  ];

  let xml = '';
  for (const rssUrl of rssUrls) {
    try {
      const r = await proxyFetch(rssUrl, { timeoutMs: 20000, maxRetries: 2, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const txt = await r.text();
      if (txt.includes('<item>')) { xml = txt; break; }
    } catch {
      // continue
    }
  }

  const out: SentimentSample[] = [];
  if (xml) {
    const items = xml.split('<item>').slice(1, 1 + Math.max(1, Math.min(limit, 50)));
    for (const item of items) {
      const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const link = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
      if (!title) continue;
      out.push({ platform: 'x', text: title.slice(0, 500), score: 1, url: link || undefined });
    }
  }

  if (!out.length) {
    return fetchDuckDuckGoSamples(topic, 'x.com', 'x', limit);
  }

  return out;
}

export async function fetchTikTokSentiment(topic: string, limit = 20): Promise<SentimentSample[]> {
  return fetchDuckDuckGoSamples(topic, 'tiktok.com', 'tiktok', limit);
}

export function classifySentiment(samples: SentimentSample[]) {
  const posWords = ['bullish', 'up', 'surge', 'win', 'positive', 'approve', 'rally'];
  const negWords = ['bearish', 'down', 'drop', 'loss', 'negative', 'reject', 'crash'];

  let pos = 0, neg = 0, neu = 0;
  for (const s of samples) {
    const t = s.text.toLowerCase();
    const p = posWords.some(w => t.includes(w));
    const n = negWords.some(w => t.includes(w));
    if (p && !n) pos++;
    else if (n && !p) neg++;
    else neu++;
  }

  const total = Math.max(1, samples.length);
  return {
    positive: Number((pos / total).toFixed(4)),
    negative: Number((neg / total).toFixed(4)),
    neutral: Number((neu / total).toFixed(4)),
    volume: samples.length,
  };
}
