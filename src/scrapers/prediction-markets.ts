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
  const url = `https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=${Math.max(1, Math.min(limit * 5, 100))}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`kalshi_http_${r.status}`);
  const data = await r.json() as any;

  const out: OddsPoint[] = [];
  for (const e of data?.events ?? []) {
    const m = e?.markets?.[0];
    const title = String(e?.title ?? m?.title ?? 'unknown');
    if (!keywordMatch(title, query)) continue;
    const yes = toNum(m?.yes_bid ?? m?.yes_ask ?? m?.last_price);
    const no = yes !== undefined ? 1 - yes : undefined;
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
  return out;
}

export async function fetchMetaculusForecasts(limit = 10, query?: string): Promise<OddsPoint[]> {
  const url = `https://www.metaculus.com/api2/questions/?status=open&limit=${Math.max(1, Math.min(limit * 5, 100))}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`metaculus_http_${r.status}`);
  const data = await r.json() as any;

  const out: OddsPoint[] = [];
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
  return out;
}

export type SentimentSample = {
  platform: 'reddit' | 'x';
  text: string;
  score: number;
  author?: string;
  url?: string;
};

export async function fetchRedditSentiment(topic: string, limit = 20): Promise<SentimentSample[]> {
  const q = encodeURIComponent(topic.trim());
  const url = `https://www.reddit.com/search.json?q=${q}&sort=new&limit=${Math.max(1, Math.min(limit, 50))}`;
  let r: Response;
  try {
    r = await proxyFetch(url, { timeoutMs: 20000, maxRetries: 2, headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch {
    r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json' } });
  }
  if (!r.ok) throw new Error(`reddit_http_${r.status}`);
  const data = await r.json() as any;

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

export async function fetchXSentiment(topic: string, limit = 20): Promise<SentimentSample[]> {
  const q = encodeURIComponent(topic.trim());
  const rssUrl = `https://nitter.net/search/rss?f=tweets&q=${q}`;
  let r: Response;
  try {
    r = await proxyFetch(rssUrl, { timeoutMs: 20000, maxRetries: 2, headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch {
    r = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  }
  if (!r.ok) throw new Error(`x_rss_http_${r.status}`);

  const xml = await r.text();
  const items = xml.split('<item>').slice(1, 1 + Math.max(1, Math.min(limit, 50)));
  const out: SentimentSample[] = [];

  for (const item of items) {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
    if (!title) continue;
    out.push({
      platform: 'x',
      text: title.slice(0, 500),
      score: 1,
      url: link || undefined,
    });
  }

  return out;
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
