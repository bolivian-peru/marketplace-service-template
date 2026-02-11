/**
 * E-Commerce Price & Stock Scraper
 * ──────────────────────────────────
 * Scrapes product prices and availability from Amazon and Walmart.
 */

import { proxyFetch } from '../proxy';

export interface ProductData {
    title: string;
    price: number | null;
    priceFormatted: string | null;
    originalPrice: number | null;
    currency: string;
    availability: string;
    inStock: boolean;
    seller: string | null;
    rating: number | null;
    reviewCount: number | null;
    bsr: string | null; // Best Sellers Rank
    category: string | null;
    imageUrl: string | null;
    productUrl: string;
    asin: string | null; // Amazon ASIN
    source: string;
}

export interface ProductSearchResult {
    products: ProductData[];
    query: string;
    totalFound: number;
}

// ─── AMAZON SCRAPER ─────────────────────────────────

export async function scrapeAmazon(
    query: string,
    page: number = 1,
): Promise<ProductSearchResult> {
    const params = new URLSearchParams({
        k: query,
        page: page.toString(),
    });

    const url = `https://www.amazon.com/s?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate',
        },
    });

    if (!response.ok) throw new Error(`Amazon returned ${response.status}`);
    const html = await response.text();

    const products: ProductData[] = [];

    // Try JSON-LD structured data
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item['@type'] === 'Product') {
                    const offer = item.offers?.[0] || item.offers || {};
                    products.push({
                        title: item.name || 'Unknown',
                        price: offer.price ? parseFloat(offer.price) : null,
                        priceFormatted: offer.price ? `$${offer.price}` : null,
                        originalPrice: null,
                        currency: offer.priceCurrency || 'USD',
                        availability: offer.availability?.includes('InStock') ? 'In Stock' : 'Out of Stock',
                        inStock: offer.availability?.includes('InStock') || false,
                        seller: offer.seller?.name || null,
                        rating: item.aggregateRating?.ratingValue || null,
                        reviewCount: item.aggregateRating?.reviewCount || null,
                        bsr: null,
                        category: item.category || null,
                        imageUrl: item.image || null,
                        productUrl: item.url || '',
                        asin: null,
                        source: 'amazon',
                    });
                }
            }
        } catch { /* skip */ }
    }

    // Fallback: HTML parsing
    if (products.length === 0) {
        const cardPattern = /data-asin="([A-Z0-9]{10})"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g;
        let cardMatch;
        let count = 0;
        while ((cardMatch = cardPattern.exec(html)) !== null && count < 20) {
            const asin = cardMatch[1];
            const card = cardMatch[0];

            const titleMatch = card.match(/class="[^"]*a-text-normal[^"]*"[^>]*>([^<]+)/);
            const priceWholeMatch = card.match(/class="a-price-whole"[^>]*>([^<]+)/);
            const priceFractionMatch = card.match(/class="a-price-fraction"[^>]*>([^<]+)/);
            const ratingMatch = card.match(/class="a-icon-alt"[^>]*>([0-9.]+) out of/);
            const reviewCountMatch = card.match(/aria-label="([0-9,]+)"[^>]*>[^<]*<\/span>\s*<\/a>/);
            const imgMatch = card.match(/class="s-image"[^>]*src="([^"]+)"/);

            if (titleMatch && asin.length === 10) {
                const priceWhole = priceWholeMatch?.[1]?.replace(/[^0-9]/g, '');
                const priceFraction = priceFractionMatch?.[1] || '00';
                const price = priceWhole ? parseFloat(`${priceWhole}.${priceFraction}`) : null;

                products.push({
                    title: titleMatch[1].trim(),
                    price,
                    priceFormatted: price ? `$${price.toFixed(2)}` : null,
                    originalPrice: null,
                    currency: 'USD',
                    availability: 'In Stock',
                    inStock: true,
                    seller: null,
                    rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
                    reviewCount: reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : null,
                    bsr: null,
                    category: null,
                    imageUrl: imgMatch?.[1] || null,
                    productUrl: `https://www.amazon.com/dp/${asin}`,
                    asin,
                    source: 'amazon',
                });
                count++;
            }
        }
    }

    const countMatch = html.match(/(?:of\s+)?([\d,]+)\s+results/i);
    const totalFound = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : products.length;

    return { products, query, totalFound };
}

// ─── WALMART SCRAPER ────────────────────────────────

export async function scrapeWalmart(
    query: string,
    page: number = 1,
): Promise<ProductSearchResult> {
    const params = new URLSearchParams({
        q: query,
        page: page.toString(),
        affinityOverride: 'default',
    });

    const url = `https://www.walmart.com/search?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error(`Walmart returned ${response.status}`);
    const html = await response.text();

    const products: ProductData[] = [];

    // Walmart uses __NEXT_DATA__ for SSR data
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
        try {
            const nextData = JSON.parse(nextDataMatch[1]);
            const items = nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];
            for (const item of items.slice(0, 40)) {
                if (!item.name) continue;
                products.push({
                    title: item.name || 'Unknown',
                    price: item.priceInfo?.currentPrice?.price || null,
                    priceFormatted: item.priceInfo?.currentPrice?.priceString || null,
                    originalPrice: item.priceInfo?.wasPrice?.price || null,
                    currency: 'USD',
                    availability: item.availabilityStatusV2?.value || 'Unknown',
                    inStock: item.availabilityStatusV2?.value === 'IN_STOCK',
                    seller: item.sellerName || null,
                    rating: item.averageRating || null,
                    reviewCount: item.numberOfReviews || null,
                    bsr: null,
                    category: item.productCategory || null,
                    imageUrl: item.imageInfo?.thumbnailUrl || item.image || null,
                    productUrl: item.canonicalUrl ? `https://www.walmart.com${item.canonicalUrl}` : '',
                    asin: null,
                    source: 'walmart',
                });
            }
        } catch { /* skip */ }
    }

    // Fallback: JSON-LD
    if (products.length === 0) {
        const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        for (const match of jsonLdMatches) {
            try {
                const data = JSON.parse(match.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
                if (data['@type'] === 'ItemList' && data.itemListElement) {
                    for (const el of data.itemListElement) {
                        const item = el.item || el;
                        if (item['@type'] === 'Product') {
                            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                            products.push({
                                title: item.name || 'Unknown',
                                price: offer?.price ? parseFloat(offer.price) : null,
                                priceFormatted: offer?.price ? `$${offer.price}` : null,
                                originalPrice: null,
                                currency: offer?.priceCurrency || 'USD',
                                availability: offer?.availability?.includes('InStock') ? 'In Stock' : 'Unknown',
                                inStock: offer?.availability?.includes('InStock') || false,
                                seller: null,
                                rating: item.aggregateRating?.ratingValue || null,
                                reviewCount: item.aggregateRating?.reviewCount || null,
                                bsr: null,
                                category: null,
                                imageUrl: item.image || null,
                                productUrl: item.url || '',
                                asin: null,
                                source: 'walmart',
                            });
                        }
                    }
                }
            } catch { /* skip */ }
        }
    }

    return { products, query, totalFound: products.length };
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function searchProducts(
    query: string,
    options: { page?: number; sources?: string[] } = {},
): Promise<ProductSearchResult> {
    const sources = options.sources || ['amazon', 'walmart'];
    const page = options.page || 1;
    const allProducts: ProductData[] = [];
    let totalFound = 0;

    const promises = sources.map(async (source) => {
        try {
            let result: ProductSearchResult;
            switch (source) {
                case 'amazon':
                    result = await scrapeAmazon(query, page);
                    break;
                case 'walmart':
                    result = await scrapeWalmart(query, page);
                    break;
                default:
                    throw new Error(`Unknown source: ${source}`);
            }
            allProducts.push(...result.products);
            totalFound += result.totalFound;
        } catch (err: any) {
            console.error(`${source} error: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);

    // Sort by price ascending
    allProducts.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));

    return { products: allProducts, query, totalFound };
}
