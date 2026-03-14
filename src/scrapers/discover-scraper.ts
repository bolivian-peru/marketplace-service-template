/**
 * Google Discover Feed Intelligence Scraper
 * ──────────────────────────────────────────
 * Monitors Google Discover-style content surfaces using mobile proxies.
 * Extracts trending topics, content clusters, performance signals,
 * and emerging topic patterns from Google's content recommendation feeds.
 *
 * Surfaces scraped:
 * - Google News trending topics
 * - Google Trends real-time & daily trends
 * - Google Discover-eligible content via mobile SERP "Interesting Finds"
 * - Topic entity clustering via Knowledge Graph signals
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';
import type {
  DiscoverFeedItem,
  DiscoverTopicCluster,
  DiscoverPerformanceEstimate,
  DiscoverTrendSignal,
} from '../types';

// ─── MOBILE USER AGENTS (Discover requires mobile) ──

const DISCOVER_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

function getRandomUA(): string {
  return DISCOVER_USER_AGENTS[Math.floor(Math.random() * DISCOVER_USER_AGENTS.length)];
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

// ─── GOOGLE TRENDS SCRAPING ─────────────────────────

/**
 * Fetch real-time trending searches from Google Trends
 */
export async function fetchTrendingSearches(
  country: string = 'US',
  category: string = 'all',
  limit: number = 20,
): Promise<DiscoverTrendSignal[]> {
  const geo = country.toUpperCase();
  const catMap: Record<string, string> = {
    all: '', business: 'b', technology: 't', entertainment: 'e',
    sports: 's', health: 'm', science: 'q', top: 'h',
  };
  const catParam = catMap[category.toLowerCase()] ?? '';

  const url = `https://trends.google.com/trending/rss?geo=${geo}${catParam ? `&cat=${catParam}` : ''}`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Trends RSS returned HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseTrendsRSS(xml, limit);
}

function parseTrendsRSS(xml: string, limit: number): DiscoverTrendSignal[] {
  const signals: DiscoverTrendSignal[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemPattern.exec(xml)) !== null && signals.length < limit) {
    const itemXml = match[1];

    const title = extractXmlTag(itemXml, 'title');
    if (!title) continue;

    const traffic = extractXmlTag(itemXml, 'ht:approx_traffic') || null;
    const pubDate = extractXmlTag(itemXml, 'pubDate') || null;
    const link = extractXmlTag(itemXml, 'link') || null;
    const description = extractXmlTag(itemXml, 'description') || null;

    // Extract related news articles
    const newsItems = extractNewsItems(itemXml);

    // Estimate velocity from traffic string
    const velocity = parseTrafficVolume(traffic);

    signals.push({
      topic: decodeHtmlEntities(title),
      traffic,
      velocity,
      publishedAt: pubDate,
      trendUrl: link,
      description: description ? decodeHtmlEntities(stripTags(description)) : null,
      relatedArticles: newsItems,
      source: 'google_trends',
      detectedAt: new Date().toISOString(),
    });
  }

  return signals;
}

function extractXmlTag(xml: string, tag: string): string | null {
  // Handle CDATA sections
  const cdataPattern = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1].trim();

  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(pattern);
  return match ? match[1].trim() : null;
}

function extractNewsItems(itemXml: string): { title: string; url: string; source: string }[] {
  const articles: { title: string; url: string; source: string }[] = [];
  const newsPattern = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi;
  let match;

  while ((match = newsPattern.exec(itemXml)) !== null) {
    const newsTitle = extractXmlTag(match[1], 'ht:news_item_title');
    const newsUrl = extractXmlTag(match[1], 'ht:news_item_url');
    const newsSource = extractXmlTag(match[1], 'ht:news_item_source');

    if (newsTitle && newsUrl) {
      articles.push({
        title: decodeHtmlEntities(newsTitle),
        url: newsUrl,
        source: newsSource ? decodeHtmlEntities(newsSource) : 'unknown',
      });
    }
  }

  return articles;
}

function parseTrafficVolume(traffic: string | null): number {
  if (!traffic) return 0;
  const cleaned = traffic.replace(/[^0-9KkMm+]/g, '').toUpperCase();
  if (cleaned.includes('M')) return parseFloat(cleaned) * 1_000_000;
  if (cleaned.includes('K')) return parseFloat(cleaned) * 1_000;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// ─── GOOGLE NEWS TOPIC SCRAPING ─────────────────────

/**
 * Scrape Google News for topic-based content (Discover-eligible articles)
 */
export async function scrapeGoogleNewsTopics(
  topic: string,
  country: string = 'US',
  language: string = 'en',
  limit: number = 15,
): Promise<DiscoverFeedItem[]> {
  const params = new URLSearchParams({
    q: topic,
    hl: language,
    gl: country,
    ceid: `${country}:${language}`,
  });

  const url = `https://news.google.com/rss/search?${params.toString()}`;

  const response = await proxyFetch(url, {
    timeoutMs: 30_000,
    maxRetries: 2,
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'application/xml, text/xml, */*',
      'Accept-Language': `${language},en;q=0.9`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google News RSS returned HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseNewsFeed(xml, topic, limit);
}

function parseNewsFeed(xml: string, topic: string, limit: number): DiscoverFeedItem[] {
  const items: DiscoverFeedItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemPattern.exec(xml)) !== null && items.length < limit) {
    const itemXml = match[1];

    const title = extractXmlTag(itemXml, 'title');
    const link = extractXmlTag(itemXml, 'link');
    if (!title || !link) continue;

    const pubDate = extractXmlTag(itemXml, 'pubDate') || null;
    const source = extractXmlTag(itemXml, 'source') || null;
    const description = extractXmlTag(itemXml, 'description') || null;

    // Extract source URL from source tag attributes
    const sourceUrlMatch = itemXml.match(/<source[^>]*url="([^"]+)"[^>]*>/i);
    const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : null;

    // Estimate content freshness score (higher = more recent)
    const freshnessScore = calculateFreshnessScore(pubDate);

    // Estimate Discover eligibility based on content signals
    const eligibilitySignals = estimateDiscoverEligibility(title, description, source);

    items.push({
      title: decodeHtmlEntities(title),
      url: link,
      source: source ? decodeHtmlEntities(source) : null,
      sourceUrl,
      publishedAt: pubDate,
      description: description ? decodeHtmlEntities(stripTags(description)).substring(0, 300) : null,
      topic,
      freshnessScore,
      eligibilitySignals,
    });
  }

  return items;
}

function calculateFreshnessScore(pubDate: string | null): number {
  if (!pubDate) return 0;
  try {
    const published = new Date(pubDate).getTime();
    const now = Date.now();
    const hoursAgo = (now - published) / (1000 * 60 * 60);

    if (hoursAgo < 1) return 100;
    if (hoursAgo < 3) return 90;
    if (hoursAgo < 6) return 80;
    if (hoursAgo < 12) return 70;
    if (hoursAgo < 24) return 60;
    if (hoursAgo < 48) return 40;
    if (hoursAgo < 72) return 20;
    return 10;
  } catch {
    return 0;
  }
}

function estimateDiscoverEligibility(
  title: string,
  description: string | null,
  source: string | null,
): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 50; // Base score

  // Title quality signals
  if (title.length >= 40 && title.length <= 100) {
    score += 10;
    factors.push('optimal_title_length');
  }
  if (/[0-9]/.test(title)) {
    score += 5;
    factors.push('contains_numbers');
  }
  if (/\?$/.test(title)) {
    score += 5;
    factors.push('question_format');
  }

  // Content signals
  if (description && description.length > 100) {
    score += 10;
    factors.push('rich_description');
  }

  // Source authority signals (known high-authority sources)
  const highAuthoritySources = [
    'reuters', 'associated press', 'bbc', 'cnn', 'nyt', 'new york times',
    'washington post', 'bloomberg', 'forbes', 'techcrunch', 'the verge',
    'wired', 'ars technica', 'guardian', 'wsj', 'wall street journal',
  ];
  if (source) {
    const sourceLower = source.toLowerCase();
    if (highAuthoritySources.some(s => sourceLower.includes(s))) {
      score += 15;
      factors.push('high_authority_source');
    }
  }

  // Engagement pattern signals from title
  const engagementPatterns = [
    { pattern: /breaking|exclusive|first look/i, label: 'urgency_signal', points: 5 },
    { pattern: /how to|guide|tutorial|tips/i, label: 'how_to_content', points: 8 },
    { pattern: /best|top \d|worst|vs\b/i, label: 'listicle_format', points: 5 },
    { pattern: /review|hands.?on|tested/i, label: 'review_content', points: 7 },
    { pattern: /announced|launches|reveals|unveils/i, label: 'news_event', points: 10 },
  ];

  for (const { pattern, label, points } of engagementPatterns) {
    if (pattern.test(title)) {
      score += points;
      factors.push(label);
    }
  }

  return { score: Math.min(score, 100), factors };
}

// ─── TOPIC CLUSTERING ───────────────────────────────

/**
 * Cluster feed items by topic similarity using keyword extraction
 */
export function clusterByTopic(items: DiscoverFeedItem[]): DiscoverTopicCluster[] {
  const keywordMap = new Map<string, DiscoverFeedItem[]>();

  for (const item of items) {
    const keywords = extractKeywords(item.title);
    for (const keyword of keywords) {
      const existing = keywordMap.get(keyword) || [];
      existing.push(item);
      keywordMap.set(keyword, existing);
    }
  }

  // Filter to clusters with 2+ articles, sort by size
  const clusters: DiscoverTopicCluster[] = [];
  const usedItems = new Set<string>();

  const sortedKeywords = Array.from(keywordMap.entries())
    .filter(([, items]) => items.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [keyword, clusterItems] of sortedKeywords) {
    // Skip if most items in this cluster are already assigned
    const newItems = clusterItems.filter(i => !usedItems.has(i.url));
    if (newItems.length < 2) continue;

    const allClusterItems = clusterItems;
    for (const item of allClusterItems) {
      usedItems.add(item.url);
    }

    // Calculate cluster metrics
    const avgFreshness = allClusterItems.reduce((sum, i) => sum + i.freshnessScore, 0) / allClusterItems.length;
    const avgEligibility = allClusterItems.reduce((sum, i) => sum + i.eligibilitySignals.score, 0) / allClusterItems.length;

    const sources = [...new Set(allClusterItems.map(i => i.source).filter(Boolean))] as string[];

    // Determine cluster velocity
    let velocity: 'rising' | 'stable' | 'declining' = 'stable';
    if (avgFreshness > 70) velocity = 'rising';
    else if (avgFreshness < 30) velocity = 'declining';

    clusters.push({
      topic: keyword,
      articleCount: allClusterItems.length,
      articles: allClusterItems.map(i => ({
        title: i.title,
        url: i.url,
        source: i.source,
        publishedAt: i.publishedAt,
      })),
      avgFreshnessScore: Math.round(avgFreshness),
      avgEligibilityScore: Math.round(avgEligibility),
      sources,
      velocity,
    });
  }

  return clusters.slice(0, 20);
}

/**
 * Extract meaningful keywords from a title for clustering
 */
function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
    'its', 'it', 'he', 'she', 'they', 'we', 'you', 'what', 'which', 'who',
    'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our',
    'their', 'me', 'him', 'us', 'them', 'new', 'says', 'said', 'gets',
    'got', 'set', 'also', 'one', 'two', 'first', 'last', 'like', 'get',
    'make', 'made', 'know', 'take', 'see', 'come', 'think', 'look', 'want',
    'give', 'use', 'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try',
    'after', 'back', 'over', 'still', 'now', 'even', 'much', 'many',
  ]);

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Also extract bigrams for better clustering
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopWords.has(words[i]) && !stopWords.has(words[i + 1])) {
      bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  // Prefer bigrams and proper nouns (capitalized words in original title)
  const properNouns = title
    .split(/\s+/)
    .filter(w => /^[A-Z][a-z]{2,}/.test(w))
    .map(w => w.toLowerCase())
    .filter(w => !stopWords.has(w));

  return [...new Set([...properNouns, ...bigrams, ...words])].slice(0, 5);
}

// ─── CONTENT PERFORMANCE ESTIMATION ─────────────────

/**
 * Estimate content performance potential for Google Discover
 * Uses multiple signals: topic velocity, source authority, content format
 */
export async function estimateContentPerformance(
  url: string,
  country: string = 'US',
): Promise<DiscoverPerformanceEstimate> {
  // Fetch the page to analyze content signals
  const response = await proxyFetch(url, {
    timeoutMs: 20_000,
    maxRetries: 1,
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Extract content signals
  const title = extractMetaContent(html, 'og:title')
    || extractMetaContent(html, 'title')
    || extractHtmlTitle(html)
    || '';

  const description = extractMetaContent(html, 'og:description')
    || extractMetaContent(html, 'description')
    || '';

  const image = extractMetaContent(html, 'og:image') || null;
  const type = extractMetaContent(html, 'og:type') || 'article';
  const siteName = extractMetaContent(html, 'og:site_name') || extractDomain(url);
  const publishDate = extractMetaContent(html, 'article:published_time')
    || extractMetaContent(html, 'datePublished')
    || null;

  // Check structured data
  const hasStructuredData = /application\/ld\+json/i.test(html);
  const hasAmpVersion = /rel="amphtml"/i.test(html);
  const hasMobileViewport = /name="viewport"/i.test(html);

  // Analyze image quality signals
  const hasLargeImage = image ? true : false;
  const imageWidth = extractMetaContent(html, 'og:image:width');
  const imageOptimal = imageWidth ? parseInt(imageWidth) >= 1200 : false;

  // Calculate scores
  const signals: { factor: string; score: number; weight: number }[] = [];

  // Title analysis
  if (title.length >= 40 && title.length <= 100) {
    signals.push({ factor: 'optimal_title_length', score: 100, weight: 0.12 });
  } else if (title.length > 0) {
    signals.push({ factor: 'title_present', score: 50, weight: 0.12 });
  } else {
    signals.push({ factor: 'missing_title', score: 0, weight: 0.12 });
  }

  // Description
  if (description.length >= 120 && description.length <= 300) {
    signals.push({ factor: 'optimal_description', score: 100, weight: 0.08 });
  } else if (description.length > 0) {
    signals.push({ factor: 'description_present', score: 50, weight: 0.08 });
  } else {
    signals.push({ factor: 'missing_description', score: 0, weight: 0.08 });
  }

  // Image (critical for Discover)
  if (imageOptimal) {
    signals.push({ factor: 'large_compelling_image', score: 100, weight: 0.20 });
  } else if (hasLargeImage) {
    signals.push({ factor: 'image_present', score: 60, weight: 0.20 });
  } else {
    signals.push({ factor: 'missing_image', score: 0, weight: 0.20 });
  }

  // Technical signals
  if (hasStructuredData) {
    signals.push({ factor: 'structured_data', score: 100, weight: 0.10 });
  } else {
    signals.push({ factor: 'no_structured_data', score: 0, weight: 0.10 });
  }

  if (hasAmpVersion) {
    signals.push({ factor: 'amp_available', score: 80, weight: 0.05 });
  }

  if (hasMobileViewport) {
    signals.push({ factor: 'mobile_friendly', score: 100, weight: 0.10 });
  } else {
    signals.push({ factor: 'not_mobile_friendly', score: 0, weight: 0.10 });
  }

  // Content freshness
  const freshness = calculateFreshnessScore(publishDate);
  signals.push({ factor: 'content_freshness', score: freshness, weight: 0.15 });

  // Open Graph completeness
  const ogComplete = [title, description, image, type].filter(Boolean).length;
  signals.push({ factor: 'og_completeness', score: (ogComplete / 4) * 100, weight: 0.10 });

  // E-E-A-T signals
  const hasAuthor = /author|byline/i.test(html);
  const hasAboutPage = /href="[^"]*\/about/i.test(html);
  if (hasAuthor) signals.push({ factor: 'author_attribution', score: 80, weight: 0.05 });
  if (hasAboutPage) signals.push({ factor: 'about_page_linked', score: 70, weight: 0.05 });

  // Calculate weighted score
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedScore = signals.reduce((sum, s) => sum + (s.score * s.weight), 0) / totalWeight;

  // Determine recommendation
  let recommendation: string;
  if (weightedScore >= 80) {
    recommendation = 'High Discover potential. Content meets most quality thresholds.';
  } else if (weightedScore >= 60) {
    recommendation = 'Moderate Discover potential. Address missing signals for improvement.';
  } else if (weightedScore >= 40) {
    recommendation = 'Low Discover potential. Significant optimization needed.';
  } else {
    recommendation = 'Very low Discover potential. Fundamental content signals missing.';
  }

  // Generate improvement suggestions
  const improvements: string[] = [];
  if (!hasLargeImage) improvements.push('Add a high-quality image (1200px+ wide) with og:image tag');
  if (!hasStructuredData) improvements.push('Add JSON-LD structured data (Article or NewsArticle schema)');
  if (!hasMobileViewport) improvements.push('Ensure mobile-responsive design with proper viewport meta tag');
  if (description.length < 120) improvements.push('Write a compelling meta description (120-300 characters)');
  if (title.length < 40 || title.length > 100) improvements.push('Optimize title length (40-100 characters)');
  if (!hasAuthor) improvements.push('Add clear author attribution for E-E-A-T signals');
  if (!imageOptimal && hasLargeImage) improvements.push('Use images at least 1200px wide for Discover cards');

  return {
    url,
    title,
    siteName,
    overallScore: Math.round(weightedScore),
    signals: signals.map(s => ({
      factor: s.factor,
      score: Math.round(s.score),
      weight: s.weight,
    })),
    recommendation,
    improvements,
    metadata: {
      hasStructuredData,
      hasAmpVersion,
      hasMobileViewport,
      hasLargeImage,
      imageOptimal,
      ogComplete: ogComplete === 4,
      publishDate,
      type,
    },
  };
}

function extractMetaContent(html: string, name: string): string | null {
  // Try property= first (Open Graph), then name=
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escapeRegexStr(name)}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${escapeRegexStr(name)}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${escapeRegexStr(name)}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${escapeRegexStr(name)}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1]);
  }

  // Special case for <title> tag
  if (name === 'title') {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) return decodeHtmlEntities(titleMatch[1]);
  }

  return null;
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function escapeRegexStr(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── TRENDING TOPIC DETECTION ───────────────────────

/**
 * Detect emerging/trending topics by combining Google Trends + News signals
 */
export async function detectTrendingTopics(
  country: string = 'US',
  category: string = 'all',
  limit: number = 20,
): Promise<{
  trends: DiscoverTrendSignal[];
  clusters: DiscoverTopicCluster[];
  emergingTopics: string[];
  meta: { totalSignals: number; clusterCount: number; topCategories: string[] };
}> {
  // Fetch trending searches
  const trends = await fetchTrendingSearches(country, category, limit);

  // For top trends, also get news coverage
  const topTopics = trends.slice(0, 5).map(t => t.topic);
  const newsResults = await Promise.allSettled(
    topTopics.map(topic => scrapeGoogleNewsTopics(topic, country, 'en', 5)),
  );

  // Collect all feed items for clustering
  const allItems: DiscoverFeedItem[] = [];
  for (const result of newsResults) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }

  // Cluster the articles
  const clusters = clusterByTopic(allItems);

  // Identify emerging topics (high velocity, recent)
  const emergingTopics = trends
    .filter(t => t.velocity > 10000)
    .map(t => t.topic)
    .slice(0, 10);

  // Extract top categories from clusters
  const topCategories = clusters
    .slice(0, 5)
    .map(c => c.topic);

  return {
    trends,
    clusters,
    emergingTopics,
    meta: {
      totalSignals: trends.length,
      clusterCount: clusters.length,
      topCategories,
    },
  };
}

// ─── DISCOVER FEED MONITORING ───────────────────────

/**
 * Monitor Google Discover-eligible content for a specific topic/niche
 */
export async function monitorDiscoverFeed(
  topics: string[],
  country: string = 'US',
  language: string = 'en',
  limit: number = 10,
): Promise<{
  items: DiscoverFeedItem[];
  clusters: DiscoverTopicCluster[];
  topSources: { source: string; count: number }[];
  avgEligibilityScore: number;
}> {
  // Fetch news for each topic in parallel
  const results = await Promise.allSettled(
    topics.map(topic => scrapeGoogleNewsTopics(topic, country, language, limit)),
  );

  const allItems: DiscoverFeedItem[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set<string>();
  const uniqueItems = allItems.filter(item => {
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });

  // Sort by freshness + eligibility
  uniqueItems.sort((a, b) => {
    const scoreA = a.freshnessScore * 0.4 + a.eligibilitySignals.score * 0.6;
    const scoreB = b.freshnessScore * 0.4 + b.eligibilitySignals.score * 0.6;
    return scoreB - scoreA;
  });

  // Cluster
  const clusters = clusterByTopic(uniqueItems);

  // Top sources
  const sourceCounts = new Map<string, number>();
  for (const item of uniqueItems) {
    if (item.source) {
      sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
    }
  }
  const topSources = Array.from(sourceCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Average eligibility
  const avgEligibilityScore = uniqueItems.length > 0
    ? Math.round(uniqueItems.reduce((sum, i) => sum + i.eligibilitySignals.score, 0) / uniqueItems.length)
    : 0;

  return {
    items: uniqueItems,
    clusters,
    topSources,
    avgEligibilityScore,
  };
}
