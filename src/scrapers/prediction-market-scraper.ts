/**
 * Prediction Market Signal Aggregator (Bounty #55)
 * ─────────────────────────────────────────────────
 * Scrapes prediction market data from Polymarket, Metaculus, and PredictIt.
 * Extracts probabilities, volumes, and market metadata from public pages.
 *
 * Platforms:
 *   - Polymarket: CLOB-based prediction market (crypto-native)
 *   - Metaculus: Calibrated forecasting platform (community-driven)
 *   - PredictIt: Political prediction market (CFTC-regulated)
 */

import { decodeHtmlEntities, decodeUnicodeEscapes } from '../utils/helpers';

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (url: string, options?: any) => Promise<Response>;

export interface PredictionMarket {
  title: string;
  platform: 'Polymarket' | 'Metaculus' | 'PredictIt';
  probability: number | null;
  volume: string | null;
  url: string;
  category: string | null;
  lastUpdated: string | null;
  traders: number | null;
  description: string | null;
  endDate: string | null;
  outcomes: MarketOutcome[];
}

export interface MarketOutcome {
  name: string;
  probability: number | null;
  price: number | null;
}

export interface MarketSearchResult {
  type: 'trending' | 'search';
  markets: PredictionMarket[];
  metadata: {
    totalMarkets: number;
    platforms: string[];
    scrapedAt: string;
    query?: string;
    category?: string;
  };
}

export interface MarketDetailResult {
  type: 'details';
  market: PredictionMarket;
  metadata: {
    platform: string;
    scrapedAt: string;
    sourceUrl: string;
  };
}

// ─── CONSTANTS ──────────────────────────────────────

const POLYMARKET_BASE = 'https://polymarket.com';
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';
const METACULUS_BASE = 'https://www.metaculus.com';
const METACULUS_API = 'https://www.metaculus.com/api2';
const PREDICTIT_BASE = 'https://www.predictit.org';
const PREDICTIT_API = 'https://www.predictit.org/api/marketdata';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CATEGORY_MAP: Record<string, string[]> = {
  politics: ['politics', 'election', 'president', 'congress', 'senate', 'democrat', 'republican', 'biden', 'trump', 'vote'],
  crypto: ['crypto', 'bitcoin', 'ethereum', 'btc', 'eth', 'defi', 'token', 'blockchain', 'solana'],
  sports: ['sports', 'nfl', 'nba', 'mlb', 'soccer', 'football', 'basketball', 'baseball', 'super bowl'],
  science: ['science', 'climate', 'ai', 'technology', 'space', 'health', 'pandemic', 'vaccine', 'research'],
  economics: ['economics', 'fed', 'inflation', 'gdp', 'recession', 'interest rate', 'stock', 'market'],
  world: ['world', 'war', 'china', 'russia', 'ukraine', 'europe', 'asia', 'conflict', 'geopolitical'],
};

// ─── HELPERS ────────────────────────────────────────

function categorizeMarket(title: string, description: string | null): string | null {
  const text = `${title} ${description || ''}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) return category;
    }
  }
  return null;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function extractTextContent(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractJsonFromScript(html: string, marker: string): any | null {
  try {
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const start = html.indexOf('{', idx);
    if (start === -1) return null;
    let depth = 0;
    let end = start;
    for (let i = start; i < html.length && i < start + 500000; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') depth--;
      if (depth === 0) { end = i; break; }
    }
    const jsonStr = html.slice(start, end + 1);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function extractAllJsonBlocks(html: string): any[] {
  const blocks: any[] = [];
  const scriptRegex = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      blocks.push(parsed);
    } catch { /* skip malformed JSON */ }
  }

  // Also try __NEXT_DATA__ pattern
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      blocks.push(JSON.parse(nextDataMatch[1]));
    } catch { /* skip */ }
  }

  return blocks;
}

function safeParseFloat(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === 'string' ? parseFloat(val) : Number(val);
  return isNaN(n) ? null : n;
}

function formatVolume(vol: number | null): string | null {
  if (vol === null || vol === undefined) return null;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

function matchesCategory(market: PredictionMarket, category: string): boolean {
  if (!category) return true;
  const lowerCat = category.toLowerCase();
  if (market.category?.toLowerCase() === lowerCat) return true;
  const keywords = CATEGORY_MAP[lowerCat] || [lowerCat];
  const text = `${market.title} ${market.description || ''}`.toLowerCase();
  return keywords.some(kw => text.includes(kw));
}

function matchesSearch(market: PredictionMarket, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${market.title} ${market.description || ''} ${market.category || ''}`.toLowerCase();
  return terms.some(term => text.includes(term));
}

// ─── POLYMARKET SCRAPER ─────────────────────────────

async function scrapePolymarketTrending(
  fetchFn: ProxyFetchFn,
  limit: number = 20,
): Promise<PredictionMarket[]> {
  const markets: PredictionMarket[] = [];

  // Strategy 1: Use Gamma API (public, no auth needed)
  try {
    const apiUrl = `${POLYMARKET_GAMMA_API}/markets?limit=${Math.min(limit * 2, 100)}&active=true&closed=false&order=volume24hr&ascending=false`;
    const resp = await fetchFn(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': POLYMARKET_BASE,
      },
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    if (resp.ok) {
      const data: any[] = await resp.json();
      for (const item of data) {
        if (!item.question && !item.title) continue;
        const title = decodeHtmlEntities(item.question || item.title || '');
        const description = item.description ? decodeHtmlEntities(item.description) : null;
        const outcomes: MarketOutcome[] = [];

        // Parse outcomes from the market data
        if (item.outcomes && Array.isArray(item.outcomes)) {
          const outcomePrices = item.outcomePrices
            ? (typeof item.outcomePrices === 'string' ? JSON.parse(item.outcomePrices) : item.outcomePrices)
            : [];
          for (let i = 0; i < item.outcomes.length; i++) {
            const price = safeParseFloat(outcomePrices[i]);
            outcomes.push({
              name: item.outcomes[i],
              probability: price !== null ? Math.round(price * 100) : null,
              price,
            });
          }
        }

        // Get primary probability (first outcome, typically "Yes")
        let probability: number | null = null;
        if (outcomes.length > 0 && outcomes[0].probability !== null) {
          probability = outcomes[0].probability;
        } else if (item.bestBid !== undefined) {
          probability = Math.round(safeParseFloat(item.bestBid)! * 100);
        }

        const volume = safeParseFloat(item.volume) || safeParseFloat(item.volume24hr);
        const traders = item.competitive != null
          ? safeParseFloat(item.competitive)
          : (safeParseFloat(item.uniqueTraders) || safeParseFloat(item.liquidity));

        const slug = item.slug || item.conditionId || '';
        const url = slug ? `${POLYMARKET_BASE}/event/${slug}` : POLYMARKET_BASE;

        markets.push({
          title,
          platform: 'Polymarket',
          probability,
          volume: formatVolume(volume),
          url,
          category: categorizeMarket(title, description),
          lastUpdated: item.updatedAt || item.lastTradeTimestamp || null,
          traders: traders ? Math.round(traders) : null,
          description,
          endDate: item.endDate || item.expirationDate || null,
          outcomes,
        });
      }
    }
  } catch (err: any) {
    console.error(`[Polymarket API] Error: ${err.message}`);
  }

  // Strategy 2: Scrape the homepage HTML if API returned nothing
  if (markets.length === 0) {
    try {
      const resp = await fetchFn(`${POLYMARKET_BASE}/markets`, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': USER_AGENT,
        },
        maxRetries: 2,
        timeoutMs: 25_000,
      });

      if (resp.ok) {
        const html = await resp.text();
        const cleaned = cleanHtml(html);

        // Try extracting from embedded JSON (Next.js/React hydration data)
        const jsonBlocks = extractAllJsonBlocks(html);
        for (const block of jsonBlocks) {
          const extracted = extractMarketsFromJsonBlock(block, 'Polymarket');
          markets.push(...extracted);
        }

        // Fallback: parse from __NEXT_DATA__ or window.__NEXT_DATA__
        if (markets.length === 0) {
          const nextData = extractJsonFromScript(html, '__NEXT_DATA__');
          if (nextData?.props?.pageProps) {
            const pageProps = nextData.props.pageProps;
            const marketData = pageProps.markets || pageProps.events || pageProps.data || [];
            for (const item of (Array.isArray(marketData) ? marketData : [])) {
              const title = item.question || item.title || item.name || '';
              if (!title) continue;
              markets.push({
                title: decodeHtmlEntities(title),
                platform: 'Polymarket',
                probability: item.probability != null ? Math.round(item.probability * 100) : null,
                volume: formatVolume(safeParseFloat(item.volume)),
                url: item.slug ? `${POLYMARKET_BASE}/event/${item.slug}` : POLYMARKET_BASE,
                category: categorizeMarket(title, item.description || null),
                lastUpdated: item.updatedAt || null,
                traders: safeParseFloat(item.uniqueTraders),
                description: item.description || null,
                endDate: item.endDate || null,
                outcomes: [],
              });
            }
          }
        }

        // Fallback: regex extraction from HTML cards
        if (markets.length === 0) {
          const cardPatterns = [
            /<a[^>]*href="\/event\/([^"]+)"[^>]*>[\s\S]*?<\/a>/gi,
            /<div[^>]*class="[^"]*market[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
            /<div[^>]*data-testid="[^"]*market[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
          ];

          for (const pattern of cardPatterns) {
            let cardMatch;
            while ((cardMatch = pattern.exec(cleaned)) !== null && markets.length < limit) {
              const cardHtml = cardMatch[0];
              const titleMatch = cardHtml.match(/<(?:h[1-6]|span|p|div)[^>]*>([^<]{10,200})<\//);
              if (!titleMatch) continue;

              const title = decodeHtmlEntities(titleMatch[1]);
              const probMatch = cardHtml.match(/(\d{1,3})(?:\.\d+)?%/);
              const volMatch = cardHtml.match(/\$[\d,.]+[KMB]?/i);
              const slug = cardMatch[1] || '';

              markets.push({
                title,
                platform: 'Polymarket',
                probability: probMatch ? parseInt(probMatch[1]) : null,
                volume: volMatch ? volMatch[0] : null,
                url: slug ? `${POLYMARKET_BASE}/event/${slug}` : POLYMARKET_BASE,
                category: categorizeMarket(title, null),
                lastUpdated: null,
                traders: null,
                description: null,
                endDate: null,
                outcomes: [],
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[Polymarket HTML] Error: ${err.message}`);
    }
  }

  return markets.slice(0, limit);
}

function extractMarketsFromJsonBlock(data: any, platform: 'Polymarket'): PredictionMarket[] {
  const results: PredictionMarket[] = [];
  if (!data || typeof data !== 'object') return results;

  // Recursively search for market-like objects
  const visited = new WeakSet();
  function traverse(obj: any, depth: number): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (visited.has(obj)) return;
    visited.add(obj);

    // Check if this looks like a market object
    if (obj.question || (obj.title && obj.slug)) {
      const title = obj.question || obj.title || '';
      if (title.length > 5) {
        const prob = obj.probability ?? obj.bestBid ?? obj.outcomePrices?.[0];
        results.push({
          title: decodeHtmlEntities(title),
          platform,
          probability: prob != null ? Math.round(Number(prob) * 100) : null,
          volume: formatVolume(safeParseFloat(obj.volume || obj.volume24hr)),
          url: obj.slug ? `${POLYMARKET_BASE}/event/${obj.slug}` : POLYMARKET_BASE,
          category: categorizeMarket(title, obj.description || null),
          lastUpdated: obj.updatedAt || null,
          traders: safeParseFloat(obj.uniqueTraders),
          description: obj.description || null,
          endDate: obj.endDate || null,
          outcomes: [],
        });
      }
    }

    // Recurse into arrays and objects
    if (Array.isArray(obj)) {
      for (const item of obj) traverse(item, depth + 1);
    } else {
      for (const key of Object.keys(obj)) {
        traverse(obj[key], depth + 1);
      }
    }
  }

  traverse(data, 0);
  return results;
}

async function scrapePolymarketDetails(
  url: string,
  fetchFn: ProxyFetchFn,
): Promise<PredictionMarket | null> {
  try {
    // Try Gamma API first if we can extract the slug
    const slugMatch = url.match(/\/event\/([^/?#]+)/);
    if (slugMatch) {
      const slug = slugMatch[1];
      const apiResp = await fetchFn(`${POLYMARKET_GAMMA_API}/markets?slug=${slug}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        maxRetries: 2,
        timeoutMs: 20_000,
      });

      if (apiResp.ok) {
        const data: any[] = await apiResp.json();
        if (data.length > 0) {
          const item = data[0];
          const outcomes: MarketOutcome[] = [];
          if (item.outcomes && Array.isArray(item.outcomes)) {
            const prices = item.outcomePrices
              ? (typeof item.outcomePrices === 'string' ? JSON.parse(item.outcomePrices) : item.outcomePrices)
              : [];
            for (let i = 0; i < item.outcomes.length; i++) {
              const price = safeParseFloat(prices[i]);
              outcomes.push({
                name: item.outcomes[i],
                probability: price !== null ? Math.round(price * 100) : null,
                price,
              });
            }
          }

          const probability = outcomes.length > 0 && outcomes[0].probability !== null
            ? outcomes[0].probability
            : (item.bestBid != null ? Math.round(Number(item.bestBid) * 100) : null);

          return {
            title: decodeHtmlEntities(item.question || item.title || ''),
            platform: 'Polymarket',
            probability,
            volume: formatVolume(safeParseFloat(item.volume)),
            url,
            category: categorizeMarket(item.question || item.title || '', item.description),
            lastUpdated: item.updatedAt || null,
            traders: safeParseFloat(item.uniqueTraders),
            description: item.description ? decodeHtmlEntities(item.description) : null,
            endDate: item.endDate || item.expirationDate || null,
            outcomes,
          };
        }
      }
    }

    // Fallback: scrape HTML
    const resp = await fetchFn(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': USER_AGENT },
      maxRetries: 2,
      timeoutMs: 25_000,
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    // Try embedded JSON
    const jsonBlocks = extractAllJsonBlocks(html);
    for (const block of jsonBlocks) {
      const extracted = extractMarketsFromJsonBlock(block, 'Polymarket');
      if (extracted.length > 0) return { ...extracted[0], url };
    }

    // Parse HTML directly
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
      || html.match(/<title>([^<]+)<\/title>/i)
      || html.match(/og:title[^>]*content="([^"]+)"/i);

    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Market';
    const probMatch = html.match(/(\d{1,3})(?:\.\d+)?%/);
    const volMatch = html.match(/(?:volume|traded)[^$]*\$([\d,.]+[KMB]?)/i);
    const descMatch = html.match(/og:description[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);

    return {
      title,
      platform: 'Polymarket',
      probability: probMatch ? parseInt(probMatch[1]) : null,
      volume: volMatch ? `$${volMatch[1]}` : null,
      url,
      category: categorizeMarket(title, descMatch?.[1] || null),
      lastUpdated: null,
      traders: null,
      description: descMatch ? decodeHtmlEntities(descMatch[1]) : null,
      endDate: null,
      outcomes: [],
    };
  } catch (err: any) {
    console.error(`[Polymarket Details] Error: ${err.message}`);
    return null;
  }
}

// ─── METACULUS SCRAPER ──────────────────────────────

async function scrapeMetaculusTrending(
  fetchFn: ProxyFetchFn,
  limit: number = 20,
): Promise<PredictionMarket[]> {
  const markets: PredictionMarket[] = [];

  // Strategy 1: Metaculus API (public, paginated)
  try {
    const apiUrl = `${METACULUS_API}/questions/?limit=${Math.min(limit * 2, 100)}&offset=0&order_by=-activity&status=open&type=forecast&include_description=true`;
    const resp = await fetchFn(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': METACULUS_BASE,
      },
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    if (resp.ok) {
      const data: any = await resp.json();
      const questions = data.results || data.questions || (Array.isArray(data) ? data : []);

      for (const q of questions) {
        if (!q.title && !q.title_short) continue;
        const title = decodeHtmlEntities(q.title || q.title_short || '');
        const description = q.description ? decodeHtmlEntities(
          q.description.replace(/<[^>]+>/g, ' ').substring(0, 500)
        ) : null;

        // Extract probability from different Metaculus response shapes
        let probability: number | null = null;
        if (q.community_prediction?.full?.q2 != null) {
          probability = Math.round(q.community_prediction.full.q2 * 100);
        } else if (q.community_prediction?.history?.length > 0) {
          const latest = q.community_prediction.history[q.community_prediction.history.length - 1];
          probability = latest.x2 != null ? Math.round(latest.x2 * 100) : null;
        } else if (q.my_predictions?.latest?.x2 != null) {
          probability = Math.round(q.my_predictions.latest.x2 * 100);
        } else if (q.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
          probability = Math.round(q.aggregations.recency_weighted.latest.centers[0] * 100);
        } else if (q.forecast_values?.latest != null) {
          probability = Math.round(q.forecast_values.latest * 100);
        } else if (q.question?.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
          probability = Math.round(q.question.aggregations.recency_weighted.latest.centers[0] * 100);
        }

        const forecasters = q.number_of_forecasters || q.forecasts_count || q.prediction_count || null;
        const qUrl = q.url || `${METACULUS_BASE}/questions/${q.id}/`;

        markets.push({
          title,
          platform: 'Metaculus',
          probability,
          volume: null, // Metaculus doesn't have monetary volume
          url: qUrl.startsWith('http') ? qUrl : `${METACULUS_BASE}${qUrl}`,
          category: categorizeMarket(title, description),
          lastUpdated: q.last_activity_time || q.edited_time || null,
          traders: forecasters,
          description,
          endDate: q.resolve_time || q.close_time || null,
          outcomes: probability !== null ? [
            { name: 'Yes', probability, price: probability / 100 },
            { name: 'No', probability: 100 - probability, price: (100 - probability) / 100 },
          ] : [],
        });
      }
    }
  } catch (err: any) {
    console.error(`[Metaculus API] Error: ${err.message}`);
  }

  // Strategy 2: HTML scraping fallback
  if (markets.length === 0) {
    try {
      const resp = await fetchFn(`${METACULUS_BASE}/questions/`, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': USER_AGENT,
        },
        maxRetries: 2,
        timeoutMs: 25_000,
      });

      if (resp.ok) {
        const html = await resp.text();
        const cleaned = cleanHtml(html);

        // Try __NEXT_DATA__ or similar embedded state
        const jsonBlocks = extractAllJsonBlocks(html);
        for (const block of jsonBlocks) {
          const extracted = extractMetaculusFromJson(block);
          markets.push(...extracted);
        }

        // Fallback: parse question cards from HTML
        if (markets.length === 0) {
          const questionPatterns = [
            /<a[^>]*href="(\/questions\/\d+\/[^"]*)"[^>]*>[\s\S]*?<\/a>/gi,
            /<div[^>]*class="[^"]*question[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
            /<li[^>]*class="[^"]*question[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
          ];

          for (const pattern of questionPatterns) {
            let match;
            while ((match = pattern.exec(cleaned)) !== null && markets.length < limit) {
              const fragment = match[0];
              const hrefMatch = fragment.match(/href="(\/questions\/\d+\/[^"]*)"/);
              const titleMatch = fragment.match(/>([^<]{15,200})</);
              if (!titleMatch) continue;

              const title = decodeHtmlEntities(titleMatch[1].trim());
              if (title.length < 10) continue;

              const probMatch = fragment.match(/(\d{1,3})%/);
              const forecastersMatch = fragment.match(/(\d+)\s*(?:forecaster|prediction)/i);
              const qPath = hrefMatch ? hrefMatch[1] : '';

              markets.push({
                title,
                platform: 'Metaculus',
                probability: probMatch ? parseInt(probMatch[1]) : null,
                volume: null,
                url: qPath ? `${METACULUS_BASE}${qPath}` : METACULUS_BASE,
                category: categorizeMarket(title, null),
                lastUpdated: null,
                traders: forecastersMatch ? parseInt(forecastersMatch[1]) : null,
                description: null,
                endDate: null,
                outcomes: [],
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[Metaculus HTML] Error: ${err.message}`);
    }
  }

  return markets.slice(0, limit);
}

function extractMetaculusFromJson(data: any): PredictionMarket[] {
  const results: PredictionMarket[] = [];
  if (!data || typeof data !== 'object') return results;

  const visited = new WeakSet();
  function traverse(obj: any, depth: number): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (visited.has(obj)) return;
    visited.add(obj);

    // Check if this looks like a Metaculus question
    if (obj.title && (obj.resolve_time || obj.type === 'forecast' || obj.number_of_forecasters != null)) {
      const title = decodeHtmlEntities(obj.title);
      let prob: number | null = null;
      if (obj.community_prediction?.full?.q2 != null) {
        prob = Math.round(obj.community_prediction.full.q2 * 100);
      } else if (obj.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
        prob = Math.round(obj.aggregations.recency_weighted.latest.centers[0] * 100);
      }

      results.push({
        title,
        platform: 'Metaculus',
        probability: prob,
        volume: null,
        url: obj.url || (obj.id ? `${METACULUS_BASE}/questions/${obj.id}/` : METACULUS_BASE),
        category: categorizeMarket(title, obj.description || null),
        lastUpdated: obj.last_activity_time || null,
        traders: obj.number_of_forecasters || null,
        description: obj.description
          ? decodeHtmlEntities(obj.description.replace(/<[^>]+>/g, ' ').substring(0, 500))
          : null,
        endDate: obj.resolve_time || null,
        outcomes: prob !== null ? [
          { name: 'Yes', probability: prob, price: prob / 100 },
          { name: 'No', probability: 100 - prob, price: (100 - prob) / 100 },
        ] : [],
      });
    }

    if (Array.isArray(obj)) {
      for (const item of obj) traverse(item, depth + 1);
    } else {
      for (const key of Object.keys(obj)) traverse(obj[key], depth + 1);
    }
  }

  traverse(data, 0);
  return results;
}

async function scrapeMetaculusDetails(
  url: string,
  fetchFn: ProxyFetchFn,
): Promise<PredictionMarket | null> {
  try {
    // Extract question ID from URL
    const idMatch = url.match(/\/questions\/(\d+)/);
    if (idMatch) {
      const qId = idMatch[1];
      const apiResp = await fetchFn(`${METACULUS_API}/questions/${qId}/`, {
        headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        maxRetries: 2,
        timeoutMs: 20_000,
      });

      if (apiResp.ok) {
        const q: any = await apiResp.json();
        const title = decodeHtmlEntities(q.title || q.title_short || '');
        const description = q.description
          ? decodeHtmlEntities(q.description.replace(/<[^>]+>/g, ' ').substring(0, 1000))
          : null;

        let probability: number | null = null;
        if (q.community_prediction?.full?.q2 != null) {
          probability = Math.round(q.community_prediction.full.q2 * 100);
        } else if (q.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
          probability = Math.round(q.aggregations.recency_weighted.latest.centers[0] * 100);
        } else if (q.question?.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
          probability = Math.round(q.question.aggregations.recency_weighted.latest.centers[0] * 100);
        }

        return {
          title,
          platform: 'Metaculus',
          probability,
          volume: null,
          url,
          category: categorizeMarket(title, description),
          lastUpdated: q.last_activity_time || null,
          traders: q.number_of_forecasters || null,
          description,
          endDate: q.resolve_time || q.close_time || null,
          outcomes: probability !== null ? [
            { name: 'Yes', probability, price: probability / 100 },
            { name: 'No', probability: 100 - probability, price: (100 - probability) / 100 },
          ] : [],
        };
      }
    }

    // Fallback: scrape HTML
    const resp = await fetchFn(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': USER_AGENT },
      maxRetries: 2,
      timeoutMs: 25_000,
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
      || html.match(/<title>([^<]+)<\/title>/i)
      || html.match(/og:title[^>]*content="([^"]+)"/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Question';

    const probMatch = html.match(/(?:community|median)\s*(?:prediction|forecast)?[^%]*?(\d{1,3})%/i)
      || html.match(/(\d{1,3})%/);
    const descMatch = html.match(/og:description[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    const forecastersMatch = html.match(/(\d+)\s*(?:forecaster|prediction)/i);

    const probability = probMatch ? parseInt(probMatch[1]) : null;
    return {
      title,
      platform: 'Metaculus',
      probability,
      volume: null,
      url,
      category: categorizeMarket(title, descMatch?.[1] || null),
      lastUpdated: null,
      traders: forecastersMatch ? parseInt(forecastersMatch[1]) : null,
      description: descMatch ? decodeHtmlEntities(descMatch[1]) : null,
      endDate: null,
      outcomes: probability !== null ? [
        { name: 'Yes', probability, price: probability / 100 },
        { name: 'No', probability: 100 - probability, price: (100 - probability) / 100 },
      ] : [],
    };
  } catch (err: any) {
    console.error(`[Metaculus Details] Error: ${err.message}`);
    return null;
  }
}

// ─── PREDICTIT SCRAPER ──────────────────────────────

async function scrapePredictItTrending(
  fetchFn: ProxyFetchFn,
  limit: number = 20,
): Promise<PredictionMarket[]> {
  const markets: PredictionMarket[] = [];

  // Strategy 1: PredictIt public API (JSON, no auth)
  try {
    const resp = await fetchFn(`${PREDICTIT_API}/all/`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': PREDICTIT_BASE,
      },
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    if (resp.ok) {
      const data: any = await resp.json();
      const apiMarkets = data.markets || data.Markets || (Array.isArray(data) ? data : []);

      // Sort by total trade volume or number of contracts
      const sorted = apiMarkets.sort((a: any, b: any) => {
        const aVol = (a.contracts || a.Contracts || []).reduce((sum: number, c: any) =>
          sum + (c.totalSharesTraded || c.TotalSharesTraded || 0), 0);
        const bVol = (b.contracts || b.Contracts || []).reduce((sum: number, c: any) =>
          sum + (c.totalSharesTraded || c.TotalSharesTraded || 0), 0);
        return bVol - aVol;
      });

      for (const m of sorted.slice(0, limit * 2)) {
        const name = m.name || m.Name || m.shortName || m.ShortName || '';
        if (!name) continue;

        const contracts = m.contracts || m.Contracts || [];
        const outcomes: MarketOutcome[] = [];
        let totalVolume = 0;

        for (const c of contracts) {
          const contractName = c.name || c.Name || c.shortName || c.ShortName || '';
          const lastPrice = safeParseFloat(c.lastTradePrice || c.LastTradePrice);
          const bestBuyYes = safeParseFloat(c.bestBuyYesCost || c.BestBuyYesCost);
          const bestBuyNo = safeParseFloat(c.bestBuyNoCost || c.BestBuyNoCost);
          const price = lastPrice ?? bestBuyYes;

          outcomes.push({
            name: contractName,
            probability: price !== null ? Math.round(price * 100) : null,
            price,
          });

          totalVolume += c.totalSharesTraded || c.TotalSharesTraded || 0;
        }

        // Primary probability: highest-priced contract
        let probability: number | null = null;
        if (outcomes.length > 0) {
          const sorted = [...outcomes].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
          probability = sorted[0].probability;
        }

        const marketId = m.id || m.Id || '';
        const mUrl = m.url || m.Url || (marketId ? `${PREDICTIT_BASE}/markets/detail/${marketId}` : PREDICTIT_BASE);

        markets.push({
          title: decodeHtmlEntities(name),
          platform: 'PredictIt',
          probability,
          volume: totalVolume > 0 ? `${totalVolume.toLocaleString()} shares` : null,
          url: mUrl.startsWith('http') ? mUrl : `${PREDICTIT_BASE}${mUrl}`,
          category: categorizeMarket(name, null),
          lastUpdated: m.timeStamp || m.TimeStamp || null,
          traders: null, // PredictIt doesn't expose trader counts
          description: m.longName || m.LongName || null,
          endDate: m.dateEnd || m.DateEnd || null,
          outcomes,
        });
      }
    }
  } catch (err: any) {
    console.error(`[PredictIt API] Error: ${err.message}`);
  }

  // Strategy 2: Scrape PredictIt HTML pages
  if (markets.length === 0) {
    try {
      const resp = await fetchFn(`${PREDICTIT_BASE}/markets`, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': USER_AGENT,
        },
        maxRetries: 2,
        timeoutMs: 25_000,
      });

      if (resp.ok) {
        const html = await resp.text();
        const cleaned = cleanHtml(html);

        // Try embedded JSON / script data
        const jsonBlocks = extractAllJsonBlocks(html);
        for (const block of jsonBlocks) {
          const extracted = extractPredictItFromJson(block);
          markets.push(...extracted);
        }

        // Look for market cards in HTML
        if (markets.length === 0) {
          const marketPatterns = [
            /<a[^>]*href="(\/markets\/detail\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
            /<div[^>]*class="[^"]*market[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
          ];

          for (const pattern of marketPatterns) {
            let match;
            while ((match = pattern.exec(cleaned)) !== null && markets.length < limit) {
              const fragment = match[0];
              const hrefMatch = fragment.match(/href="(\/markets\/detail\/\d+[^"]*)"/);
              const titleMatch = fragment.match(/>([^<]{10,200})</);
              if (!titleMatch) continue;

              const title = decodeHtmlEntities(titleMatch[1].trim());
              if (title.length < 10 || /^\s*(Home|Markets|FAQ|About)\s*$/i.test(title)) continue;

              const priceMatch = fragment.match(/(\d{1,2})¢|(\$0\.\d{2})/);
              const price = priceMatch
                ? (priceMatch[1] ? parseInt(priceMatch[1]) : Math.round(parseFloat(priceMatch[2]!) * 100))
                : null;

              markets.push({
                title,
                platform: 'PredictIt',
                probability: price,
                volume: null,
                url: hrefMatch ? `${PREDICTIT_BASE}${hrefMatch[1]}` : PREDICTIT_BASE,
                category: categorizeMarket(title, null),
                lastUpdated: null,
                traders: null,
                description: null,
                endDate: null,
                outcomes: [],
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[PredictIt HTML] Error: ${err.message}`);
    }
  }

  return markets.slice(0, limit);
}

function extractPredictItFromJson(data: any): PredictionMarket[] {
  const results: PredictionMarket[] = [];
  if (!data || typeof data !== 'object') return results;

  const visited = new WeakSet();
  function traverse(obj: any, depth: number): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (visited.has(obj)) return;
    visited.add(obj);

    // Check for PredictIt market shape
    const name = obj.name || obj.Name || obj.shortName || obj.ShortName;
    const contracts = obj.contracts || obj.Contracts;
    if (name && contracts && Array.isArray(contracts)) {
      const outcomes: MarketOutcome[] = [];
      for (const c of contracts) {
        const cName = c.name || c.Name || '';
        const price = safeParseFloat(c.lastTradePrice || c.LastTradePrice || c.bestBuyYesCost || c.BestBuyYesCost);
        outcomes.push({
          name: cName,
          probability: price !== null ? Math.round(price * 100) : null,
          price,
        });
      }

      const topOutcome = [...outcomes].sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0];
      const marketId = obj.id || obj.Id || '';

      results.push({
        title: decodeHtmlEntities(name),
        platform: 'PredictIt',
        probability: topOutcome?.probability ?? null,
        volume: null,
        url: marketId ? `${PREDICTIT_BASE}/markets/detail/${marketId}` : PREDICTIT_BASE,
        category: categorizeMarket(name, null),
        lastUpdated: obj.timeStamp || obj.TimeStamp || null,
        traders: null,
        description: obj.longName || obj.LongName || null,
        endDate: obj.dateEnd || obj.DateEnd || null,
        outcomes,
      });
    }

    if (Array.isArray(obj)) {
      for (const item of obj) traverse(item, depth + 1);
    } else {
      for (const key of Object.keys(obj)) traverse(obj[key], depth + 1);
    }
  }

  traverse(data, 0);
  return results;
}

async function scrapePredictItDetails(
  url: string,
  fetchFn: ProxyFetchFn,
): Promise<PredictionMarket | null> {
  try {
    // Extract market ID from URL
    const idMatch = url.match(/\/markets\/detail\/(\d+)/);
    if (idMatch) {
      const marketId = idMatch[1];
      const apiResp = await fetchFn(`${PREDICTIT_API}/markets/${marketId}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        maxRetries: 2,
        timeoutMs: 20_000,
      });

      if (apiResp.ok) {
        const m: any = await apiResp.json();
        const name = m.name || m.Name || '';
        const contracts = m.contracts || m.Contracts || [];
        const outcomes: MarketOutcome[] = [];
        let totalVolume = 0;

        for (const c of contracts) {
          const cName = c.name || c.Name || c.shortName || c.ShortName || '';
          const price = safeParseFloat(c.lastTradePrice || c.LastTradePrice);
          outcomes.push({
            name: cName,
            probability: price !== null ? Math.round(price * 100) : null,
            price,
          });
          totalVolume += c.totalSharesTraded || c.TotalSharesTraded || 0;
        }

        const topOutcome = [...outcomes].sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0];

        return {
          title: decodeHtmlEntities(name),
          platform: 'PredictIt',
          probability: topOutcome?.probability ?? null,
          volume: totalVolume > 0 ? `${totalVolume.toLocaleString()} shares` : null,
          url,
          category: categorizeMarket(name, null),
          lastUpdated: m.timeStamp || m.TimeStamp || null,
          traders: null,
          description: m.longName || m.LongName || null,
          endDate: m.dateEnd || m.DateEnd || null,
          outcomes,
        };
      }
    }

    // Fallback: scrape HTML
    const resp = await fetchFn(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': USER_AGENT },
      maxRetries: 2,
      timeoutMs: 25_000,
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
      || html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Market';

    // Extract contract prices from HTML table or cards
    const outcomes: MarketOutcome[] = [];
    const contractPattern = /<div[^>]*class="[^"]*contract[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let contractMatch;
    while ((contractMatch = contractPattern.exec(html)) !== null) {
      const fragment = contractMatch[1];
      const nameMatch = fragment.match(/>([^<]{3,100})</);
      const priceMatch = fragment.match(/(\d{1,2})¢|\$?0\.(\d{2})/);
      if (nameMatch) {
        const price = priceMatch
          ? (priceMatch[1] ? parseInt(priceMatch[1]) / 100 : parseFloat(`0.${priceMatch[2]}`))
          : null;
        outcomes.push({
          name: decodeHtmlEntities(nameMatch[1].trim()),
          probability: price !== null ? Math.round(price * 100) : null,
          price,
        });
      }
    }

    // Also try table rows
    if (outcomes.length === 0) {
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowPattern.exec(html)) !== null) {
        const row = rowMatch[1];
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        if (cells.length >= 2) {
          const name = extractTextContent(cells[0]!);
          const priceText = extractTextContent(cells[1]!);
          const priceMatch = priceText.match(/(\d{1,2})¢|\$?0\.(\d{2})/);
          if (name && priceMatch) {
            const price = priceMatch[1] ? parseInt(priceMatch[1]) / 100 : parseFloat(`0.${priceMatch[2] || "00"}`);
            outcomes.push({
              name: name.trim(),
              probability: Math.round(price * 100),
              price,
            });
          }
        }
      }
    }

    const topOutcome = [...outcomes].sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0];
    const descMatch = html.match(/og:description[^>]*content="([^"]+)"/i);

    return {
      title,
      platform: 'PredictIt',
      probability: topOutcome?.probability ?? null,
      volume: null,
      url,
      category: categorizeMarket(title, descMatch?.[1] || null),
      lastUpdated: null,
      traders: null,
      description: descMatch ? decodeHtmlEntities(descMatch[1]) : null,
      endDate: null,
      outcomes,
    };
  } catch (err: any) {
    console.error(`[PredictIt Details] Error: ${err.message}`);
    return null;
  }
}

// ─── EXPORTED API ───────────────────────────────────

/**
 * Get trending prediction markets across all platforms.
 * Aggregates results from Polymarket, Metaculus, and PredictIt.
 */
export async function getTrendingMarkets(
  category: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<MarketSearchResult> {
  const perPlatform = Math.max(Math.ceil(limit / 3) + 5, 15);

  // Scrape all three platforms in parallel
  const [polymarkets, metaculusMarkets, predictitMarkets] = await Promise.allSettled([
    scrapePolymarketTrending(fetchFn, perPlatform),
    scrapeMetaculusTrending(fetchFn, perPlatform),
    scrapePredictItTrending(fetchFn, perPlatform),
  ]);

  let allMarkets: PredictionMarket[] = [];

  if (polymarkets.status === 'fulfilled') allMarkets.push(...polymarkets.value);
  if (metaculusMarkets.status === 'fulfilled') allMarkets.push(...metaculusMarkets.value);
  if (predictitMarkets.status === 'fulfilled') allMarkets.push(...predictitMarkets.value);

  // Filter by category if specified
  if (category) {
    allMarkets = allMarkets.filter(m => matchesCategory(m, category));
  }

  // Deduplicate by title similarity
  allMarkets = deduplicateMarkets(allMarkets);

  // Sort: prioritize markets with probabilities, then by volume/traders
  allMarkets.sort((a, b) => {
    // Markets with probability data come first
    if (a.probability !== null && b.probability === null) return -1;
    if (a.probability === null && b.probability !== null) return 1;
    // Then by trader count
    if ((a.traders || 0) !== (b.traders || 0)) return (b.traders || 0) - (a.traders || 0);
    return 0;
  });

  const finalMarkets = allMarkets.slice(0, limit);
  const platforms = [...new Set(finalMarkets.map(m => m.platform))];

  return {
    type: 'trending',
    markets: finalMarkets,
    metadata: {
      totalMarkets: finalMarkets.length,
      platforms,
      scrapedAt: new Date().toISOString(),
      ...(category ? { category } : {}),
    },
  };
}

/**
 * Search prediction markets by keyword across all platforms.
 */
export async function searchMarkets(
  query: string,
  limit: number,
  fetchFn: ProxyFetchFn,
): Promise<MarketSearchResult> {
  const perPlatform = Math.max(Math.ceil(limit / 3) + 10, 20);

  // For search, we fetch larger datasets and filter client-side
  // Some platforms support search params, others we filter locally
  const [polymarkets, metaculusMarkets, predictitMarkets] = await Promise.allSettled([
    scrapePolymarketSearch(query, fetchFn, perPlatform),
    scrapeMetaculusSearch(query, fetchFn, perPlatform),
    scrapePredictItTrending(fetchFn, perPlatform), // PredictIt has no search API; filter locally
  ]);

  let allMarkets: PredictionMarket[] = [];

  if (polymarkets.status === 'fulfilled') allMarkets.push(...polymarkets.value);
  if (metaculusMarkets.status === 'fulfilled') allMarkets.push(...metaculusMarkets.value);
  if (predictitMarkets.status === 'fulfilled') {
    // Filter PredictIt results by search query
    allMarkets.push(...predictitMarkets.value.filter(m => matchesSearch(m, query)));
  }

  allMarkets = deduplicateMarkets(allMarkets);

  // Sort by relevance (number of query terms matched)
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  allMarkets.sort((a, b) => {
    const aText = `${a.title} ${a.description || ''}`.toLowerCase();
    const bText = `${b.title} ${b.description || ''}`.toLowerCase();
    const aScore = queryTerms.filter(t => aText.includes(t)).length;
    const bScore = queryTerms.filter(t => bText.includes(t)).length;
    if (aScore !== bScore) return bScore - aScore;
    if (a.probability !== null && b.probability === null) return -1;
    if (a.probability === null && b.probability !== null) return 1;
    return 0;
  });

  const finalMarkets = allMarkets.slice(0, limit);
  const platforms = [...new Set(finalMarkets.map(m => m.platform))];

  return {
    type: 'search',
    markets: finalMarkets,
    metadata: {
      totalMarkets: finalMarkets.length,
      platforms,
      scrapedAt: new Date().toISOString(),
      query,
    },
  };
}

/**
 * Get detailed information about a specific prediction market.
 * Detects the platform from the URL and scrapes accordingly.
 */
export async function getMarketDetails(
  url: string,
  fetchFn: ProxyFetchFn,
): Promise<MarketDetailResult> {
  const lowerUrl = url.toLowerCase();
  let market: PredictionMarket | null = null;

  if (lowerUrl.includes('polymarket.com')) {
    market = await scrapePolymarketDetails(url, fetchFn);
  } else if (lowerUrl.includes('metaculus.com')) {
    market = await scrapeMetaculusDetails(url, fetchFn);
  } else if (lowerUrl.includes('predictit.org')) {
    market = await scrapePredictItDetails(url, fetchFn);
  } else {
    // Try to detect platform from page content
    market = await scrapeGenericMarketPage(url, fetchFn);
  }

  if (!market) {
    throw new Error(`Failed to extract market data from ${url}. Supported platforms: Polymarket, Metaculus, PredictIt.`);
  }

  return {
    type: 'details',
    market,
    metadata: {
      platform: market.platform,
      scrapedAt: new Date().toISOString(),
      sourceUrl: url,
    },
  };
}

// ─── SEARCH-SPECIFIC SCRAPERS ───────────────────────

async function scrapePolymarketSearch(
  query: string,
  fetchFn: ProxyFetchFn,
  limit: number,
): Promise<PredictionMarket[]> {
  const markets: PredictionMarket[] = [];

  // Gamma API supports text_query parameter
  try {
    const encoded = encodeURIComponent(query);
    const apiUrl = `${POLYMARKET_GAMMA_API}/markets?limit=${limit}&active=true&closed=false&text_query=${encoded}`;
    const resp = await fetchFn(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': POLYMARKET_BASE,
      },
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    if (resp.ok) {
      const data: any[] = await resp.json();
      for (const item of data) {
        if (!item.question && !item.title) continue;
        const title = decodeHtmlEntities(item.question || item.title || '');
        const description = item.description ? decodeHtmlEntities(item.description) : null;
        const outcomes: MarketOutcome[] = [];

        if (item.outcomes && Array.isArray(item.outcomes)) {
          const prices = item.outcomePrices
            ? (typeof item.outcomePrices === 'string' ? JSON.parse(item.outcomePrices) : item.outcomePrices)
            : [];
          for (let i = 0; i < item.outcomes.length; i++) {
            const price = safeParseFloat(prices[i]);
            outcomes.push({
              name: item.outcomes[i],
              probability: price !== null ? Math.round(price * 100) : null,
              price,
            });
          }
        }

        let probability: number | null = null;
        if (outcomes.length > 0 && outcomes[0].probability !== null) {
          probability = outcomes[0].probability;
        }

        const slug = item.slug || item.conditionId || '';
        markets.push({
          title,
          platform: 'Polymarket',
          probability,
          volume: formatVolume(safeParseFloat(item.volume)),
          url: slug ? `${POLYMARKET_BASE}/event/${slug}` : POLYMARKET_BASE,
          category: categorizeMarket(title, description),
          lastUpdated: item.updatedAt || null,
          traders: safeParseFloat(item.uniqueTraders),
          description,
          endDate: item.endDate || null,
          outcomes,
        });
      }
    }
  } catch (err: any) {
    console.error(`[Polymarket Search] Error: ${err.message}`);
  }

  // Fallback: get trending and filter
  if (markets.length === 0) {
    const trending = await scrapePolymarketTrending(fetchFn, limit * 2);
    markets.push(...trending.filter(m => matchesSearch(m, query)));
  }

  return markets.slice(0, limit);
}

async function scrapeMetaculusSearch(
  query: string,
  fetchFn: ProxyFetchFn,
  limit: number,
): Promise<PredictionMarket[]> {
  const markets: PredictionMarket[] = [];

  // Metaculus API supports search parameter
  try {
    const encoded = encodeURIComponent(query);
    const apiUrl = `${METACULUS_API}/questions/?search=${encoded}&limit=${limit}&status=open&type=forecast&order_by=-activity`;
    const resp = await fetchFn(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': METACULUS_BASE,
      },
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    if (resp.ok) {
      const data: any = await resp.json();
      const questions = data.results || data.questions || (Array.isArray(data) ? data : []);

      for (const q of questions) {
        if (!q.title && !q.title_short) continue;
        const title = decodeHtmlEntities(q.title || q.title_short || '');
        const description = q.description
          ? decodeHtmlEntities(q.description.replace(/<[^>]+>/g, ' ').substring(0, 500))
          : null;

        let probability: number | null = null;
        if (q.community_prediction?.full?.q2 != null) {
          probability = Math.round(q.community_prediction.full.q2 * 100);
        } else if (q.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
          probability = Math.round(q.aggregations.recency_weighted.latest.centers[0] * 100);
        } else if (q.question?.aggregations?.recency_weighted?.latest?.centers?.[0] != null) {
          probability = Math.round(q.question.aggregations.recency_weighted.latest.centers[0] * 100);
        }

        const qUrl = q.url || `${METACULUS_BASE}/questions/${q.id}/`;

        markets.push({
          title,
          platform: 'Metaculus',
          probability,
          volume: null,
          url: qUrl.startsWith('http') ? qUrl : `${METACULUS_BASE}${qUrl}`,
          category: categorizeMarket(title, description),
          lastUpdated: q.last_activity_time || null,
          traders: q.number_of_forecasters || null,
          description,
          endDate: q.resolve_time || null,
          outcomes: probability !== null ? [
            { name: 'Yes', probability, price: probability / 100 },
            { name: 'No', probability: 100 - probability, price: (100 - probability) / 100 },
          ] : [],
        });
      }
    }
  } catch (err: any) {
    console.error(`[Metaculus Search] Error: ${err.message}`);
  }

  // Fallback: trending + filter
  if (markets.length === 0) {
    const trending = await scrapeMetaculusTrending(fetchFn, limit * 2);
    markets.push(...trending.filter(m => matchesSearch(m, query)));
  }

  return markets.slice(0, limit);
}

// ─── GENERIC FALLBACK SCRAPER ───────────────────────

async function scrapeGenericMarketPage(
  url: string,
  fetchFn: ProxyFetchFn,
): Promise<PredictionMarket | null> {
  try {
    const resp = await fetchFn(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': USER_AGENT },
      maxRetries: 2,
      timeoutMs: 25_000,
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Detect platform from HTML content
    let platform: 'Polymarket' | 'Metaculus' | 'PredictIt' = 'Polymarket';
    if (html.includes('metaculus') || html.includes('Metaculus')) platform = 'Metaculus';
    else if (html.includes('predictit') || html.includes('PredictIt')) platform = 'PredictIt';

    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
      || html.match(/<title>([^<]+)<\/title>/i)
      || html.match(/og:title[^>]*content="([^"]+)"/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Unknown Market';

    const probMatch = html.match(/(\d{1,3})(?:\.\d+)?%/);
    const descMatch = html.match(/og:description[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    const volMatch = html.match(/(?:volume|traded)[^$]*\$([\d,.]+[KMB]?)/i);

    return {
      title,
      platform,
      probability: probMatch ? parseInt(probMatch[1]) : null,
      volume: volMatch ? `$${volMatch[1]}` : null,
      url,
      category: categorizeMarket(title, descMatch?.[1] || null),
      lastUpdated: null,
      traders: null,
      description: descMatch ? decodeHtmlEntities(descMatch[1]) : null,
      endDate: null,
      outcomes: [],
    };
  } catch {
    return null;
  }
}

// ─── DEDUPLICATION ──────────────────────────────────

function deduplicateMarkets(markets: PredictionMarket[]): PredictionMarket[] {
  const seen = new Map<string, PredictionMarket>();

  for (const market of markets) {
    // Normalize title for comparison
    const key = market.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80);

    if (!seen.has(key)) {
      seen.set(key, market);
    } else {
      // Keep the one with more data
      const existing = seen.get(key)!;
      const existingScore = (existing.probability !== null ? 1 : 0)
        + (existing.volume !== null ? 1 : 0)
        + (existing.traders !== null ? 1 : 0)
        + (existing.description !== null ? 1 : 0)
        + existing.outcomes.length;
      const newScore = (market.probability !== null ? 1 : 0)
        + (market.volume !== null ? 1 : 0)
        + (market.traders !== null ? 1 : 0)
        + (market.description !== null ? 1 : 0)
        + market.outcomes.length;
      if (newScore > existingScore) {
        seen.set(key, market);
      }
    }
  }

  return Array.from(seen.values());
}
