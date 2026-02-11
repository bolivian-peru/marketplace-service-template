/**
 * Real Estate Listing Scraper
 * ────────────────────────────
 * Scrapes property listings from Zillow and Redfin.
 * Returns structured data: address, price, beds/baths, sqft, etc.
 */

import { proxyFetch } from '../proxy';

export interface PropertyListing {
    address: string;
    price: number | null;
    priceFormatted: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    lotSize: string | null;
    yearBuilt: number | null;
    propertyType: string | null;
    listingStatus: string;
    daysOnMarket: number | null;
    priceHistory: PriceChange[];
    listingAgent: string | null;
    listingUrl: string;
    imageUrl: string | null;
    source: string;
    latitude: number | null;
    longitude: number | null;
}

export interface PriceChange {
    date: string;
    price: number;
    event: string;
}

export interface RealEstateSearchResult {
    listings: PropertyListing[];
    totalFound: number;
    query: string;
    searchType: string;
}

// ─── ZILLOW SCRAPER ─────────────────────────────────

export async function scrapeZillow(
    location: string,
    minPrice?: number,
    maxPrice?: number,
    beds?: number,
): Promise<RealEstateSearchResult> {
    // Zillow search URL
    const searchTerm = encodeURIComponent(location);
    let url = `https://www.zillow.com/homes/${searchTerm}_rb/`;

    // Build filter params
    const filterState: any = { isForSaleByAgent: { value: true }, isForSaleByOwner: { value: true } };
    if (minPrice) filterState.price = { ...filterState.price, min: minPrice };
    if (maxPrice) filterState.price = { ...filterState.price, max: maxPrice };
    if (beds) filterState.beds = { min: beds };

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
        },
    });

    if (!response.ok) {
        throw new Error(`Zillow returned ${response.status}`);
    }

    const html = await response.text();
    return parseZillowHTML(html, location);
}

function parseZillowHTML(html: string, location: string): RealEstateSearchResult {
    const listings: PropertyListing[] = [];

    // Zillow embeds search results as JSON in a script tag
    const dataMatch = html.match(/<!--"listResults":([\s\S]*?)-->/);
    const preloadMatch = html.match(/"searchResults":\s*(\{[\s\S]*?\})\s*,\s*"(?:mapResults|totalResultCount)"/);
    const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

    // Try __NEXT_DATA__ approach
    if (jsonMatch) {
        try {
            const nextData = JSON.parse(jsonMatch[1]);
            const searchResults = nextData?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults || [];
            for (const result of searchResults.slice(0, 40)) {
                listings.push({
                    address: result.address || result.addressStreet || 'Unknown',
                    price: result.unformattedPrice || result.price ? parseInt(String(result.price).replace(/[^0-9]/g, '')) : null,
                    priceFormatted: result.price || null,
                    beds: result.beds || null,
                    baths: result.baths || null,
                    sqft: result.area || null,
                    lotSize: result.lotAreaString || null,
                    yearBuilt: null,
                    propertyType: result.hdpData?.homeInfo?.homeType || null,
                    listingStatus: result.statusText || 'For Sale',
                    daysOnMarket: result.hdpData?.homeInfo?.daysOnZillow || null,
                    priceHistory: [],
                    listingAgent: result.brokerName || null,
                    listingUrl: result.detailUrl ? `https://www.zillow.com${result.detailUrl}` : '',
                    imageUrl: result.imgSrc || null,
                    source: 'zillow',
                    latitude: result.latLong?.latitude || null,
                    longitude: result.latLong?.longitude || null,
                });
            }
        } catch {
            // Fall through to regex parsing
        }
    }

    // Fallback: parse JSON-LD
    if (listings.length === 0) {
        const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        for (const match of jsonLdMatches) {
            try {
                const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
                if (data['@type'] === 'ItemList' && data.itemListElement) {
                    for (const item of data.itemListElement) {
                        const listing = item.item || item;
                        if (listing['@type'] === 'SingleFamilyResidence' || listing['@type'] === 'Apartment') {
                            listings.push({
                                address: listing.name || listing.address?.streetAddress || 'Unknown',
                                price: listing.offers?.price || null,
                                priceFormatted: listing.offers?.price ? `$${Number(listing.offers.price).toLocaleString()}` : null,
                                beds: listing.numberOfRooms || null,
                                baths: null,
                                sqft: listing.floorSize?.value || null,
                                lotSize: null,
                                yearBuilt: null,
                                propertyType: listing['@type'] || null,
                                listingStatus: 'For Sale',
                                daysOnMarket: null,
                                priceHistory: [],
                                listingAgent: null,
                                listingUrl: listing.url || '',
                                imageUrl: listing.image || null,
                                source: 'zillow',
                                latitude: listing.geo?.latitude || null,
                                longitude: listing.geo?.longitude || null,
                            });
                        }
                    }
                }
            } catch {
                // Skip
            }
        }
    }

    // Fallback: basic HTML card parsing
    if (listings.length === 0) {
        const cardPattern = /data-test="property-card"[\s\S]*?<\/article>/g;
        const cards = html.match(cardPattern) || [];
        for (const card of cards.slice(0, 40)) {
            const addressMatch = card.match(/data-test="property-card-addr"[^>]*>([^<]+)/);
            const priceMatch = card.match(/data-test="property-card-price"[^>]*>([^<]+)/);
            const bedsMatch = card.match(/([\d.]+)\s*b(?:e)?ds?/i);
            const bathsMatch = card.match(/([\d.]+)\s*ba(?:th)?s?/i);
            const sqftMatch = card.match(/([\d,]+)\s*sqft/i);
            const linkMatch = card.match(/href="(\/homedetails\/[^"]+)"/);

            if (addressMatch || priceMatch) {
                const priceStr = priceMatch?.[1]?.replace(/[^0-9]/g, '');
                listings.push({
                    address: addressMatch?.[1]?.trim() || 'Unknown',
                    price: priceStr ? parseInt(priceStr) : null,
                    priceFormatted: priceMatch?.[1]?.trim() || null,
                    beds: bedsMatch ? parseFloat(bedsMatch[1]) : null,
                    baths: bathsMatch ? parseFloat(bathsMatch[1]) : null,
                    sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
                    lotSize: null,
                    yearBuilt: null,
                    propertyType: null,
                    listingStatus: 'For Sale',
                    daysOnMarket: null,
                    priceHistory: [],
                    listingAgent: null,
                    listingUrl: linkMatch ? `https://www.zillow.com${linkMatch[1]}` : '',
                    imageUrl: null,
                    source: 'zillow',
                    latitude: null,
                    longitude: null,
                });
            }
        }
    }

    const countMatch = html.match(/([\d,]+)\s*(?:results|homes)/i);
    const totalFound = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : listings.length;

    return { listings, totalFound, query: location, searchType: 'location' };
}

// ─── REDFIN SCRAPER ─────────────────────────────────

export async function scrapeRedfin(
    location: string,
    minPrice?: number,
    maxPrice?: number,
    beds?: number,
): Promise<RealEstateSearchResult> {
    const searchTerm = encodeURIComponent(location);
    const url = `https://www.redfin.com/city/0/search?q=${searchTerm}`;

    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error(`Redfin returned ${response.status}`);
    }

    const html = await response.text();
    return parseRedfinHTML(html, location);
}

function parseRedfinHTML(html: string, location: string): RealEstateSearchResult {
    const listings: PropertyListing[] = [];

    // Redfin embeds data in window.__reactServerState or similar
    const dataMatch = html.match(/window\.__reactServerState\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (dataMatch) {
        try {
            const data = JSON.parse(dataMatch[1]);
            // Navigate Redfin's data structure for listings
            const homes = data?.payload?.homes || [];
            for (const home of homes.slice(0, 40)) {
                listings.push({
                    address: home.streetLine?.value
                        ? `${home.streetLine.value}, ${home.city || ''}, ${home.state || ''} ${home.zip || ''}`
                        : 'Unknown',
                    price: home.price?.value || null,
                    priceFormatted: home.price?.value ? `$${Number(home.price.value).toLocaleString()}` : null,
                    beds: home.beds || null,
                    baths: home.baths || null,
                    sqft: home.sqFt?.value || null,
                    lotSize: home.lotSize?.value ? `${home.lotSize.value} sqft` : null,
                    yearBuilt: home.yearBuilt?.value || null,
                    propertyType: home.propertyType || null,
                    listingStatus: home.listingType || 'For Sale',
                    daysOnMarket: home.dom?.value || null,
                    priceHistory: [],
                    listingAgent: home.listingAgent || null,
                    listingUrl: home.url ? `https://www.redfin.com${home.url}` : '',
                    imageUrl: home.photoUrls?.[0] || null,
                    source: 'redfin',
                    latitude: home.latLong?.latitude || null,
                    longitude: home.latLong?.longitude || null,
                });
            }
        } catch {
            // Fall through
        }
    }

    // Fallback: JSON-LD
    if (listings.length === 0) {
        const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        for (const match of jsonLdMatches) {
            try {
                const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
                if (data['@type'] === 'SearchResultsPage' && data.about?.itemListElement) {
                    for (const item of data.about.itemListElement) {
                        const listing = item.item || item;
                        listings.push({
                            address: listing.name || listing.address || 'Unknown',
                            price: listing.offers?.price || null,
                            priceFormatted: listing.offers?.price ? `$${Number(listing.offers.price).toLocaleString()}` : null,
                            beds: null,
                            baths: null,
                            sqft: null,
                            lotSize: null,
                            yearBuilt: null,
                            propertyType: null,
                            listingStatus: 'For Sale',
                            daysOnMarket: null,
                            priceHistory: [],
                            listingAgent: null,
                            listingUrl: listing.url || '',
                            imageUrl: listing.image || null,
                            source: 'redfin',
                            latitude: null,
                            longitude: null,
                        });
                    }
                }
            } catch {
                // Skip
            }
        }
    }

    const countMatch = html.match(/([\d,]+)\s*homes?\s*(?:for sale|found)/i);
    const totalFound = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : listings.length;

    return { listings, totalFound, query: location, searchType: 'location' };
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function searchProperties(
    location: string,
    options: { minPrice?: number; maxPrice?: number; beds?: number; sources?: string[] } = {},
): Promise<RealEstateSearchResult> {
    const sources = options.sources || ['zillow', 'redfin'];
    const allListings: PropertyListing[] = [];
    let totalFound = 0;

    const promises = sources.map(async (source) => {
        try {
            let result: RealEstateSearchResult;
            switch (source) {
                case 'zillow':
                    result = await scrapeZillow(location, options.minPrice, options.maxPrice, options.beds);
                    break;
                case 'redfin':
                    result = await scrapeRedfin(location, options.minPrice, options.maxPrice, options.beds);
                    break;
                default:
                    throw new Error(`Unknown source: ${source}`);
            }
            allListings.push(...result.listings);
            totalFound += result.totalFound;
        } catch (err: any) {
            // Continue with other sources
            console.error(`${source} error: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);

    // Sort by price descending
    allListings.sort((a, b) => (b.price || 0) - (a.price || 0));

    return { listings: allListings, totalFound, query: location, searchType: 'location' };
}
