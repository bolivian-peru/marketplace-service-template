import { proxyFetch } from '../proxy';

export interface MarketOdds {
  yes: number;
  no: number;
  volume24h?: number;
  liquidity?: number;
}

export interface PredictionMarketData {
  polymarket?: MarketOdds;
  kalshi?: MarketOdds;
  metaculus?: {
    median: number;
    forecasters: number;
  };
}

/**
 * Polymarket API Scraper
 */
export async function fetchPolymarket(marketSlug: string): Promise<MarketOdds | null> {
  try {
    const response = await fetch(`https://gamma-api.polymarket.com/markets?slug=${marketSlug}`);
    if (!response.ok) return null;
    const data = await response.json();
    const market = Array.isArray(data) ? data[0] : data;
    
    if (!market) return null;

    return {
      yes: parseFloat(market.outcomePrices?.[0] || '0.5'),
      no: parseFloat(market.outcomePrices?.[1] || '0.5'),
      volume24h: parseFloat(market.volume24h || 0),
      liquidity: parseFloat(market.liquidity || 0)
    };
  } catch (error) {
    console.error('[Polymarket] Fetch failed:', error);
    return null;
  }
}

/**
 * Kalshi API Scraper
 */
export async function fetchKalshi(ticker: string): Promise<MarketOdds | null> {
  try {
    const response = await fetch(`https://trading-api.kalshi.com/trade-api/v2/markets/${ticker}`);
    if (!response.ok) return null;
    const data = await response.json();
    const market = data.market;

    if (!market) return null;

    return {
      yes: (market.yes_ask || 50) / 100, 
      no: (market.no_ask || 50) / 100,
      volume24h: market.volume_24h || 0
    };
  } catch (error) {
    console.error('[Kalshi] Fetch failed:', error);
    return null;
  }
}

/**
 * Metaculus API Scraper
 */
export async function fetchMetaculus(id: string): Promise<{ median: number; forecasters: number } | null> {
  try {
    const response = await fetch(`https://www.metaculus.com/api2/questions/${id}`);
    if (!response.ok) return null;
    const data = await response.json();

    return {
      median: data.prediction_timeseries?.slice(-1)[0]?.community_prediction || 0.5,
      forecasters: data.number_of_forecasters || 0
    };
  } catch (error) {
    console.error('[Metaculus] Fetch failed:', error);
    return null;
  }
}
