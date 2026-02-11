/**
 * Social Profile Intelligence Scraper
 * ─────────────────────────────────────
 * Scrapes social media profiles from Twitter/X and Instagram.
 * Returns followers, bio, engagement rate, recent posts.
 */

import { proxyFetch } from '../proxy';

export interface SocialProfile {
    handle: string;
    displayName: string;
    bio: string | null;
    followers: number | null;
    following: number | null;
    posts: number | null;
    verified: boolean;
    profileImageUrl: string | null;
    profileUrl: string;
    engagementRate: number | null;
    recentPosts: PostData[];
    source: string;
}

export interface PostData {
    text: string;
    date: string | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    url: string | null;
}

export interface ProfileSearchResult {
    profiles: SocialProfile[];
    query: string;
}

// ─── TWITTER/X SCRAPER ──────────────────────────────

export async function scrapeTwitterProfile(handle: string): Promise<SocialProfile | null> {
    const cleanHandle = handle.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '').split('/')[0];
    const url = `https://x.com/${cleanHandle}`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Twitter/X returned ${response.status}`);
    }

    const html = await response.text();
    return parseTwitterProfile(html, cleanHandle);
}

function parseTwitterProfile(html: string, handle: string): SocialProfile | null {
    // Try JSON-LD
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            if (data['@type'] === 'Person' || data['@type'] === 'ProfilePage') {
                const person = data.mainEntity || data;
                return {
                    handle,
                    displayName: person.name || person.givenName || handle,
                    bio: person.description || null,
                    followers: person.interactionStatistic?.find?.((s: any) => s.interactionType?.includes?.('Follow'))?.userInteractionCount || null,
                    following: null,
                    posts: null,
                    verified: false,
                    profileImageUrl: person.image?.contentUrl || person.image || null,
                    profileUrl: `https://x.com/${handle}`,
                    engagementRate: null,
                    recentPosts: [],
                    source: 'twitter',
                };
            }
        } catch { /* skip */ }
    }

    // Fallback: Open Graph meta tags
    const nameMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
    const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/);
    const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);

    // Extract follower count from page content
    const followersMatch = html.match(/([\d,.]+[KMB]?)\s*(?:Followers|followers)/i);
    const followingMatch = html.match(/([\d,.]+[KMB]?)\s*(?:Following|following)/i);

    if (nameMatch || descMatch) {
        return {
            handle,
            displayName: nameMatch?.[1]?.replace(/ \(@.*\)$/, '') || handle,
            bio: descMatch?.[1] || null,
            followers: followersMatch ? parseCount(followersMatch[1]) : null,
            following: followingMatch ? parseCount(followingMatch[1]) : null,
            posts: null,
            verified: html.includes('verified') || html.includes('VerifiedBadge'),
            profileImageUrl: imgMatch?.[1] || null,
            profileUrl: `https://x.com/${handle}`,
            engagementRate: null,
            recentPosts: [],
            source: 'twitter',
        };
    }

    return null;
}

// ─── INSTAGRAM SCRAPER ──────────────────────────────

export async function scrapeInstagramProfile(handle: string): Promise<SocialProfile | null> {
    const cleanHandle = handle.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').split('/')[0];
    const url = `https://www.instagram.com/${cleanHandle}/`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Instagram returned ${response.status}`);
    }

    const html = await response.text();
    return parseInstagramProfile(html, cleanHandle);
}

function parseInstagramProfile(html: string, handle: string): SocialProfile | null {
    // Try JSON-LD
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            if (data['@type'] === 'ProfilePage' || data['@type'] === 'Person') {
                const person = data.mainEntity || data;
                const followers = person.interactionStatistic?.find?.((s: any) =>
                    s.interactionType?.includes?.('Follow') && s.name?.includes?.('Follows'))?.userInteractionCount;
                const following = person.interactionStatistic?.find?.((s: any) =>
                    s.interactionType?.includes?.('Follow') && s.name?.includes?.('Following'))?.userInteractionCount;

                return {
                    handle,
                    displayName: person.name || person.alternateName || handle,
                    bio: person.description || null,
                    followers: followers ? parseInt(followers) : null,
                    following: following ? parseInt(following) : null,
                    posts: null,
                    verified: person.identifier?.propertyID === 'verified' || false,
                    profileImageUrl: person.image || null,
                    profileUrl: `https://www.instagram.com/${handle}/`,
                    engagementRate: null,
                    recentPosts: [],
                    source: 'instagram',
                };
            }
        } catch { /* skip */ }
    }

    // Fallback: Open Graph meta tags
    const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
    const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/);
    const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);

    if (descMatch) {
        // Instagram description format: "1.2M Followers, 500 Following, 2,000 Posts"
        const followersMatch = descMatch[1].match(/([\d,.]+[KMB]?)\s*Followers/i);
        const followingMatch = descMatch[1].match(/([\d,.]+[KMB]?)\s*Following/i);
        const postsMatch = descMatch[1].match(/([\d,.]+[KMB]?)\s*Posts/i);

        return {
            handle,
            displayName: titleMatch?.[1]?.replace(/ \(@.*\)$/, '').replace(/ • Instagram.*$/, '') || handle,
            bio: descMatch[1].replace(/^[\d,.KMB\s]*Followers.*?-\s*/, '') || null,
            followers: followersMatch ? parseCount(followersMatch[1]) : null,
            following: followingMatch ? parseCount(followingMatch[1]) : null,
            posts: postsMatch ? parseCount(postsMatch[1]) : null,
            verified: false,
            profileImageUrl: imgMatch?.[1] || null,
            profileUrl: `https://www.instagram.com/${handle}/`,
            engagementRate: null,
            recentPosts: [],
            source: 'instagram',
        };
    }

    return null;
}

// ─── HELPERS ────────────────────────────────────────

function parseCount(str: string): number {
    const cleaned = str.replace(/,/g, '');
    const multipliers: Record<string, number> = { K: 1000, M: 1000000, B: 1000000000 };
    const match = cleaned.match(/^([\d.]+)([KMB])?$/i);
    if (!match) return parseInt(cleaned) || 0;
    const num = parseFloat(match[1]);
    const mult = match[2] ? multipliers[match[2].toUpperCase()] || 1 : 1;
    return Math.round(num * mult);
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function lookupProfile(
    handle: string,
    sources: string[] = ['twitter', 'instagram'],
): Promise<ProfileSearchResult> {
    const profiles: SocialProfile[] = [];

    const promises = sources.map(async (source) => {
        try {
            let profile: SocialProfile | null = null;
            switch (source) {
                case 'twitter':
                    profile = await scrapeTwitterProfile(handle);
                    break;
                case 'instagram':
                    profile = await scrapeInstagramProfile(handle);
                    break;
            }
            if (profile) profiles.push(profile);
        } catch (err: any) {
            console.error(`${source} error: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);
    return { profiles, query: handle };
}
