import { proxyFetch } from './proxy';

// ─── Trend Intelligence Cross-Platform Research ───
// Aggregates Reddit + X/Twitter + YouTube and synthesizes patterns

interface TrendPattern {
  pattern: string;
  strength: 'established' | 'reinforced' | 'emerging';
  sources: string[];
  evidence: Array<{ platform: string; title?: string; text?: string; url: string; score?: number; likes?: number; views?: number }>;
}

interface TrendSentiment {
  overall: 'positive' | 'negative' | 'neutral' | 'mixed';
  by_platform: Record<string, { positive: number; neutral: number; negative: number }>;
}

interface TrendReport {
  topic: string;
  timeframe: string;
  patterns: TrendPattern[];
  sentiment: TrendSentiment;
  top_discussions: Array<{ platform: string; title: string; url: string; engagement: number }>;
  emerging_topics: string[];
  sources_checked: number;
}

const YOUTUBE_SEARCH_URL = 'https://www.youtube.com/results';

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';

function simpleSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();
  const posWords = ['great', 'amazing', 'love', 'excellent', 'best', 'awesome', 'fantastic', 'good', 'perfect', 'impressive', 'better', 'improved', 'excited', 'brilliant', 'wonderful', 'recommend', 'helpful'];
  const negWords = ['terrible', 'worst', 'hate', 'awful', 'bad', 'horrible', 'broken', 'useless', 'disappointing', 'failed', 'poor', 'worse', 'annoying', 'frustrating', 'scam', 'overrated', 'waste'];
  let pos = 0, neg = 0;
  for (const w of posWords) if (lower.includes(w)) pos++;
  for (const w of negWords) if (lower.includes(w)) neg++;
  if (pos > neg + 1) return 'positive';
  if (neg > pos + 1) return 'negative';
  if (pos > 0 && neg > 0) return 'neutral';
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}

async function scrapeRedditTrend(topic: string): Promise<Array<{ title: string; url: string; score: number; subreddit: string; comments: number; text: string }>> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=relevance&t=month&limit=25`;
  try {
    const resp = await proxyFetch(url, { headers: { 'User-Agent': MOBILE_UA } });
    const data = await resp.json() as any;
    const posts = data?.data?.children || [];
    return posts.map((p: any) => ({
      title: p.data?.title || '',
      url: `https://reddit.com${p.data?.permalink || ''}`,
      score: p.data?.score || 0,
      subreddit: p.data?.subreddit || '',
      comments: p.data?.num_comments || 0,
      text: (p.data?.selftext || '').substring(0, 200)
    }));
  } catch { return []; }
}

async function scrapeTwitterTrend(topic: string): Promise<Array<{ text: string; url: string; likes: number; retweets: number; author: string }>> {
  // Twitter guest search via mobile proxy
  try {
    // Get guest token
    const tokenResp = await proxyFetch('https://api.twitter.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA' }
    });
    const tokenData = await tokenResp.json() as any;
    const guestToken = tokenData?.guest_token;
    if (!guestToken) return [];

    const searchResp = await proxyFetch(`https://api.twitter.com/1.1/search/tweets.json?q=${encodeURIComponent(topic)}&result_type=popular&count=20`, {
      headers: {
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'X-Guest-Token': guestToken,
        'User-Agent': MOBILE_UA
      }
    });
    const searchData = await searchResp.json() as any;
    const tweets = searchData?.statuses || [];
    return tweets.map((t: any) => ({
      text: t.text || t.full_text || '',
      url: `https://twitter.com/${t.user?.screen_name}/status/${t.id_str}`,
      likes: t.favorite_count || 0,
      retweets: t.retweet_count || 0,
      author: `@${t.user?.screen_name || 'unknown'}`
    }));
  } catch { return []; }
}

async function scrapeYouTubeTrend(topic: string): Promise<Array<{ title: string; url: string; views: string; channel: string; published: string }>> {
  try {
    const resp = await proxyFetch(`${YOUTUBE_SEARCH_URL}?search_query=${encodeURIComponent(topic)}&sp=CAI%253D`, {
      headers: { 'User-Agent': MOBILE_UA }
    });
    const html = await resp.text();
    const results: Array<{ title: string; url: string; views: string; channel: string; published: string }> = [];

    // Extract from ytInitialData
    const initData = html.match(/var ytInitialData = ({.*?});/s);
    if (initData) {
      try {
        const data = JSON.parse(initData[1]);
        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
        for (const item of contents.slice(0, 15)) {
          const video = item?.videoRenderer;
          if (!video) continue;
          results.push({
            title: video.title?.runs?.[0]?.text || '',
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
            views: video.viewCountText?.simpleText || video.shortViewCountText?.simpleText || '0',
            channel: video.ownerText?.runs?.[0]?.text || '',
            published: video.publishedTimeText?.simpleText || ''
          });
        }
      } catch {}
    }
    return results;
  } catch { return []; }
}

function detectPatterns(redditPosts: any[], tweetResults: any[], ytResults: any[], topic: string): TrendPattern[] {
  const patterns: TrendPattern[] = [];

  // Cross-platform pattern: topic appears on multiple platforms with engagement
  const platformCount = [redditPosts.length > 0, tweetResults.length > 0, ytResults.length > 0].filter(Boolean).length;

  if (platformCount >= 3) {
    const evidence: TrendPattern['evidence'] = [];
    if (redditPosts[0]) evidence.push({ platform: 'reddit', title: redditPosts[0].title, url: redditPosts[0].url, score: redditPosts[0].score });
    if (tweetResults[0]) evidence.push({ platform: 'x', text: tweetResults[0].text?.substring(0, 140), url: tweetResults[0].url, likes: tweetResults[0].likes });
    if (ytResults[0]) evidence.push({ platform: 'youtube', title: ytResults[0].title, url: ytResults[0].url, views: parseInt(ytResults[0].views?.replace(/[^0-9]/g, '') || '0') });

    patterns.push({ pattern: `"${topic}" is actively discussed across all platforms`, strength: 'established', sources: ['reddit', 'x', 'youtube'], evidence });
  } else if (platformCount === 2) {
    patterns.push({ pattern: `"${topic}" discussion present on ${platformCount} platforms`, strength: 'reinforced', sources: redditPosts.length > 0 ? ['reddit'] : [].concat(tweetResults.length > 0 ? ['x'] as any : []).concat(ytResults.length > 0 ? ['youtube'] as any : []), evidence: [] });
  }

  // High-engagement posts
  const hotReddit = redditPosts.filter(p => p.score > 100);
  if (hotReddit.length > 3) {
    patterns.push({ pattern: `Strong Reddit engagement — ${hotReddit.length} posts with 100+ upvotes`, strength: hotReddit.length > 5 ? 'established' : 'reinforced', sources: ['reddit'], evidence: hotReddit.slice(0, 3).map(p => ({ platform: 'reddit', title: p.title, url: p.url, score: p.score })) });
  }

  // Viral tweets
  const viralTweets = tweetResults.filter((t: any) => t.likes > 50 || t.retweets > 20);
  if (viralTweets.length > 2) {
    patterns.push({ pattern: `Viral X/Twitter discussion — ${viralTweets.length} high-engagement tweets`, strength: viralTweets.length > 5 ? 'established' : 'emerging', sources: ['x'], evidence: viralTweets.slice(0, 3).map((t: any) => ({ platform: 'x', text: t.text?.substring(0, 140), url: t.url, likes: t.likes })) });
  }

  return patterns;
}

export async function researchTopic(topic: string, platforms: string[] = ['reddit', 'x', 'youtube'], days: number = 30): Promise<TrendReport> {
  // Parallel scraping across platforms
  const [redditPosts, tweetResults, ytResults] = await Promise.all([
    platforms.includes('reddit') ? scrapeRedditTrend(topic) : Promise.resolve([]),
    platforms.includes('x') ? scrapeTwitterTrend(topic) : Promise.resolve([]),
    platforms.includes('youtube') ? scrapeYouTubeTrend(topic) : Promise.resolve([]),
  ]);

  // Sentiment analysis
  const allTexts: Array<{ text: string; platform: string }> = [];
  for (const p of redditPosts) allTexts.push({ text: `${p.title} ${p.text}`, platform: 'reddit' });
  for (const t of tweetResults) allTexts.push({ text: t.text, platform: 'x' });
  for (const y of ytResults) allTexts.push({ text: y.title, platform: 'youtube' });

  const sentimentByPlatform: Record<string, { positive: number; neutral: number; negative: number }> = {};
  for (const { text, platform } of allTexts) {
    if (!sentimentByPlatform[platform]) sentimentByPlatform[platform] = { positive: 0, neutral: 0, negative: 0 };
    const s = simpleSentiment(text);
    sentimentByPlatform[platform][s]++;
  }

  // Normalize to percentages
  for (const p of Object.keys(sentimentByPlatform)) {
    const total = sentimentByPlatform[p].positive + sentimentByPlatform[p].neutral + sentimentByPlatform[p].negative;
    if (total > 0) {
      sentimentByPlatform[p].positive = Math.round((sentimentByPlatform[p].positive / total) * 100);
      sentimentByPlatform[p].neutral = Math.round((sentimentByPlatform[p].neutral / total) * 100);
      sentimentByPlatform[p].negative = 100 - sentimentByPlatform[p].positive - sentimentByPlatform[p].neutral;
    }
  }

  const allPos = Object.values(sentimentByPlatform).reduce((s, v) => s + v.positive, 0);
  const allNeg = Object.values(sentimentByPlatform).reduce((s, v) => s + v.negative, 0);
  const overall = allPos > allNeg * 1.5 ? 'positive' : allNeg > allPos * 1.5 ? 'negative' : allPos > 0 && allNeg > 0 ? 'mixed' : 'neutral';

  // Top discussions
  const topDiscussions = [
    ...redditPosts.map(p => ({ platform: 'reddit', title: p.title, url: p.url, engagement: p.score + p.comments })),
    ...tweetResults.map((t: any) => ({ platform: 'x', title: t.text?.substring(0, 80), url: t.url, engagement: t.likes + t.retweets })),
    ...ytResults.map(y => ({ platform: 'youtube', title: y.title, url: y.url, engagement: parseInt(y.views?.replace(/[^0-9]/g, '') || '0') })),
  ].sort((a, b) => b.engagement - a.engagement).slice(0, 10);

  // Patterns
  const patterns = detectPatterns(redditPosts, tweetResults, ytResults, topic);

  // Emerging topics from subreddit diversity
  const subreddits = [...new Set(redditPosts.map(p => p.subreddit))];

  return {
    topic, timeframe: `last ${days} days`,
    patterns,
    sentiment: { overall: overall as any, by_platform: sentimentByPlatform },
    top_discussions: topDiscussions,
    emerging_topics: subreddits.slice(0, 5).map(s => `r/${s}`),
    sources_checked: redditPosts.length + tweetResults.length + ytResults.length
  };
}

export async function getTrending(country: string = 'US', platforms: string[] = ['reddit', 'x']): Promise<any> {
  // Get trending topics from each platform
  const trending: any[] = [];

  if (platforms.includes('reddit')) {
    try {
      const resp = await proxyFetch('https://www.reddit.com/r/popular.json?limit=10', { headers: { 'User-Agent': MOBILE_UA } });
      const data = await resp.json() as any;
      for (const post of (data?.data?.children || []).slice(0, 10)) {
        trending.push({ platform: 'reddit', title: post.data?.title, subreddit: post.data?.subreddit, score: post.data?.score, url: `https://reddit.com${post.data?.permalink}` });
      }
    } catch {}
  }

  if (platforms.includes('x')) {
    try {
      const tokenResp = await proxyFetch('https://api.twitter.com/1.1/guest/activate.json', { method: 'POST', headers: { 'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA' } });
      const tokenData = await tokenResp.json() as any;
      const gt = tokenData?.guest_token;
      if (gt) {
        const trendResp = await proxyFetch(`https://api.twitter.com/1.1/trends/place.json?id=1`, { headers: { 'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA', 'X-Guest-Token': gt } });
        const trendData = await trendResp.json() as any;
        for (const t of (trendData?.[0]?.trends || []).slice(0, 10)) {
          trending.push({ platform: 'x', name: t.name, tweet_volume: t.tweet_volume, url: t.url });
        }
      }
    } catch {}
  }

  return { country, platforms, trending, timestamp: new Date().toISOString() };
}
