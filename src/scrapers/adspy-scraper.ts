/**
 * Ad Spy & Creative Intelligence Scraper
 * ─────────────────────────────────────────
 * Monitors competitor ads from Meta Ad Library and Google Ads Transparency.
 */

import { proxyFetch } from '../proxy';

export interface AdCreative {
    advertiser: string;
    adText: string | null;
    headline: string | null;
    description: string | null;
    callToAction: string | null;
    imageUrl: string | null;
    videoUrl: string | null;
    landingPage: string | null;
    startDate: string | null;
    endDate: string | null;
    isActive: boolean;
    platform: string;
    adFormat: string | null;
    impressionRange: string | null;
    spendRange: string | null;
    targetingInfo: string | null;
    adUrl: string;
    source: string;
}

export interface AdSearchResult {
    ads: AdCreative[];
    query: string;
    totalFound: number;
}

// ─── META AD LIBRARY SCRAPER ────────────────────────

export async function scrapeMetaAdLibrary(
    query: string,
    country: string = 'US',
): Promise<AdSearchResult> {
    const params = new URLSearchParams({
        q: query,
        country: country,
        active_status: 'active',
        ad_type: 'all',
        media_type: 'all',
    });

    const url = `https://www.facebook.com/ads/library/?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Meta Ad Library returned ${response.status}`);
    const html = await response.text();

    const ads: AdCreative[] = [];

    // Meta embeds ad data in hidden divs and JSON payloads
    const adCardPattern = /data-testid="ad_library_card"[\s\S]*?<\/div>\s*(?:<\/div>){2,}/g;
    const cards = html.match(adCardPattern) || [];

    for (const card of cards.slice(0, 30)) {
        const advertiserMatch = card.match(/class="[^"]*(?:xjp7ctv|x1lliihq)[^"]*"[^>]*>([^<]+)/);
        const adTextMatch = card.match(/class="[^"]*(?:x193iq5w|xeuugli)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
        const dateMatch = card.match(/(?:Started running on|Started)\s*([A-Za-z]+ \d{1,2}, \d{4})/);
        const imgMatch = card.match(/src="(https:\/\/scontent[^"]+)"/);
        const linkMatch = card.match(/href="(https?:\/\/[^"]+)" target="_blank"/);

        if (advertiserMatch || adTextMatch) {
            ads.push({
                advertiser: advertiserMatch?.[1]?.trim() || 'Unknown',
                adText: adTextMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || null,
                headline: null,
                description: null,
                callToAction: null,
                imageUrl: imgMatch?.[1] || null,
                videoUrl: null,
                landingPage: linkMatch?.[1] || null,
                startDate: dateMatch?.[1] || null,
                endDate: null,
                isActive: true,
                platform: 'meta',
                adFormat: imgMatch ? 'image' : 'text',
                impressionRange: null,
                spendRange: null,
                targetingInfo: null,
                adUrl: url,
                source: 'meta_ad_library',
            });
        }
    }

    // Fallback: JSON-LD or embedded JSON
    if (ads.length === 0) {
        const jsonPattern = /"adArchiveID":"(\d+)"[\s\S]*?"snapshot":\{([\s\S]*?)\}/g;
        let jsonMatch;
        while ((jsonMatch = jsonPattern.exec(html)) !== null && ads.length < 30) {
            try {
                const snapshotStr = `{${jsonMatch[2]}}`;
                const bodyMatch = snapshotStr.match(/"body":\{[^}]*"text":"([^"]+)"/);
                const titleMatch = snapshotStr.match(/"title":"([^"]+)"/);
                const linkUrlMatch = snapshotStr.match(/"link_url":"([^"]+)"/);
                const pageNameMatch = snapshotStr.match(/"page_name":"([^"]+)"/);

                ads.push({
                    advertiser: pageNameMatch?.[1] || 'Unknown',
                    adText: bodyMatch?.[1] || null,
                    headline: titleMatch?.[1] || null,
                    description: null,
                    callToAction: null,
                    imageUrl: null,
                    videoUrl: null,
                    landingPage: linkUrlMatch?.[1] || null,
                    startDate: null,
                    endDate: null,
                    isActive: true,
                    platform: 'meta',
                    adFormat: 'unknown',
                    impressionRange: null,
                    spendRange: null,
                    targetingInfo: null,
                    adUrl: url,
                    source: 'meta_ad_library',
                });
            } catch { /* skip */ }
        }
    }

    return { ads, query, totalFound: ads.length };
}

// ─── GOOGLE ADS TRANSPARENCY SCRAPER ────────────────

export async function scrapeGoogleAdsTransparency(
    query: string,
    region: string = 'US',
): Promise<AdSearchResult> {
    const url = `https://adstransparency.google.com/?region=${region}&query=${encodeURIComponent(query)}`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Google Ads Transparency returned ${response.status}`);
    const html = await response.text();

    const ads: AdCreative[] = [];

    // Google Ads Transparency uses web components and shadow DOM
    // Try embedded JSON data
    const dataMatch = html.match(/AF_initDataCallback\(\{[^}]*data:([\s\S]*?)\}\);/g) || [];
    for (const match of dataMatch) {
        try {
            const jsonStr = match.match(/data:\s*([\s\S]*?)\s*\}\);/)?.[1];
            if (!jsonStr) continue;
            const data = JSON.parse(jsonStr);
            // Navigate Google's nested array structure
            if (Array.isArray(data)) {
                const items = data.flat(3).filter((item: any) => Array.isArray(item) && item.length > 3);
                for (const item of items.slice(0, 30)) {
                    const text = typeof item[1] === 'string' ? item[1] : null;
                    const advertiser = typeof item[0] === 'string' ? item[0] : null;
                    if (text || advertiser) {
                        ads.push({
                            advertiser: advertiser || 'Unknown',
                            adText: text || null,
                            headline: null,
                            description: null,
                            callToAction: null,
                            imageUrl: null,
                            videoUrl: null,
                            landingPage: null,
                            startDate: null,
                            endDate: null,
                            isActive: true,
                            platform: 'google',
                            adFormat: 'search',
                            impressionRange: null,
                            spendRange: null,
                            targetingInfo: null,
                            adUrl: url,
                            source: 'google_ads_transparency',
                        });
                    }
                }
            }
        } catch { /* skip */ }
    }

    // Fallback: basic pattern matching
    if (ads.length === 0) {
        const advertiserPattern = /class="[^"]*advertiser-name[^"]*"[^>]*>([^<]+)/g;
        let advMatch;
        while ((advMatch = advertiserPattern.exec(html)) !== null && ads.length < 30) {
            ads.push({
                advertiser: advMatch[1].trim(),
                adText: null,
                headline: null,
                description: null,
                callToAction: null,
                imageUrl: null,
                videoUrl: null,
                landingPage: null,
                startDate: null,
                endDate: null,
                isActive: true,
                platform: 'google',
                adFormat: 'unknown',
                impressionRange: null,
                spendRange: null,
                targetingInfo: null,
                adUrl: url,
                source: 'google_ads_transparency',
            });
        }
    }

    return { ads, query, totalFound: ads.length };
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function searchAds(
    query: string,
    options: { country?: string; sources?: string[] } = {},
): Promise<AdSearchResult> {
    const sources = options.sources || ['meta', 'google'];
    const country = options.country || 'US';
    const allAds: AdCreative[] = [];
    let totalFound = 0;

    const promises = sources.map(async (source) => {
        try {
            let result: AdSearchResult;
            switch (source) {
                case 'meta':
                    result = await scrapeMetaAdLibrary(query, country);
                    break;
                case 'google':
                    result = await scrapeGoogleAdsTransparency(query, country);
                    break;
                default:
                    throw new Error(`Unknown source: ${source}`);
            }
            allAds.push(...result.ads);
            totalFound += result.totalFound;
        } catch (err: any) {
            console.error(`${source} error: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);
    return { ads: allAds, query, totalFound };
}
