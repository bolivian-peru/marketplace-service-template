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

// ─── AI Vision Analysis (Expert Batching) ───────────

const VISION_SYSTEM_PROMPT = `
You are an expert forensic analyst specializing in social media account authenticity.
You receive a batch of recent Instagram post images from a single account.

YOUR JOB: Identify signals of authenticity OR artificial/bot behavior.

## ANALYSIS DIMENSIONS

1. Face Consistency: Same real human faces? Natural variation vs. GAN/Stock?
2. Image Authenticity: AI-generated red flags? Stock watermarks?
3. Content Consistency: Coherent personal brand? Logical narrative?
4. Engagement Bait: Giveaway templates? Low-effort reposts?

OUTPUT FORMAT (strict JSON, no markdown):
{
  "face_consistency_score": 0.0-1.0,
  "faces_detected": boolean,
  "face_notes": "string",
  "ai_generated_probability": 0.0-1.0,
  "stock_photo_probability": 0.0-1.0,
  "content_themes": ["string"],
  "content_consistency_score": 0.0-1.0,
  "account_type_signals": ["influencer", "business", "bot", "personal", "meme_page"],
  "primary_account_type": "string",
  "confidence": 0.0-1.0,
  "red_flags": ["string"],
  "positive_signals": ["string"],
  "sentiment": "positive|neutral|negative|mixed",
  "brand_safe": boolean
}
`;

async function analyzeBatch(imageUrls: string[], batchIdx: number): Promise<any> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const content: any[] = [
        { type: 'text', text: `Batch ${batchIdx}. Analyze these ${imageUrls.length} images. Return JSON only.` }
    ];

    for (const url of imageUrls) {
        content.push({ type: 'image_url', image_url: { url, detail: 'low' } });
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: VISION_SYSTEM_PROMPT },
                { role: 'user', content }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3
        })
    });

    if (!resp.ok) throw new Error(`Vision API error: ${resp.status}`);
    const data = await resp.json();
    return JSON.parse(data.choices[0].message.content);
}

// ─── Trust Score Algorithm (0-100) ──────────────────

function calculateTrustScore(profile: InstagramProfile, visionResults: any[]): any {
    const avgVision = {
        face_consistency: visionResults.reduce((s, v) => s + (v.face_consistency_score || 0), 0) / visionResults.length,
        ai_prob: visionResults.reduce((s, v) => s + (v.ai_generated_probability || 0), 0) / visionResults.length,
        stock_prob: visionResults.reduce((s, v) => s + (v.stock_photo_probability || 0), 0) / visionResults.length,
        coherence: visionResults.reduce((s, v) => s + (v.content_consistency_score || 0), 0) / visionResults.length,
        red_flags: visionResults.flatMap(v => v.red_flags || [])
    };

    const scores: Record<string, number> = {};

    // 1. Engagement Quality (25 pts)
    const er = profile.engagement_rate / 100;
    let engScore = 0;
    if (er >= 0.005 && er <= 0.08) engScore = 25;
    else if (er > 0.08) engScore = Math.max(0, 25 - (er - 0.08) * 100);
    else engScore = (er / 0.005) * 25;
    
    const ffRatio = profile.following / Math.max(profile.followers, 1);
    if (ffRatio > 2.0) engScore *= 0.7;
    scores.engagement = Math.min(25, engScore);

    // 2. Visual Authenticity (25 pts)
    let visScore = 25;
    visScore -= avgVision.ai_prob * 20;
    visScore -= avgVision.stock_prob * 15;
    visScore += avgVision.face_consistency * 5;
    scores.visual = Math.max(0, Math.min(25, visScore));

    // 3. Content Coherence (25 pts)
    let cohScore = avgVision.coherence * 20;
    if (profile.posts_count > 50) cohScore += 5;
    scores.coherence = Math.max(0, Math.min(25, cohScore));

    // 4. Profile Legitimacy (25 pts)
    let legScore = 10;
    if (profile.is_verified) legScore += 10;
    if (profile.followers > 1000) legScore += 5;
    legScore -= avgVision.red_flags.length * 2;
    scores.legitimacy = Math.max(0, Math.min(25, legScore));

    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    
    return {
        trust_score: Math.round(total),
        components: scores,
        verdict: total >= 70 ? 'high_trust' : total >= 45 ? 'medium_trust' : 'low_trust'
    };
}

// ─── Full Analysis ──────────────────────────────────

export async function analyzeProfile(username: string): Promise<any> {
    const profile = await getProfile(username);
    const posts = await getPosts(username, 12);
    
    const imageUrls = posts.filter(p => p.image_url).map(p => p.image_url);
    const batches = [imageUrls.slice(0, 4), imageUrls.slice(4, 8), imageUrls.slice(8, 12)].filter(b => b.length > 0);
    
    const visionResults = await Promise.all(batches.map((batch, idx) => analyzeBatch(batch, idx + 1)));
    const trust = calculateTrustScore(profile, visionResults);

    return {
        profile,
        posts,
        ai_analysis: {
            ...trust,
            vision_details: visionResults,
            images_analyzed: imageUrls.length,
            model_used: 'gpt-4o'
        }
    };
}

export async function analyzeImages(username: string): Promise<any> {
    const posts = await getPosts(username, 12);
    const imageUrls = posts.filter(p => p.image_url).map(p => p.image_url);
    const batches = [imageUrls.slice(0, 4), imageUrls.slice(4, 8), imageUrls.slice(8, 12)].filter(b => b.length > 0);
    const results = await Promise.all(batches.map((batch, idx) => analyzeBatch(batch, idx + 1)));
    return { images_analyzed: imageUrls.length, vision_details: results };
}

export async function auditProfile(username: string): Promise<any> {
    const full = await analyzeProfile(username);
    return { profile: full.profile, authenticity: full.ai_analysis };
}
