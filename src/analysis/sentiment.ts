/**
 * Sentiment analysis using curated word lists.
 */

export interface SentimentScore {
  overall: 'positive' | 'neutral' | 'negative';
  score: number;
  positive: number;
  neutral: number;
  negative: number;
  totalWords: number;
}

export interface PlatformSentiment {
  overall: 'positive' | 'neutral' | 'negative';
  positive: number;
  neutral: number;
  negative: number;
}

const POSITIVE_WORDS = new Set([
  'great', 'amazing', 'excellent', 'fantastic', 'wonderful', 'outstanding',
  'brilliant', 'superb', 'exceptional', 'perfect', 'best', 'awesome',
  'love', 'loved', 'like', 'liked', 'enjoy', 'enjoyed', 'appreciate',
  'recommend', 'recommended', 'prefer', 'preferred', 'favorite', 'favourite',
  'helpful', 'useful', 'effective', 'efficient', 'works', 'working',
  'solved', 'fixed', 'improved', 'better', 'good', 'nice', 'clean',
  'happy', 'pleased', 'satisfied', 'impressed', 'excited', 'thrilled',
  'glad', 'thankful', 'grateful', 'delighted',
  'fast', 'smooth', 'stable', 'reliable', 'accurate', 'intuitive',
  'responsive', 'elegant', 'solid', 'powerful', 'innovative', 'clever',
  'easy', 'simple', 'straightforward', 'painless',
  'absolutely', 'definitely', 'certainly', 'yes', 'agree', 'correct',
  'right', 'true', 'indeed', 'exactly', 'precisely',
]);

const NEGATIVE_WORDS = new Set([
  'terrible', 'awful', 'horrible', 'dreadful', 'atrocious', 'appalling',
  'pathetic', 'garbage', 'trash', 'junk', 'worthless', 'useless',
  'hate', 'hated', 'dislike', 'disliked', 'avoid', 'disappointed',
  'disappointing', 'frustrating', 'frustrated', 'annoying', 'annoyed',
  'broken', 'bug', 'bugs', 'buggy', 'crash', 'crashes', 'crashing',
  'failed', 'failing', 'failure', 'error', 'errors', 'issue', 'issues',
  'problem', 'problems', 'worst', 'bad', 'poor', 'mediocre', 'lacking',
  'scam', 'fraud', 'fake', 'misleading', 'waste', 'overpriced', 'expensive',
  'ripoff', 'rip-off', 'spam',
  'unhappy', 'angry', 'upset', 'annoyed', 'furious', 'outraged',
  'sad', 'regret', 'regretful', 'sorry', 'unfortunately',
  'slow', 'laggy', 'unstable', 'unreliable', 'inaccurate', 'confusing',
  'complicated', 'messy', 'outdated', 'deprecated', 'bloated',
  'never', 'nobody', 'nothing', 'nowhere', 'neither', 'hardly',
]);

const NEGATION_WORDS = new Set([
  'not', "n't", 'no', 'never', 'neither', 'nor', "don't", "doesn't",
  "didn't", "isn't", "aren't", "wasn't", "weren't", "can't", 'cannot',
  "couldn't", "won't", "wouldn't", "shouldn't",
]);

const INTENSIFIERS = new Set([
  'very', 'extremely', 'incredibly', 'absolutely', 'completely', 'totally',
  'utterly', 'highly', 'deeply', 'seriously', 'really', 'super', 'so',
]);

const MAX_TEXT_LENGTH = 8_000;
const MAX_TOKENS_PER_TEXT = 2_000;
const MAX_TEXTS_PER_BATCH = 300;

function sanitizeText(text: string): string {
  return text.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function tokenize(text: string): string[] {
  return sanitizeText(text)
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, MAX_TOKENS_PER_TEXT);
}

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
      if (isNegated && i > 0) {
        isNegated = false;
      }
      intensifierMultiplier = 1;
    }
  }

  const rawScore = (positiveCount - negativeCount) / Math.max(totalWords, 1);
  const score = Math.max(-1, Math.min(1, rawScore * 10));

  const positiveInt = Math.max(0, Math.round(positiveCount));
  const negativeInt = Math.max(0, Math.round(negativeCount));
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

export function aggregateSentiment(texts: string[]): PlatformSentiment {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { overall: 'neutral', positive: 33, neutral: 34, negative: 33 };
  }

  const limitedTexts = texts
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .slice(0, MAX_TEXTS_PER_BATCH);

  if (limitedTexts.length === 0) {
    return { overall: 'neutral', positive: 33, neutral: 34, negative: 33 };
  }

  const scores = limitedTexts.map((t) => scoreSentiment(t));
  const positiveCount = scores.filter((s) => s.overall === 'positive').length;
  const negativeCount = scores.filter((s) => s.overall === 'negative').length;
  const neutralCount = scores.length - positiveCount - negativeCount;

  const total = scores.length;
  const positivePercent = Math.round((positiveCount / total) * 100);
  const negativePercent = Math.round((negativeCount / total) * 100);
  const neutralPercent = Math.max(0, 100 - positivePercent - negativePercent);

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
