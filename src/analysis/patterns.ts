/**
 * Cross-Platform Pattern Detection
 * ──────────────────────────────────
 * The core intelligence layer. Finds topics that appear across multiple
 * platforms, scores their signal strength, and groups evidence.
 *
 * Algorithm:
 *   1. Extract weighted keywords from each platform's data
 *   2. Find keywords that appear across 2+ platforms = "signal"
 *   3. Score by engagement weight + platform breadth
 *   4. Classify: established (3+), reinforced (2+), emerging (1, high engagement)
 *   5. Return top patterns with evidence
 */

import type { RedditPost } from '../scrapers/reddit';
import type { WebResult, TrendingTopic } from '../scrapers/web';
import type { SignalStrength, TrendPattern, PatternEvidence } from '../types/index';

// ─── CONSTANTS ──────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she',
  'they', 'them', 'their', 'what', 'which', 'who', 'how', 'when', 'where',
  'why', 'all', 'each', 'every', 'both', 'more', 'most', 'other', 'some',
  'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'up', 'out', 'if', 'then', 'there', 'also', 'into', 'after',
  'before', 'new', 'one', 'two', 'three', 'now', 'like', 'get', 'got', 'use',
  'using', 'used', 'any', 'even', 'still', 'much', 'many', 'well', 'back',
  'way', 'make', 'made', 'really', 'see', 'think', 'know', 'go', 'going',
  'good', 'time', 'year', 'day', 'week', 'month', 'post', 'comment', 'https',
  'http', 'www', 'com', 'reddit', 'subreddit',
]);

const MIN_KEYWORD_LENGTH = 3;
const MAX_PATTERNS = 10;
const EMERGING_ENGAGEMENT_THRESHOLD = 100; // min score for "emerging" single-source signal

// ─── INTERNAL TYPES ─────────────────────────────────

interface KeywordSignal {
  keyword: string;
  platforms: Set<string>;
  totalEngagement: number;
  evidence: PatternEvidence[];
}

// ─── HELPERS ────────────────────────────────────────

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Extract bigrams (two-word phrases) from a token array.
 * Bigrams often capture more meaningful signals than single words.
 */
function extractBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

/**
 * Compute an engagement weight for a Reddit post.
 * Combines score (upvotes) and comment count, with diminishing returns.
 */
function redditEngagement(post: RedditPost): number {
  return Math.log1p(post.score) * 10 + Math.log1p(post.numComments) * 5;
}

/**
 * Compute engagement weight for a web result.
 * Web results don't have engagement metrics, so use a base value.
 */
function webEngagement(): number {
  return 20; // flat weight - web results indicate editorial relevance
}

// ─── KEYWORD EXTRACTION ─────────────────────────────

function extractRedditKeywords(
  posts: RedditPost[],
): Map<string, { weight: number; evidence: PatternEvidence[] }> {
  const keywords = new Map<string, { weight: number; evidence: PatternEvidence[] }>();

  for (const post of posts) {
    const text = `${post.title} ${post.selftext}`;
    const tokens = tokenizeText(text);
    const bigrams = extractBigrams(tokens);
    const allTerms = [...tokens, ...bigrams];
    const engagement = redditEngagement(post);

    const evidence: PatternEvidence = {
      platform: 'reddit',
      title: post.title,
      url: post.permalink,
      engagement: Math.round(post.score),
      subreddit: post.subreddit,
      score: post.score,
      numComments: post.numComments,
      created: post.created,
    };

    for (const term of allTerms) {
      const existing = keywords.get(term);
      if (existing) {
        existing.weight += engagement;
        // Add evidence only once per post per keyword (first occurrence)
        if (existing.evidence.length < 5) {
          existing.evidence.push(evidence);
        }
      } else {
        keywords.set(term, { weight: engagement, evidence: [evidence] });
      }
    }
  }

  return keywords;
}

function extractWebKeywords(
  results: WebResult[],
): Map<string, { weight: number; evidence: PatternEvidence[] }> {
  const keywords = new Map<string, { weight: number; evidence: PatternEvidence[] }>();

  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    const tokens = tokenizeText(text);
    const bigrams = extractBigrams(tokens);
    const allTerms = [...tokens, ...bigrams];
    const engagement = webEngagement();

    const evidence: PatternEvidence = {
      platform: 'web',
      title: result.title,
      url: result.url,
      engagement,
      source: result.source,
    };

    for (const term of allTerms) {
      const existing = keywords.get(term);
      if (existing) {
        existing.weight += engagement;
        if (existing.evidence.length < 5) {
          existing.evidence.push(evidence);
        }
      } else {
        keywords.set(term, { weight: engagement, evidence: [evidence] });
      }
    }
  }

  return keywords;
}

function extractTrendingKeywords(
  topics: TrendingTopic[],
): Map<string, { weight: number; evidence: PatternEvidence[] }> {
  const keywords = new Map<string, { weight: number; evidence: PatternEvidence[] }>();

  for (const topic of topics) {
    // Parse traffic estimate (e.g. "200K+")
    let trafficWeight = 50;
    if (topic.traffic) {
      const m = topic.traffic.match(/([\d.]+)([KkMm]?)/);
      if (m) {
        let n = parseFloat(m[1]);
        if (m[2]?.toLowerCase() === 'k') n *= 1000;
        if (m[2]?.toLowerCase() === 'm') n *= 1_000_000;
        trafficWeight = Math.log1p(n) * 5;
      }
    }

    const tokens = tokenizeText(topic.title);
    const bigrams = extractBigrams(tokens);
    const allTerms = [...tokens, ...bigrams];

    const evidence: PatternEvidence = {
      platform: 'web',
      title: topic.title,
      url: topic.articles[0]?.url ?? '',
      engagement: Math.round(trafficWeight),
      source: 'Google Trends',
    };

    for (const term of allTerms) {
      const existing = keywords.get(term);
      if (existing) {
        existing.weight += trafficWeight;
        if (existing.evidence.length < 5) existing.evidence.push(evidence);
      } else {
        keywords.set(term, { weight: trafficWeight, evidence: [evidence] });
      }
    }
  }

  return keywords;
}

// ─── SIGNAL CLASSIFICATION ──────────────────────────

function classifyStrength(
  platformCount: number,
  totalEngagement: number,
): SignalStrength {
  if (platformCount >= 3) return 'established';
  if (platformCount >= 2) return 'reinforced';
  if (totalEngagement >= EMERGING_ENGAGEMENT_THRESHOLD) return 'emerging';
  return 'emerging'; // single source, lower engagement - still worth reporting
}

// ─── PUBLIC API ─────────────────────────────────────

export interface PlatformData {
  reddit?: RedditPost[];
  web?: WebResult[];
  webTrending?: TrendingTopic[];
}

/**
 * Detect cross-platform patterns from scraped data.
 * Returns top patterns sorted by signal strength and engagement.
 */
export function detectPatterns(data: PlatformData): TrendPattern[] {
  // Build per-platform keyword maps
  const platformMaps: { platform: string; map: Map<string, { weight: number; evidence: PatternEvidence[] }> }[] = [];

  if (data.reddit && data.reddit.length > 0) {
    platformMaps.push({ platform: 'reddit', map: extractRedditKeywords(data.reddit) });
  }
  if (data.web && data.web.length > 0) {
    platformMaps.push({ platform: 'web', map: extractWebKeywords(data.web) });
  }
  if (data.webTrending && data.webTrending.length > 0) {
    platformMaps.push({ platform: 'web_trending', map: extractTrendingKeywords(data.webTrending) });
  }

  if (platformMaps.length === 0) return [];

  // Merge all keywords into a signal map
  const signals = new Map<string, KeywordSignal>();

  for (const { platform, map } of platformMaps) {
    for (const [keyword, { weight, evidence }] of map) {
      const existing = signals.get(keyword);
      if (existing) {
        existing.platforms.add(platform);
        existing.totalEngagement += weight;
        existing.evidence.push(...evidence.slice(0, 2));
      } else {
        signals.set(keyword, {
          keyword,
          platforms: new Set([platform]),
          totalEngagement: weight,
          evidence: evidence.slice(0, 3),
        });
      }
    }
  }

  // Score and filter
  const scored: TrendPattern[] = [];

  for (const signal of signals.values()) {
    const platformCount = signal.platforms.size;
    // Skip low-weight single-platform signals to reduce noise
    if (platformCount === 1 && signal.totalEngagement < EMERGING_ENGAGEMENT_THRESHOLD) {
      continue;
    }
    // Skip very short keywords (2 chars) that slipped through
    if (signal.keyword.length < MIN_KEYWORD_LENGTH) continue;

    const strength = classifyStrength(platformCount, signal.totalEngagement);
    const platformList = Array.from(signal.platforms).map((p) =>
      p === 'web_trending' ? 'web' : p
    ) as ('reddit' | 'web')[];

    // Deduplicate platforms
    const uniquePlatforms = Array.from(new Set(platformList)) as ('reddit' | 'web')[];

    scored.push({
      pattern: signal.keyword,
      strength,
      sources: uniquePlatforms,
      totalEngagement: Math.round(signal.totalEngagement),
      evidence: signal.evidence.slice(0, 5),
    });
  }

  // Sort: established > reinforced > emerging, then by engagement
  const strengthOrder: Record<SignalStrength, number> = {
    established: 3,
    reinforced: 2,
    emerging: 1,
  };

  scored.sort((a, b) => {
    const strengthDiff = strengthOrder[b.strength] - strengthOrder[a.strength];
    if (strengthDiff !== 0) return strengthDiff;
    return b.totalEngagement - a.totalEngagement;
  });

  return scored.slice(0, MAX_PATTERNS);
}

/**
 * Get the top N keywords from a single platform's data - used for trending endpoint.
 */
export function getTopKeywords(
  posts: RedditPost[],
  limit: number = 10,
): { keyword: string; weight: number; evidence: PatternEvidence[] }[] {
  const map = extractRedditKeywords(posts);
  return Array.from(map.entries())
    .map(([keyword, data]) => ({ keyword, ...data }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}
