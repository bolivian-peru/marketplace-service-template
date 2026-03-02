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

