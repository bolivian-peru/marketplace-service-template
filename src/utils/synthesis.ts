/**
 * Cross-Platform Synthesis Engine
 * ─────────────────────────────────────────────────────────
 * Takes raw data from Reddit, X, YouTube and synthesizes:
 *   - Pattern detection (cross-platform signal identification)
 *   - Engagement-weighted scoring
 *   - Sentiment analysis (positive/negative/neutral per platform)
 *   - Signal strength classification
 *   - Emerging topics extraction
 */

import type {
  Evidence,
  Platform,
  TrendPattern,
  SentimentResult,
  SignalStrength,
  RedditPost,
  XPost,
  YouTubeVideo,
  PlatformSentiment,
} from '../types';

// ─── SENTIMENT LEXICON ───────────────────────────────

const POSITIVE_WORDS = new Set([
  'great', 'amazing', 'awesome', 'excellent', 'love', 'best', 'good', 'fantastic',
  'helpful', 'useful', 'impressive', 'brilliant', 'perfect', 'recommended', 'worth',
  'exciting', 'innovative', 'powerful', 'fast', 'efficient', 'reliable', 'solid',
  'beautiful', 'clean', 'simple', 'easy', 'better', 'improved', 'success', 'win',
  'revolutionize', 'breakthrough', 'superior', 'outstanding', 'exceptional', 'top',
  'works', 'fixed', 'solved', 'pleased', 'happy', 'proud', 'glad', 'love', 'enjoy',
  'incredible', 'insane', 'wild', 'blown', 'mind', 'huge', 'massive', 'game-changing',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'broken', 'fail',
  'failed', 'failure', 'useless', 'waste', 'disappointed', 'disappointing', 'slow',
  'buggy', 'bug', 'crash', 'error', 'problem', 'issue', 'broken', 'dead', 'down',
  'dead', 'scam', 'overrated', 'toxic', 'dangerous', 'wrong', 'missing', 'lacking',
  'regret', 'avoid', 'warning', 'careful', 'frustrating', 'annoying', 'stuck',
  'complicated', 'confusing', 'difficult', 'hard', 'poor', 'mediocre', 'meh',
  'disappointed', 'sad', 'unfortunate', 'disaster', 'crisis', 'controversy', 'ban',
]);

function analyzeTextSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  let pos = 0;
  let neg = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) pos++;
    if (NEGATIVE_WORDS.has(word)) neg++;
  }

  if (pos === 0 && neg === 0) return 'neutral';
  if (pos > neg * 1.5) return 'positive';
  if (neg > pos * 1.5) return 'negative';
  return 'neutral';
}

function getPostText(e: Evidence): string {
  if (e.platform === 'reddit') return `${e.title} ${e.selftext || ''}`;
  if (e.platform === 'x') return e.text;
  if (e.platform === 'youtube') return `${e.title} ${e.description || ''}`;
  return '';
}

// ─── KEYWORD EXTRACTION ──────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they',
  'my', 'your', 'his', 'her', 'our', 'their', 'what', 'which', 'who', 'when', 'where',
  'how', 'why', 'all', 'some', 'any', 'just', 'like', 'more', 'also', 'so', 'not',
  'no', 'if', 'then', 'than', 'up', 'out', 'about', 'into', 'after', 'over', 'new',
  'get', 'use', 'using', 'used', 'now', 'here', 'there', 'very', 'much', 'many',
  'one', 'two', 'first', 'second', 'still', 'even', 'back', 'well', 'way', 'day',
  'go', 'going', 'got', 'make', 'made', 'need', 'want', 'see', 'think', 'know',
]);

function extractKeyPhrases(evidence: Evidence[], minCount: number = 2): Map<string, number> {
  const bigrams = new Map<string, number>();
  const unigrams = new Map<string, number>();

  for (const e of evidence) {
    const text = getPostText(e).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const words = text.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));

    // Unigrams
    for (const w of words) {
      unigrams.set(w, (unigrams.get(w) || 0) + 1);
    }

    // Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (words[i].length > 2 && words[i + 1].length > 2) {
        bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
      }
    }
  }

  // Combine and filter
  const phrases = new Map<string, number>();

  for (const [bigram, count] of bigrams) {
    if (count >= minCount) phrases.set(bigram, count * 2); // Bigrams weighted higher
  }

  for (const [word, count] of unigrams) {
    if (count >= minCount && !STOP_WORDS.has(word)) {
      // Only add unigram if not already covered by a bigram
      let covered = false;
      for (const b of bigrams.keys()) {
        if (b.includes(word) && (bigrams.get(b) || 0) >= minCount) {
          covered = true;
          break;
        }
      }
      if (!covered) phrases.set(word, count);
    }
  }

  return phrases;
}

// ─── PATTERN DETECTION ───────────────────────────────

function determineSignalStrength(
  platforms: Platform[],
  totalEngagement: number,
  evidenceCount: number,
): SignalStrength {
  if (platforms.length >= 3 && totalEngagement > 1000) return 'established';
  if (platforms.length >= 2 && totalEngagement > 200) return 'reinforced';
  if (platforms.length >= 3 || totalEngagement > 500) return 'reinforced';
  return 'emerging';
}

function capitalizePhrase(phrase: string): string {
  return phrase.split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
}

/**
 * Main pattern detection: groups evidence by recurring phrases and themes.
 */
export function detectPatterns(
  evidence: Evidence[],
  topic: string,
): TrendPattern[] {
  if (evidence.length === 0) return [];

  const phrases = extractKeyPhrases(evidence, 2);

  // Sort phrases by frequency
  const sortedPhrases = [...phrases.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const patterns: TrendPattern[] = [];
  const usedEvidence = new Set<string>();

  for (const [phrase, freq] of sortedPhrases) {
    // Skip if too similar to topic itself
    if (topic.toLowerCase().includes(phrase) || phrase.split(' ').length < 1) continue;

    // Find evidence containing this phrase
    const matchingEvidence = evidence.filter(e => {
      const text = getPostText(e).toLowerCase();
      return text.includes(phrase);
    });

    if (matchingEvidence.length < 2) continue;

    // Determine which platforms this pattern spans
    const platformSet = new Set<Platform>(matchingEvidence.map(e => e.platform));
    const platforms = [...platformSet] as Platform[];

    const totalEngagement = matchingEvidence.reduce((sum, e) => sum + e.engagementScore, 0);

    // Take top 3 pieces of evidence
    const topEvidence = matchingEvidence
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 3);

    const strength = determineSignalStrength(platforms, totalEngagement, matchingEvidence.length);

    patterns.push({
      pattern: `${capitalizePhrase(phrase)} ${getPatternContext(phrase, matchingEvidence)}`,
      strength,
      sources: platforms,
      evidence: topEvidence,
      totalEngagement: Math.round(totalEngagement),
    });

    // Mark evidence as used
    for (const e of topEvidence) {
      const eid = e.platform + '_' + ('id' in e ? e.id : '');
      usedEvidence.add(eid);
    }

    if (patterns.length >= 8) break;
  }

  // Sort: established > reinforced > emerging, then by engagement
  return patterns.sort((a, b) => {
    const order = { established: 3, reinforced: 2, emerging: 1 };
    const diff = order[b.strength] - order[a.strength];
    if (diff !== 0) return diff;
    return b.totalEngagement - a.totalEngagement;
  });
}

function getPatternContext(phrase: string, evidence: Evidence[]): string {
  // Try to extract context from highest engagement evidence
  const best = evidence.sort((a, b) => b.engagementScore - a.engagementScore)[0];
  if (!best) return 'discussion';

  const text = getPostText(best).toLowerCase();
  const idx = text.indexOf(phrase);
  if (idx === -1) return 'trend';

  const context = text.slice(Math.max(0, idx - 30), idx + phrase.length + 30);
  const words = context.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));

  return words.length > 2 ? 'discussion' : 'trend';
}

// ─── SENTIMENT ANALYSIS ──────────────────────────────

export function analyzeSentiment(
  evidenceByPlatform: Partial<Record<Platform, Evidence[]>>,
): SentimentResult {
  const byPlatform: Partial<Record<Platform, PlatformSentiment>> = {};
  let totalPos = 0;
  let totalNeg = 0;
  let totalNeutral = 0;

  for (const [platform, items] of Object.entries(evidenceByPlatform) as [Platform, Evidence[]][]) {
    if (!items?.length) continue;

    let pos = 0, neg = 0, neutral = 0;

    for (const item of items) {
      const sentiment = analyzeTextSentiment(getPostText(item));
      if (sentiment === 'positive') { pos++; totalPos++; }
      else if (sentiment === 'negative') { neg++; totalNeg++; }
      else { neutral++; totalNeutral++; }
    }

    const total = pos + neg + neutral;
    byPlatform[platform] = {
      positive: Math.round((pos / total) * 100),
      neutral: Math.round((neutral / total) * 100),
      negative: Math.round((neg / total) * 100),
      sampleSize: total,
    };
  }

  const total = totalPos + totalNeg + totalNeutral;
  let overall: SentimentResult['overall'] = 'neutral';

  if (total > 0) {
    const posRate = totalPos / total;
    const negRate = totalNeg / total;

    if (posRate > 0.55) overall = 'positive';
    else if (negRate > 0.45) overall = 'negative';
    else if (Math.abs(posRate - negRate) < 0.15) overall = 'mixed';
  }

  return { overall, by_platform: byPlatform };
}

// ─── EMERGING TOPICS ─────────────────────────────────

export function extractEmergingTopics(
  evidence: Evidence[],
  mainTopic: string,
  maxTopics: number = 5,
): string[] {
  const phrases = extractKeyPhrases(evidence, 2);
  const topicWords = new Set(mainTopic.toLowerCase().split(/\s+/));

  const emerging: string[] = [];

  for (const [phrase, freq] of [...phrases.entries()].sort((a, b) => b[1] - a[1])) {
    // Skip if just the main topic
    const phraseWords = phrase.split(' ');
    const overlap = phraseWords.filter(w => topicWords.has(w)).length;
    if (overlap / phraseWords.length > 0.5) continue;

    // Only keep multi-word phrases or meaningful single words
    if (phrase.includes(' ') || (phrase.length > 5 && freq >= 3)) {
      emerging.push(capitalizePhrase(phrase));
    }

    if (emerging.length >= maxTopics) break;
  }

  return emerging;
}

// ─── TOP DISCUSSIONS ─────────────────────────────────

export function getTopDiscussions(
  evidence: Evidence[],
  limit: number = 10,
): Evidence[] {
  return [...evidence]
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, limit);
}
