/**
 * Instagram Intelligence + AI Vision Analysis API (Bounty #71)
 * Scrapes Instagram profiles/posts via mobile proxy + AI vision analysis.
 */

import { proxyFetch } from '../proxy';

// ─── Types ──────────────────────────────────────────

export interface InstagramProfile {
  username: string; full_name: string; bio: string; profile_pic_url: string;
  followers: number; following: number; posts_count: number;
  is_verified: boolean; is_business: boolean; is_private: boolean;
  category: string | null; external_url: string | null;
  engagement_rate: number; avg_likes: number; avg_comments: number;
  posting_frequency: string;
}

export interface InstagramPost {
  id: string; shortcode: string; type: 'image' | 'video' | 'carousel';
  caption: string; likes: number; comments: number;
  timestamp: string; image_url: string; video_url: string | null;
  is_sponsored: boolean; hashtags: string[];
}

export interface ContentThemes {
  top_themes: string[]; style: string;
  aesthetic_consistency: string; brand_safety_score: number;
}

export interface AccountTypeAnalysis {
  primary: string; niche: string; confidence: number;
  sub_niches: string[]; signals: string[];
}

export interface SentimentAnalysis {
  overall: string;
  breakdown: { positive: number; neutral: number; negative: number };
  emotional_themes: string[]; brand_alignment: string[];
}

export interface AuthenticityAnalysis {
  score: number; verdict: string;
  face_consistency: boolean | string; engagement_pattern: string;
  follower_quality: string; comment_analysis: string;
  fake_signals: Record<string, any>;
}

export interface AIAnalysis {
  account_type: AccountTypeAnalysis; content_themes: ContentThemes;
  sentiment: SentimentAnalysis; authenticity: AuthenticityAnalysis;
  images_analyzed: number; model_used: string;
  recommendations: { good_for_brands: string[]; estimated_post_value: string; risk_level: string };
}

export interface FullAnalysis { profile: InstagramProfile; posts: InstagramPost[]; ai_analysis: AIAnalysis; }

// ─── Helpers ────────────────────────────────────────

function cleanText(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([a-zA-Z0-9_]+)/g)].map(m => m[1]).slice(0, 30);
}

function calcEngagement(posts: InstagramPost[], followers: number): { rate: number; avgLikes: number; avgComments: number } {
  if (!posts.length || !followers) return { rate: 0, avgLikes: 0, avgComments: 0 };
  const avgL = posts.reduce((s, p) => s + p.likes, 0) / posts.length;
  const avgC = posts.reduce((s, p) => s + p.comments, 0) / posts.length;
  return { rate: Math.round(((avgL + avgC) / followers) * 10000) / 100, avgLikes: Math.round(avgL), avgComments: Math.round(avgC) };
}

function calcPostFreq(posts: InstagramPost[]): string {
  if (posts.length < 2) return 'unknown';
  const sorted = posts.map(p => new Date(p.timestamp).getTime()).sort((a, b) => b - a);
  const spanDays = (sorted[0] - sorted[sorted.length - 1]) / 86400000;
  if (spanDays < 1) return `${posts.length} posts/day`;
  const perWeek = Math.round((posts.length / spanDays) * 7 * 10) / 10;
  return `${perWeek} posts/week`;
}

// ─── Instagram Fetch ────────────────────────────────

async function fetchInstagramPage(url: string): Promise<string> {
  const r = await proxyFetch(url, { maxRetries: 2, timeoutMs: 25000, headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }});
  if (!r.ok) {
    if (r.status === 404) throw new Error('Profile not found');
    if (r.status === 429) throw new Error('Rate limited by Instagram');
    throw new Error(`Instagram returned ${r.status}`);
  }
  const html = await r.text();
  if (html.includes('login') && html.includes('password') && !html.includes('ProfilePage'))
    throw new Error('Instagram requires login — proxy IP may be flagged');
  return html;
}

async function fetchInstagramJSON(username: string): Promise<any> {
  // Try the web profile info endpoint (works on mobile user agents)
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const r = await proxyFetch(url, { maxRetries: 2, timeoutMs: 20000, headers: {
    'X-IG-App-ID': '936619743392459',
    'X-ASBD-ID': '198387', 'X-IG-WWW-Claim': '0',
    'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }});
  if (!r.ok) throw new Error(`Instagram API returned ${r.status}`);
  return r.json();
}

// ─── Profile Extraction ─────────────────────────────

function extractProfileFromSharedData(html: string): any | null {
  // Method 1: window._sharedData
  const sdM = html.match(/window\._sharedData\s*=\s*({[\s\S]*?})\s*;\s*<\/script>/);
  if (sdM) {
    try { const d = JSON.parse(sdM[1]); return d?.entry_data?.ProfilePage?.[0]?.graphql?.user; } catch {}
  }
  // Method 2: __additionalDataLoaded
  const adM = html.match(/__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*({[\s\S]*?})\s*\)\s*;/);
  if (adM) {
    try { const d = JSON.parse(adM[1]); return d?.graphql?.user || d?.user; } catch {}
  }
  // Method 3: embedded JSON relay
  for (const m of html.matchAll(/<script[^>]*>({[\s\S]*?"ProfilePage"[\s\S]*?})<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      const user = d?.require?.flatMap((r: any) => r?.[3] || [])
        ?.find((a: any) => a?.__bbox?.result?.data?.user)
        ?.__bbox?.result?.data?.user;
      if (user) return user;
    } catch {}
  }
  return null;
}

export async function getProfile(username: string): Promise<InstagramProfile> {
  let userData: any = null;
  
  // Try JSON API first
  try {
    const json = await fetchInstagramJSON(username);
    userData = json?.data?.user || json?.graphql?.user;
  } catch {}

  // Fallback to HTML scraping
  if (!userData) {
    const html = await fetchInstagramPage(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    userData = extractProfileFromSharedData(html);
  }
  
  if (!userData) throw new Error('Could not extract profile data');
  
  const edges = userData.edge_owner_to_timeline_media?.edges || [];
  const posts = edges.slice(0, 12).map((e: any) => edgeToPost(e.node));
  const eng = calcEngagement(posts, userData.edge_followed_by?.count || 0);
  
  return {
    username: userData.username || username,
    full_name: userData.full_name || '',
    bio: userData.biography || '',
    profile_pic_url: userData.profile_pic_url_hd || userData.profile_pic_url || '',
    followers: userData.edge_followed_by?.count || 0,
    following: userData.edge_follow?.count || 0,
    posts_count: userData.edge_owner_to_timeline_media?.count || 0,
    is_verified: userData.is_verified || false,
    is_business: userData.is_business_account || false,
    is_private: userData.is_private || false,
    category: userData.category_name || userData.business_category_name || null,
    external_url: userData.external_url || null,
    engagement_rate: eng.rate, avg_likes: eng.avgLikes, avg_comments: eng.avgComments,
    posting_frequency: calcPostFreq(posts),
  };
}

// ─── Posts Extraction ───────────────────────────────

function edgeToPost(node: any): InstagramPost {
  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
  return {
    id: node.id || '', shortcode: node.shortcode || '',
    type: node.__typename === 'GraphVideo' ? 'video' : node.__typename === 'GraphSidecar' ? 'carousel' : 'image',
    caption, likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
    comments: node.edge_media_to_comment?.count || node.edge_media_preview_comment?.count || 0,
    timestamp: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : '',
    image_url: node.display_url || node.thumbnail_src || '',
    video_url: node.video_url || null,
    is_sponsored: node.is_ad || (caption.toLowerCase().includes('#ad') || caption.toLowerCase().includes('#sponsored')),
    hashtags: extractHashtags(caption),
  };
}

export async function getPosts(username: string, limit: number = 12): Promise<InstagramPost[]> {
  let userData: any = null;
  try {
    const json = await fetchInstagramJSON(username);
    userData = json?.data?.user || json?.graphql?.user;
  } catch {}
  if (!userData) {
    const html = await fetchInstagramPage(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    userData = extractProfileFromSharedData(html);
  }
  if (!userData) throw new Error('Could not extract posts');
  const edges = userData.edge_owner_to_timeline_media?.edges || [];
  return edges.slice(0, limit).map((e: any) => edgeToPost(e.node));
}

// ─── AI Vision Analysis ─────────────────────────────

const VISION_PROMPT = `Analyze these Instagram post images from a single account. Return a JSON object with:
1. "account_type": { "primary": one of "influencer"/"business"/"personal"/"bot_fake"/"meme_page"/"news_media", "niche": string, "confidence": 0-1, "sub_niches": string[], "signals": string[] }
2. "content_themes": { "top_themes": string[] (up to 5), "style": string (e.g. "professional_photography", "casual_mobile", "graphic_design"), "aesthetic_consistency": "high"/"medium"/"low", "brand_safety_score": 0-100 }
3. "sentiment": { "overall": "positive"/"neutral"/"negative"/"mixed", "breakdown": { "positive": %, "neutral": %, "negative": % }, "emotional_themes": string[], "brand_alignment": string[] }
4. "authenticity": { "score": 0-100, "verdict": "authentic"/"likely_authentic"/"suspicious"/"likely_fake", "face_consistency": "same_person"/"multiple_people"/"no_faces"/"stock_photos", "engagement_pattern": "organic"/"suspicious"/"bot_like" }
5. "recommendations": { "good_for_brands": string[], "estimated_post_value": string (e.g. "$500-800"), "risk_level": "low"/"medium"/"high" }
Return ONLY valid JSON, no markdown.`;

async function analyzeWithVision(imageUrls: string[], captions: string[], profileSummary: string): Promise<any> {
  // Try OpenAI GPT-4o first, then Claude
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  
  if (openaiKey) {
    return analyzeOpenAI(openaiKey, imageUrls, captions, profileSummary);
  } else if (anthropicKey) {
    return analyzeClaude(anthropicKey, imageUrls, captions, profileSummary);
  }
  // Fallback: heuristic analysis without vision model
  return heuristicAnalysis(captions, profileSummary);
}

async function analyzeOpenAI(apiKey: string, imageUrls: string[], captions: string[], profileSummary: string): Promise<any> {
  const content: any[] = [
    { type: 'text', text: `${VISION_PROMPT}\n\nProfile: ${profileSummary}\n\nCaptions:\n${captions.map((c, i) => `${i + 1}. ${c.slice(0, 200)}`).join('\n')}` },
  ];
  // Include up to 6 images to keep costs reasonable
  for (const url of imageUrls.slice(0, 6)) {
    content.push({ type: 'image_url', image_url: { url, detail: 'low' } });
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content }], max_tokens: 1500, temperature: 0.3 }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  try { return { ...JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()), model_used: 'gpt-4o' }; }
  catch { return { ...heuristicAnalysis(captions, profileSummary), model_used: 'gpt-4o-fallback' }; }
}

async function analyzeClaude(apiKey: string, imageUrls: string[], captions: string[], profileSummary: string): Promise<any> {
  // Download images and convert to base64 for Claude
  const imageContent: any[] = [];
  for (const url of imageUrls.slice(0, 6)) {
    try {
      const r = await fetch(url); if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      const b64 = Buffer.from(buf).toString('base64');
      const ct = r.headers.get('content-type') || 'image/jpeg';
      imageContent.push({ type: 'image', source: { type: 'base64', media_type: ct, data: b64 } });
    } catch {}
  }
  const content: any[] = [
    ...imageContent,
    { type: 'text', text: `${VISION_PROMPT}\n\nProfile: ${profileSummary}\n\nCaptions:\n${captions.map((c, i) => `${i + 1}. ${c.slice(0, 200)}`).join('\n')}` },
  ];
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1500, messages: [{ role: 'user', content }] }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status}`);
  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  try { return { ...JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()), model_used: 'claude-sonnet-4-5' }; }
  catch { return { ...heuristicAnalysis(captions, profileSummary), model_used: 'claude-fallback' }; }
}

function heuristicAnalysis(captions: string[], profileSummary: string): any {
  const allText = (captions.join(' ') + ' ' + profileSummary).toLowerCase();
  const themes: string[] = [];
  const themeMap: Record<string, string[]> = {
    travel: ['travel', 'wanderlust', 'explore', 'adventure', 'destination', 'vacation'],
    food: ['food', 'recipe', 'cooking', 'restaurant', 'delicious', 'foodie'],
    fashion: ['fashion', 'style', 'outfit', 'wear', 'clothing', 'ootd'],
    fitness: ['fitness', 'workout', 'gym', 'health', 'training', 'exercise'],
    tech: ['tech', 'coding', 'developer', 'software', 'startup', 'ai'],
    beauty: ['beauty', 'makeup', 'skincare', 'cosmetics', 'glow'],
    lifestyle: ['lifestyle', 'life', 'daily', 'routine', 'morning'],
    photography: ['photography', 'photo', 'camera', 'canon', 'nikon', 'lens'],
    business: ['business', 'entrepreneur', 'ceo', 'founder', 'startup'],
    music: ['music', 'song', 'album', 'concert', 'artist'],
  };
  for (const [theme, keywords] of Object.entries(themeMap)) {
    if (keywords.some(k => allText.includes(k))) themes.push(theme);
  }
  if (!themes.length) themes.push('general');

  const hashtagCount = captions.reduce((s, c) => s + (c.match(/#/g) || []).length, 0);
  const avgHashtags = hashtagCount / Math.max(captions.length, 1);
  const hasAds = captions.some(c => /#(ad|sponsored|partner|collab)\b/i.test(c));
  const isBot = avgHashtags > 20 || allText.includes('follow for follow') || allText.includes('f4f');

  let accountType = 'personal';
  if (isBot) accountType = 'bot_fake';
  else if (hasAds || profileSummary.includes('business')) accountType = allText.includes('brand') ? 'business' : 'influencer';

  return {
    account_type: { primary: accountType, niche: themes[0], confidence: 0.6, sub_niches: themes.slice(1, 4), signals: ['heuristic_analysis'] },
    content_themes: { top_themes: themes.slice(0, 5), style: 'unknown', aesthetic_consistency: 'unknown', brand_safety_score: isBot ? 20 : 75 },
    sentiment: { overall: 'neutral', breakdown: { positive: 50, neutral: 40, negative: 10 }, emotional_themes: [], brand_alignment: themes.slice(0, 3) },
    authenticity: { score: isBot ? 15 : 70, verdict: isBot ? 'likely_fake' : 'likely_authentic', face_consistency: 'unknown', engagement_pattern: 'unknown', follower_quality: 'unknown', comment_analysis: 'unknown', fake_signals: { heuristic_only: true } },
    recommendations: { good_for_brands: themes.slice(0, 3), estimated_post_value: 'unknown', risk_level: isBot ? 'high' : 'medium' },
    model_used: 'heuristic',
  };
}

// ─── Full Analysis ──────────────────────────────────

export async function analyzeProfile(username: string): Promise<FullAnalysis> {
  const profile = await getProfile(username);
  const posts = await getPosts(username, 12);
  const imageUrls = posts.filter(p => p.image_url).map(p => p.image_url);
  const captions = posts.map(p => p.caption);
  const profileSummary = `@${profile.username} | ${profile.full_name} | ${profile.followers} followers | ${profile.following} following | ${profile.posts_count} posts | Bio: ${profile.bio} | Category: ${profile.category || 'none'} | Verified: ${profile.is_verified} | Business: ${profile.is_business}`;
  
  const raw = await analyzeWithVision(imageUrls, captions, profileSummary);
  
  return {
    profile,
    posts,
    ai_analysis: {
      account_type: raw.account_type || { primary: 'unknown', niche: 'unknown', confidence: 0, sub_niches: [], signals: [] },
      content_themes: raw.content_themes || { top_themes: [], style: 'unknown', aesthetic_consistency: 'unknown', brand_safety_score: 0 },
      sentiment: raw.sentiment || { overall: 'neutral', breakdown: { positive: 33, neutral: 34, negative: 33 }, emotional_themes: [], brand_alignment: [] },
      authenticity: raw.authenticity || { score: 0, verdict: 'unknown', face_consistency: 'unknown', engagement_pattern: 'unknown', follower_quality: 'unknown', comment_analysis: 'unknown', fake_signals: {} },
      images_analyzed: imageUrls.length,
      model_used: raw.model_used || 'unknown',
      recommendations: raw.recommendations || { good_for_brands: [], estimated_post_value: 'unknown', risk_level: 'unknown' },
    },
  };
}

export async function analyzeImages(username: string): Promise<{ images_analyzed: number; analysis: any }> {
  const posts = await getPosts(username, 12);
  const imageUrls = posts.filter(p => p.image_url).map(p => p.image_url);
  const captions = posts.map(p => p.caption);
  const raw = await analyzeWithVision(imageUrls, captions, `@${username}`);
  return { images_analyzed: imageUrls.length, analysis: raw };
}

export async function auditProfile(username: string): Promise<{ profile: InstagramProfile; authenticity: AuthenticityAnalysis }> {
  const full = await analyzeProfile(username);
  return { profile: full.profile, authenticity: full.ai_analysis.authenticity };
}

// ─── Hashtag Trend Analysis ────────────────────────

export interface HashtagTrend {
  hashtag: string;
  count: number;
  avg_likes: number;
  avg_comments: number;
  engagement_rate: number;
  sample_posts: { shortcode: string; likes: number; comments: number }[];
}

export interface HashtagAnalysis {
  username: string;
  total_posts_analyzed: number;
  total_unique_hashtags: number;
  top_hashtags: HashtagTrend[];
  hashtag_categories: Record<string, string[]>;
  optimal_hashtag_count: number;
  recommendations: string[];
}

export async function analyzeHashtags(username: string, limit: number = 12): Promise<HashtagAnalysis> {
  const profile = await getProfile(username);
  const posts = await getPosts(username, limit);

  const hashtagMap = new Map<string, { count: number; likes: number[]; comments: number[]; posts: { shortcode: string; likes: number; comments: number }[] }>();

  for (const post of posts) {
    for (const tag of post.hashtags) {
      const lower = tag.toLowerCase();
      if (!hashtagMap.has(lower)) {
        hashtagMap.set(lower, { count: 0, likes: [], comments: [], posts: [] });
      }
      const entry = hashtagMap.get(lower)!;
      entry.count++;
      entry.likes.push(post.likes);
      entry.comments.push(post.comments);
      entry.posts.push({ shortcode: post.shortcode, likes: post.likes, comments: post.comments });
    }
  }

  const trends: HashtagTrend[] = [...hashtagMap.entries()]
    .map(([hashtag, data]) => {
      const avgLikes = Math.round(data.likes.reduce((a, b) => a + b, 0) / data.likes.length);
      const avgComments = Math.round(data.comments.reduce((a, b) => a + b, 0) / data.comments.length);
      return {
        hashtag,
        count: data.count,
        avg_likes: avgLikes,
        avg_comments: avgComments,
        engagement_rate: profile.followers > 0 ? Math.round(((avgLikes + avgComments) / profile.followers) * 10000) / 100 : 0,
        sample_posts: data.posts.slice(0, 3),
      };
    })
    .sort((a, b) => b.count - a.count);

  // Categorize hashtags
  const categoryMap: Record<string, string[]> = {
    branded: [], niche: [], community: [], location: [], campaign: [], generic: [],
  };
  const brandKeywords = ['brand', 'collab', 'partner', 'sponsor', 'ad'];
  const communityKeywords = ['community', 'tribe', 'squad', 'fam', 'crew'];
  const locationKeywords = ['city', 'town', 'country', 'travel', 'visit', 'explore'];

  for (const t of trends) {
    const tag = t.hashtag;
    if (brandKeywords.some(k => tag.includes(k)) || t.count === 1) categoryMap.branded.push(tag);
    else if (communityKeywords.some(k => tag.includes(k))) categoryMap.community.push(tag);
    else if (locationKeywords.some(k => tag.includes(k))) categoryMap.location.push(tag);
    else if (t.count >= 3) categoryMap.niche.push(tag);
    else categoryMap.generic.push(tag);
  }

  // Find optimal hashtag count by correlating with engagement
  const postHashtagCounts = posts.map(p => ({ count: p.hashtags.length, engagement: p.likes + p.comments }));
  const sorted = [...postHashtagCounts].sort((a, b) => b.engagement - a.engagement);
  const topHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
  const optimalCount = topHalf.length > 0 ? Math.round(topHalf.reduce((s, p) => s + p.count, 0) / topHalf.length) : 0;

  const recommendations: string[] = [];
  if (trends.length === 0) recommendations.push('No hashtags detected. Adding relevant hashtags can increase discoverability.');
  if (optimalCount > 0 && optimalCount < 30) recommendations.push(`Optimal hashtag count appears to be ~${optimalCount} based on engagement correlation.`);
  if (categoryMap.niche.length > 0) recommendations.push(`Strong niche hashtags: ${categoryMap.niche.slice(0, 5).map(h => '#' + h).join(', ')}`);
  const topPerformer = trends.sort((a, b) => b.engagement_rate - a.engagement_rate)[0];
  if (topPerformer) recommendations.push(`Highest engagement hashtag: #${topPerformer.hashtag} (${topPerformer.engagement_rate}% engagement)`);

  return {
    username: profile.username,
    total_posts_analyzed: posts.length,
    total_unique_hashtags: hashtagMap.size,
    top_hashtags: trends.slice(0, 20),
    hashtag_categories: categoryMap,
    optimal_hashtag_count: optimalCount,
    recommendations,
  };
}

// ─── Competitor Comparison ─────────────────────────

export interface CompetitorComparison {
  profiles: {
    username: string;
    followers: number;
    following: number;
    posts_count: number;
    engagement_rate: number;
    avg_likes: number;
    avg_comments: number;
    posting_frequency: string;
    is_verified: boolean;
    is_business: boolean;
    category: string | null;
    bio: string;
    top_hashtags: string[];
  }[];
  comparison: {
    highest_followers: string;
    highest_engagement: string;
    most_active: string;
    best_likes_ratio: string;
    rankings: { metric: string; ranking: { username: string; value: number | string }[] }[];
  };
  insights: string[];
}

export async function compareProfiles(usernames: string[]): Promise<CompetitorComparison> {
  if (usernames.length < 2) throw new Error('At least 2 usernames required for comparison');
  if (usernames.length > 5) throw new Error('Maximum 5 usernames for comparison');

  const results = await Promise.allSettled(
    usernames.map(async (u) => {
      const profile = await getProfile(u);
      const posts = await getPosts(u, 12);
      const hashtags = posts.flatMap(p => p.hashtags);
      const hashtagFreq = new Map<string, number>();
      for (const h of hashtags) {
        hashtagFreq.set(h.toLowerCase(), (hashtagFreq.get(h.toLowerCase()) || 0) + 1);
      }
      const topHashtags = [...hashtagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h]) => h);
      return { profile, topHashtags };
    })
  );

  const profiles: CompetitorComparison['profiles'] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { profile: p, topHashtags } = r.value;
      profiles.push({
        username: p.username, followers: p.followers, following: p.following,
        posts_count: p.posts_count, engagement_rate: p.engagement_rate,
        avg_likes: p.avg_likes, avg_comments: p.avg_comments,
        posting_frequency: p.posting_frequency, is_verified: p.is_verified,
        is_business: p.is_business, category: p.category, bio: p.bio,
        top_hashtags: topHashtags,
      });
    }
  }

  if (profiles.length < 2) throw new Error('Could not fetch enough profiles for comparison');

  const byFollowers = [...profiles].sort((a, b) => b.followers - a.followers);
  const byEngagement = [...profiles].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const byLikes = [...profiles].sort((a, b) => b.avg_likes - a.avg_likes);

  // Parse posting frequency for comparison
  const parseFreq = (f: string): number => {
    const m = f.match(/([\d.]+)/);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    if (f.includes('day')) return v * 7;
    return v;
  };
  const byActivity = [...profiles].sort((a, b) => parseFreq(b.posting_frequency) - parseFreq(a.posting_frequency));

  const rankings = [
    { metric: 'followers', ranking: byFollowers.map(p => ({ username: p.username, value: p.followers })) },
    { metric: 'engagement_rate', ranking: byEngagement.map(p => ({ username: p.username, value: p.engagement_rate })) },
    { metric: 'avg_likes', ranking: byLikes.map(p => ({ username: p.username, value: p.avg_likes })) },
    { metric: 'avg_comments', ranking: [...profiles].sort((a, b) => b.avg_comments - a.avg_comments).map(p => ({ username: p.username, value: p.avg_comments })) },
    { metric: 'posting_frequency', ranking: byActivity.map(p => ({ username: p.username, value: p.posting_frequency })) },
  ];

  const insights: string[] = [];
  if (byFollowers[0].username !== byEngagement[0].username) {
    insights.push(`@${byEngagement[0].username} has the highest engagement rate (${byEngagement[0].engagement_rate}%) despite @${byFollowers[0].username} having more followers.`);
  }
  const avgEng = profiles.reduce((s, p) => s + p.engagement_rate, 0) / profiles.length;
  insights.push(`Average engagement rate across compared accounts: ${Math.round(avgEng * 100) / 100}%`);
  const allHashtags = profiles.flatMap(p => p.top_hashtags);
  const sharedHashtags = [...new Set(allHashtags)].filter(h => profiles.filter(p => p.top_hashtags.includes(h)).length >= 2);
  if (sharedHashtags.length > 0) {
    insights.push(`Shared hashtags across competitors: ${sharedHashtags.slice(0, 10).map(h => '#' + h).join(', ')}`);
  }

  return {
    profiles,
    comparison: {
      highest_followers: byFollowers[0].username,
      highest_engagement: byEngagement[0].username,
      most_active: byActivity[0].username,
      best_likes_ratio: byLikes[0].username,
      rankings,
    },
    insights,
  };
}

// ─── Discover / Search by AI Attributes ────────────

export interface DiscoverFilters {
  niche?: string;
  min_followers?: number;
  max_followers?: number;
  account_type?: string;
  sentiment?: string;
  brand_safe?: boolean;
  min_engagement?: number;
}

export interface DiscoverResult {
  username: string;
  followers: number;
  engagement_rate: number;
  niche: string;
  account_type: string;
  sentiment: string;
  brand_safety_score: number;
  authenticity_score: number;
  match_score: number;
}

// In-memory analyzed profiles cache for discover queries
const analyzedProfilesCache = new Map<string, { data: FullAnalysis; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

export function cacheAnalysis(username: string, analysis: FullAnalysis): void {
  analyzedProfilesCache.set(username.toLowerCase(), { data: analysis, timestamp: Date.now() });
}

export async function discoverProfiles(usernames: string[], filters: DiscoverFilters): Promise<DiscoverResult[]> {
  // Analyze all provided usernames (or use cache)
  const results: DiscoverResult[] = [];

  for (const username of usernames) {
    const cached = analyzedProfilesCache.get(username.toLowerCase());
    let analysis: FullAnalysis;

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      analysis = cached.data;
    } else {
      try {
        analysis = await analyzeProfile(username);
        cacheAnalysis(username, analysis);
      } catch {
        continue; // Skip profiles that fail to fetch
      }
    }

    const ai = analysis.ai_analysis;
    let matchScore = 100;

    // Apply filters and compute match score
    if (filters.niche) {
      const nicheMatch = ai.account_type.niche?.toLowerCase().includes(filters.niche.toLowerCase()) ||
        ai.account_type.sub_niches?.some(s => s.toLowerCase().includes(filters.niche!.toLowerCase())) ||
        ai.content_themes.top_themes?.some(t => t.toLowerCase().includes(filters.niche!.toLowerCase()));
      if (!nicheMatch) continue;
    }
    if (filters.min_followers && analysis.profile.followers < filters.min_followers) continue;
    if (filters.max_followers && analysis.profile.followers > filters.max_followers) continue;
    if (filters.account_type && ai.account_type.primary?.toLowerCase() !== filters.account_type.toLowerCase()) continue;
    if (filters.sentiment && ai.sentiment.overall?.toLowerCase() !== filters.sentiment.toLowerCase()) continue;
    if (filters.brand_safe && ai.content_themes.brand_safety_score < 70) continue;
    if (filters.min_engagement && analysis.profile.engagement_rate < filters.min_engagement) continue;

    // Calculate match score based on confidence and quality
    matchScore = Math.round(
      (ai.account_type.confidence || 0.5) * 30 +
      (ai.authenticity.score || 50) * 0.3 +
      (ai.content_themes.brand_safety_score || 50) * 0.2 +
      Math.min(analysis.profile.engagement_rate * 5, 20)
    );

    results.push({
      username: analysis.profile.username,
      followers: analysis.profile.followers,
      engagement_rate: analysis.profile.engagement_rate,
      niche: ai.account_type.niche || 'unknown',
      account_type: ai.account_type.primary || 'unknown',
      sentiment: ai.sentiment.overall || 'neutral',
      brand_safety_score: ai.content_themes.brand_safety_score || 0,
      authenticity_score: ai.authenticity.score || 0,
      match_score: Math.min(matchScore, 100),
    });
  }

  return results.sort((a, b) => b.match_score - a.match_score);
}
