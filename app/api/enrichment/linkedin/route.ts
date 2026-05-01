import { NextResponse } from 'next/server';
import { z } from 'zod';

// -----------------------------------------------------------------------------
// [Master Senior Architecture] LinkedIn Enrichment API
// Implements: Zod Validation, Error Boundaries, External Provider Abstraction.
// -----------------------------------------------------------------------------

const EnrichmentQuerySchema = z.object({
  linkedinUrl: z.string().url("Must be a valid URL").includes("linkedin.com/in/", { message: "Must be a LinkedIn profile URL" }),
  useCache: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 1. Strict Input Validation
    const parsed = EnrichmentQuerySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ 
        success: false, 
        error: "VALIDATION_FAILED", 
        details: parsed.error.format() 
      }, { status: 400 });
    }

    const { linkedinUrl, useCache } = parsed.data;

    // 2. Integration with External Enrichment Provider (e.g., Proxycurl)
    // Abstracted to allow easy provider swapping via Env variables.
    const apiKey = process.env.ENRICHMENT_API_KEY;
    if (!apiKey) {
      console.error("[Enrichment Service] Missing API Key");
      return NextResponse.json({ success: false, error: "SERVICE_UNAVAILABLE" }, { status: 503 });
    }

    const apiUrl = `https://nubela.co/proxycurl/api/v2/linkedin?url=${encodeURIComponent(linkedinUrl)}&use_cache=${useCache ? 'if-present' : 'if-recent'}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      next: { revalidate: 86400 } // Next.js Cache optimization (24h)
    });

    if (!response.ok) {
      throw new Error(`Provider returned ${response.status}`);
    }

    const enrichmentData = await response.json();

    // 3. Data Transformation & Normalization (Standardizing the output)
    const normalizedData = {
      profileId: enrichmentData.public_identifier,
      fullName: enrichmentData.full_name,
      headline: enrichmentData.occupation,
      location: `${enrichmentData.city}, ${enrichmentData.country}`,
      experiences: enrichmentData.experiences.map((exp: any) => ({
        company: exp.company,
        title: exp.title,
        isCurrent: !exp.ends_at,
      })),
      enrichedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: normalizedData,
    }, { status: 200 });

  } catch (error: any) {
    console.error('[Enrichment API Error]', error);
    return NextResponse.json({ 
      success: false, 
      error: "INTERNAL_SERVER_ERROR",
      message: error.message 
    }, { status: 500 });
  }
}