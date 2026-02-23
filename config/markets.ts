// config/markets.ts
// Mapping between logical market slugs and concrete IDs on each platform.

export interface MarketConfig {
  id: string; // internal slug, e.g. "us-presidential-election-2028"
  label: string; // human readable title
  topic: string; // text topic for sentiment scraping
  polymarket?: {
    // Polymarket CLOB API market_slug or a substring of the question
    marketSlug?: string;
    questionSearch?: string;
  };
  kalshi?: {
    // Kalshi elections API event ticker, e.g. "PRES-2028" (example only)
    eventTicker: string;
  };
  metaculus?: {
    // Metaculus numeric question id
    questionId: number;
  };
}

export const MARKET_MAP: Record<string, MarketConfig> = {
  // Example mapping for a U.S. presidential election style market.
  // NOTE: These identifiers are intended as examples and may need
  // to be updated to match currently listed markets on each venue.
  'us-presidential-election-2028': {
    id: 'us-presidential-election-2028',
    label: 'US Presidential Election 2028 – Democrat vs Republican',
    topic: 'US presidential election 2028',
    polymarket: {
      // Attempt to match any Polymarket market whose question contains
      // this phrase (case-insensitive), falling back to market_slug
      // lookups when we have an exact slug.
      questionSearch: 'US Presidential Election 2028',
    },
    kalshi: {
      // Example event ticker. The aggregator will degrade gracefully
      // if the ticker is not found on the public elections API.
      eventTicker: 'PRES-2028',
    },
    metaculus: {
      // Example question id related to a future US election. Replace
      // with a concrete ID if you want deterministic behaviour.
      questionId: 42274,
    },
  },
};

export function resolveMarketConfig(slug: string): MarketConfig | null {
  const key = slug.trim().toLowerCase();
  return MARKET_MAP[key] ?? null;
}
