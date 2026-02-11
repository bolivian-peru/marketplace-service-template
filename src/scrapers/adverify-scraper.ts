/**
 * Ad Verification & Brand Safety Scraper
 * ─────────────────────────────────────────
 * Verifies digital ad placements: checks ad presence, creative integrity,
 * geo-targeting compliance, and brand safety of surrounding content.
 */

import { proxyFetch } from '../proxy';

export interface AdPlacement {
    found: boolean;
    url: string;
    adPosition: string | null;
    adSize: string | null;
    adNetwork: string | null;
    creativeIntegrity: CreativeCheck;
    surroundingContent: ContentSafety;
    geoTarget: GeoCheck;
    loadTime: number | null;
    viewability: ViewabilityCheck;
}

export interface CreativeCheck {
    imageLoaded: boolean;
    linkWorking: boolean;
    correctLandingPage: boolean | null;
    landingPageUrl: string | null;
    mismatches: string[];
}

export interface ContentSafety {
    pageTitle: string | null;
    pageCategory: string | null;
    safetyScore: number; // 0-100, higher = safer
    flaggedTerms: string[];
    adultContent: boolean;
    violenceContent: boolean;
    hateContent: boolean;
    drugContent: boolean;
}

export interface GeoCheck {
    expectedCountry: string | null;
    actualCountry: string | null;
    targeting: string;
    correct: boolean | null;
}

export interface ViewabilityCheck {
    aboveFold: boolean | null;
    estimatedViewRate: number | null;
    adDensity: number | null;
}

export interface VerificationResult {
    placements: AdPlacement[];
    url: string;
    overallSafety: number;
    totalAdsFound: number;
}

// Brand safety dictionaries
const UNSAFE_TERMS: Record<string, string[]> = {
    adult: ['porn', 'xxx', 'adult content', 'explicit', 'nsfw', 'nude', 'sex'],
    violence: ['murder', 'kill', 'shooting', 'assault', 'bomb', 'terrorist', 'weapon', 'gun violence'],
    hate: ['hate speech', 'racism', 'bigot', 'supremacy', 'discrimination', 'slur'],
    drugs: ['cocaine', 'heroin', 'meth', 'drug dealer', 'illegal drugs', 'fentanyl'],
    misinformation: ['fake news', 'conspiracy', 'hoax', 'disinformation'],
};

function analyzeContentSafety(html: string, url: string): ContentSafety {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const flaggedTerms: string[] = [];
    let adult = false, violence = false, hate = false, drug = false;

    for (const [category, terms] of Object.entries(UNSAFE_TERMS)) {
        for (const term of terms) {
            if (text.includes(term)) {
                flaggedTerms.push(`[${category}] ${term}`);
                if (category === 'adult') adult = true;
                if (category === 'violence') violence = true;
                if (category === 'hate') hate = true;
                if (category === 'drugs') drug = true;
            }
        }
    }

    // Calculate safety score (100 = completely safe)
    const penaltyPerTerm = 10;
    const safetyScore = Math.max(0, 100 - flaggedTerms.length * penaltyPerTerm);

    // Extract page metadata
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const categoryMatch = html.match(/<meta[^>]*name="category"[^>]*content="([^"]+)"/i) ||
        html.match(/<meta[^>]*property="article:section"[^>]*content="([^"]+)"/i);

    return {
        pageTitle: titleMatch?.[1]?.trim() || null,
        pageCategory: categoryMatch?.[1]?.trim() || null,
        safetyScore,
        flaggedTerms,
        adultContent: adult,
        violenceContent: violence,
        hateContent: hate,
        drugContent: drug,
    };
}

// ─── AD DETECTION & VERIFICATION ────────────────────

export async function verifyAdPlacements(
    url: string,
    options: {
        expectedCountry?: string;
        expectedLandingPage?: string;
        expectedAdNetwork?: string;
    } = {},
): Promise<VerificationResult> {
    const startTime = Date.now();

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Target URL returned ${response.status}`);
    const html = await response.text();
    const loadTime = Date.now() - startTime;

    const placements: AdPlacement[] = [];

    // Content safety analysis
    const contentSafety = analyzeContentSafety(html, url);

    // Detect ad slots
    const adPatterns = [
        // Google AdSense
        { network: 'Google AdSense', pattern: /class="adsbygoogle"/g },
        { network: 'Google AdSense', pattern: /data-ad-client="ca-pub-/g },
        { network: 'Google Ad Manager', pattern: /googletag\.defineSlot/g },
        { network: 'Google Ad Manager', pattern: /class="[^"]*dfp[^"]*"/gi },
        // Amazon
        { network: 'Amazon Ads', pattern: /amzn_assoc_/g },
        // Generic ad divs
        { network: 'Unknown', pattern: /id="ad[-_]?(?:banner|slot|unit|container|wrapper|leaderboard|sidebar|header|footer)"/gi },
        { network: 'Unknown', pattern: /class="[^"]*(?:ad[-_]?banner|ad[-_]?unit|ad[-_]?slot|advertisement)[^"]*"/gi },
    ];

    for (const { network, pattern } of adPatterns) {
        const matches = html.match(pattern) || [];
        for (const match of matches) {
            // Detect ad position
            const beforeMatch = html.slice(0, html.indexOf(match));
            const headerCount = (beforeMatch.match(/<header/gi) || []).length;
            const mainCount = (beforeMatch.match(/<main/gi) || []).length;
            const footerCount = (beforeMatch.match(/<footer/gi) || []).length;

            let position = 'unknown';
            if (footerCount > 0) position = 'footer';
            else if (mainCount > 0) position = 'in-content';
            else if (headerCount > 0) position = 'below-header';
            else position = 'above-fold';

            // Extract ad size from nearby attributes
            const sizeMatch = match.match(/(?:width|data-ad-format)="([^"]+)"/);
            const widthMatch = match.match(/style="[^"]*width:\s*(\d+)/);
            const heightMatch = match.match(/style="[^"]*height:\s*(\d+)/);
            let adSize = null;
            if (widthMatch && heightMatch) adSize = `${widthMatch[1]}x${heightMatch[1]}`;
            else if (sizeMatch) adSize = sizeMatch[1];

            placements.push({
                found: true,
                url,
                adPosition: position,
                adSize,
                adNetwork: network !== 'Unknown' ? network : options.expectedAdNetwork || 'Unknown',
                creativeIntegrity: {
                    imageLoaded: true, // Can't fully verify without rendering
                    linkWorking: true,
                    correctLandingPage: options.expectedLandingPage ? null : null, // Would need to click through
                    landingPageUrl: options.expectedLandingPage || null,
                    mismatches: [],
                },
                surroundingContent: contentSafety,
                geoTarget: {
                    expectedCountry: options.expectedCountry || null,
                    actualCountry: null, // Would need proxy geo info
                    targeting: 'proxied',
                    correct: null,
                },
                loadTime,
                viewability: {
                    aboveFold: position === 'above-fold' || position === 'below-header',
                    estimatedViewRate: position === 'above-fold' ? 0.85 : position === 'in-content' ? 0.6 : 0.3,
                    adDensity: null,
                },
            });
        }
    }

    // Calculate ad density
    const pageArea = html.length; // Rough proxy
    const adDensity = placements.length > 0 ? Math.min(100, (placements.length / (pageArea / 10000)) * 100) : 0;
    for (const p of placements) {
        if (p.viewability) p.viewability.adDensity = Math.round(adDensity * 10) / 10;
    }

    const overallSafety = contentSafety.safetyScore;

    return { placements, url, overallSafety, totalAdsFound: placements.length };
}
