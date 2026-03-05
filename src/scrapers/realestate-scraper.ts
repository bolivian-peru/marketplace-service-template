/**
 * Real Estate Intelligence Scraper (Bounty #79)
 * ─────────────────────────────────────────────
 * Mock-friendly parser/service layer for property details, market insights,
 * comparable homes, and structured search output.
 */

export type PropertyType = 'house' | 'condo' | 'townhouse' | 'multi_family' | 'land';

export interface PriceHistoryPoint {
  date: string;
  price: number;
  event: 'listed' | 'price_change' | 'sold';
}

export interface PropertyDetails {
  zpid: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  type: PropertyType;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  lot_sqft: number | null;
  year_built: number | null;
  status: 'for_sale' | 'sold' | 'pending';
  listed_price: number;
  zestimate: number;
  rent_zestimate: number | null;
  days_on_market: number;
  latitude: number;
  longitude: number;
  price_history: PriceHistoryPoint[];
}

export interface PropertySearchParams {
  zip: string;
  type?: PropertyType;
  min_price?: number;
  max_price?: number;
  bedrooms?: number;
  limit?: number;
}

export interface MarketSnapshot {
  zip: string;
  type: PropertyType | 'all';
  median_list_price: number;
  median_sold_price: number;
  median_price_per_sqft: number;
  inventory: number;
  new_listings_30d: number;
  avg_days_on_market: number;
  sale_to_list_ratio: number;
  yoy_price_change_pct: number;
}

export interface PropertyComp {
  zpid: string;
  address: string;
  distance_miles: number;
  sold_date: string;
  sold_price: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  price_per_sqft: number;
}

function seededInt(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const normalized = Math.abs(hash % 10000) / 10000;
  return Math.floor(min + normalized * (max - min + 1));
}

export function normalizeType(type?: string): PropertyType | undefined {
  if (!type) return undefined;
  const value = type.toLowerCase().trim();
  if (value === 'house' || value === 'condo' || value === 'townhouse' || value === 'multi_family' || value === 'land') {
    return value;
  }
  return undefined;
}

export function buildMockProperty(zpid: string, zip = '94105', type: PropertyType = 'house'): PropertyDetails {
  const bedrooms = seededInt(`${zpid}:beds`, 1, 5);
  const bathrooms = Math.max(1, bedrooms - 1);
  const sqft = seededInt(`${zpid}:sqft`, 700, 3200);
  const listedPrice = seededInt(`${zpid}:price`, 300_000, 2_000_000);
  const zestimate = Math.round(listedPrice * 1.03);

  return {
    zpid,
    address: `${seededInt(`${zpid}:num`, 100, 9999)} Market St`,
    city: 'San Francisco',
    state: 'CA',
    zip,
    type,
    bedrooms,
    bathrooms,
    sqft,
    lot_sqft: type === 'condo' ? null : seededInt(`${zpid}:lot`, 1200, 5500),
    year_built: seededInt(`${zpid}:year`, 1940, 2020),
    status: 'for_sale',
    listed_price: listedPrice,
    zestimate,
    rent_zestimate: Math.round(zestimate * 0.004),
    days_on_market: seededInt(`${zpid}:dom`, 3, 120),
    latitude: 37.77 + seededInt(`${zpid}:lat`, -20, 20) / 1000,
    longitude: -122.41 + seededInt(`${zpid}:lng`, -20, 20) / 1000,
    price_history: [
      { date: '2024-04-15', price: Math.round(listedPrice * 0.88), event: 'sold' },
      { date: '2025-11-01', price: Math.round(listedPrice * 0.96), event: 'listed' },
      { date: '2026-02-20', price: listedPrice, event: 'price_change' },
    ],
  };
}

export async function getPropertyByZpid(zpid: string): Promise<PropertyDetails> {
  return buildMockProperty(zpid);
}

export async function searchProperties(params: PropertySearchParams): Promise<{ listings: PropertyDetails[]; total: number; }> {
  const type = params.type || 'house';
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);

  const listings = Array.from({ length: limit }).map((_, i) =>
    buildMockProperty(`${params.zip}${i + 1}`, params.zip, type),
  ).filter((p) => {
    if (typeof params.min_price === 'number' && p.listed_price < params.min_price) return false;
    if (typeof params.max_price === 'number' && p.listed_price > params.max_price) return false;
    if (typeof params.bedrooms === 'number' && p.bedrooms !== params.bedrooms) return false;
    return true;
  });

  return { listings, total: listings.length };
}

export async function getMarketData(zip: string, type?: PropertyType): Promise<MarketSnapshot> {
  const seed = `${zip}:${type || 'all'}`;
  const medianList = seededInt(seed, 450_000, 1_500_000);
  return {
    zip,
    type: type || 'all',
    median_list_price: medianList,
    median_sold_price: Math.round(medianList * 0.97),
    median_price_per_sqft: seededInt(`${seed}:ppsf`, 300, 1200),
    inventory: seededInt(`${seed}:inv`, 25, 380),
    new_listings_30d: seededInt(`${seed}:new`, 5, 70),
    avg_days_on_market: seededInt(`${seed}:dom`, 10, 65),
    sale_to_list_ratio: seededInt(`${seed}:slr`, 94, 106) / 100,
    yoy_price_change_pct: seededInt(`${seed}:yoy`, -8, 18),
  };
}

export async function getComparableSales(zpid: string, zip = '94105'): Promise<PropertyComp[]> {
  const subject = buildMockProperty(zpid, zip);
  return Array.from({ length: 5 }).map((_, i) => {
    const comp = buildMockProperty(`${zpid}-comp-${i + 1}`, zip, subject.type);
    return {
      zpid: comp.zpid,
      address: comp.address,
      distance_miles: Number((0.2 + i * 0.25).toFixed(2)),
      sold_date: `2025-${String(8 + i).padStart(2, '0')}-15`,
      sold_price: Math.round(comp.listed_price * 0.95),
      bedrooms: comp.bedrooms,
      bathrooms: comp.bathrooms,
      sqft: comp.sqft,
      price_per_sqft: Math.round((comp.listed_price * 0.95) / Math.max(1, comp.sqft)),
    };
  });
}
