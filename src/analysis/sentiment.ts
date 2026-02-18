/**
 * Sentiment Analysis
 * ──────────────────
 * Word-list based scoring. No external API. Fast and deterministic.
 *
 * Approach: count positive/negative word matches in text,
 * normalize by word count, classify into three buckets.
 *
 * Not as sophisticated as a transformer model but accurate enough
 * for social media text where sentiment is usually unambiguous.
 */

// ─── TYPES ──────────────────────────────────────────

export interface SentimentScore {
  overall: 'positive' | 'neutral' | 'negative';
  score: number;      // -1.0 to 1.0
  positive: number;   // count
  neutral: number;    // estimated: total - pos - neg
  negative: number;   // count
  totalWords: number;
}

export interface PlatformSentiment {
  overall: 'positive' | 'neutral' | 'negative';
  positive: number;   // percentage 0-100
  neutral: number;
  negative: number;
}

// ─── WORD LISTS ─────────────────────────────────────

const POSITIVE_WORDS = new Set([
  // Quality
  'great', 'amazing', 'excellent', 'fantastic', 'wonderful', 'outstanding',
  'brilliant', 'superb', 'exceptional', 'perfect', 'best', 'awesome',
  // Approval
  'love', 'loved', 'like', 'liked', 'enjoy', 'enjoyed', 'appreciate',
  'recommend', 'recommended', 'prefer', 'preferred', 'favorite', 'favourite',
  // Utility
  'helpful', 'useful', 'effective', 'efficient', 'works', 'working',
  'solved', 'fixed', 'improved', 'better', 'good', 'nice', 'clean',
  // Sentiment
  'happy', 'pleased', 'satisfied', 'impressed', 'excited', 'thrilled',
  'glad', 'thankful', 'grateful', 'delighted',
  // Tech-specific positives
  'fast', 'smooth', 'stable', 'reliable', 'accurate', 'intuitive',
  'responsive', 'elegant', 'solid', 'powerful', 'innovative', 'clever',
  'easy', 'simple', 'straightforward', 'painless',
  // Agreement/endorsement
  'absolutely', 'definitely', 'certainly', 'yes', 'agree', 'correct',
  'right', 'true', 'indeed', 'exactly', 'precisely',
]);

const NEGATIVE_WORDS = new Set([
  // Quality
  'terrible', 'awful', 'horrible', 'dreadful', 'atrocious', 'appalling',
  'pathetic', 'garbage', 'trash', 'junk', 'worthless', 'useless',
  // Disapproval
  'hate', 'hated', 'dislike', 'disliked', 'avoid', 'disappointed',
  'disappointing', 'frustrating', 'frustrated', 'annoying', 'annoyed',
  // Problems
  'broken', 'bug', 'bugs', 'buggy', 'crash', 'crashes', 'crashing',
  'failed', 'failing', 'failure', 'error', 'errors', 'issue', 'issues',
  'problem', 'problems', 'worst', 'bad', 'poor', 'mediocre', 'lacking',
  // Deception/harm
  'scam', 'fraud', 'fake', 'misleading', 'waste', 'overpriced', 'expensive',
  'ripoff', 'rip-off', 'spam',
  // Sentiment
  'unhappy', 'angry', 'upset', 'annoyed', 'furious', 'outraged',
  'sad', 'regret', 'regretful', 'sorry', 'unfortunately',
  // Tech-specific negatives
  'slow', 'laggy', 'unstable', 'unreliable', 'inaccurate', 'confusing',
  'complicated', 'messy', 'outdated', 'deprecated', 'bloated',
  // Negation amplifiers (handled separately)
  'never', 'nobody', 'nothing', 'nowhere', 'neither', 'hardly',
]);

// Negation words flip the next word's sentiment
const NEGATION_WORDS = new Set([
  'not', "n't", 'no', 'never', 'neither', 'nor', "don't", "doesn't",
  "didn't", "isn't", "aren't", "wasn't", "weren't", "can't", "cannot",
  "couldn't", "won't", "wouldn't", "shouldn't",
]);

// Words that intensify sentiment
const INTENSIFIERS = new Set([
  'very', 'extremely', 'incredibly', 'absolutely', 'completely', 'totally',
  'utterly', 'highly', 'deeply', 'seriously', 'really', 'super', 'so',
]);

// ─── TOKENIZER ──────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// ─── SCORING ────────────────────────────────────────

/**
 * Score a single text string for sentiment.
 */
export function scoreSentiment(text: string): SentimentScore {
  if (!text || !text.trim()) {
    return { overall: 'neutral', score: 0, positive: 0, neutral: 0, negative: 0, totalWords: 0 };
  }

  const tokens = tokenize(text);
  const totalWords = tokens.length;

  if (totalWords === 0) {
    return { overall: 'neutral', score: 0, positive: 0, neutral: 0, negative: 0, totalWords: 0 };
  }

  let positiveCount = 0;
  let negativeCount = 0;
  let isNegated = false;
  let intensifierMultiplier = 1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (NEGATION_WORDS.has(token)) {
      isNegated = true;
      intensifierMultiplier = 1;
      continue;
    }

    if (INTENSIFIERS.has(token)) {
      intensifierMultiplier = 1.5;
      continue;
    }

    const weight = intensifierMultiplier;

    if (POSITIVE_WORDS.has(token)) {
      if (isNegated) {
        negativeCount += weight;
      } else {
        positiveCount += weight;
      }
      isNegated = false;
      intensifierMultiplier = 1;
    } else if (NEGATIVE_WORDS.has(token)) {
      if (isNegated) {
        positiveCount += weight;
      } else {
        negativeCount += weight;
      }
      isNegated = false;
      intensifierMultiplier = 1;
    } else {
      // Non-sentiment word resets negation after 3 words
      if (isNegated && i > 0) {
        // Only negate the immediately following sentiment word
        // After a non-sentiment word, negation expires
        isNegated = false;
      }
      intensifierMultiplier = 1;
    }
  }

  const rawScore = (positiveCount - negativeCount) / Math.max(totalWords, 1);
  // Clamp to -1..1 and scale (raw is usually small)
  const score = Math.max(-1, Math.min(1, rawScore * 10));

  const positiveInt = Math.round(positiveCount);
  const negativeInt = Math.round(negativeCount);
  const neutralInt = Math.max(0, totalWords - positiveInt - negativeInt);

  let overall: 'positive' | 'neutral' | 'negative';
  if (score > 0.05) {
    overall = 'positive';
  } else if (score < -0.05) {
    overall = 'negative';
  } else {
    overall = 'neutral';
  }

  return {
    overall,
    score,
    positive: positiveInt,
    neutral: neutralInt,
    negative: negativeInt,
    totalWords,
  };
}

/**
 * Score an array of texts and return aggregate platform-level sentiment percentages.
 */
export function aggregateSentiment(texts: string[]): PlatformSentiment {
  if (texts.length === 0) {
    return { overall: 'neutral', positive: 33, neutral: 34, negative: 33 };
  }

  const scores = texts.map((t) => scoreSentiment(t));
  const positiveCount = scores.filter((s) => s.overall === 'positive').length;
  const negativeCount = scores.filter((s) => s.overall === 'negative').length;
  const neutralCount = scores.length - positiveCount - negativeCount;

  const total = scores.length;
  const positivePercent = Math.round((positiveCount / total) * 100);
  const negativePercent = Math.round((negativeCount / total) * 100);
  const neutralPercent = 100 - positivePercent - negativePercent;

  let overall: 'positive' | 'neutral' | 'negative';
  if (positivePercent > negativePercent && positivePercent >= 40) {
    overall = 'positive';
  } else if (negativePercent > positivePercent && negativePercent >= 40) {
    overall = 'negative';
  } else {
    overall = 'neutral';
  }

  return {
    overall,
    positive: positivePercent,
    neutral: neutralPercent,
    negative: negativePercent,
  };
}
