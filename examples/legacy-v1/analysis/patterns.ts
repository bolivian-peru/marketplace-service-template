/**
 * Cross-platform pattern detection.
 * Finds topics appearing across sources and scores signal strength.
 */

import type { RedditPost } from '../scrapers/reddit';
import type { WebResult, TrendingTopic } from '../scrapers/web';
import type { SignalStrength, TrendPattern, PatternEvidence } from '../types/index';

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
const MAX_KEYWORD_LENGTH = 80;
const MAX_PATTERNS = 10;
const EMERGING_ENGAGEMENT_THRESHOLD = 100;
const MAX_ITEMS_PER_PLATFORM = 100;
const MAX_TEXT_LENGTH = 1_200;
const MAX_TOKENS_PER_TEXT = 150;
const MAX_TERMS_PER_TEXT = 250;
const MAX_KEYWORDS_PER_PLATFORM = 4_000;
const MAX_SIGNAL_KEYWORDS = 6_000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

interface KeywordSignal {
  keyword: string;
  platforms: Set<string>;
  totalEngagement: number;
  evidence: PatternEvidence[];
}

function normalizeKeyword(term: string): string | null {
  const normalized = term.trim().toLowerCase();
  if (normalized.length < MIN_KEYWORD_LENGTH || normalized.length > MAX_KEYWORD_LENGTH) {
    return null;
  }
  if (!/^[a-z0-9 ]+$/.test(normalized)) {
    return null;
  }
  if (STOPWORDS.has(normalized)) {
    return null;
  }
  return normalized;
}

function tokenizeText(text: string): string[] {
  const normalizedText = text
    .toLowerCase()
    .slice(0, MAX_TEXT_LENGTH)
    .replace(/[^\w\s]/g, ' ');

  const words = normalizedText
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  return words.slice(0, MAX_TOKENS_PER_TEXT);
}

function extractBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  const tokenCount = Math.min(tokens.length, MAX_TOKENS_PER_TEXT);

  for (let i = 0; i < tokenCount - 1; i++) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    const normalized = normalizeKeyword(phrase);
    if (normalized) {
      bigrams.push(normalized);
    }
  }

  return bigrams;
}

function redditEngagement(post: RedditPost): number {
  return Math.log1p(Math.max(0, post.score)) * 10 + Math.log1p(Math.max(0, post.numComments)) * 5;
}

function webEngagement(): number {
  return 20;
}

function addKeyword(
  map: Map<string, { weight: number; evidence: PatternEvidence[] }>,
  term: string,
  weight: number,
  evidence: PatternEvidence,
): void {
  if (map.size >= MAX_KEYWORDS_PER_PLATFORM && !map.has(term)) {
    return;
  }

  const existing = map.get(term);
  if (existing) {
    existing.weight += weight;
    if (existing.evidence.length < 5) {
      existing.evidence.push(evidence);
    }
  } else {
    map.set(term, { weight, evidence: [evidence] });
  }
}

function extractRedditKeywords(
  posts: RedditPost[],
): Map<string, { weight: number; evidence: PatternEvidence[] }> {
  const keywords = new Map<string, { weight: number; evidence: PatternEvidence[] }>();

  for (const post of posts.slice(0, MAX_ITEMS_PER_PLATFORM)) {
    const text = `${post.title} ${post.selftext}`;
    const tokens = tokenizeText(text);
    const bigrams = extractBigrams(tokens);
    const allTerms = Array.from(new Set([...tokens, ...bigrams])).slice(0, MAX_TERMS_PER_TEXT);
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

    for (const rawTerm of allTerms) {
      const term = normalizeKeyword(rawTerm);
      if (!term) continue;
      addKeyword(keywords, term, engagement, evidence);
    }
  }

  return keywords;
}

function extractWebKeywords(
  results: WebResult[],
): Map<string, { weight: number; evidence: PatternEvidence[] }> {
  const keywords = new Map<string, { weight: number; evidence: PatternEvidence[] }>();

  for (const result of results.slice(0, MAX_ITEMS_PER_PLATFORM)) {
    const text = `${result.title} ${result.snippet}`;
    const tokens = tokenizeText(text);
    const bigrams = extractBigrams(tokens);
    const allTerms = Array.from(new Set([...tokens, ...bigrams])).slice(0, MAX_TERMS_PER_TEXT);
    const engagement = webEngagement();

    const evidence: PatternEvidence = {
      platform: 'web',
      title: result.title,
      url: result.url,
      engagement,
      source: result.source,
    };

    for (const rawTerm of allTerms) {
      const term = normalizeKeyword(rawTerm);
      if (!term) continue;
      addKeyword(keywords, term, engagement, evidence);
    }
  }

  return keywords;
}

function extractTrendingKeywords(
  topics: TrendingTopic[],
): Map<string, { weight: number; evidence: PatternEvidence[] }> {
  const keywords = new Map<string, { weight: number; evidence: PatternEvidence[] }>();

  for (const topic of topics.slice(0, MAX_ITEMS_PER_PLATFORM)) {
    let trafficWeight = 50;
    if (topic.traffic) {
      const m = topic.traffic.match(/([\d.]+)([KkMm]?)/);
      if (m) {
        let n = parseFloat(m[1]);
        if (m[2]?.toLowerCase() === 'k') n *= 1000;
        if (m[2]?.toLowerCase() === 'm') n *= 1_000_000;
        trafficWeight = Math.log1p(Math.max(0, n)) * 5;
      }
    }

    const tokens = tokenizeText(topic.title);
    const bigrams = extractBigrams(tokens);
    const allTerms = Array.from(new Set([...tokens, ...bigrams])).slice(0, MAX_TERMS_PER_TEXT);

    const evidence: PatternEvidence = {
      platform: 'web',
      title: topic.title,
      url: topic.articles[0]?.url ?? '',
      engagement: Math.round(trafficWeight),
      source: 'Google Trends',
    };

    for (const rawTerm of allTerms) {
      const term = normalizeKeyword(rawTerm);
      if (!term) continue;
      addKeyword(keywords, term, trafficWeight, evidence);
    }
  }

  return keywords;
}

function classifyStrength(
  platformCount: number,
  totalEngagement: number,
): SignalStrength {
  if (platformCount >= 3) return 'established';
  if (platformCount >= 2) return 'reinforced';
  if (totalEngagement >= EMERGING_ENGAGEMENT_THRESHOLD) return 'emerging';
  return 'emerging';
}

export interface PlatformData {
  reddit?: RedditPost[];
  web?: WebResult[];
  webTrending?: TrendingTopic[];
}

export function detectPatterns(data: PlatformData): TrendPattern[] {
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

  const signals = new Map<string, KeywordSignal>();

  for (const { platform, map } of platformMaps) {
    for (const [keyword, { weight, evidence }] of map) {
      if (signals.size >= MAX_SIGNAL_KEYWORDS && !signals.has(keyword)) {
        continue;
      }

      const existing = signals.get(keyword);
      if (existing) {
        existing.platforms.add(platform);
        existing.totalEngagement += weight;
        if (existing.evidence.length < 5) {
          existing.evidence.push(...evidence.slice(0, 2));
          if (existing.evidence.length > 5) {
            existing.evidence = existing.evidence.slice(0, 5);
          }
        }
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

  const scored: TrendPattern[] = [];

  for (const signal of signals.values()) {
    const platformCount = signal.platforms.size;

    if (platformCount === 1 && signal.totalEngagement < EMERGING_ENGAGEMENT_THRESHOLD) {
      continue;
    }

    if (signal.keyword.length < MIN_KEYWORD_LENGTH || signal.keyword.length > MAX_KEYWORD_LENGTH) {
      continue;
    }

    const strength = classifyStrength(platformCount, signal.totalEngagement);
    const platformList = Array.from(signal.platforms).map((p) =>
      p === 'web_trending' ? 'web' : p,
    ) as ('reddit' | 'web')[];

    const uniquePlatforms = Array.from(new Set(platformList)) as ('reddit' | 'web')[];

    scored.push({
      pattern: signal.keyword,
      strength,
      sources: uniquePlatforms,
      totalEngagement: Math.round(signal.totalEngagement),
      evidence: signal.evidence.slice(0, 5),
    });
  }

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

export function getTopKeywords(
  posts: RedditPost[],
  limit: number = 10,
): { keyword: string; weight: number; evidence: PatternEvidence[] }[] {
  const safeLimit = clamp(limit, 1, 50);
  const map = extractRedditKeywords(posts.slice(0, MAX_ITEMS_PER_PLATFORM));
  return Array.from(map.entries())
    .map(([keyword, data]) => ({ keyword, ...data }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, safeLimit);
}
