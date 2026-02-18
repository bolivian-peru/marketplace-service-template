/**
 * Trend Intelligence API — Cross-Platform Research Engine
 * ────────────────────────────────────────────────────────
 * Scrapes multiple platforms in parallel, synthesizes results into
 * engagement-weighted patterns with sentiment analysis.
 *
 * Platforms: Reddit, X/Twitter (via Nitter), YouTube, Web (DuckDuckGo)
 */

import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface ResearchResult {
  topic: string;
  timeframe: string;
  patterns: Array<{
    pattern: string;
    strength: 'emerging' | 'growing' | 'established';
    sources: string[];
    evidence: Array<{
      platform: string;
      title: string;
      url: string;
      engagement: number;
      snippet: string;
    }>;
  }>;
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative';
    by_platform: Record<string, { positive: number; neutral: number; negative: number }>;
  };
  top_discussions: Array<{
    platform: string;
    title: string;
    url: string;
    engagement: number;
  }>;
  emerging_topics: string[];
  meta: {
    sources_checked: number;
    platforms_used: string[];
  };
}

export interface TrendingResult {
  country: string;
  platforms: string[];
  trends: Array<{
    topic: string;
    platforms_trending: string[];
    combined_engagement: number;
    urls: Array<{ platform: string; url: string }>;
  }>;
}

interface RawItem {
  platform: string;
  title: string;
  url: string;
  engagement: number;
  snippet: string;
}

// ─── CONSTANTS ──────────────────────────────────────

const POSITIVE_WORDS = ['amazing', 'great', 'love', 'best', 'awesome', 'revolutionary', 'breakthrough'];
const NEGATIVE_WORDS = ['terrible', 'worst', 'hate', 'broken', 'scam', 'disappointing', 'failed'];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'was', 'are',
  'be', 'has', 'had', 'have', 'will', 'can', 'do', 'does', 'did', 'not',
  'so', 'if', 'no', 'up', 'out', 'just', 'about', 'into', 'than', 'then',
  'its', 'my', 'your', 'his', 'her', 'our', 'we', 'you', 'he', 'she',
  'they', 'them', 'what', 'which', 'who', 'how', 'when', 'where', 'why',
  'all', 'each', 'every', 'both', 'more', 'most', 'some', 'any', 'new',
  'also', 'now', 'only', 'very', 'been', 'would', 'could', 'should',
  'i', 'me', 'us', 'as', 'am', 'were', 'being', 'get', 'got', 'one',
  'two', 'like', 'over', 'after', 'before', 'such', 'well', 'back',
]);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ─── HTML UTILITIES ─────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function parseEngagement(text: string): number {
  const cleaned = text.replace(/,/g, '').trim().toLowerCase();
  const match = cleaned.match(/([\d.]+)\s*([kmb])?/);
  if (!match) return 0;
  let num = parseFloat(match[1]);
  if (match[2] === 'k') num *= 1_000;
  else if (match[2] === 'm') num *= 1_000_000;
  else if (match[2] === 'b') num *= 1_000_000_000;
  return Math.round(num);
}

// ─── PLATFORM SCRAPERS ──────────────────────────────

async function scrapeReddit(
  topic: string,
  proxyFetch: ProxyFetchFn,
): Promise<RawItem[]> {
  const query = encodeURIComponent(topic);
  const url = `https://old.reddit.com/search?q=${query}&sort=relevance&t=month`;

  const response = await proxyFetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) throw new Error(`Reddit returned HTTP ${response.status}`);
  const html = await response.text();
  const items: RawItem[] = [];

  // old.reddit.com search results: <a class="search-title ..."> with href, score in <span class="search-score">
  const postPattern = /<a[^>]*class="[^"]*search-title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<span[^>]*class="[^"]*search-score[^"]*"[^>]*>([\s\S]*?)<\/span>)?[\s\S]*?(?:<span[^>]*class="[^"]*search-comments[^"]*"[^>]*>([\s\S]*?)<\/span>)?[\s\S]*?(?:<a[^>]*class="[^"]*search-subreddit-link[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = postPattern.exec(html)) !== null) {
    const postUrl = match[1].startsWith('http') ? match[1] : `https://old.reddit.com${match[1]}`;
    const title = decodeHtmlEntities(stripTags(match[2]));
    const score = match[3] ? parseEngagement(stripTags(match[3])) : 0;
    const comments = match[4] ? parseEngagement(stripTags(match[4])) : 0;
    const subreddit = match[5] ? stripTags(match[5]) : '';

    if (title.length > 3) {
      items.push({
        platform: 'reddit',
        title,
        url: postUrl,
        engagement: score + comments,
        snippet: subreddit ? `r/${subreddit} - ${score} points, ${comments} comments` : `${score} points`,
      });
    }
  }

  // Fallback: broader link extraction from search page
  if (items.length === 0) {
    const fallbackPattern = /<a[^>]*href="(\/r\/[^"]+\/comments\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = fallbackPattern.exec(html)) !== null) {
      const title = decodeHtmlEntities(stripTags(match[2]));
      if (title.length > 5) {
        items.push({
          platform: 'reddit',
          title,
          url: `https://old.reddit.com${match[1]}`,
          engagement: 0,
          snippet: '',
        });
      }
    }
  }

  return items.slice(0, 25);
}

async function scrapeTwitter(
  topic: string,
  proxyFetch: ProxyFetchFn,
): Promise<RawItem[]> {
  const query = encodeURIComponent(topic);
  const url = `https://nitter.net/search?f=tweets&q=${query}`;

  const response = await proxyFetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) throw new Error(`Nitter returned HTTP ${response.status}`);
  const html = await response.text();
  const items: RawItem[] = [];

  // Nitter timeline items: <div class="timeline-item"> with tweet content and stats
  const tweetPattern = /<div[^>]*class="[^"]*timeline-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*timeline-item|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = tweetPattern.exec(html)) !== null) {
    const block = match[1];

    // Extract tweet link
    const linkMatch = block.match(/<a[^>]*class="[^"]*tweet-link[^"]*"[^>]*href="([^"]+)"/i);
    const tweetUrl = linkMatch ? `https://nitter.net${linkMatch[1]}` : '';

    // Extract tweet text
    const contentMatch = block.match(/<div[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const content = contentMatch ? decodeHtmlEntities(stripTags(contentMatch[1])) : '';

    // Extract engagement (likes, retweets, replies)
    const statPattern = /<span[^>]*class="[^"]*(?:tweet-stat|icon-container)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    let totalEngagement = 0;
    let statMatch: RegExpExecArray | null;
    while ((statMatch = statPattern.exec(block)) !== null) {
      totalEngagement += parseEngagement(stripTags(statMatch[1]));
    }

    if (content.length > 5 && tweetUrl) {
      items.push({
        platform: 'twitter',
        title: content.substring(0, 200),
        url: tweetUrl,
        engagement: totalEngagement,
        snippet: content.substring(0, 300),
      });
    }
  }

  return items.slice(0, 25);
}

async function scrapeYouTube(
  topic: string,
  proxyFetch: ProxyFetchFn,
): Promise<RawItem[]> {
  const query = encodeURIComponent(topic);
  // sp=CAI%253D sorts by upload date
  const url = `https://www.youtube.com/results?search_query=${query}&sp=CAI%253D`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) throw new Error(`YouTube returned HTTP ${response.status}`);
  const html = await response.text();
  const items: RawItem[] = [];

  // YouTube embeds video data in ytInitialData JSON
  const dataMatch = html.match(/var\s+ytInitialData\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

      for (const item of contents) {
        const video = item.videoRenderer;
        if (!video) continue;

        const title = video.title?.runs?.[0]?.text || '';
        const videoId = video.videoId || '';
        const viewText = video.viewCountText?.simpleText || video.viewCountText?.runs?.[0]?.text || '0';
        const channel = video.ownerText?.runs?.[0]?.text || '';
        const snippet = video.detailedMetadataSnippets?.[0]?.snippetText?.runs
          ?.map((r: { text: string }) => r.text).join('') || '';

        const views = parseEngagement(viewText.replace(/\s*views?/i, ''));

        if (title && videoId) {
          items.push({
            platform: 'youtube',
            title,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            engagement: views,
            snippet: channel ? `${channel} - ${viewText}${snippet ? ` | ${snippet}` : ''}` : viewText,
          });
        }
      }
    } catch {
      // JSON parse failed; fall through to regex fallback
    }
  }

  // Fallback: regex extraction from HTML
  if (items.length === 0) {
    const videoPattern = /\"videoId\":\"([^"]+)\"[\s\S]*?\"title\":\{\"runs\":\[\{\"text\":\"([^"]+)\"\}[\s\S]*?(?:\"viewCountText\":\{\"simpleText\":\"([^"]+)\"\})?[\s\S]*?(?:\"ownerText\":\{\"runs\":\[\{\"text\":\"([^"]+)\"\})?/g;
    let match: RegExpExecArray | null;
    while ((match = videoPattern.exec(html)) !== null) {
      const videoId = match[1];
      const title = match[2];
      const viewText = match[3] || '0';
      const channel = match[4] || '';

      if (title && videoId && !items.some(i => i.url.includes(videoId))) {
        items.push({
          platform: 'youtube',
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          engagement: parseEngagement(viewText.replace(/\s*views?/i, '')),
          snippet: channel ? `${channel} - ${viewText}` : viewText,
        });
      }
    }
  }

  return items.slice(0, 25);
}

async function scrapeWeb(
  topic: string,
  proxyFetch: ProxyFetchFn,
): Promise<RawItem[]> {
  const query = encodeURIComponent(topic);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;

  const response = await proxyFetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  const html = await response.text();
  const items: RawItem[] = [];

  // DuckDuckGo HTML: results in <div class="result ..."> with <a class="result__a" href="...">
  const resultPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null) {
    let resultUrl = match[1];
    const title = decodeHtmlEntities(stripTags(match[2]));
    const snippet = match[3] ? decodeHtmlEntities(stripTags(match[3])) : '';

    // DuckDuckGo sometimes wraps URLs in redirects
    if (resultUrl.includes('uddg=')) {
      const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);
    }

    if (title.length > 3 && resultUrl.startsWith('http')) {
      items.push({
        platform: 'web',
        title,
        url: resultUrl,
        engagement: 0,
        snippet,
      });
    }
  }

  return items.slice(0, 25);
}

// ─── KEYWORD EXTRACTION ─────────────────────────────

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// ─── SENTIMENT ANALYSIS ─────────────────────────────

function analyzeSentiment(text: string): { positive: number; neutral: number; negative: number } {
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;

  for (const word of POSITIVE_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lower.match(re);
    if (matches) pos += matches.length;
  }
  for (const word of NEGATIVE_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lower.match(re);
    if (matches) neg += matches.length;
  }

  const total = pos + neg;
  if (total === 0) return { positive: 0, neutral: 1, negative: 0 };

  return {
    positive: pos / total,
    neutral: 0,
    negative: neg / total,
  };
}

function overallSentiment(scores: { positive: number; neutral: number; negative: number }): 'positive' | 'neutral' | 'negative' {
  if (scores.positive > scores.negative + 0.1) return 'positive';
  if (scores.negative > scores.positive + 0.1) return 'negative';
  return 'neutral';
}

// ─── SYNTHESIS ENGINE ───────────────────────────────

function synthesizePatterns(items: RawItem[]): ResearchResult['patterns'] {
  // Build keyword frequency map across items
  const keywordItems: Map<string, RawItem[]> = new Map();

  for (const item of items) {
    const keywords = extractKeywords(`${item.title} ${item.snippet}`);
    for (const kw of keywords) {
      if (!keywordItems.has(kw)) keywordItems.set(kw, []);
      keywordItems.get(kw)!.push(item);
    }
  }

  // Find keywords that appear across multiple items — these form patterns
  const patternCandidates: Array<{
    keyword: string;
    items: RawItem[];
    platforms: Set<string>;
    totalEngagement: number;
  }> = [];

  for (const [keyword, kwItems] of keywordItems) {
    if (kwItems.length < 2) continue;
    const platforms = new Set(kwItems.map(i => i.platform));
    const totalEngagement = kwItems.reduce((sum, i) => sum + i.engagement, 0);
    patternCandidates.push({ keyword, items: kwItems, platforms, totalEngagement });
  }

  // Sort by: platform diversity first, then total engagement
  patternCandidates.sort((a, b) => {
    const platDiff = b.platforms.size - a.platforms.size;
    if (platDiff !== 0) return platDiff;
    return b.totalEngagement - a.totalEngagement;
  });

  // Deduplicate: skip patterns whose items are already covered
  const usedItemUrls = new Set<string>();
  const patterns: ResearchResult['patterns'] = [];

  for (const candidate of patternCandidates.slice(0, 20)) {
    // Check overlap: if >80% of items already claimed, skip
    const newItems = candidate.items.filter(i => !usedItemUrls.has(i.url));
    if (newItems.length < 1) continue;

    const platformCount = candidate.platforms.size;
    let strength: 'emerging' | 'growing' | 'established';
    if (platformCount >= 3) strength = 'established';
    else if (platformCount === 2) strength = 'growing';
    else strength = 'emerging';

    const evidence = newItems.slice(0, 5).map(i => ({
      platform: i.platform,
      title: i.title,
      url: i.url,
      engagement: i.engagement,
      snippet: i.snippet,
    }));

    for (const item of newItems) usedItemUrls.add(item.url);

    patterns.push({
      pattern: candidate.keyword,
      strength,
      sources: [...candidate.platforms],
      evidence,
    });

    if (patterns.length >= 10) break;
  }

  return patterns;
}

// ─── EXPORTED FUNCTIONS ─────────────────────────────

/**
 * Cross-platform research for a given topic.
 * Scrapes platforms in parallel, synthesizes patterns, and performs sentiment analysis.
 */
export async function researchTopic(
  topic: string,
  platforms: string[],
  days: number,
  country: string,
  proxyFetch: ProxyFetchFn,
): Promise<ResearchResult> {
  const scraperMap: Record<string, (t: string, pf: ProxyFetchFn) => Promise<RawItem[]>> = {
    reddit: scrapeReddit,
    twitter: scrapeTwitter,
    youtube: scrapeYouTube,
    web: scrapeWeb,
  };

  const activePlatforms = platforms.filter(p => p in scraperMap);
  if (activePlatforms.length === 0) {
    throw new Error(`No supported platforms. Supported: ${Object.keys(scraperMap).join(', ')}`);
  }

  // Scrape all platforms in parallel
  const results = await Promise.allSettled(
    activePlatforms.map(p => scraperMap[p](topic, proxyFetch)),
  );

  const allItems: RawItem[] = [];
  const platformsUsed: string[] = [];
  let sourcesChecked = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const platform = activePlatforms[i];
    sourcesChecked++;

    if (result.status === 'fulfilled' && result.value.length > 0) {
      allItems.push(...result.value);
      platformsUsed.push(platform);
      console.log(`[TrendIntel] ${platform}: ${result.value.length} items`);
    } else if (result.status === 'rejected') {
      console.warn(`[TrendIntel] ${platform} failed: ${result.reason?.message || result.reason}`);
    }
  }

  // Synthesize patterns from all collected items
  const patterns = synthesizePatterns(allItems);

  // Sentiment analysis per platform and overall
  const byPlatform: Record<string, { positive: number; neutral: number; negative: number }> = {};
  let allText = '';

  for (const platform of platformsUsed) {
    const platformItems = allItems.filter(i => i.platform === platform);
    const combinedText = platformItems.map(i => `${i.title} ${i.snippet}`).join(' ');
    byPlatform[platform] = analyzeSentiment(combinedText);
    allText += ' ' + combinedText;
  }

  const overallScores = analyzeSentiment(allText);

  // Top discussions: sort by engagement
  const topDiscussions = [...allItems]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10)
    .map(i => ({
      platform: i.platform,
      title: i.title,
      url: i.url,
      engagement: i.engagement,
    }));

  // Emerging topics: find keywords that appear frequently but are not the main topic
  const topicKeywords = new Set(extractKeywords(topic));
  const keywordFreq: Map<string, number> = new Map();

  for (const item of allItems) {
    const keywords = extractKeywords(`${item.title} ${item.snippet}`);
    for (const kw of keywords) {
      if (!topicKeywords.has(kw)) {
        keywordFreq.set(kw, (keywordFreq.get(kw) || 0) + 1);
      }
    }
  }

  const emergingTopics = [...keywordFreq.entries()]
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword]) => keyword);

  return {
    topic,
    timeframe: `${days} days`,
    patterns,
    sentiment: {
      overall: overallSentiment(overallScores),
      by_platform: byPlatform,
    },
    top_discussions: topDiscussions,
    emerging_topics: emergingTopics,
    meta: {
      sources_checked: sourcesChecked,
      platforms_used: platformsUsed,
    },
  };
}

/**
 * Get trending topics across multiple platforms.
 * Fetches each platform's trending/hot page and finds cross-platform overlaps.
 */
export async function getCrossPlatformTrending(
  country: string,
  platforms: string[],
  proxyFetch: ProxyFetchFn,
): Promise<TrendingResult> {
  const trendingScrapers: Record<string, () => Promise<RawItem[]>> = {
    reddit: async () => {
      const url = 'https://old.reddit.com/r/popular/';
      const response = await proxyFetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeoutMs: 30_000,
        maxRetries: 1,
      });
      if (!response.ok) throw new Error(`Reddit popular returned ${response.status}`);
      const html = await response.text();
      const items: RawItem[] = [];

      const postPattern = /<a[^>]*class="[^"]*title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<span[^>]*class="[^"]*score[^"]*"[^>]*>([\s\S]*?)<\/span>)?/gi;
      let match: RegExpExecArray | null;
      while ((match = postPattern.exec(html)) !== null) {
        const title = decodeHtmlEntities(stripTags(match[2]));
        const postUrl = match[1].startsWith('http') ? match[1] : `https://old.reddit.com${match[1]}`;
        const score = match[3] ? parseEngagement(stripTags(match[3])) : 0;
        if (title.length > 5) {
          items.push({ platform: 'reddit', title, url: postUrl, engagement: score, snippet: '' });
        }
      }
      return items.slice(0, 25);
    },

    twitter: async () => {
      const url = 'https://nitter.net/';
      const response = await proxyFetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeoutMs: 30_000,
        maxRetries: 1,
      });
      if (!response.ok) throw new Error(`Nitter trending returned ${response.status}`);
      const html = await response.text();
      const items: RawItem[] = [];

      const trendPattern = /<a[^>]*href="\/search\?q=([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = trendPattern.exec(html)) !== null) {
        const text = decodeHtmlEntities(stripTags(match[2]));
        if (text.length > 2) {
          items.push({
            platform: 'twitter',
            title: text,
            url: `https://nitter.net/search?q=${match[1]}`,
            engagement: 0,
            snippet: '',
          });
        }
      }
      return items.slice(0, 25);
    },

    youtube: async () => {
      const url = `https://www.youtube.com/feed/trending?gl=${country.toUpperCase()}`;
      const response = await proxyFetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
        timeoutMs: 30_000,
        maxRetries: 1,
      });
      if (!response.ok) throw new Error(`YouTube trending returned ${response.status}`);
      const html = await response.text();
      const items: RawItem[] = [];

      const dataMatch = html.match(/var\s+ytInitialData\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (dataMatch) {
        try {
          const data = JSON.parse(dataMatch[1]);
          const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
          for (const tab of tabs) {
            const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
            for (const section of sections) {
              const sectionItems = section?.itemSectionRenderer?.contents || [];
              for (const si of sectionItems) {
                const video = si.videoRenderer;
                if (!video) continue;
                const title = video.title?.runs?.[0]?.text || '';
                const videoId = video.videoId || '';
                const viewText = video.viewCountText?.simpleText || '0';
                if (title && videoId) {
                  items.push({
                    platform: 'youtube',
                    title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    engagement: parseEngagement(viewText.replace(/\s*views?/i, '')),
                    snippet: viewText,
                  });
                }
              }
            }
          }
        } catch {
          // JSON parse failed
        }
      }
      return items.slice(0, 25);
    },

    web: async () => {
      const url = 'https://html.duckduckgo.com/html/?q=trending+today';
      const response = await proxyFetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeoutMs: 30_000,
        maxRetries: 1,
      });
      if (!response.ok) throw new Error(`DuckDuckGo trending returned ${response.status}`);
      const html = await response.text();
      const items: RawItem[] = [];

      const resultPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = resultPattern.exec(html)) !== null) {
        let resultUrl = match[1];
        const title = decodeHtmlEntities(stripTags(match[2]));
        if (resultUrl.includes('uddg=')) {
          const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);
        }
        if (title.length > 3 && resultUrl.startsWith('http')) {
          items.push({ platform: 'web', title, url: resultUrl, engagement: 0, snippet: '' });
        }
      }
      return items.slice(0, 25);
    },
  };

  const activePlatforms = platforms.filter(p => p in trendingScrapers);
  if (activePlatforms.length === 0) {
    throw new Error(`No supported platforms. Supported: ${Object.keys(trendingScrapers).join(', ')}`);
  }

  const results = await Promise.allSettled(
    activePlatforms.map(p => trendingScrapers[p]()),
  );

  const allItems: RawItem[] = [];
  const platformsUsed: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const platform = activePlatforms[i];

    if (result.status === 'fulfilled' && result.value.length > 0) {
      allItems.push(...result.value);
      platformsUsed.push(platform);
      console.log(`[TrendIntel] trending ${platform}: ${result.value.length} items`);
    } else if (result.status === 'rejected') {
      console.warn(`[TrendIntel] trending ${platform} failed: ${result.reason?.message || result.reason}`);
    }
  }

  // Group items by keyword overlap to find cross-platform trends
  const keywordMap: Map<string, { platforms: Set<string>; items: RawItem[] }> = new Map();

  for (const item of allItems) {
    const keywords = extractKeywords(item.title);
    for (const kw of keywords) {
      if (!keywordMap.has(kw)) keywordMap.set(kw, { platforms: new Set(), items: [] });
      const entry = keywordMap.get(kw)!;
      entry.platforms.add(item.platform);
      entry.items.push(item);
    }
  }

  // Prefer keywords appearing on multiple platforms
  const trendCandidates = [...keywordMap.entries()]
    .filter(([_, data]) => data.items.length >= 2)
    .sort((a, b) => {
      const platDiff = b[1].platforms.size - a[1].platforms.size;
      if (platDiff !== 0) return platDiff;
      const engA = a[1].items.reduce((s, i) => s + i.engagement, 0);
      const engB = b[1].items.reduce((s, i) => s + i.engagement, 0);
      return engB - engA;
    });

  // Deduplicate trends
  const usedUrls = new Set<string>();
  const trends: TrendingResult['trends'] = [];

  for (const [keyword, data] of trendCandidates) {
    const newItems = data.items.filter(i => !usedUrls.has(i.url));
    if (newItems.length < 1) continue;

    for (const item of newItems) usedUrls.add(item.url);

    trends.push({
      topic: keyword,
      platforms_trending: [...data.platforms],
      combined_engagement: newItems.reduce((sum, i) => sum + i.engagement, 0),
      urls: newItems.slice(0, 5).map(i => ({ platform: i.platform, url: i.url })),
    });

    if (trends.length >= 20) break;
  }

  return {
    country,
    platforms: platformsUsed,
    trends,
  };
}
