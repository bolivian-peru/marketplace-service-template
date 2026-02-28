/**
 * Facebook Marketplace Monitor API (Bounty #75)
 * Scrapes Facebook Marketplace listings via mobile proxy.
 */

import { proxyFetch } from '../proxy';

export interface MarketplaceSeller { name: string; joined: string | null; rating: string | null; profile_url: string | null; }

export interface MarketplaceListing {
  id: string; title: string; price: number | null; currency: string; location: string;
  seller: MarketplaceSeller; condition: string | null; posted_at: string | null;
  images: string[]; description: string; category: string | null; url: string;
}

export interface MarketplaceSearchResult { query: string; location: string | null; results: MarketplaceListing[]; totalFound: number; }

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(text: string): number | null {
  const m = text.match(/[\$\xA3\u20AC]?\s*([\d,]+(?:\.\d{2})?)/);
  return m ? (parseFloat(m[1].replace(/,/g, '')) || null) : null;
}

function parseCurrency(text: string): string {
  if (text.includes('\xA3')) return 'GBP';
  if (text.includes('\u20AC')) return 'EUR';
  return 'USD';
}

function relativeTimeToISO(text: string): string | null {
  if (!text) return null;
  const now = new Date(); const lc = text.toLowerCase();
  if (lc.includes('just now')) return now.toISOString();
  const minM = lc.match(/(\d+)\s*min/); if (minM) { now.setMinutes(now.getMinutes() - parseInt(minM[1])); return now.toISOString(); }
  const hrM = lc.match(/(\d+)\s*hour/); if (hrM) { now.setHours(now.getHours() - parseInt(hrM[1])); return now.toISOString(); }
  const dayM = lc.match(/(\d+)\s*day/); if (dayM) { now.setDate(now.getDate() - parseInt(dayM[1])); return now.toISOString(); }
  const wkM = lc.match(/(\d+)\s*week/); if (wkM) { now.setDate(now.getDate() - parseInt(wkM[1]) * 7); return now.toISOString(); }
  return null;
}

async function fetchMarketplacePage(url: string): Promise<string> {
  const r = await proxyFetch(url, { maxRetries: 2, timeoutMs: 25_000, headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
  }});
  if (!r.ok) {
    if (r.status === 403) throw new Error('Facebook blocked request.');
    if (r.status === 404) throw new Error('Listing not found.');
    throw new Error('Facebook returned ' + r.status);
  }
  const html = await r.text();
  if (html.includes('checkpoint') || html.includes('login_form')) throw new Error('Facebook requires login — proxy IP flagged.');
  return html;
}

function extractListingsFromHtml(html: string): MarketplaceListing[] {
  const listings: MarketplaceListing[] = [];
  const blocks = html.split(/(?:data-testid="marketplace-feed-item"|class="[^"]*x1lliihq[^"]*")/);
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i].slice(0, 5000);
    const idM = b.match(/\/marketplace\/item\/(\d+)/); if (!idM) continue;
    const titleM = b.match(/(?:aria-label|alt)="([^"]+)"/i) || b.match(/<span[^>]*>([^<]{5,100})<\/span>/);
    const title = titleM ? cleanText(titleM[1]) : ''; if (!title || title.length < 3) continue;
    const priceM = b.match(/[\$\xA3\u20AC]\s*[\d,]+(?:\.\d{2})?/) || b.match(/(Free|free)/);
    const priceText = priceM ? priceM[0] : '';
    const price = priceText.toLowerCase() === 'free' ? 0 : parsePrice(priceText);
    const locM = b.match(/(?:Listed in|located in|\xB7)\s*([A-Z][a-zA-Z\s,]+(?:,\s*[A-Z]{2})?)/i);
    const images: string[] = [];
    for (const img of b.matchAll(/src="(https:\/\/[^"]*(?:scontent|fbcdn)[^"]*\.(jpg|jpeg|png|webp)[^"]*)"/g)) {
      if (!images.includes(img[1])) images.push(img[1]);
    }
    const timeM = b.match(/(?:Listed|Posted)\s+([\w\s]+\s+ago|just now)/i) || b.match(/(\d+\s+(?:minute|hour|day|week)s?\s+ago)/i);
    const condM = b.match(/(New|Used - Like New|Used - Good|Used - Fair|Used - Poor|Refurbished)/i);
    listings.push({
      id: idM[1], title, price, currency: parseCurrency(priceText), location: locM ? cleanText(locM[1]) : '',
      seller: { name: '', joined: null, rating: null, profile_url: null },
      condition: condM ? condM[1] : null, posted_at: timeM ? relativeTimeToISO(timeM[1]) : null,
      images: images.slice(0, 5), description: '', category: null,
      url: 'https://www.facebook.com/marketplace/item/' + idM[1],
    });
  }
  // Try embedded JSON (Facebook relay format)
  for (const sjsBlock of html.matchAll(/data-sjs>(\{[\s\S]*?\})<\/script>/g)) {
    try {
      const data = JSON.parse(sjsBlock[1]);
      if (data?.require) {
        for (const req of data.require) {
          if (!Array.isArray(req) || req.length <= 3) continue;
          const args = req[3]; if (!Array.isArray(args)) continue;
          for (const arg of args) {
            const edges = arg?.__bbox?.result?.data?.marketplace_search?.feed_units?.edges;
            if (!edges) continue;
            for (const edge of edges) {
              const n = edge?.node?.listing; if (!n) continue;
              listings.push({
                id: n.id || '', title: n.marketplace_listing_title || '',
                price: n.listing_price?.amount ? parseFloat(n.listing_price.amount) / 100 : null,
                currency: n.listing_price?.currency || 'USD',
                location: n.location?.reverse_geocode?.city || '',
                seller: { name: n.marketplace_listing_seller?.name || '', joined: null, rating: null, profile_url: null },
                condition: n.condition || null,
                posted_at: n.creation_time ? new Date(n.creation_time * 1000).toISOString() : null,
                images: n.primary_listing_photo?.image?.uri ? [n.primary_listing_photo.image.uri] : [],
                description: n.redacted_description?.text || '', category: null,
                url: 'https://www.facebook.com/marketplace/item/' + (n.id || ''),
              });
            }
          }
        }
      }
    } catch {}
  }
  return listings;
}

export async function searchMarketplace(query: string, options: { location?: string; radius?: number; minPrice?: number; maxPrice?: number } = {}, limit: number = 20): Promise<MarketplaceSearchResult> {
  const params = new URLSearchParams(); params.set('query', query);
  if (options.minPrice) params.set('minPrice', String(options.minPrice));
  if (options.maxPrice) params.set('maxPrice', String(options.maxPrice));
  let url = options.location
    ? 'https://www.facebook.com/marketplace/' + options.location.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '/search/?' + params
    : 'https://www.facebook.com/marketplace/search/?' + params;
  const html = await fetchMarketplacePage(url);
  let listings = extractListingsFromHtml(html);
  if (options.minPrice || options.maxPrice) {
    listings = listings.filter(l => {
      if (options.minPrice && l.price !== null && l.price < options.minPrice) return false;
      if (options.maxPrice && l.price !== null && l.price > options.maxPrice) return false;
      return true;
    });
  }
  return { query, location: options.location || null, results: listings.slice(0, limit), totalFound: listings.length };
}

export async function getListingDetail(listingId: string): Promise<MarketplaceListing> {
  const html = await fetchMarketplacePage('https://www.facebook.com/marketplace/item/' + listingId);
  const titleM = html.match(/marketplace_listing_title['"]\s*:\s*['"]([\s\S]*?)['"]/) || html.match(/<title>([^<]+)<\/title>/);
  const title = titleM ? cleanText(titleM[1]).replace(/ \| Facebook Marketplace$/, '') : '';
  const priceM = html.match(/listing_price['"]\s*:\s*\{[^}]*?amount['"]\s*:\s*['"]([\d.]+)['"]/) || html.match(/[\$\xA3\u20AC]\s*([\d,]+(?:\.\d{2})?)/);
  const price = priceM ? parseFloat(priceM[1]) / (priceM[0].includes('amount') ? 100 : 1) : null;
  const currM = html.match(/currency['"]\s*:\s*['"](USD|GBP|EUR|CAD|AUD)['"]/i);
  const locM = html.match(/location_text['"]\s*:\s*['"]([\s\S]*?)['"]/) || html.match(/(?:Listed in)\s*([^<\n]+)/i);
  const descM = html.match(/redacted_description['"]\s*:\s*\{[^}]*?text['"]\s*:\s*['"]([\s\S]*?)['"]/);
  const sellerM = html.match(/marketplace_listing_seller['"]\s*:\s*\{[^}]*?name['"]\s*:\s*['"]([\s\S]*?)['"]/);
  const condM = html.match(/condition['"]\s*:\s*['"](NEW|USED_LIKE_NEW|USED_GOOD|USED_FAIR)['"]/i);
  const condMap: Record<string, string> = { NEW: 'New', USED_LIKE_NEW: 'Used - Like New', USED_GOOD: 'Used - Good', USED_FAIR: 'Used - Fair' };
  const images: string[] = [];
  for (const img of html.matchAll(/(?:listing_photos|image_uri|uri)['"]\s*:\s*['"](https:\/\/[^'"]*(?:scontent|fbcdn)[^'"]*\.(jpg|jpeg|png|webp)[^'"]*)['"]/g)) {
    const u = img[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/'); if (!images.includes(u)) images.push(u);
  }
  return {
    id: listingId, title, price, currency: currM ? currM[1] : 'USD', location: locM ? cleanText(locM[1]) : '',
    seller: { name: sellerM ? sellerM[1] : '', joined: null, rating: null, profile_url: null },
    condition: condM ? (condMap[condM[1].toUpperCase()] || condM[1]) : null, posted_at: null,
    images: images.slice(0, 10), description: descM ? cleanText(descM[1]).slice(0, 5000) : '',
    category: null, url: 'https://www.facebook.com/marketplace/item/' + listingId,
  };
}

export async function getCategories(): Promise<Array<{ id: string; name: string }>> {
  return [
    { id: 'vehicles', name: 'Vehicles' }, { id: 'propertyrentals', name: 'Property Rentals' },
    { id: 'apparel', name: 'Apparel' }, { id: 'electronics', name: 'Electronics' },
    { id: 'entertainment', name: 'Entertainment' }, { id: 'family', name: 'Family' },
    { id: 'free', name: 'Free Stuff' }, { id: 'garden', name: 'Garden & Outdoor' },
    { id: 'hobbies', name: 'Hobbies' }, { id: 'home-goods', name: 'Home Goods' },
    { id: 'home-improvement', name: 'Home Improvement' }, { id: 'home-sales', name: 'Home Sales' },
    { id: 'musical-instruments', name: 'Musical Instruments' }, { id: 'office-supplies', name: 'Office Supplies' },
    { id: 'pet-supplies', name: 'Pet Supplies' }, { id: 'sporting-goods', name: 'Sporting Goods' },
    { id: 'toys-games', name: 'Toys & Games' },
  ];
}

export async function getNewListings(query: string, sinceHours: number = 1, location?: string, limit: number = 20): Promise<MarketplaceSearchResult> {
  const result = await searchMarketplace(query, { location }, limit * 2);
  const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const fresh = result.results.filter(l => !l.posted_at || new Date(l.posted_at) >= cutoff);
  return { query, location: result.location, results: fresh.slice(0, limit), totalFound: fresh.length };
}