/**
 * AI Vision Analysis Module
 * Supports: Google Gemini (free tier), OpenAI GPT-4o (paid), Ollama/LLaVA (local)
 */

export interface ContentAnalysis {
  content_themes: string[];
  content_style: string;
  brand_safety_score: number;
  content_consistency: string;
}

export interface AccountTypeAnalysis {
  primary: string;
  niche: string;
  confidence: number;
  sub_niches: string[];
  signals: string[];
}

export interface SentimentAnalysis {
  overall: string;
  breakdown: { positive: number; neutral: number; negative: number };
  emotional_themes: string[];
  brand_alignment: string[];
}

export interface AuthenticityAnalysis {
  score: number;
  verdict: string;
  face_consistency: boolean | string;
  engagement_pattern: string;
  follower_quality: string;
  comment_analysis: string;
  fake_signals: {
    stock_photo_detected: boolean;
    engagement_vs_followers: string;
    follower_growth_pattern: string;
  };
}

export interface VisionAnalysisResult {
  account_type: AccountTypeAnalysis;
  content_themes: ContentAnalysis;
  sentiment: SentimentAnalysis;
  authenticity: AuthenticityAnalysis;
  images_analyzed: number;
  model_used: string;
  recommendations: {
    good_for_brands: string[];
    estimated_post_value: string;
    risk_level: string;
  };
}

type VisionProvider = 'gemini' | 'openai' | 'ollama';

function getProvider(): VisionProvider {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.OLLAMA_URL) return 'ollama';
  return 'gemini'; // default
}

/**
 * Analyze images using Google Gemini Vision (Free Tier)
 */
async function analyzeWithGemini(imageUrls: string[], profileContext: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const imageParts = [];
  for (const url of imageUrls.slice(0, 8)) {
    // Fetch image and convert to base64
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const mime = res.headers.get('content-type') || 'image/jpeg';
      imageParts.push({
        inlineData: { mimeType: mime, data: base64 }
      });
    } catch { continue; }
  }

  if (imageParts.length === 0) throw new Error('No images could be fetched');

  const prompt = `You are an Instagram account intelligence analyst. Analyze these ${imageParts.length} Instagram post images.

Profile context: ${profileContext}

Return a JSON object with EXACTLY this structure (no markdown, no code fences, just raw JSON):
{
  "account_type": {
    "primary": "influencer|business|personal|bot_fake|meme_page|news_media",
    "niche": "string describing the niche",
    "confidence": 0.0-1.0,
    "sub_niches": ["array", "of", "sub-niches"],
    "signals": ["evidence", "for", "classification"]
  },
  "content_themes": {
    "content_themes": ["top", "themes", "detected"],
    "content_style": "professional_photography|casual|mixed|curated|stock",
    "brand_safety_score": 0-100,
    "content_consistency": "high|medium|low"
  },
  "sentiment": {
    "overall": "positive|neutral|negative|mixed",
    "breakdown": {"positive": 0-100, "neutral": 0-100, "negative": 0-100},
    "emotional_themes": ["aspirational", "happy", etc],
    "brand_alignment": ["luxury", "wellness", etc]
  },
  "authenticity": {
    "score": 0-100,
    "verdict": "authentic|likely_authentic|suspicious|likely_fake",
    "face_consistency": true/false/"no_faces",
    "stock_photo_detected": false,
    "engagement_vs_followers": "healthy|suspicious|inflated",
    "follower_growth_pattern": "natural|suspicious|unknown"
  },
  "recommendations": {
    "good_for_brands": ["array", "of", "brand", "categories"],
    "estimated_post_value": "$X-Y range",
    "risk_level": "low|medium|high"
  }
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            ...imageParts
          ]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${err}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  try {
    return JSON.parse(text);
  } catch {
    // Try extracting JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse Gemini response as JSON');
  }
}

/**
 * Analyze images using OpenAI GPT-4o Vision
 */
async function analyzeWithOpenAI(imageUrls: string[], profileContext: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const imageContent = imageUrls.slice(0, 8).map(url => ({
    type: 'image_url' as const,
    image_url: { url, detail: 'low' as const }
  }));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Analyze these Instagram post images. Profile: ${profileContext}. Return JSON with account_type, content_themes, sentiment, authenticity, recommendations.` },
          ...imageContent
        ]
      }],
      max_tokens: 2048,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })
  });

  if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

/**
 * Main analysis function — picks best available provider
 */
export async function analyzeImages(
  imageUrls: string[],
  profileContext: string
): Promise<VisionAnalysisResult> {
  const provider = getProvider();
  let raw: any;

  try {
    if (provider === 'gemini') {
      raw = await analyzeWithGemini(imageUrls, profileContext);
    } else if (provider === 'openai') {
      raw = await analyzeWithOpenAI(imageUrls, profileContext);
    } else {
      throw new Error('No AI vision provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
    }
  } catch (err: any) {
    // If primary fails and we have a fallback, try it
    if (provider === 'gemini' && process.env.OPENAI_API_KEY) {
      raw = await analyzeWithOpenAI(imageUrls, profileContext);
    } else {
      throw err;
    }
  }

  return {
    account_type: {
      primary: raw.account_type?.primary ?? 'unknown',
      niche: raw.account_type?.niche ?? 'unknown',
      confidence: raw.account_type?.confidence ?? 0,
      sub_niches: raw.account_type?.sub_niches ?? [],
      signals: raw.account_type?.signals ?? [],
    },
    content_themes: {
      content_themes: raw.content_themes?.content_themes ?? raw.content_themes?.top_themes ?? [],
      content_style: raw.content_themes?.content_style ?? 'unknown',
      brand_safety_score: raw.content_themes?.brand_safety_score ?? 0,
      content_consistency: raw.content_themes?.content_consistency ?? 'unknown',
    },
    sentiment: {
      overall: raw.sentiment?.overall ?? 'unknown',
      breakdown: raw.sentiment?.breakdown ?? { positive: 0, neutral: 0, negative: 0 },
      emotional_themes: raw.sentiment?.emotional_themes ?? [],
      brand_alignment: raw.sentiment?.brand_alignment ?? [],
    },
    authenticity: {
      score: raw.authenticity?.score ?? 0,
      verdict: raw.authenticity?.verdict ?? 'unknown',
      face_consistency: raw.authenticity?.face_consistency ?? 'unknown',
      engagement_pattern: raw.authenticity?.engagement_vs_followers ?? 'unknown',
      follower_quality: 'unknown',
      comment_analysis: 'unknown',
      fake_signals: {
        stock_photo_detected: raw.authenticity?.stock_photo_detected ?? false,
        engagement_vs_followers: raw.authenticity?.engagement_vs_followers ?? 'unknown',
        follower_growth_pattern: raw.authenticity?.follower_growth_pattern ?? 'unknown',
      }
    },
    images_analyzed: imageUrls.length,
    model_used: provider === 'gemini' ? 'gemini-2.0-flash' : provider === 'openai' ? 'gpt-4o' : 'ollama-llava',
    recommendations: {
      good_for_brands: raw.recommendations?.good_for_brands ?? [],
      estimated_post_value: raw.recommendations?.estimated_post_value ?? 'unknown',
      risk_level: raw.recommendations?.risk_level ?? 'unknown',
    }
  };
}
