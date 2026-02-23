// src/signals.ts
// Signal generation logic for prediction market arbitrage & sentiment divergence.

import type { AggregatedMarketData } from './marketData';
import type { SocialSentimentSnapshot } from './sentiment';

export interface ArbitrageSignal {
  detected: boolean;
  spread: number | null; // absolute probability spread between venues
  direction?: string;
  confidence?: number; // 0-1
}

export interface SentimentDivergenceSignal {
  detected: boolean;
  description?: string;
  magnitude?: 'low' | 'moderate' | 'high';
}

export interface VolumeSpikeSignal {
  detected: boolean;
}

export interface SignalBundle {
  arbitrage: ArbitrageSignal;
  sentimentDivergence: SentimentDivergenceSignal;
  volumeSpike: VolumeSpikeSignal;
}

function averageDefined(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function computeArbitrageSignal(data: AggregatedMarketData): ArbitrageSignal {
  const yesPrices: number[] = [];

  const polyYes = data.odds.polymarket?.yes;
  const kalshiYes = data.odds.kalshi?.yes;
  const metaMedian = data.odds.metaculus?.median;

  if (typeof polyYes === 'number' && Number.isFinite(polyYes)) yesPrices.push(polyYes);
  if (typeof kalshiYes === 'number' && Number.isFinite(kalshiYes)) yesPrices.push(kalshiYes);
  if (typeof metaMedian === 'number' && Number.isFinite(metaMedian)) yesPrices.push(metaMedian);

  if (yesPrices.length < 2) {
    return { detected: false, spread: null };
  }

  const maxYes = Math.max(...yesPrices);
  const minYes = Math.min(...yesPrices);
  const spread = clamp01(maxYes - minYes);

  const THRESHOLD = 0.02; // 2% spread before we call it a signal
  if (spread <= THRESHOLD) {
    return { detected: false, spread };
  }

  let direction: string | undefined;
  if (polyYes != null && kalshiYes != null) {
    if (polyYes > kalshiYes + THRESHOLD) {
      direction = 'Polymarket YES overpriced vs Kalshi';
    } else if (kalshiYes > polyYes + THRESHOLD) {
      direction = 'Kalshi YES overpriced vs Polymarket';
    }
  }

  const confidence = clamp01(Math.min(1, spread / 0.15));

  return {
    detected: true,
    spread,
    direction,
    confidence,
  };
}

export function computeSentimentDivergence(
  data: AggregatedMarketData,
  sentiment: SocialSentimentSnapshot,
): SentimentDivergenceSignal {
  const price = averageDefined([
    data.odds.polymarket?.yes ?? null,
    data.odds.kalshi?.yes ?? null,
    data.odds.metaculus?.median ?? null,
  ]);

  if (price == null) {
    return { detected: false };
  }

  const twitter = sentiment.twitter;
  const reddit = sentiment.reddit;

  const pos = averageDefined([
    twitter?.positive ?? null,
    reddit?.positive ?? null,
  ]);
  const neg = averageDefined([
    twitter?.negative ?? null,
    reddit?.negative ?? null,
  ]);

  if (pos == null || neg == null) {
    return { detected: false };
  }

  const total = pos + neg;
  if (total <= 0) {
    return { detected: false };
  }

  const bullishShare = clamp01(pos / total);
  const diff = bullishShare - price;
  const absDiff = Math.abs(diff);

  if (absDiff < 0.05) {
    return { detected: false };
  }

  let magnitude: 'low' | 'moderate' | 'high' = 'low';
  if (absDiff >= 0.15) magnitude = 'high';
  else if (absDiff >= 0.08) magnitude = 'moderate';

  const direction = diff > 0 ? 'bullish' : 'bearish';

  const description =
    direction === 'bullish'
      ? `Social sentiment ${(bullishShare * 100).toFixed(1)}% bullish but market price only ${(price * 100).toFixed(1)}% YES`
      : `Social sentiment ${(100 - bullishShare * 100).toFixed(1)}% bearish but market price ${(price * 100).toFixed(1)}% YES`;

  return {
    detected: true,
    description,
    magnitude,
  };
}

export function computeVolumeSpikeSignal(data: AggregatedMarketData): VolumeSpikeSignal {
  // Volume spike detection would normally require a time series or at
  // least a trailing average. For MVP we simply expose a stub that
  // always returns detected: false while leaving a clear extension
  // point for future improvements.
  void data; // unused for now
  return { detected: false };
}

export function buildSignalBundle(
  data: AggregatedMarketData,
  sentiment: SocialSentimentSnapshot,
): SignalBundle {
  return {
    arbitrage: computeArbitrageSignal(data),
    sentimentDivergence: computeSentimentDivergence(data, sentiment),
    volumeSpike: computeVolumeSpikeSignal(data),
  };
}
