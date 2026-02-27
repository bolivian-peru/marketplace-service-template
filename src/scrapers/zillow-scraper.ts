/**
 * Real Estate Listing Intelligence Scraper (Bounty #79)
 * Scrapes Zillow property data, price history, Zestimates,
 * comparable sales, and market stats via mobile proxy.
 */

import { proxyFetch } from '../proxy';

export interface PriceHistoryEvent { date: string; event: string; price: number | null; source: string; }
export interface PropertyDetails { bedrooms: number; bathrooms: number; sqft: number | null; lot_sqft: number | null; year_built: number | null; type: string; status: string; stories: number | null; parking: string | null; heating: string | null; cooling: string | null; }
export interface NeighborhoodData { walk_score: number | null; transit_score: number | null; median_home_value: number | null; median_rent: number | null; }

export interface ZillowProperty {
  zpid: string; address: string; city: string; state: string; zipcode: string;
  price: number | null; zestimate: number | null; rent_zestimate: number | null;
  price_history: PriceHistoryEvent[]; details: PropertyDetails; neighborhood: NeighborhoodData;
  description: string; photos: string[]; url: string;
  latitude: number | null; longitude: number | null; days_on_zillow: number | null;
}

export interface SearchResult {
  zpid: string; address: string; price: number | null; zestimate: number | null;
  bedrooms: number; bathrooms: number; sqft: number | null;
  type: string; status: string; image: string | null; url: string;
}

export interface CompSale {
  zpid: string; address: string; price: number | null; sold_date: string | null;
  bedrooms: number; bathrooms: number; sqft: number | null;
  distance_mi: number | null; similarity_score: number | null;
}

export interface MarketStats {
  zipcode: string; median_home_value: number | null; median_list_price: number | null;
  median_rent: number | null; avg_days_on_market: number | null; inventory_count: number | null;
  price_change_yoy: number | null; homes_sold_last_month: number | null;
}

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(text: string): number | null {
  const m = text.match(/\$?([\d,]+)/);
  return m ? (parseInt(m[1].replace(/,/g, '')) || null) : null;
}

async function fetchZillowPage(url: string): Promise<string> {
  const r = await proxyFetch(url, { maxRetries: 2, timeoutMs: 25_000, headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache',
  }});
  if (!r.ok) {
    if (r.status === 403) throw new Error('Zillow blocked request — proxy IP flagged.');
    if (r.status === 404) throw new Error('Property not found.');
    throw new Error('Zillow returned ' + r.status);
  }
  const html = await r.text();
  if (html.includes('px-captcha')) throw new Error('Zillow CAPTCHA triggered.');
  return html;
}

function extractZillowData(html: string): any {
  const m1 = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m1) try { const d = JSON.parse(m1[1]); return d?.props?.pageProps?.componentProps?.gdpClientCache || d?.props?.pageProps?.initialData || d?.props?.pageProps || d; } catch {}
  const m2 = html.match(/"apiCache"\s*:\s*(\{[\s\S]*?\})\s*,\s*"/);
  if (m2) try { return JSON.parse('{"d":' + m2[1] + '}').d; } catch {}
  const m3 = html.match(/"gdpClientCache"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (m3) try { return JSON.parse(m3[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')); } catch {}
  return null;
}

function findPropertyInData(data: any): any {
  if (!data) return null;
  if (data.property) return data.property;
  if (data.gdpClientCache) {
    try {
      const p = typeof data.gdpClientCache === 'string' ? JSON.parse(data.gdpClientCache) : data.gdpClientCache;
      for (const k of Object.keys(p)) { const v = typeof p[k] === 'string' ? JSON.parse(p[k]) : p[k]; if (v?.property) return v.property; }
    } catch {}
  }
  for (const k of Object.keys(data)) if (typeof data[k] === 'object' && data[k]?.property) return data[k].property;
  return null;
}

export async function scrapeProperty(zpid: string): Promise<ZillowProperty> {
  const html = await fetchZillowPage('https://www.zillow.com/homedetails/' + zpid + '_zpid/');
  const raw = extractZillowData(html);
  const prop = findPropertyInData(raw);
  if (prop) {
    const ph: PriceHistoryEvent[] = (prop.priceHistory || []).slice(0, 20).map((h: any) => ({ date: h.date || '', event: h.event || '', price: h.price || null, source: h.source || '' }));
    const photos = (prop.photos || prop.responsivePhotos || []).map((p: any) => p.mixedSources?.jpeg?.[0]?.url || p.url || '').filter(Boolean).slice(0, 15);
    return {
      zpid, address: prop.address?.streetAddress || '', city: prop.address?.city || '', state: prop.address?.state || '', zipcode: prop.address?.zipcode || '',
      price: prop.price || prop.listPrice || null, zestimate: prop.zestimate || null, rent_zestimate: prop.rentZestimate || null, price_history: ph,
      details: { bedrooms: prop.bedrooms || 0, bathrooms: prop.bathrooms || 0, sqft: prop.livingArea || null, lot_sqft: prop.lotSize || null, year_built: prop.yearBuilt || null, type: prop.homeType || '', status: prop.homeStatus || '', stories: prop.stories || null, parking: prop.parkingCapacity ? prop.parkingCapacity + ' spaces' : null, heating: prop.heating || null, cooling: prop.cooling || null },
      neighborhood: { walk_score: prop.walkScore || null, transit_score: prop.transitScore || null, median_home_value: null, median_rent: null },
      description: (prop.description || '').slice(0, 3000), photos,
      url: 'https://www.zillow.com/homedetails/' + zpid + '_zpid/',
      latitude: prop.latitude || null, longitude: prop.longitude || null, days_on_zillow: prop.daysOnZillow || null,
    };
  }
  const addr = html.match(/<h1[^>]*>([^<]+)<\/h1>/); const address = addr ? cleanText(addr[1]) : '';
  const pm = html.match(/\$[\d,]+/); const price = pm ? parsePrice(pm[0]) : null;
  const zm = html.match(/Zestimate[^$]*\$([\d,]+)/i); const zestimate = zm ? parseInt(zm[1].replace(/,/g, '')) : null;
  const photos: string[] = []; for (const im of html.matchAll(/src="(https:\/\/photos\.zillowstatic\.com[^"]+)"/g)) if (!photos.includes(im[1])) photos.push(im[1]);
  const loc = address.match(/,\s*([^,]+),\s*(\w{2})\s+(\d{5})/);
  return {
    zpid, address, city: loc?.[1]?.trim() || '', state: loc?.[2] || '', zipcode: loc?.[3] || '',
    price, zestimate, rent_zestimate: null, price_history: [],
    details: { bedrooms: parseInt(html.match(/(\d+)\s*(?:bd|bed)/i)?.[1] || '0'), bathrooms: parseFloat(html.match(/([\d.]+)\s*(?:ba|bath)/i)?.[1] || '0'), sqft: html.match(/([\d,]+)\s*sqft/i) ? parseInt(html.match(/([\d,]+)\s*sqft/i)![1].replace(/,/g, '')) : null, lot_sqft: null, year_built: html.match(/(?:Built in|Year built:)\s*(\d{4})/i) ? parseInt(html.match(/(?:Built in|Year built:)\s*(\d{4})/i)![1]) : null, type: html.match(/(Single Family|Condo|Townhouse|Multi Family|Apartment|Land)/i)?.[1] || '', status: html.match(/(For Sale|For Rent|Sold|Pending|Off Market)/i)?.[1] || '', stories: null, parking: null, heating: null, cooling: null },
    neighborhood: { walk_score: null, transit_score: null, median_home_value: null, median_rent: null },
    description: '', photos: photos.slice(0, 15),
    url: 'https://www.zillow.com/homedetails/' + zpid + '_zpid/', latitude: null, longitude: null, days_on_zillow: null,
  };
}

export async function searchZillow(query: string, filter: { type?: 'for_sale' | 'for_rent' | 'sold'; minPrice?: number; maxPrice?: number; beds?: number; baths?: number } = {}, limit: number = 20): Promise<SearchResult[]> {
  let url = /^\d{5}$/.test(query) ? 'https://www.zillow.com/homes/' + query + '_rb/' : 'https://www.zillow.com/' + query.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '/';
  if (filter.type === 'for_rent') url = url.replace('/homes/', '/rentals/');
  if (filter.type === 'sold') url = url.replace('/homes/', '/sold/');
  const html = await fetchZillowPage(url);
  const results: SearchResult[] = [];
  const raw = extractZillowData(html);
  if (raw) {
    for (const item of findSearchResults(raw)) {
      if (results.length >= limit) break;
      if (filter.minPrice && item.price && item.price < filter.minPrice) continue;
      if (filter.maxPrice && item.price && item.price > filter.maxPrice) continue;
      if (filter.beds && item.bedrooms < filter.beds) continue;
      if (filter.baths && item.bathrooms < filter.baths) continue;
      results.push(item);
    }
  }
  if (!results.length) {
    for (const card of html.split('data-test="property-card"').slice(1)) {
      if (results.length >= limit) break;
      const c = card.slice(0, 5000); const zp = c.match(/\/(\d+)_zpid/); if (!zp) continue;
      const p = c.match(/data-test="property-card-price"[^>]*>([^<]+)/); const price = p ? parsePrice(p[1]) : null;
      if (filter.minPrice && price && price < filter.minPrice) continue;
      if (filter.maxPrice && price && price > filter.maxPrice) continue;
      results.push({ zpid: zp[1], address: cleanText(c.match(/data-test="property-card-addr"[^>]*>([^<]+)/)?.[1] || ''), price, zestimate: null, bedrooms: parseInt(c.match(/(\d+)\s*(?:bd|bds)/i)?.[1] || '0'), bathrooms: parseFloat(c.match(/([\d.]+)\s*(?:ba|bas)/i)?.[1] || '0'), sqft: c.match(/([\d,]+)\s*sqft/i) ? parseInt(c.match(/([\d,]+)\s*sqft/i)![1].replace(/,/g, '')) : null, type: c.match(/(House|Condo|Townhouse|Apartment|Land)/i)?.[1] || '', status: c.match(/(For Sale|For Rent|Sold|Pending)/i)?.[1] || '', image: c.match(/src="(https:\/\/[^"]*zillowstatic[^"]*\.(jpg|webp|png)[^"]*)"/)?.[1] || null, url: 'https://www.zillow.com/homedetails/' + zp[1] + '_zpid/' });
    }
  }
  return results;
}

function findSearchResults(data: any): SearchResult[] {
  const find = (o: any): any[] => { if (!o || typeof o !== 'object') return []; if (Array.isArray(o)) { for (const i of o) { const f = find(i); if (f.length) return f; } return []; } if (o.listResults) return o.listResults; if (o.searchResults?.listResults) return o.searchResults.listResults; if (o.cat1?.searchResults?.listResults) return o.cat1.searchResults.listResults; if (o.mapResults) return o.mapResults; for (const k of ['props','pageProps','searchPageState','queryState']) if (o[k]) { const f = find(o[k]); if (f.length) return f; } return []; };
  return find(data).filter(i => i.zpid || i.id).map(i => ({ zpid: String(i.zpid || i.id), address: i.address || '', price: i.price || i.unformattedPrice || null, zestimate: i.zestimate || i.hdpData?.homeInfo?.zestimate || null, bedrooms: i.beds || i.bedrooms || 0, bathrooms: i.baths || i.bathrooms || 0, sqft: i.area || i.livingArea || null, type: i.hdpData?.homeInfo?.homeType || i.propertyType || '', status: i.statusType || i.homeStatus || '', image: i.imgSrc || null, url: i.detailUrl || 'https://www.zillow.com/homedetails/' + (i.zpid || i.id) + '_zpid/' }));
}

export async function getComparableSales(zpid: string, limit: number = 10): Promise<CompSale[]> {
  const html = await fetchZillowPage('https://www.zillow.com/homedetails/' + zpid + '_zpid/');
  const comps: CompSale[] = [];
  const raw = extractZillowData(html); const prop = findPropertyInData(raw);
  for (const c of (prop?.comps || prop?.nearbyHomes || []).slice(0, limit)) {
    comps.push({ zpid: String(c.zpid || ''), address: c.address?.streetAddress || c.formattedAddress || '', price: c.price || c.lastSoldPrice || null, sold_date: c.dateSold || c.lastSoldDate || null, bedrooms: c.bedrooms || 0, bathrooms: c.bathrooms || 0, sqft: c.livingArea || null, distance_mi: c.distance || null, similarity_score: c.similarityScore || null });
  }
  return comps;
}

export async function getMarketStatsByZip(zipcode: string): Promise<MarketStats> {
  const html = await fetchZillowPage('https://www.zillow.com/homes/' + zipcode + '_rb/');
  const stats: MarketStats = { zipcode, median_home_value: null, median_list_price: null, median_rent: null, avg_days_on_market: null, inventory_count: null, price_change_yoy: null, homes_sold_last_month: null };
  const raw = extractZillowData(html);
  if (raw) {
    const find = (o: any): any => { if (!o || typeof o !== 'object') return null; if (o.regionOverview) return o.regionOverview; if (o.marketOverview) return o.marketOverview; for (const k of Object.keys(o)) if (typeof o[k] === 'object') { const f = find(o[k]); if (f) return f; } return null; };
    const m = find(raw);
    if (m) { stats.median_home_value = m.medianHomeValue || m.zhvi || null; stats.median_list_price = m.medianListPrice || null; stats.median_rent = m.medianRent || m.zori || null; stats.avg_days_on_market = m.avgDaysOnMarket || null; stats.price_change_yoy = m.homeValueChange1Year || null; stats.homes_sold_last_month = m.homesSold || null; }
  }
  const sr = await searchZillow(zipcode, { type: 'for_sale' }, 50);
  stats.inventory_count = sr.length;
  if (!stats.median_list_price && sr.length) { const p = sr.map(r => r.price).filter((x): x is number => x !== null).sort((a, b) => a - b); if (p.length) stats.median_list_price = p[Math.floor(p.length / 2)]; }
  return stats;
}
