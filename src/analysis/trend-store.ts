/**
 * Historical Trend Data Store
 *
 * In-memory store for historical trend snapshots.
 * Tracks engagement over time to enable:
 *   - Historical trend comparison
 *   - Breakout baseline calculation
 *   - Trend velocity measurement
 *
 * Data persists only for the lifetime of the process.
 * For production, this should be backed by a database.
 */

export interface TrendSnapshot {
  topic: string;
  timestamp: number;
  platforms: string[];
  totalEngagement: number;
  platformEngagement: Record<string, number>;
  sentimentScore: number;  // -1 to 1
}

export interface TrendHistory {
  topic: string;
  snapshots: TrendSnapshot[];
  firstSeen: number;
  lastSeen: number;
  peakEngagement: number;
  avgEngagement: number;
  trendDirection: 'rising' | 'stable' | 'declining';
}

const MAX_SNAPSHOTS_PER_TOPIC = 1000;
const MAX_TOPICS = 5000;
const CLEANUP_THRESHOLD = 4000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// In-memory store
const trendStore = new Map<string, TrendSnapshot[]>();

function normalizeTopic(topic: string): string {
  return topic.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Record a trend snapshot.
 */
export function recordSnapshot(snapshot: TrendSnapshot): void {
  const key = normalizeTopic(snapshot.topic);

  // Enforce max topics limit
  if (trendStore.size >= MAX_TOPICS && !trendStore.has(key)) {
    cleanupOldTopics();
  }

  const existing = trendStore.get(key) ?? [];
  existing.push({
    ...snapshot,
    topic: key,
    timestamp: snapshot.timestamp || Date.now(),
  });

  // Cap snapshots per topic
  if (existing.length > MAX_SNAPSHOTS_PER_TOPIC) {
    existing.splice(0, existing.length - MAX_SNAPSHOTS_PER_TOPIC);
  }

  trendStore.set(key, existing);
}

/**
 * Get historical data for a topic.
 */
export function getTrendHistory(topic: string): TrendHistory | null {
  const key = normalizeTopic(topic);
  const snapshots = trendStore.get(key);

  if (!snapshots || snapshots.length === 0) return null;

  const engagements = snapshots.map(s => s.totalEngagement);
  const totalEngagement = engagements.reduce((sum, e) => sum + e, 0);

  // Determine trend direction from recent vs historical engagement
  let trendDirection: 'rising' | 'stable' | 'declining' = 'stable';
  if (snapshots.length >= 3) {
    const splitIdx = Math.floor(snapshots.length * 0.7);
    const historical = snapshots.slice(0, splitIdx);
    const recent = snapshots.slice(splitIdx);

    const histAvg = historical.reduce((s, snap) => s + snap.totalEngagement, 0) / historical.length;
    const recentAvg = recent.reduce((s, snap) => s + snap.totalEngagement, 0) / recent.length;

    if (histAvg > 0) {
      const ratio = recentAvg / histAvg;
      if (ratio > 1.3) trendDirection = 'rising';
      else if (ratio < 0.7) trendDirection = 'declining';
    }
  }

  return {
    topic: key,
    snapshots,
    firstSeen: snapshots[0].timestamp,
    lastSeen: snapshots[snapshots.length - 1].timestamp,
    peakEngagement: Math.max(...engagements),
    avgEngagement: Math.round(totalEngagement / snapshots.length),
    trendDirection,
  };
}

/**
 * Get engagement baselines for topics (used by breakout detection).
 */
export function getEngagementBaselines(topics: string[]): Map<string, number> {
  const baselines = new Map<string, number>();

  for (const topic of topics) {
    const history = getTrendHistory(topic);
    if (history && history.snapshots.length >= 2) {
      baselines.set(normalizeTopic(topic), history.avgEngagement);
    }
  }

  return baselines;
}

/**
 * Get all tracked topics with their current trend direction.
 */
export function getTrackedTopics(limit: number = 50): TrendHistory[] {
  const histories: TrendHistory[] = [];

  for (const [key] of trendStore) {
    const history = getTrendHistory(key);
    if (history) histories.push(history);
    if (histories.length >= limit) break;
  }

  // Sort by most recent activity
  histories.sort((a, b) => b.lastSeen - a.lastSeen);

  return histories.slice(0, limit);
}

/**
 * Clean up old topics to stay within memory limits.
 */
function cleanupOldTopics(): void {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;

  // Remove topics older than MAX_AGE
  for (const [key, snapshots] of trendStore) {
    const lastSnapshot = snapshots[snapshots.length - 1];
    if (lastSnapshot && lastSnapshot.timestamp < cutoff) {
      trendStore.delete(key);
    }
  }

  // If still too many, remove least active
  if (trendStore.size > CLEANUP_THRESHOLD) {
    const entries = Array.from(trendStore.entries())
      .map(([key, snaps]) => ({
        key,
        lastSeen: snaps[snaps.length - 1]?.timestamp ?? 0,
        count: snaps.length,
      }))
      .sort((a, b) => a.lastSeen - b.lastSeen);

    const toRemove = entries.slice(0, trendStore.size - CLEANUP_THRESHOLD);
    for (const entry of toRemove) {
      trendStore.delete(entry.key);
    }
  }
}

/**
 * Get the number of tracked topics (for diagnostics).
 */
export function getStoreStats(): { topics: number; totalSnapshots: number } {
  let totalSnapshots = 0;
  for (const snapshots of trendStore.values()) {
    totalSnapshots += snapshots.length;
  }
  return { topics: trendStore.size, totalSnapshots };
}
