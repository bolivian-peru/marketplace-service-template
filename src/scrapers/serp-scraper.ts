/**
 * Mobile SERP Tracker Scraper
 * ─────────────────────────────
 * Scrapes Google Search results from real mobile devices.
 * Returns organic results, PAA, featured snippets, AI Overviews.
 */

import { proxyFetch } from '../proxy';

export interface OrganicResult {
    position: number;
    title: string;
    url: string;
    displayUrl: string;
    snippet: string;
}

export interface PeopleAlsoAsk {
    question: string;
    snippet: string | null;
    source: string | null;
}

export interface FeaturedSnippet {
    text: string;
    source: string;
    sourceUrl: string;
}

export interface AIOverview {
    text: string;
    sources: Array<{ title: string; url: string }>;
}

export interface MapPack {
    name: string;
    rating: number | null;
    reviewCount: number | null;
    address: string | null;
    type: string | null;
}

export interface SerpResult {
    query: string;
    country: string;
    language: string;
    organic: OrganicResult[];
    featuredSnippet: FeaturedSnippet | null;
    aiOverview: AIOverview | null;
    peopleAlsoAsk: PeopleAlsoAsk[];
    relatedSearches: string[];
    mapPack: MapPack[];
    totalResults: string | null;
    page: number;
}

// ─── GOOGLE MOBILE SEARCH SCRAPER ───────────────────

export async function scrapeGoogleMobile(
    query: string,
    options: {
        country?: string;
        language?: string;
        page?: number;
        location?: string;
    } = {},
): Promise<SerpResult> {
    const country = options.country || 'US';
    const language = options.language || 'en';
    const page = options.page || 0;
    const start = page * 10;

    const params = new URLSearchParams({
        q: query,
        hl: language,
        gl: country,
        start: start.toString(),
        num: '10',
    });

    if (options.location) {
        params.set('near', options.location);
    }

    // Use mobile Google URL
    const url = `https://www.google.com/search?${params.toString()}`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            // Mobile user agent is already set by proxyFetch
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': `${language}-${country},${language};q=0.9`,
            'Cache-Control': 'no-cache',
        },
    });

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error('Google rate limited (429). Retrying with new IP recommended.');
        }
        throw new Error(`Google returned ${response.status}`);
    }

    const html = await response.text();

    // Check for CAPTCHA
    if (html.includes('unusual traffic') || html.includes('captcha') || html.includes('recaptcha')) {
        throw new Error('Google CAPTCHA detected. Need IP rotation or CAPTCHA solving.');
    }

    return parseGoogleSERP(html, query, country, language, page);
}

function parseGoogleSERP(
    html: string,
    query: string,
    country: string,
    language: string,
    page: number,
): SerpResult {
    const organic: OrganicResult[] = [];
    const peopleAlsoAsk: PeopleAlsoAsk[] = [];
    const relatedSearches: string[] = [];
    const mapPack: MapPack[] = [];
    let featuredSnippet: FeaturedSnippet | null = null;
    let aiOverview: AIOverview | null = null;

    // ── Parse Organic Results ──
    // Google uses various patterns for search result containers
    const resultPattern = /class="[^"]*(?:g\s|MjjYud|tF2Cxc)[^"]*"[\s\S]*?<\/div>\s*(?:<\/div>){1,3}/g;
    const results = html.match(resultPattern) || [];
    let position = 1;

    for (const result of results.slice(0, 20)) {
        // Extract title and link
        const linkMatch = result.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/);
        if (!linkMatch) continue;

        const url = linkMatch[1];
        const title = linkMatch[2].trim();

        // Skip Google's own results
        if (url.includes('google.com/search') || url.includes('google.com/maps')) continue;

        // Extract snippet
        const snippetMatch = result.match(/class="[^"]*(?:VwiC3b|IsZvec|aCOpRe)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
        const snippet = snippetMatch
            ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
            : '';

        // Extract display URL
        const displayUrlMatch = result.match(/class="[^"]*(?:UWckNb|NJjxre|tjvcx)[^"]*"[^>]*>([^<]+)/);
        const displayUrl = displayUrlMatch?.[1]?.trim() || new URL(url).hostname;

        organic.push({ position: position++, title, url, displayUrl, snippet });
    }

    // ── Parse Featured Snippet ──
    const fsMatch = html.match(/class="[^"]*(?:IZ6rdc|c2xzTb|xpdopen)[^"]*"[\s\S]*?<\/div>/);
    if (fsMatch) {
        const textMatch = fsMatch[0].match(/class="[^"]*(?:LGOjhe|ILfuVd)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
        const sourceMatch = fsMatch[0].match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<(?:span|cite)[^>]*>([^<]+)/);
        if (textMatch) {
            featuredSnippet = {
                text: textMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
                source: sourceMatch?.[2]?.trim() || '',
                sourceUrl: sourceMatch?.[1] || '',
            };
        }
    }

    // ── Parse AI Overview ──
    const aiMatch = html.match(/class="[^"]*(?:yp1CPe|Wt5Tfe|M8OgIe|IThcWe)[^"]*"[\s\S]*?<\/div>/);
    if (aiMatch) {
        const textContent = aiMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (textContent.length > 50) {
            const sourceLinks: Array<{ title: string; url: string }> = [];
            const linkPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/g;
            let linkMatch;
            while ((linkMatch = linkPattern.exec(aiMatch[0])) !== null) {
                if (!linkMatch[1].includes('google.com')) {
                    sourceLinks.push({ title: linkMatch[2].trim() || linkMatch[1], url: linkMatch[1] });
                }
            }
            aiOverview = { text: textContent.slice(0, 1000), sources: sourceLinks };
        }
    }

    // ── Parse People Also Ask ──
    const paaPattern = /class="[^"]*(?:related-question-pair|gqLncc)[^"]*"[\s\S]*?<\/div>/g;
    const paaMatches = html.match(paaPattern) || [];
    for (const paa of paaMatches.slice(0, 8)) {
        const questionMatch = paa.match(/data-q="([^"]+)"/);
        const altQuestionMatch = paa.match(/<span[^>]*>([^<]*\?)[^<]*<\/span>/);
        const question = questionMatch?.[1] || altQuestionMatch?.[1];
        if (question) {
            peopleAlsoAsk.push({
                question: question.trim(),
                snippet: null,
                source: null,
            });
        }
    }

    // ── Parse Related Searches ──
    const relatedPattern = /class="[^"]*(?:s75CSd|k8XOCe|brs_col)[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)/g;
    let relatedMatch;
    while ((relatedMatch = relatedPattern.exec(html)) !== null) {
        const term = relatedMatch[1].trim();
        if (term && !relatedSearches.includes(term)) {
            relatedSearches.push(term);
        }
    }

    // ── Parse Map Pack ──
    const mapPackPattern = /class="[^"]*(?:VkpGBb|cXedhc)[^"]*"[\s\S]*?<\/div>/g;
    const mapMatches = html.match(mapPackPattern) || [];
    for (const mapItem of mapMatches.slice(0, 5)) {
        const nameMatch = mapItem.match(/class="[^"]*(?:qBF1Pd|dbg0pd|OSrXXb)[^"]*"[^>]*>([^<]+)/);
        const ratingMatch = mapItem.match(/([\d.]+)\s*<span[^>]*class="[^"]*(?:yi40Hd|Fam1ne)/);
        const reviewMatch = mapItem.match(/\(([\d,]+)\)/);
        const addressMatch = mapItem.match(/class="[^"]*(?:rllt__details|W4Efsd)[^"]*"[^>]*>[^<]*<span[^>]*>([^<]+)/);

        if (nameMatch) {
            mapPack.push({
                name: nameMatch[1].trim(),
                rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
                reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null,
                address: addressMatch?.[1]?.trim() || null,
                type: null,
            });
        }
    }

    // ── Parse Total Results ──
    const totalMatch = html.match(/About ([\d,]+) results/);
    const totalResults = totalMatch?.[1] || null;

    return {
        query,
        country,
        language,
        organic,
        featuredSnippet,
        aiOverview,
        peopleAlsoAsk,
        relatedSearches,
        mapPack,
        totalResults,
        page,
    };
}
