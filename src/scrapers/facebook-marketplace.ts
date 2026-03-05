import { proxyFetch } from '../proxy';

export interface MarketplaceSeller {
  name: string | null;
  joined: string | null;
  rating: string | null;
}

export interface MarketplaceListing {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  location: string | null;
  seller: MarketplaceSeller;
  condition: string | null;
  posted_at: string | null;
  images: string[];
  url: string;
}

export interface MarketplaceSearchParams {
  query: string;
  location?: string;
  category?: string;
  radius?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}

const FB_MOBILE_BASE = 'https://m.facebook.com';

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('\\/', '/');
}

function parsePrice(raw: string | null): { amount: number | null; currency: string } {
  if (!raw) return { amount: null, currency: 'USD' };
  const normalized = raw.replace(/\s+/g, ' ').trim();

  const currency = normalized.includes('€')
    ? 'EUR'
    : normalized.includes('£')
      ? 'GBP'
      : 'USD';

  const numberText = normalized.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  if (!numberText) return { amount: null, currency };

  const amount = Number.parseFloat(numberText);
  return { amount: Number.isFinite(amount) ? amount : null, currency };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function relativeTimeToIso(value: string | null): string | null {
  if (!value) return null;
  const text = value.toLowerCase().trim();

  const now = Date.now();
  if (text === 'just now') return new Date(now).toISOString();
  if (text === 'yesterday') return new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const shortMatch = text.match(/(\d+)\s*([smhdw])\b/);
  if (shortMatch) {
    const valueNum = Number.parseInt(shortMatch[1], 10);
    const unit = shortMatch[2];
    if (!Number.isFinite(valueNum)) return null;

    const multiplier = unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : unit === 'd'
            ? 86_400_000
            : 604_800_000;

    return new Date(now - valueNum * multiplier).toISOString();
  }

  const longMatch = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!longMatch) return null;

  const valueNum = Number.parseInt(longMatch[1], 10);
  if (!Number.isFinite(valueNum)) return null;

  const unit = longMatch[2];
  const multiplier = unit === 'second'
    ? 1000
    : unit === 'minute'
      ? 60_000
      : unit === 'hour'
        ? 3_600_000
        : unit === 'day'
          ? 86_400_000
          : unit === 'week'
            ? 604_800_000
            : unit === 'month'
              ? 2_592_000_000
              : 31_536_000_000;

  return new Date(now - valueNum * multiplier).toISOString();
}

function parseSeller(text: string): MarketplaceSeller {
  const sellerNameMatch = text.match(/seller(?:name)?["':\s]+([a-zA-Z0-9 ._-]{2,60})/i);
  const joinedMatch = text.match(/joined["':\s]+([a-zA-Z0-9 ,]{2,30})/i);
  const ratingMatch = text.match(/rating["':\s]+([0-9.]+\/?5(?:\s*stars?)?)/i);

  return {
    name: sellerNameMatch ? normalizeWhitespace(sellerNameMatch[1]) : null,
    joined: joinedMatch ? normalizeWhitespace(joinedMatch[1]) : null,
    rating: ratingMatch ? normalizeWhitespace(ratingMatch[1]) : null,
  };
}

function parseListingChunk(id: string, chunk: string): MarketplaceListing {
  const titleMatch = chunk.match(/(?:"title"|aria-label|data-title)[=:"]+([^"<>{]{3,160})/i);
  const locationMatch = chunk.match(/(?:"location"|data-location)[=:"]+([^"<>{]{2,120})/i);
  const conditionMatch = chunk.match(/(?:"condition"|data-condition)[=:"]+([^"<>{]{2,120})/i);

  const postedFromShort = chunk.match(/(\d+\s*[smhdw])\b/i)?.[1] ?? null;
  const postedFromAgo = chunk.match(/(\d+\s*(?:minute|hour|day|week|month|year)s?\s+ago)/i)?.[1] ?? null;
  const postedFromYesterday = /\byesterday\b/i.test(chunk) ? 'yesterday' : null;
  const postedRaw = postedFromShort || postedFromAgo || postedFromYesterday;

  const imageMatches = Array.from(chunk.matchAll(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi)).map((m) =>
    decodeHtml(m[0]).replace(/\\\//g, '/'),
  );

  const priceMatch = chunk.match(/(?:"price"|"formatted_amount"|data-price)[=:"]+([^"<>{]{1,60})/i) ||
    chunk.match(/([$€£]\s?[0-9][0-9,\.]{0,15})/);
  const parsedPrice = parsePrice(priceMatch ? decodeHtml(priceMatch[1] ?? priceMatch[0]) : null);

  return {
    id,
    title: titleMatch ? normalizeWhitespace(decodeHtml(titleMatch[1])) : `Marketplace Listing ${id}`,
    price: parsedPrice.amount,
    currency: parsedPrice.currency,
    location: locationMatch ? normalizeWhitespace(decodeHtml(locationMatch[1])) : null,
    seller: parseSeller(chunk),
    condition: conditionMatch ? normalizeWhitespace(decodeHtml(conditionMatch[1])) : null,
    posted_at: relativeTimeToIso(postedRaw),
    images: imageMatches.slice(0, 6),
    url: `https://facebook.com/marketplace/item/${id}`,
  };
}

function extractListings(html: string, limit: number): MarketplaceListing[] {
  const matches = Array.from(html.matchAll(/\/marketplace\/item\/(\d{6,})/g));
  const seen = new Set<string>();
  const listings: MarketplaceListing[] = [];

  for (const match of matches) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const start = Math.max(0, (match.index ?? 0) - 120);
    const end = Math.min(html.length, (match.index ?? 0) + 700);
    const chunk = html.slice(start, end);

    listings.push(parseListingChunk(id, chunk));
    if (listings.length >= limit) break;
  }

  return listings;
}

function parseSinceWindowMs(since: string): number {
  const normalized = since.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(s|m|h|d|w)$/);
  if (!match) return 3_600_000;

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 1) return 3_600_000;

  const unit = match[2];
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60_000;
  if (unit === 'h') return value * 3_600_000;
  if (unit === 'd') return value * 86_400_000;
  return value * 604_800_000;
}

function buildSearchUrl(params: MarketplaceSearchParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('query', params.query);

  if (params.location) searchParams.set('location', params.location);
  if (params.category) searchParams.set('category', params.category);
  if (params.radius) searchParams.set('radius', params.radius);
  if (typeof params.minPrice === 'number') searchParams.set('minPrice', String(Math.max(0, params.minPrice)));
  if (typeof params.maxPrice === 'number') searchParams.set('maxPrice', String(Math.max(0, params.maxPrice)));

  return `${FB_MOBILE_BASE}/marketplace/search/?${searchParams.toString()}`;
}

export async function searchMarketplace(params: MarketplaceSearchParams): Promise<MarketplaceListing[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const res = await proxyFetch(buildSearchUrl(params), {
    timeoutMs: 30_000,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  });

  if (!res.ok) {
    throw new Error(`Marketplace search failed with status ${res.status}`);
  }

  const html = await res.text();
  return extractListings(html, limit);
}

export async function getMarketplaceListing(listingId: string): Promise<MarketplaceListing | null> {
  const normalizedId = listingId.replace(/\D/g, '');
  if (!normalizedId) return null;

  const res = await proxyFetch(`${FB_MOBILE_BASE}/marketplace/item/${normalizedId}/`, {
    timeoutMs: 30_000,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  });

  if (!res.ok) {
    throw new Error(`Marketplace listing fetch failed with status ${res.status}`);
  }

  const html = await res.text();
  const listings = extractListings(html, 1);
  if (listings.length > 0) {
    return { ...listings[0], id: normalizedId, url: `https://facebook.com/marketplace/item/${normalizedId}` };
  }

  return {
    id: normalizedId,
    title: `Marketplace Listing ${normalizedId}`,
    price: null,
    currency: 'USD',
    location: null,
    seller: { name: null, joined: null, rating: null },
    condition: null,
    posted_at: null,
    images: [],
    url: `https://facebook.com/marketplace/item/${normalizedId}`,
  };
}

export async function listMarketplaceCategories(location?: string): Promise<string[]> {
  const url = `${FB_MOBILE_BASE}/marketplace/${location ? `?location=${encodeURIComponent(location)}` : ''}`;

  try {
    const res = await proxyFetch(url, {
      timeoutMs: 20_000,
      maxRetries: 1,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });

    if (res.ok) {
      const html = await res.text();
      const dynamic = Array.from(html.matchAll(/\/marketplace\/category\/([a-z0-9_-]+)/gi)).map((m) => m[1].replaceAll('-', ' '));
      const deduped = Array.from(new Set(dynamic.map((value) => normalizeWhitespace(value)))).filter(Boolean);
      if (deduped.length > 0) return deduped.slice(0, 25);
    }
  } catch {
    // fall through to defaults
  }

  return [
    'vehicles',
    'property rentals',
    'electronics',
    'home goods',
    'apparel',
    'family',
    'hobbies',
    'classifieds',
  ];
}

export async function monitorNewMarketplaceListings(
  query: string,
  since: string,
  location?: string,
  limit: number = 30,
): Promise<MarketplaceListing[]> {
  const listings = await searchMarketplace({ query, location, limit });
  const cutoff = Date.now() - parseSinceWindowMs(since);

  return listings.filter((listing) => {
    if (!listing.posted_at) return false;
    const timestamp = Date.parse(listing.posted_at);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}
