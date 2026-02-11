/**
 * Review & Reputation Scraper
 * ────────────────────────────
 * Scrapes business reviews from Google Maps and Yelp.
 * Returns reviews, ratings, sentiment, keyword extraction.
 */

import { proxyFetch } from '../proxy';

export interface Review {
    author: string;
    rating: number | null;
    date: string | null;
    text: string;
    source: string;
    helpful: number | null;
}

export interface BusinessReviews {
    businessName: string;
    overallRating: number | null;
    totalReviews: number | null;
    ratingDistribution: Record<string, number>;
    reviews: Review[];
    topKeywords: string[];
    sentimentSummary: { positive: number; neutral: number; negative: number };
    source: string;
    url: string;
}

export interface ReviewSearchResult {
    businesses: BusinessReviews[];
    query: string;
}

// ─── SENTIMENT ANALYSIS (simple keyword-based) ──────

const POSITIVE_WORDS = ['great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'best', 'awesome', 'perfect', 'friendly', 'delicious', 'recommend', 'outstanding', 'clean', 'helpful', 'fast', 'professional'];
const NEGATIVE_WORDS = ['terrible', 'horrible', 'awful', 'worst', 'bad', 'hate', 'disgusting', 'rude', 'dirty', 'slow', 'overpriced', 'cold', 'stale', 'avoid', 'disappointing', 'poor', 'never again'];

function analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
    const lower = text.toLowerCase();
    let pos = 0, neg = 0;
    for (const w of POSITIVE_WORDS) if (lower.includes(w)) pos++;
    for (const w of NEGATIVE_WORDS) if (lower.includes(w)) neg++;
    if (pos > neg + 1) return 'positive';
    if (neg > pos + 1) return 'negative';
    if (pos > neg) return 'positive';
    if (neg > pos) return 'negative';
    return 'neutral';
}

function extractKeywords(reviews: Review[]): string[] {
    const wordCount: Record<string, number> = {};
    const stopWords = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'were', 'it', 'i', 'we', 'they', 'this', 'that', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'not', 'no', 'so', 'very', 'have', 'had', 'has', 'been', 'would', 'could', 'will', 'just', 'my', 'our', 'your', 'their', 'here', 'there', 'if', 'about', 'got', 'get', 'go', 'going', 'back', 'out', 'up', 'one', 'two', 'also', 'really', 'don', 'didn', 'can', 'do', 'did', 'be', 'its']);

    for (const review of reviews) {
        const words = review.text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
        for (const word of words) {
            if (word.length > 3 && !stopWords.has(word)) {
                wordCount[word] = (wordCount[word] || 0) + 1;
            }
        }
    }

    return Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => word);
}

// ─── GOOGLE MAPS REVIEWS SCRAPER ────────────────────

export async function scrapeGoogleMapsReviews(
    query: string,
    location?: string,
): Promise<BusinessReviews[]> {
    const searchQuery = location ? `${query} ${location}` : query;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Google Maps returned ${response.status}`);
    const html = await response.text();

    const businesses: BusinessReviews[] = [];

    // Parse JSON-LD for business data
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item['@type'] === 'LocalBusiness' || item['@type']?.includes('Restaurant') || item['@type']?.includes('Store')) {
                    const reviews: Review[] = (item.review || []).map((r: any) => ({
                        author: r.author?.name || 'Anonymous',
                        rating: r.reviewRating?.ratingValue || null,
                        date: r.datePublished || null,
                        text: r.reviewBody || r.description || '',
                        source: 'google_maps',
                        helpful: null,
                    }));

                    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
                    for (const r of reviews) {
                        sentimentCounts[analyzeSentiment(r.text)]++;
                    }

                    businesses.push({
                        businessName: item.name || 'Unknown',
                        overallRating: item.aggregateRating?.ratingValue || null,
                        totalReviews: item.aggregateRating?.reviewCount || reviews.length,
                        ratingDistribution: {},
                        reviews,
                        topKeywords: extractKeywords(reviews),
                        sentimentSummary: sentimentCounts,
                        source: 'google_maps',
                        url: item.url || url,
                    });
                }
            }
        } catch { /* skip */ }
    }

    // Fallback: extract from page metadata
    if (businesses.length === 0) {
        const nameMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
        const ratingMatch = html.match(/([\d.]+)\s*stars?/i);
        const reviewCountMatch = html.match(/([\d,]+)\s*reviews?/i);

        if (nameMatch) {
            businesses.push({
                businessName: nameMatch[1],
                overallRating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
                totalReviews: reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : null,
                ratingDistribution: {},
                reviews: [],
                topKeywords: [],
                sentimentSummary: { positive: 0, neutral: 0, negative: 0 },
                source: 'google_maps',
                url,
            });
        }
    }

    return businesses;
}

// ─── YELP REVIEWS SCRAPER ───────────────────────────

export async function scrapeYelpReviews(
    query: string,
    location?: string,
): Promise<BusinessReviews[]> {
    const params = new URLSearchParams({ find_desc: query });
    if (location) params.set('find_loc', location);

    const url = `https://www.yelp.com/search?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Yelp returned ${response.status}`);
    const html = await response.text();

    const businesses: BusinessReviews[] = [];

    // Parse JSON-LD
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            const items = Array.isArray(data) ? data : data['@graph'] || [data];
            for (const item of items) {
                if (item['@type'] === 'LocalBusiness' || item['@type']?.includes('Restaurant')) {
                    const reviews: Review[] = (item.review || []).slice(0, 20).map((r: any) => ({
                        author: r.author || 'Anonymous',
                        rating: r.reviewRating?.ratingValue || null,
                        date: r.datePublished || null,
                        text: r.description || '',
                        source: 'yelp',
                        helpful: null,
                    }));

                    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
                    for (const r of reviews) {
                        sentimentCounts[analyzeSentiment(r.text)]++;
                    }

                    businesses.push({
                        businessName: item.name || 'Unknown',
                        overallRating: item.aggregateRating?.ratingValue || null,
                        totalReviews: item.aggregateRating?.reviewCount || reviews.length,
                        ratingDistribution: {},
                        reviews,
                        topKeywords: extractKeywords(reviews),
                        sentimentSummary: sentimentCounts,
                        source: 'yelp',
                        url: item.url || url,
                    });
                }
            }
        } catch { /* skip */ }
    }

    return businesses;
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function searchReviews(
    query: string,
    location?: string,
    sources: string[] = ['google_maps', 'yelp'],
): Promise<ReviewSearchResult> {
    const allBusinesses: BusinessReviews[] = [];

    const promises = sources.map(async (source) => {
        try {
            switch (source) {
                case 'google_maps':
                    allBusinesses.push(...await scrapeGoogleMapsReviews(query, location));
                    break;
                case 'yelp':
                    allBusinesses.push(...await scrapeYelpReviews(query, location));
                    break;
            }
        } catch (err: any) {
            console.error(`${source} error: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);

    return { businesses: allBusinesses, query };
}
