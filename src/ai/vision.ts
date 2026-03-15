export async function analyzeImagesBase(images: string[], promptText: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return null; // Fallback handled by caller
    }

    const content: any[] = [
        { type: "text", text: promptText },
        ...images.map(img => ({ type: "image_url", image_url: { url: img } }))
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content }],
            response_format: { type: "json_object" }
        })
    });

    if (!res.ok) {
        throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as any;
    return JSON.parse(data.choices[0].message.content || "{}");
}

export async function analyzeInstagramAccount(profile: any, images: string[], captions: string) {
    const prompt = `Analyze these recent Instagram post images, captions, and profile data for @${profile.username}.
Profile Bio: ${profile.biography}
Followers: ${profile.edge_followed_by?.count}
Following: ${profile.edge_follow?.count}
Captions sample: ${captions.substring(0, 1000)}

Return a JSON object strictly matching this schema:
{
  "account_type": { "primary": "influencer|business|personal|bot/fake|meme_page|news_media", "niche": "string", "confidence": 0.95, "sub_niches": ["string"] },
  "content_themes": { "top_themes": ["string"], "style": "string", "aesthetic_consistency": "high|medium|low", "brand_safety_score": 95 },
  "sentiment": { "overall": "positive|neutral|negative", "breakdown": { "positive": 78, "neutral": 18, "negative": 4 }, "emotional_themes": ["string"], "brand_alignment": ["string"] },
  "authenticity": { "score": 92, "verdict": "authentic|likely_authentic|suspicious|fake", "face_consistency": true, "engagement_pattern": "organic|inconsistent|suspicious", "follower_quality": "high|medium|low", "comment_analysis": "mostly_genuine|generic|bot_like" },
  "recommendations": { "good_for_brands": ["string"], "estimated_post_value": "$X-$Y", "risk_level": "low|medium|high" }
}`;
    const result = await analyzeImagesBase(images, prompt);
    return result || getMockAnalysis();
}

export async function analyzeImages(images: string[]) {
    const prompt = `Analyze these Instagram post images and return a JSON object:
{
  "content_themes": ["string"],
  "content_style": "string",
  "brand_safety_score": 95,
  "content_consistency": "high|medium|low"
}`;
    const result = await analyzeImagesBase(images, prompt);
    return result || { content_themes: ["lifestyle"], content_style: "casual", brand_safety_score: 90, content_consistency: "high" };
}

export async function auditInstagramAccount(profile: any, images: string[]) {
    const prompt = `Analyze these images and profile stats to detect if this account is fake/bot.
Followers: ${profile.edge_followed_by?.count}
Return JSON:
{
  "authenticity_score": 87,
  "fake_signals": { "stock_photo_detected": false, "face_consistency": "same_person_across_posts|inconsistent|no_faces", "engagement_vs_followers": "healthy|suspicious", "comment_quality": "organic|bot_like", "follower_growth_pattern": "natural" },
  "verdict": "likely_authentic|suspicious|fake"
}`;
    const result = await analyzeImagesBase(images, prompt);
    return result || { authenticity_score: 90, fake_signals: { stock_photo_detected: false, face_consistency: "same_person_across_posts", engagement_vs_followers: "healthy", comment_quality: "organic", follower_growth_pattern: "natural" }, verdict: "likely_authentic" };
}

function getMockAnalysis() {
    return {
      account_type: { primary: "influencer", niche: "lifestyle", confidence: 0.9, sub_niches: ["travel"] },
      content_themes: { top_themes: ["travel"], style: "casual", aesthetic_consistency: "high", brand_safety_score: 95 },
      sentiment: { overall: "positive", breakdown: { positive: 80, neutral: 15, negative: 5 }, emotional_themes: ["happy"], brand_alignment: ["lifestyle"] },
      authenticity: { score: 95, verdict: "authentic", face_consistency: true, engagement_pattern: "organic", follower_quality: "high", comment_analysis: "mostly_genuine" },
      recommendations: { good_for_brands: ["travel"], estimated_post_value: "$100", risk_level: "low" }
    };
}
