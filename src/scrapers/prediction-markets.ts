/**
 * Prediction Markets Scraper (Bounty #55)
 * ─────────────────────────────────────────
 * Fetches live odds from Polymarket, Kalshi, and Metaculus.
 * Detects arbitrage opportunities across platforms.
 */

// ─── TYPES ──────────────────────────────────────────

export interface MarketOdds {
  platform: string;
  market: string;
  slug?: string;
  yes: number;      // 0-1 probability
  no: number;
  volume24h?: number;
  liquidity?: number;
  lastUpdated: string;
}

export interface ArbitrageOpportunity {
  market: string;
  platforms: { platform: string; yes: number; no: number }[];
  spread: number;        // |platform1.yes - platform2.yes|
  direction: string;     // which side to bet on which platform
  expectedProfit: number; // rough % profit
}

// ─── HELPERS ────────────────────────────────────────

async function apiFetch(url: string, headers?: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MarketBot/1.0)',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── POLYMARKET ─────────────────────────────────────

/**
 * Get market odds from Polymarket via Gamma API.
 * Slug examples: "will-bitcoin-etf-be-approved", "trump-wins-2024"
 */
export async function getPolymarketOdds(slug: string): Promise<MarketOdds | null> {
  try {
    const data = await apiFetch(
      `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&limit=1`
    );

    const market = Array.isArray(data) ? data[0] : data?.markets?.[0];
    if (!market) return null;

    // outcomePrices is usually ["0.72", "0.28"] for yes/no
    let yes = 0.5;
    let no = 0.5;
    if (market.outcomePrices) {
      const prices = Array.isArray(market.outcomePrices)
        ? market.outcomePrices
        : JSON.parse(market.outcomePrices);
      yes = parseFloat(prices[0]) || 0.5;
      no = parseFloat(prices[1]) || (1 - yes);
    } else if (market.lastTradePrice) {
      yes = parseFloat(market.lastTradePrice) || 0.5;
      no = 1 - yes;
    }

    return {
      platform: 'polymarket',
      market: market.question || market.title || slug,
      slug,
      yes,
      no,
      volume24h: parseFloat(market.volume24hr || market.volumeNum || '0'),
      liquidity: parseFloat(market.liquidity || '0'),
      lastUpdated: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error('[Polymarket] Error:', err.message);
    return null;
  }
}

/**
 * Search Polymarket for markets matching a keyword.
 */
export async function searchPolymarketMarkets(keyword: string): Promise<MarketOdds[]> {
  try {
    const data = await apiFetch(
      `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(keyword)}&active=true&limit=5&order=volume&ascending=false`
    );

    const markets = Array.isArray(data) ? data : (data?.markets || []);
    return markets.slice(0, 5).map((m: any) => {
      let yes = 0.5, no = 0.5;
      if (m.outcomePrices) {
        const prices = Array.isArray(m.outcomePrices)
          ? m.outcomePrices
          : JSON.parse(m.outcomePrices);
        yes = parseFloat(prices[0]) || 0.5;
        no = parseFloat(prices[1]) || (1 - yes);
      }
      return {
        platform: 'polymarket',
        market: m.question || m.title || keyword,
        slug: m.slug,
        yes,
        no,
        volume24h: parseFloat(m.volume24hr || m.volumeNum || '0'),
        liquidity: parseFloat(m.liquidity || '0'),
        lastUpdated: new Date().toISOString(),
      };
    });
  } catch (err: any) {
    console.error('[Polymarket Search] Error:', err.message);
    return [];
  }
}

// ─── KALSHI ─────────────────────────────────────────

/**
 * Get market odds from Kalshi public API.
 * Ticker examples: "KXBTC-25DEC", "PRES-24"
 */
export async function getKalshiOdds(ticker: string): Promise<MarketOdds | null> {
  try {
    const data = await apiFetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`
    );

    const market = data?.market;
    if (!market) return null;

    // yes_bid / yes_ask in cents (0-100)
    const yesBid = (market.yes_bid ?? 50) / 100;
    const yesAsk = (market.yes_ask ?? 50) / 100;
    const yes = (yesBid + yesAsk) / 2;

    return {
      platform: 'kalshi',
      market: market.title || ticker,
      slug: ticker,
      yes,
      no: 1 - yes,
      volume24h: market.volume_24h || 0,
      liquidity: market.open_interest || 0,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error('[Kalshi] Error:', err.message);
    return null;
  }
}

/**
 * Get trending Kalshi markets.
 */
export async function getKalshiTrending(): Promise<MarketOdds[]> {
  try {
    const data = await apiFetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?limit=10&status=open&order_by=liquidity&ascending=false`
    );

    const markets = data?.markets || [];
    return markets.slice(0, 10).map((m: any) => {
      const yesBid = (m.yes_bid ?? 50) / 100;
      const yesAsk = (m.yes_ask ?? 50) / 100;
      const yes = (yesBid + yesAsk) / 2;
      return {
        platform: 'kalshi',
        market: m.title || m.ticker,
        slug: m.ticker,
        yes,
        no: 1 - yes,
        volume24h: m.volume_24h || 0,
        liquidity: m.open_interest || 0,
        lastUpdated: new Date().toISOString(),
      };
    });
  } catch (err: any) {
    console.error('[Kalshi Trending] Error:', err.message);
    return [];
  }
}

// ─── METACULUS ───────────────────────────────────────

/**
 * Get prediction from Metaculus public API.
 * Question ID examples: 4764, 11245
 */
export async function getMetaculusOdds(questionId: string | number): Promise<MarketOdds | null> {
  try {
    const data = await apiFetch(
      `https://www.metaculus.com/api2/questions/${questionId}/`
    );

    if (!data?.id) return null;

    // community_prediction.full.q2 is median probability
    const pred = data.community_prediction?.full?.q2
      ?? data.metaculus_prediction?.full?.q2
      ?? data.resolution_criteria_description
      ?? null;

    const yes = pred !== null ? parseFloat(pred) : 0.5;

    return {
      platform: 'metaculus',
      market: data.title || String(questionId),
      slug: String(questionId),
      yes: isNaN(yes) ? 0.5 : yes,
      no: isNaN(yes) ? 0.5 : 1 - yes,
      volume24h: data.activity_latest_7days || 0,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error('[Metaculus] Error:', err.message);
    return null;
  }
}

// ─── ARBITRAGE DETECTION ────────────────────────────

/**
 * Fetch multiple markets across platforms and find arbitrage opportunities.
 * Returns pairs where spread > 0.03 (3%).
 */
export async function getArbitrageOpportunities(): Promise<{
  opportunities: ArbitrageOpportunity[];
  markets: MarketOdds[];
  fetchedAt: string;
}> {
  // Fetch multiple markets in parallel
  const [polyBtcEtf, polyTrump, kalshiMarkets] = await Promise.allSettled([
    searchPolymarketMarkets('bitcoin ETF'),
    searchPolymarketMarkets('2024 election'),
    getKalshiTrending(),
  ]);

  const allMarkets: MarketOdds[] = [];

  if (polyBtcEtf.status === 'fulfilled') allMarkets.push(...polyBtcEtf.value);
  if (polyTrump.status === 'fulfilled') allMarkets.push(...polyTrump.value);
  if (kalshiMarkets.status === 'fulfilled') allMarkets.push(...kalshiMarkets.value);

  // Find similar markets across platforms (simple keyword matching)
  const opportunities: ArbitrageOpportunity[] = [];
  const polyMarkets = allMarkets.filter(m => m.platform === 'polymarket');
  const kalshiMkts = allMarkets.filter(m => m.platform === 'kalshi');

  for (const poly of polyMarkets) {
    for (const kalshi of kalshiMkts) {
      // Look for similar topics
      const polyWords = poly.market.toLowerCase().split(/\s+/);
      const kalshiWords = kalshi.market.toLowerCase().split(/\s+/);
      const overlap = polyWords.filter(w => w.length > 4 && kalshiWords.includes(w));

      if (overlap.length >= 2) {
        const spread = Math.abs(poly.yes - kalshi.yes);
        if (spread > 0.03) {
          const direction = poly.yes > kalshi.yes
            ? `BUY YES on Kalshi (${(kalshi.yes * 100).toFixed(1)}¢), SHORT on Polymarket (${(poly.yes * 100).toFixed(1)}¢)`
            : `BUY YES on Polymarket (${(poly.yes * 100).toFixed(1)}¢), SHORT on Kalshi (${(kalshi.yes * 100).toFixed(1)}¢)`;

          opportunities.push({
            market: `${poly.market} vs ${kalshi.market}`,
            platforms: [
              { platform: 'polymarket', yes: poly.yes, no: poly.no },
              { platform: 'kalshi', yes: kalshi.yes, no: kalshi.no },
            ],
            spread: parseFloat(spread.toFixed(4)),
            direction,
            expectedProfit: parseFloat((spread * 100 - 2).toFixed(2)), // rough % minus 2% fees
          });
        }
      }
    }
  }

  // Sort by spread descending
  opportunities.sort((a, b) => b.spread - a.spread);

  return {
    opportunities: opportunities.slice(0, 10),
    markets: allMarkets,
    fetchedAt: new Date().toISOString(),
  };
}
