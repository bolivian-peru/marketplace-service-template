// src/sentiment.ts
// Social sentiment aggregation for prediction markets (Twitter + Reddit).

import { aggregateSentiment } from './analysis/sentiment';
import { searchTwitter, type TwitterResult } from './scrapers/twitter';
import { searchReddit, type RedditPost } from './scrapers/reddit';

export interface PlatformSentimentSummary {
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  trending: boolean;
  topSamples: Array<{ text: string; url?: string | null }>;
}

export interface SocialSentimentSnapshot {
  type: 'sentiment';
  topic: string;
  country: string;
  timestamp: string;
  twitter?: PlatformSentimentSummary;
  reddit?: PlatformSentimentSummary;
}

const MAX_TWEETS = 40;
const MAX_REDDIT_POSTS = 50;

function pickTopTexts<T extends { text?: string; url?: string }>(
  items: T[],
  limit: number,
): Array<{ text: string; url?: string | null }> {
  const result: Array<{ text: string; url?: string | null }> = [];
  for (const item of items) {
    if (result.length >= limit) break;
    const raw = (item as any).text ?? '';
    if (typeof raw !== 'string') continue;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    result.push({ text: text.slice(0, 280), url: (item as any).url ?? null });
  }
  return result;
}

export async function getSocialSentiment(
  topic: string,
  country: string = 'US',
): Promise<SocialSentimentSnapshot> {
  const safeTopic = topic.trim().slice(0, 200);
  const safeCountry = country.trim().toUpperCase().slice(0, 2) || 'US';
  const now = new Date().toISOString();

  const [tweets, redditPosts] = await Promise.all<[
    TwitterResult[] | null,
    RedditPost[] | null,
  ]>([
    searchTwitter(safeTopic, 3, MAX_TWEETS).catch(() => null),
    searchReddit(safeTopic, 7, MAX_REDDIT_POSTS).catch(() => null),
  ]);

  let twitterSummary: PlatformSentimentSummary | undefined;
  if (tweets && tweets.length > 0) {
    const texts = tweets.map((t) => t.text.slice(0, 280));
    const sentiment = aggregateSentiment(texts);
    twitterSummary = {
      positive: sentiment.positive,
      negative: sentiment.negative,
      neutral: sentiment.neutral,
      volume: tweets.length,
      trending: true,
      topSamples: pickTopTexts(tweets, 5),
    };
  }

  let redditSummary: PlatformSentimentSummary | undefined;
  if (redditPosts && redditPosts.length > 0) {
    const texts = redditPosts.map((p) => `${p.title.slice(0, 200)} ${p.selftext.slice(0, 300)}`);
    const sentiment = aggregateSentiment(texts);
    redditSummary = {
      positive: sentiment.positive,
      negative: sentiment.negative,
      neutral: sentiment.neutral,
      volume: redditPosts.length,
      trending: false,
      topSamples: pickTopTexts(
        redditPosts.map((p) => ({ text: `${p.title} – ${p.selftext}`, url: p.permalink })),
        5,
      ),
    };
  }

  return {
    type: 'sentiment',
    topic: safeTopic,
    country: safeCountry,
    timestamp: now,
    twitter: twitterSummary,
    reddit: redditSummary,
  };
}
