/**
 * Prediction Market Signal Aggregator (Manifold Markets)
 * ──────────────────────────────────
 * Fetches real-time data from Manifold Markets (https://manifold.markets).
 * Returns structured data on active markets, prices (probabilities), volume, and trends.
 * 
 * API: https://docs.manifold.markets/api
 * Rate Limit: ~1 req/sec (no API key needed for public endpoints).
 * 
 * Features:
 * 1. Active Markets - List top markets by liquidity or recency.
 * 2. Market Prices - Get current probability and volume for a specific market.
 * 3. Trending Markets - Find markets with highest 24h volume.
 */

const MANIFOLD_BASE_URL = 'https://api.manifold.markets/v0';

export interface MarketSignal {
  id: string;
  question: string;
  slug: string;
  probability: number;  // 0 to 1
  volume: number;
  volume24h: number;
  isResolved: boolean;
  creatorUsername: string;
  closeDate?: number; // timestamp
  url: string;
  createdAt: number;
}

export interface TrendingSignal {
  market: MarketSignal;
  momentum: number; // velocity of volume change
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

// Helper to safely fetch
async function fetchManifold(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${MANIFOLD_BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Proxies.sx-Bounty-Bot/1.0' },
    signal: AbortSignal.timeout(10000), // 10s timeout
  });
  if (!res.ok) throw new Error(`Manifold API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// 1. Get Active Markets (sorted by score/liquidity)
export async function fetchActiveMarkets(limit = 5): Promise<MarketSignal[]> {
  // Manifold sorts by score by default
  const data = await fetchManifold('/markets', { 
    limit, 
  });

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((m: any) => ({
    id: m.id,
    question: m.question,
    slug: m.slug,
    probability: m.probability,
    volume: m.volume || 0,
    volume24h: m.volume24Hours || 0,
    isResolved: m.isResolved,
    creatorUsername: m.creatorUsername,
    closeDate: m.closeTime,
    url: m.url,
    createdAt: m.createdTime,
  }));
}

// 2. Search Markets
export async function searchMarkets(query: string, limit = 5): Promise<MarketSignal[]> {
  const data = await fetchManifold('/search-markets', { 
    term: query, 
    limit,
  });

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((m: any) => ({
    id: m.id,
    question: m.question,
    slug: m.slug,
    probability: m.probability,
    volume: m.volume || 0,
    volume24h: m.volume24Hours || 0,
    isResolved: m.isResolved,
    creatorUsername: m.creatorUsername,
    closeDate: m.closeTime,
    url: m.url,
    createdAt: m.createdTime,
  }));
}

// 3. Get Trending Markets (high 24h volume)
export async function getTrendingMarkets(limit = 5): Promise<TrendingSignal[]> {
  // Manifold doesn't have a direct 'trending' sort, but we can sort by 'newest' and filter by volume24h
  // Or fetch a larger batch and sort locally.
  const data = await fetchManifold('/markets', { 
    limit: 50, 
  });

  if (!Array.isArray(data)) {
    return [];
  }

  const markets: MarketSignal[] = data
    .filter((m: any) => !m.isResolved && (m.volume24Hours || 0) > 0)
    .sort((a: any, b: any) => (b.volume24Hours || 0) - (a.volume24Hours || 0))
    .slice(0, limit)
    .map((m: any) => ({
      id: m.id,
      question: m.question,
      slug: m.slug,
      probability: m.probability,
      volume: m.volume || 0,
      volume24h: m.volume24Hours || 0,
      isResolved: m.isResolved,
      creatorUsername: m.creatorUsername,
      closeDate: m.closeTime,
      url: m.url,
      createdAt: m.createdTime,
    }));

  return markets.map(m => {
    const momentum = m.volume24h / (m.volume > 0 ? m.volume : 1);
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (m.probability > 0.65) sentiment = 'bullish';
    if (m.probability < 0.35) sentiment = 'bearish';

    return { market: m, momentum, sentiment };
  });
}

// 4. Get Market Details (including comments/answers if needed)
export async function getMarketDetails(slug: string): Promise<MarketSignal & { description?: string }> {
  // First, find the market ID by slug
  const searchResults = await searchMarkets(slug.split('/').pop() || slug, 5);
  const match = searchResults.find(m => m.slug === slug || m.id === slug);
  
  if (!match) {
    throw new Error('Market not found');
  }

  // Fetch comments to calculate engagement score
  const comments: any[] = await fetchManifold(`/market/${match.id}/comments`, { limit: 10 });
  
  return {
    ...match,
    description: `Engagement: ${comments.length} comments. Sentiment: ${match.probability > 0.5 ? 'Bullish' : 'Bearish'}`,
  };
}
