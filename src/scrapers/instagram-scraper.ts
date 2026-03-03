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

export interface DiscoverFilters {
  niche?: string;
  account_type?: string;
  sentiment?: string;
  min_followers?: number;
  max_followers?: number;
  brand_safe?: boolean;
  limit?: number;
}

export interface DiscoverResult {
  accounts: Array<{
    username: string;
    followers: number;
    engagement_rate: number;
    account_type: string;
    niche: string;
    sentiment: string;
    brand_safety_score: number;
    match_reasons: string[];
  }>;
  scanned: number;
  returned: number;
  partial_failures: string[];
}

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
  const provider = (process.env.VISION_PROVIDER || 'openai-compatible').toLowerCase();
  const visionApiKey = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if ((provider === 'openai' || provider === 'openai-compatible') && visionApiKey) {
    return analyzeOpenAICompatible(visionApiKey, imageUrls, captions, profileSummary);
  }

  if (provider === 'anthropic' && anthropicKey) {
    return analyzeClaude(anthropicKey, imageUrls, captions, profileSummary);
  }

  if (visionApiKey) {
    return analyzeOpenAICompatible(visionApiKey, imageUrls, captions, profileSummary);
  }

  if (anthropicKey) {
    return analyzeClaude(anthropicKey, imageUrls, captions, profileSummary);
  }

  // Fallback: heuristic analysis without vision model
  return heuristicAnalysis(captions, profileSummary);
}

async function analyzeOpenAICompatible(apiKey: string, imageUrls: string[], captions: string[], profileSummary: string): Promise<any> {
  const baseUrl = (process.env.VISION_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.VISION_MODEL || 'gpt-4o';
  const content: any[] = [
    { type: 'text', text: `${VISION_PROMPT}\n\nProfile: ${profileSummary}\n\nCaptions:\n${captions.map((c, i) => `${i + 1}. ${c.slice(0, 200)}`).join('\n')}` },
  ];
  // Include up to 6 images to keep costs reasonable
  for (const url of imageUrls.slice(0, 6)) {
    content.push({ type: 'image_url', image_url: { url, detail: 'low' } });
  }
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 1500, temperature: 0.3 }),
  });
  if (!resp.ok) throw new Error(`Vision API error: ${resp.status}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  try { return { ...JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()), model_used: model }; }
  catch { return { ...heuristicAnalysis(captions, profileSummary), model_used: `${model}-fallback` }; }
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


function parseSeedUsernames(): string[] {
  const raw = process.env.IG_DISCOVER_SEED_USERNAMES || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function includesValue(target: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  return (target || '').toLowerCase().includes(expected.toLowerCase());
}

export async function discoverAccounts(filters: DiscoverFilters): Promise<DiscoverResult> {
  const limit = Math.min(Math.max(filters.limit || 10, 1), 25);
  const seeds = parseSeedUsernames().slice(0, 50);
  if (!seeds.length) {
    throw new Error('IG_DISCOVER_SEED_USERNAMES is empty. Add comma-separated public usernames in env.');
  }

  const accounts: DiscoverResult['accounts'] = [];
  const partial_failures: string[] = [];

  for (const username of seeds) {
    try {
      const full = await analyzeProfile(username);
      const { profile, ai_analysis } = full;
      const reasons: string[] = [];

      const niche = ai_analysis.account_type?.niche || ai_analysis.content_themes?.top_themes?.[0] || 'unknown';
      const accountType = ai_analysis.account_type?.primary || 'unknown';
      const sentiment = ai_analysis.sentiment?.overall || 'neutral';
      const safety = ai_analysis.content_themes?.brand_safety_score || 0;

      if (filters.min_followers != null && profile.followers < filters.min_followers) continue;
      if (filters.max_followers != null && profile.followers > filters.max_followers) continue;
      if (filters.brand_safe === true && safety < 70) continue;
      if (!includesValue(niche, filters.niche)) continue;
      if (!includesValue(accountType, filters.account_type)) continue;
      if (!includesValue(sentiment, filters.sentiment)) continue;

      if (filters.niche) reasons.push(`niche:${niche}`);
      if (filters.account_type) reasons.push(`type:${accountType}`);
      if (filters.sentiment) reasons.push(`sentiment:${sentiment}`);
      if (filters.brand_safe) reasons.push(`brand_safety:${safety}`);

      accounts.push({
        username: profile.username,
        followers: profile.followers,
        engagement_rate: profile.engagement_rate,
        account_type: accountType,
        niche,
        sentiment,
        brand_safety_score: safety,
        match_reasons: reasons.length ? reasons : ['matched'],
      });

      if (accounts.length >= limit) break;
    } catch (err: any) {
      partial_failures.push(`${username}: ${err?.message || String(err)}`);
    }
  }

  return {
    accounts,
    scanned: seeds.length,
    returned: accounts.length,
    partial_failures,
  };
}
