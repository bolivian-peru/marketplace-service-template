import { proxyFetch } from '../proxy';
import { maskSecrets } from '../utils/security';
import * as crypto from 'node:crypto';

export interface FoodPriceInfo {
    name: string;
    price: number;
    currency: string;
    description?: string;
    imageUrl?: string;
}

export interface RestaurantInfo {
    id: string;
    name: string;
    address?: string;
    rating?: number;
    items: FoodPriceInfo[];
    collection_meta?: {
        collected_at: string;
        node_id: string;
        latency_ms: number;
        sha256: string;
    };
}

/**
 * Uber Eats Scraper
 * Fetches restaurant menu and prices using public web API.
 */
export async function scrapeUberEats(storeUuid: string, lat: number, lng: number): Promise<RestaurantInfo> {
    const url = 'https://www.ubereats.com/_p/api/getStoreV1';
    
    // Exact payload from capture
    const body = {
        storeUuid,
        diningMode: "DELIVERY",
        time: {
            asap: true
        },
        cbType: "EATER_ENDORSED"
    };

    const startTime = Date.now();
    const response = await proxyFetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-csrf-token': 'x',
            'x-uber-target-location-latitude': String(lat),
            'x-uber-target-location-longitude': String(lng),
            'x-uber-request-id': crypto.randomUUID(),
            'x-uber-session-id': crypto.randomUUID()
        },
        body: JSON.stringify(body)
    });

    const latency_ms = Date.now() - startTime;

    if (!response.ok) {
        throw new Error(`Failed to fetch Uber Eats store: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const sha256 = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const store = data?.data;
    
    if (!store) {
        throw new Error('Invalid response from Uber Eats: No store data found.');
    }

    const name = store.title?.text || store.title || store.name || 'Unknown Restaurant';

    const catalogSectionsMap = store.catalogSectionsMap || {};
    const sectionEntitiesMap = store.sectionEntitiesMap || {};
    const items: FoodPriceInfo[] = [];
    
    // Try sectionEntitiesMap first
    for (const id in sectionEntitiesMap) {
        const entity = sectionEntitiesMap[id];
        if (entity.payload?.standardItemsPayload?.catalogItems) {
             const catalogItems = entity.payload.standardItemsPayload.catalogItems;
             for (const item of catalogItems) {
                items.push({
                    name: item.title?.text || item.title || item.name,
                    price: (item.price || item.unitPrice || 0) / 100,
                    currency: item.currencyCode || 'USD',
                    description: item.description?.text || item.description,
                    imageUrl: item.imageUrl
                });
            }
        }
    }

    // Fallback or additional check for catalogSectionsMap
    for (const sectionId in catalogSectionsMap) {
        const rawSection = catalogSectionsMap[sectionId];
        const subSections = Array.isArray(rawSection) ? rawSection : [rawSection];
        
        for (const section of subSections) {
            const catalogItems = section.payload?.standardItemsPayload?.catalogItems || section.items || [];
            if (catalogItems.length > 0) {
                for (const item of catalogItems) {
                    items.push({
                        name: item.title?.text || item.title || item.name,
                        price: (item.price || item.unitPrice || 0) / 100,
                        currency: item.currencyCode || 'USD',
                        description: item.description?.text || item.description,
                        imageUrl: item.imageUrl
                    });
                }
            }
        }
    }

    return {
        id: store.uuid,
        name,
        address: store.location?.address,
        rating: store.rating?.ratingValue,
        items,
        collection_meta: {
            collected_at: new Date().toISOString(),
            node_id: 'STARK-AEA-01',
            latency_ms,
            sha256
        }
    };
}

/**
 * Search for restaurants on Uber Eats
 */
export async function searchUberEats(query: string, lat: number, lng: number): Promise<any[]> {
    const url = 'https://www.ubereats.com/_p/api/getSearchFeedV1';
    
    // Exact payload from capture
    const body = {
        userQuery: query,
        date: "",
        startTime: 0,
        endTime: 0,
        sortAndFilters: [],
        vertical: "ALL",
        searchSource: "SEARCH_BAR",
        displayType: "SEARCH_RESULTS",
        searchType: "GLOBAL_SEARCH",
        keyName: "",
        cacheKey: "",
        recaptchaToken: ""
    };

    const response = await proxyFetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-csrf-token': 'x',
            'x-uber-target-location-latitude': String(lat),
            'x-uber-target-location-longitude': String(lng)
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) return [];
    
    const data: any = await response.json();
    const feedItems = data?.data?.feedItems || data?.data?.searchFeed?.feedItems || [];
    
    // Extract stores from the feed
    const stores: any[] = [];
    for (const item of feedItems) {
        const store = item.store || item.payload?.storePayload?.store;
        const id = store?.uuid || item.uuid;
        const name = store?.title?.text || store?.title || item.title || store?.name || item.name;

        if (id && name && typeof name === 'string') {
            stores.push({
                id,
                name,
                rating: store?.rating?.ratingValue || item.rating?.ratingValue,
                imageUrl: store?.imageUrl || item.imageUrl
            });
        } else if (id && name && (name as any).text) {
             stores.push({
                id,
                name: (name as any).text,
                rating: store?.rating?.ratingValue || item.rating?.ratingValue,
                imageUrl: store?.imageUrl || item.imageUrl
            });
        }
    }
    
    return stores;
}
