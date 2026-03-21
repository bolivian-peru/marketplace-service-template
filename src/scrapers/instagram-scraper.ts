/**
 * Instagram Intelligence Scraper + AI Vision Analysis
 * ────────────────────────────────────────────────────
 * Uses Proxies.sx mobile proxies to scrape Instagram profiles,
 * posts, and images, then runs GPT-4o vision analysis for:
 *   - Account type classification
 *   - Content theme detection
 *   - Sentiment analysis
 *   - Fake account detection
 */

import { proxyFetch, getProxy } from '../proxy';
import type {
  InstagramProfile,
  InstagramPost,
  AIAnalysis,
  AIAccountType,
  AIContentThemes,
  AISentiment,
  AIAuthenticity,
  BrandRecommendations,
  FullAnalysisResult,
  ImageAnalysisResult,
  AuditResult,
} from '../types/instagram';

// ─── HELPERS ─────────────────────────────────────────

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_]+/g) || [];
  return [...new Set(matches.map(h => h.toLowerCase()))];
}

function extractMentions(text: string): string[] {
  const matches = text.match(/@[a-zA-Z0-9_.]+/g) || [];
  return [...new Set(matches.map(m => m.toLowerCase()))];
}

function isSponsored(caption: string): boolean {
  const sponsored = ['#ad', '#sponsored', '#collab', '#gifted', '#promo', '#partner', 'paid partnership'];
  const lower = caption.toLowerCase();
  return sponsored.some(s => lower.includes(s));
}

function calculateEngagementRate(likes: number, comments: number, followers: number): number {
  if (followers <= 0) return 0;
  return parseFloat(((likes + comments) / followers * 100).toFixed(2));
}

function calculatePostingFrequency(posts: InstagramPost[]): string {
  if (posts.length < 2) return 'Unknown';
  const timestamps = posts.map(p => new Date(p.timestamp).getTime()).sort((a, b) => b - a);
  const oldest = timestamps[timestamps.length - 1];
  const newest = timestamps[0];
  const weeksDiff = (newest - oldest) / (7 * 24 * 60 * 60 * 1000);
  if (weeksDiff <= 0) return 'Unknown';
  const postsPerWeek = posts.length / weeksDiff;
  return `${postsPerWeek.toFixed(1)} posts/week`;
}

function estimateFollowerGrowthSignal(profile: any): 'growing' | 'declining' | 'stagnant' | 'unknown' {
  // Heuristic: engagement rate vs follower count signal
  const engRate = profile.engagement_rate || 0;
  if (engRate > 5) return 'growing';
  if (engRate > 2) return 'stagnant';
  if (engRate > 0) return 'declining';
  return 'unknown';
}

// ─── INSTAGRAM API / SCRAPING ────────────────────────

/**
 * Fetch Instagram profile using the public web API
 * Uses mobile User-Agent via Proxies.sx to bypass blocks
 */
async function fetchInstagramProfile(username: string): Promise<any> {
  const cleanUsername = username.replace('@', '').toLowerCase().trim();
  
  // Try Instagram's JSON API first (most reliable)
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUsername}`;
  
  try {
    const response = await proxyFetch(apiUrl, {
      headers: {
        'User-Agent': 'Instagram 303.0.0.30.110 (iPhone14,3; iOS 17_0; en_US; en-US; scale=3.00; 1284x2778; 495222575)',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-IG-WWW-Claim': '0',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
      },
      timeoutMs: 30_000,
    });

    if (response.ok) {
      const data = await response.json() as any;
      if (data?.data?.user) {
        return data.data.user;
      }
    }
  } catch (err: any) {
    console.warn(`[IG] API endpoint failed: ${err.message}, trying GraphQL fallback`);
  }

  // Fallback: Instagram GraphQL endpoint
  const graphqlUrl = `https://www.instagram.com/${cleanUsername}/?__a=1&__d=dis`;
  
  try {
    const response = await proxyFetch(graphqlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram/303.0.0.30.110',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.instagram.com/',
      },
      timeoutMs: 30_000,
    });

    if (response.ok) {
      const data = await response.json() as any;
      if (data?.graphql?.user) {
        return data.graphql.user;
      }
    }
  } catch (err: any) {
    console.warn(`[IG] GraphQL fallback failed: ${err.message}`);
  }

  // Final fallback: scrape HTML page and extract JSON
  const profileUrl = `https://www.instagram.com/${cleanUsername}/`;
  const response = await proxyFetch(profileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 45_000,
  });

  if (!response.ok) {
    throw new Error(`Instagram returned ${response.status} for @${cleanUsername}`);
  }

  const html = await response.text();
  
  // Extract JSON from script tags
  const jsonMatch = html.match(/<script type="application\/json" data-sjs>(.*?)<\/script>/s) ||
                    html.match(/window\._sharedData\s*=\s*({.*?});<\/script>/s) ||
                    html.match(/"ProfilePage":\[({.*?})\]/s);

  if (!jsonMatch) {
    // Try to extract from newer IG page format
    const altMatch = html.match(/{"require":\[\["ScheduledServerJS".*?\]\]}/s);
    if (altMatch) {
      // Parse nested JSON
      try {
        const outerData = JSON.parse(altMatch[0]);
        // Drill into the structure to find user data
        const userMatch = JSON.stringify(outerData).match(/"biography":"[^"]*","blocked_by_viewer"/);
        if (userMatch) {
          const userDataStr = JSON.stringify(outerData);
          const startIdx = userDataStr.lastIndexOf('{"biography"', userDataStr.indexOf('"blocked_by_viewer"'));
          if (startIdx !== -1) {
            // This is complex - return a structured mock that indicates we got partial data
            return parseUserFromHtml(html, cleanUsername);
          }
        }
      } catch {
        // ignore
      }
    }
    return parseUserFromHtml(html, cleanUsername);
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    return parsed?.graphql?.user || parsed?.entry_data?.ProfilePage?.[0]?.graphql?.user || null;
  } catch {
    return parseUserFromHtml(html, cleanUsername);
  }
}

/**
 * Parse user data from HTML meta tags when JSON extraction fails
 */
function parseUserFromHtml(html: string, username: string): any {
  const followersMatch = html.match(/(\d[\d,.]+)\s*[Ff]ollowers/);
  const followingMatch = html.match(/(\d[\d,.]+)\s*[Ff]ollowing/);
  const postsMatch = html.match(/(\d[\d,.]+)\s*[Pp]osts?/);
  const fullNameMatch = html.match(/<title>([^<|]+)\s*\(@/);
  const bioMatch = html.match(/<meta name="description" content="([^"]+)"/);
  const verifiedMatch = html.includes('"is_verified":true') || html.includes('verified_badge');

  const parseCount = (str: string | undefined): number => {
    if (!str) return 0;
    const cleaned = str.replace(/,/g, '');
    if (cleaned.includes('k') || cleaned.includes('K')) {
      return Math.round(parseFloat(cleaned) * 1000);
    }
    if (cleaned.includes('m') || cleaned.includes('M')) {
      return Math.round(parseFloat(cleaned) * 1000000);
    }
    return parseInt(cleaned) || 0;
  };

  return {
    username,
    full_name: fullNameMatch?.[1]?.trim() || username,
    biography: bioMatch?.[1] || '',
    edge_followed_by: { count: parseCount(followersMatch?.[1]) },
    edge_follow: { count: parseCount(followingMatch?.[1]) },
    edge_owner_to_timeline_media: { count: parseCount(postsMatch?.[1]), edges: [] },
    is_verified: verifiedMatch,
    is_business_account: false,
    is_private: html.includes('"is_private":true'),
    profile_pic_url_hd: null,
    external_url: null,
    business_category_name: null,
    _partial: true,
  };
}

/**
 * Normalize raw Instagram API user data to our InstagramProfile format
 */
function normalizeProfile(raw: any, posts: InstagramPost[]): InstagramProfile {
  const followers = raw.edge_followed_by?.count || raw.follower_count || 0;
  const following = raw.edge_follow?.count || raw.following_count || 0;
  const postsCount = raw.edge_owner_to_timeline_media?.count || raw.media_count || 0;
  
  const avgLikes = posts.length > 0 
    ? Math.round(posts.reduce((s, p) => s + p.likes, 0) / posts.length)
    : 0;
  const avgComments = posts.length > 0
    ? Math.round(posts.reduce((s, p) => s + p.comments, 0) / posts.length)
    : 0;
  const engagementRate = calculateEngagementRate(avgLikes, avgComments, followers);
  const postingFreq = calculatePostingFrequency(posts);

  const profile: InstagramProfile = {
    username: raw.username || '',
    full_name: raw.full_name || raw.full_name || '',
    bio: raw.biography || '',
    followers,
    following,
    posts_count: postsCount,
    is_verified: raw.is_verified || false,
    is_business: raw.is_business_account || raw.is_professional_account || false,
    is_private: raw.is_private || false,
    profile_pic_url: raw.profile_pic_url_hd || raw.profile_pic_url || null,
    external_url: raw.external_url || null,
    category: raw.business_category_name || raw.category || null,
    engagement_rate: engagementRate,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    posting_frequency: postingFreq,
    follower_growth_signal: estimateFollowerGrowthSignal({ engagement_rate: engagementRate }),
    scraped_at: new Date().toISOString(),
  };

  return profile;
}

/**
 * Extract posts from raw Instagram API data
 */
function extractPosts(raw: any, limit: number = 12): InstagramPost[] {
  const edges = raw.edge_owner_to_timeline_media?.edges || 
                raw.edge_media_collections?.edges || 
                [];

  return edges.slice(0, limit).map((edge: any) => {
    const node = edge.node;
    const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    const imageUrl = node.display_url || node.thumbnail_src || null;
    const type = node.__typename === 'GraphVideo' ? 'video'
      : node.__typename === 'GraphSidecar' ? 'carousel'
      : node.is_video ? 'video' : 'image';

    return {
      id: node.id || '',
      shortcode: node.shortcode || '',
      type,
      caption,
      likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
      comments: node.edge_media_to_comment?.count || 0,
      timestamp: node.taken_at_timestamp
        ? new Date(node.taken_at_timestamp * 1000).toISOString()
        : new Date().toISOString(),
      image_url: imageUrl,
      video_url: node.video_url || null,
      is_sponsored: isSponsored(caption),
      hashtags: extractHashtags(caption),
      mentions: extractMentions(caption),
    } as InstagramPost;
  });
}

// ─── AI VISION ANALYSIS ─────────────────────────────

const MODEL_USED = 'gpt-4o';

interface OpenAIVisionResponse {
  account_type: {
    primary: string;
    niche: string;
    confidence: number;
    sub_niches: string[];
    signals: string[];
  };
  content_themes: {
    top_themes: string[];
    style: string;
    aesthetic_consistency: 'high' | 'medium' | 'low';
    brand_safety_score: number;
    content_consistency: 'high' | 'medium' | 'low';
  };
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative' | 'mixed';
    breakdown: { positive: number; neutral: number; negative: number };
    emotional_themes: string[];
    brand_alignment: string[];
  };
  authenticity: {
    score: number;
    verdict: 'authentic' | 'likely_authentic' | 'suspicious' | 'likely_fake' | 'fake';
    face_consistency: boolean | null;
    engagement_pattern: 'organic' | 'inflated' | 'bot-like' | 'purchased' | 'unknown';
    follower_quality: 'high' | 'medium' | 'low' | 'unknown';
    comment_analysis: 'mostly_genuine' | 'mixed' | 'mostly_generic' | 'bot-like' | 'unknown';
    fake_signals: {
      stock_photo_detected: boolean;
      engagement_vs_followers: string;
      follower_growth_pattern: string;
      posting_pattern: string;
    };
  };
}

/**
 * Collect image URLs from posts (only ones loadable via proxy)
 */
function collectImageUrls(posts: InstagramPost[]): string[] {
  return posts
    .filter(p => p.image_url !== null && (p.type === 'image' || p.type === 'carousel'))
    .map(p => p.image_url as string)
    .slice(0, 12);
}

/**
 * Run AI vision analysis on Instagram post images using GPT-4o
 */
async function runVisionAnalysis(
  imageUrls: string[],
  profile: InstagramProfile,
  posts: InstagramPost[],
): Promise<OpenAIVisionResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured. Set it in .env to enable AI vision analysis.');
  }

  // Build caption context for sentiment analysis
  const captionContext = posts
    .slice(0, 12)
    .map(p => p.caption)
    .filter(c => c.length > 0)
    .join('\n---\n');

  // Build image content parts
  const imageContent: any[] = imageUrls.map(url => ({
    type: 'image_url',
    image_url: { url, detail: 'low' }, // 'low' = cheaper, still great for style analysis
  }));

  const systemPrompt = `You are an expert Instagram analytics AI. Analyze Instagram profile images and return ONLY valid JSON matching the exact schema provided. Be accurate and evidence-based in your analysis.`;

  const userPrompt = `Analyze this Instagram account @${profile.username} with ${profile.followers.toLocaleString()} followers.

Profile bio: "${profile.bio}"
Engagement rate: ${profile.engagement_rate}%
Recent captions:
${captionContext.slice(0, 2000)}

${imageUrls.length > 0 ? `I'm providing ${imageUrls.length} recent post images for visual analysis.` : 'No images available - analyze based on profile data and captions only.'}

Return ONLY this exact JSON structure (no markdown, no explanation):
{
  "account_type": {
    "primary": "influencer|business|personal|bot_fake|meme_page|news_media",
    "niche": "travel_lifestyle|fitness|food|fashion|tech|beauty|gaming|comedy|education|finance|other",
    "confidence": 0.0-1.0,
    "sub_niches": ["array", "of", "sub-niches"],
    "signals": ["evidence", "signals", "detected"]
  },
  "content_themes": {
    "top_themes": ["theme1", "theme2", "theme3", "theme4"],
    "style": "professional_photography|casual_selfies|mixed|stock_photos|ugc|reposted_content",
    "aesthetic_consistency": "high|medium|low",
    "brand_safety_score": 0-100,
    "content_consistency": "high|medium|low"
  },
  "sentiment": {
    "overall": "positive|neutral|negative|mixed",
    "breakdown": { "positive": 0-100, "neutral": 0-100, "negative": 0-100 },
    "emotional_themes": ["aspirational", "educational", etc],
    "brand_alignment": ["luxury", "wellness", etc]
  },
  "authenticity": {
    "score": 0-100,
    "verdict": "authentic|likely_authentic|suspicious|likely_fake|fake",
    "face_consistency": true|false|null,
    "engagement_pattern": "organic|inflated|bot-like|purchased|unknown",
    "follower_quality": "high|medium|low|unknown",
    "comment_analysis": "mostly_genuine|mixed|mostly_generic|bot-like|unknown",
    "fake_signals": {
      "stock_photo_detected": true|false,
      "engagement_vs_followers": "healthy|low|inflated|suspicious",
      "follower_growth_pattern": "natural|sudden_spike|suspicious|purchased",
      "posting_pattern": "consistent|sporadic|automated|natural"
    }
  }
}`;

  const messages: any[] = [
    {
      role: 'user',
      content: imageUrls.length > 0
        ? [{ type: 'text', text: userPrompt }, ...imageContent]
        : userPrompt,
    },
  ];

  const requestBody = {
    model: MODEL_USED,
    messages,
    max_tokens: 1000,
    temperature: 0.1, // Low temperature for consistent analysis
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${error}`);
  }

  const result = await response.json() as any;
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAI returned empty response');
  }

  // Strip markdown code blocks if present
  const cleaned = content.replace(/^```json\n?/m, '').replace(/^```\n?/m, '').replace(/```$/m, '').trim();

  try {
    return JSON.parse(cleaned) as OpenAIVisionResponse;
  } catch (err) {
    throw new Error(`Failed to parse AI response as JSON: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Generate brand recommendations from AI analysis
 */
function generateRecommendations(
  profile: InstagramProfile,
  analysis: OpenAIVisionResponse,
): BrandRecommendations {
  const niche = analysis.account_type.niche;
  const themes = analysis.content_themes.top_themes;
  const brandAlignment = analysis.sentiment.brand_alignment;

  // Brand category mapping
  const brandMap: Record<string, string[]> = {
    travel_lifestyle: ['travel_agencies', 'hotels', 'airlines', 'camera_brands', 'luggage_brands'],
    fitness: ['sportswear', 'supplement_brands', 'gym_equipment', 'health_apps', 'nutrition'],
    food: ['restaurants', 'food_delivery', 'kitchen_appliances', 'cooking_apps', 'grocery'],
    fashion: ['clothing_brands', 'accessories', 'beauty', 'luxury_goods', 'fast_fashion'],
    tech: ['gadgets', 'software', 'apps', 'electronics', 'gaming'],
    beauty: ['cosmetics', 'skincare', 'haircare', 'beauty_tools', 'fragrance'],
    gaming: ['game_studios', 'gaming_hardware', 'energy_drinks', 'streaming_platforms'],
    education: ['edtech', 'online_courses', 'books', 'productivity_apps', 'finance'],
    finance: ['fintech', 'investment_apps', 'banking', 'crypto', 'insurance'],
  };

  const goodForBrands = [
    ...(brandMap[niche] || ['general_brands']),
    ...brandAlignment,
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);

  // Estimate post value based on followers and engagement
  let estimatedValue = '$10-50';
  const f = profile.followers;
  const e = profile.engagement_rate;
  if (f > 1_000_000) {
    estimatedValue = e > 3 ? '$5000-15000' : '$2000-8000';
  } else if (f > 500_000) {
    estimatedValue = e > 3 ? '$2000-5000' : '$800-2500';
  } else if (f > 100_000) {
    estimatedValue = e > 3 ? '$800-2000' : '$300-800';
  } else if (f > 50_000) {
    estimatedValue = e > 3 ? '$300-800' : '$100-300';
  } else if (f > 10_000) {
    estimatedValue = e > 3 ? '$100-300' : '$50-150';
  } else {
    estimatedValue = e > 5 ? '$50-150' : '$10-50';
  }

  const riskLevel: 'low' | 'medium' | 'high' =
    analysis.authenticity.score > 75 && analysis.content_themes.brand_safety_score > 80 ? 'low'
    : analysis.authenticity.score > 50 || analysis.content_themes.brand_safety_score > 60 ? 'medium'
    : 'high';

  return { good_for_brands: goodForBrands, estimated_post_value: estimatedValue, risk_level: riskLevel };
}

// ─── PUBLIC API FUNCTIONS ─────────────────────────────

/**
 * Get basic Instagram profile data
 */
export async function getProfile(username: string): Promise<InstagramProfile> {
  const raw = await fetchInstagramProfile(username);
  if (!raw) throw new Error(`Could not find Instagram profile for @${username}`);
  
  // Fetch a few posts to calculate engagement metrics
  let posts: InstagramPost[] = [];
  try {
    posts = extractPosts(raw, 12);
  } catch {
    // If post extraction fails, continue with empty posts
  }

  return normalizeProfile(raw, posts);
}

/**
 * Get recent posts for an Instagram account
 */
export async function getPosts(username: string, limit: number = 12): Promise<InstagramPost[]> {
  const raw = await fetchInstagramProfile(username);
  if (!raw) throw new Error(`Could not find Instagram profile for @${username}`);
  return extractPosts(raw, limit);
}

/**
 * Full AI-powered analysis: profile + posts + vision analysis
 */
export async function analyzeProfile(username: string): Promise<FullAnalysisResult> {
  const startTime = Date.now();
  
  // Fetch profile data
  const raw = await fetchInstagramProfile(username);
  if (!raw) throw new Error(`Could not find Instagram profile for @${username}`);
  
  const posts = extractPosts(raw, 12);
  const profile = normalizeProfile(raw, posts);
  
  // Collect image URLs
  const imageUrls = collectImageUrls(posts);
  
  // Run AI vision analysis
  const visionResult = await runVisionAnalysis(imageUrls, profile, posts);
  
  const aiAnalysis: AIAnalysis = {
    account_type: visionResult.account_type,
    content_themes: visionResult.content_themes,
    sentiment: visionResult.sentiment,
    authenticity: visionResult.authenticity,
    images_analyzed: imageUrls.length,
    model_used: MODEL_USED,
  };

  const recommendations = generateRecommendations(profile, visionResult);

  return {
    profile,
    posts,
    ai_analysis: aiAnalysis,
    recommendations,
  };
}

/**
 * AI vision analysis of post images only
 */
export async function analyzeImages(username: string): Promise<ImageAnalysisResult> {
  const raw = await fetchInstagramProfile(username);
  if (!raw) throw new Error(`Could not find Instagram profile for @${username}`);
  
  const posts = extractPosts(raw, 12);
  const profile = normalizeProfile(raw, posts);
  const imageUrls = collectImageUrls(posts);
  
  const visionResult = await runVisionAnalysis(imageUrls, profile, posts);
  
  return {
    username,
    images_analyzed: imageUrls.length,
    analysis: {
      account_type: visionResult.account_type,
      content_themes: visionResult.content_themes,
      sentiment: visionResult.sentiment,
      authenticity: visionResult.authenticity,
      images_analyzed: imageUrls.length,
      model_used: MODEL_USED,
    },
  };
}

/**
 * Fake follower / bot detection audit (AI-enhanced)
 */
export async function auditProfile(username: string): Promise<AuditResult> {
  const raw = await fetchInstagramProfile(username);
  if (!raw) throw new Error(`Could not find Instagram profile for @${username}`);
  
  const posts = extractPosts(raw, 12);
  const profile = normalizeProfile(raw, posts);
  const imageUrls = collectImageUrls(posts);
  
  // Run vision analysis focused on authenticity
  const visionResult = await runVisionAnalysis(imageUrls, profile, posts);
  
  // Calculate follower/following ratio
  const ratio = profile.following > 0 
    ? parseFloat((profile.followers / profile.following).toFixed(2))
    : profile.followers;
  
  let ratioAssessment: string;
  if (ratio > 100) ratioAssessment = 'Celebrity/Brand level — very high ratio';
  else if (ratio > 10) ratioAssessment = 'Established creator — healthy ratio';
  else if (ratio > 3) ratioAssessment = 'Growing account — normal ratio';
  else if (ratio > 1) ratioAssessment = 'Follow-for-follow pattern detected';
  else ratioAssessment = 'Following more than followers — possible bot behavior';

  // Compute raw signals
  const rawSignals: string[] = [];
  
  if (profile.engagement_rate > 15) rawSignals.push('Unusually high engagement rate — possible bot inflation');
  else if (profile.engagement_rate < 0.5 && profile.followers > 10000) rawSignals.push('Very low engagement for follower count — suspicious');
  else rawSignals.push('Engagement rate within expected range');
  
  if (profile.following > 5000) rawSignals.push('Following large number of accounts — possible follow-bot pattern');
  if (profile.is_business) rawSignals.push('Business account type verified');
  if (profile.is_verified) rawSignals.push('Instagram verified badge present');
  
  const hasSponsored = posts.some(p => p.is_sponsored);
  if (hasSponsored) rawSignals.push('Sponsored content detected — brand collaborations active');
  
  const avgHashtags = posts.length > 0
    ? posts.reduce((s, p) => s + p.hashtags.length, 0) / posts.length
    : 0;
  if (avgHashtags > 20) rawSignals.push(`High hashtag volume (avg ${avgHashtags.toFixed(1)}/post) — possible reach manipulation`);
  
  // Expected engagement range
  let expectedRange: string;
  const f = profile.followers;
  if (f > 1_000_000) expectedRange = '0.5-2%';
  else if (f > 100_000) expectedRange = '1-3%';
  else if (f > 10_000) expectedRange = '2-5%';
  else expectedRange = '3-10%';

  const engAssessment = 
    profile.engagement_rate > parseFloat(expectedRange.split('-')[1]) * 2 ? 'Inflated — significantly above expected range'
    : profile.engagement_rate < parseFloat(expectedRange.split('-')[0]) * 0.5 ? 'Below expected — potential follower quality issues'
    : 'Normal — within expected range for this follower tier';

  return {
    profile,
    authenticity: {
      ...visionResult.authenticity,
      raw_signals: rawSignals,
      engagement_analysis: {
        engagement_rate: profile.engagement_rate,
        expected_range: expectedRange,
        assessment: engAssessment,
      },
      follower_to_following_ratio: ratio,
      ratio_assessment: ratioAssessment,
    },
  };
}