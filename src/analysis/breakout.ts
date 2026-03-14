/**
 * Breakout Detection Engine
 *
 * Detects trend breakouts (sudden spikes in engagement or interest)
 * across multiple platforms. Uses statistical methods to identify
 * anomalous growth patterns.
 */

import type { TrendPattern, SignalStrength } from '../types/index';

export interface BreakoutSignal {
  topic: string;
  breakoutScore: number;        // 0-100, higher = stronger breakout
  velocityScore: number;        // Rate of engagement change
  platformCoverage: number;     // Number of platforms with signal
  classification: 'explosive' | 'accelerating' | 'steady' | 'cooling';
  evidence: BreakoutEvidence[];
}

export interface BreakoutEvidence {
  platform: string;
  metric: string;
  currentValue: number;
  baselineValue: number;
  multiplier: number;
}

export interface EngagementSnapshot {
  platform: string;
  topic: string;
  engagement: number;
  timestamp: number;
}

/**
 * Classify breakout velocity based on engagement multiplier.
 */
function classifyBreakout(
  multiplier: number,
  platformCount: number,
): 'explosive' | 'accelerating' | 'steady' | 'cooling' {
  if (multiplier >= 5 && platformCount >= 2) return 'explosive';
  if (multiplier >= 3 || (multiplier >= 2 && platformCount >= 3)) return 'accelerating';
  if (multiplier >= 1.5) return 'steady';
  return 'cooling';
}

/**
 * Detect breakouts from cross-platform trend patterns.
 *
 * Takes detected patterns and their engagement data, then identifies
 * which patterns show breakout characteristics (rapid growth, cross-platform spread).
 */
export function detectBreakouts(
  patterns: TrendPattern[],
  historicalBaselines?: Map<string, number>,
): BreakoutSignal[] {
  const breakouts: BreakoutSignal[] = [];
  const baselines = historicalBaselines ?? new Map<string, number>();

  for (const pattern of patterns) {
    const baseline = baselines.get(pattern.pattern) ?? estimateBaseline(pattern);
    const currentEngagement = pattern.totalEngagement;

    if (baseline <= 0) continue;

    const multiplier = currentEngagement / baseline;
    const platformCount = pattern.sources.length;

    // Only flag as breakout if engagement exceeds baseline significantly
    if (multiplier < 1.5) continue;

    const classification = classifyBreakout(multiplier, platformCount);

    // Calculate breakout score (0-100)
    const rawScore = Math.log2(multiplier) * 20 + (platformCount - 1) * 15;
    const breakoutScore = Math.round(Math.min(100, Math.max(0, rawScore)) * 100) / 100;

    // Calculate velocity score based on how fast engagement is growing
    const velocityScore = Math.round(
      Math.min(100, (multiplier - 1) * 30 + platformCount * 10) * 100
    ) / 100;

    const evidence: BreakoutEvidence[] = [];

    for (const source of pattern.sources) {
      const platformEvidence = pattern.evidence.filter(e => e.platform === source);
      const platformEngagement = platformEvidence.reduce((sum, e) => sum + e.engagement, 0);
      const platformBaseline = baseline / Math.max(1, pattern.sources.length);

      evidence.push({
        platform: source,
        metric: 'engagement',
        currentValue: Math.round(platformEngagement),
        baselineValue: Math.round(platformBaseline),
        multiplier: Math.round((platformEngagement / Math.max(1, platformBaseline)) * 100) / 100,
      });
    }

    breakouts.push({
      topic: pattern.pattern,
      breakoutScore,
      velocityScore,
      platformCoverage: platformCount,
      classification,
      evidence,
    });
  }

  // Sort by breakout score descending
  breakouts.sort((a, b) => b.breakoutScore - a.breakoutScore);

  return breakouts.slice(0, 10);
}

/**
 * Estimate a baseline engagement level for a pattern when no historical data exists.
 * Uses the pattern's own evidence to infer a reasonable baseline.
 */
function estimateBaseline(pattern: TrendPattern): number {
  // Use median engagement of evidence as a rough baseline
  const engagements = pattern.evidence
    .map(e => e.engagement)
    .filter(e => e > 0)
    .sort((a, b) => a - b);

  if (engagements.length === 0) return 10; // default minimum baseline

  const median = engagements[Math.floor(engagements.length / 2)];

  // Baseline is assumed to be ~60% of current median (conservative estimate)
  return Math.max(10, median * 0.6);
}

/**
 * Calculate a composite trend score that combines multiple signals.
 * Returns a score from 0-100.
 */
export function calculateTrendScore(
  pattern: TrendPattern,
  breakout: BreakoutSignal | null,
): number {
  let score = 0;

  // Platform coverage (0-30 points)
  score += Math.min(30, pattern.sources.length * 10);

  // Engagement level (0-30 points)
  const engagementLog = Math.log1p(pattern.totalEngagement);
  score += Math.min(30, engagementLog * 3);

  // Signal strength (0-20 points)
  const strengthScores: Record<SignalStrength, number> = {
    established: 20,
    reinforced: 12,
    emerging: 5,
  };
  score += strengthScores[pattern.strength];

  // Breakout bonus (0-20 points)
  if (breakout) {
    score += Math.min(20, breakout.breakoutScore / 5);
  }

  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}

/**
 * Rank trends by composite score, combining engagement, cross-platform
 * presence, signal strength, and breakout indicators.
 */
export function rankTrends(
  patterns: TrendPattern[],
  breakouts: BreakoutSignal[],
): { pattern: TrendPattern; score: number; breakout: BreakoutSignal | null }[] {
  const breakoutMap = new Map<string, BreakoutSignal>();
  for (const b of breakouts) {
    breakoutMap.set(b.topic, b);
  }

  const ranked = patterns.map(pattern => {
    const breakout = breakoutMap.get(pattern.pattern) ?? null;
    const score = calculateTrendScore(pattern, breakout);
    return { pattern, score, breakout };
  });

  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}
