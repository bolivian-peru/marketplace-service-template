/**
 * Shared Type Definitions
 * ───────────────────────
 * All interfaces used across the service.
 */

// ─── GOOGLE MAPS TYPES ──────────────────────────────

export interface BusinessData {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  hours: BusinessHours | null;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  coordinates: {
    latitude: number;
    longitude: number;
  } | null;
  placeId: string | null;
  priceLevel: string | null;
  permanentlyClosed: boolean;
}

export interface BusinessHours {
  [day: string]: string;
}

export interface SearchResult {
  businesses: BusinessData[];
  totalFound: number;
  nextPageToken: string | null;
  searchQuery: string;
  location: string;
}

// ─── MOBILE SERP TRACKER TYPES ──────────────────────

export interface OrganicResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  sitelinks: Sitelink[];
  date: string | null;
  cached: boolean;
}

export interface Sitelink {
  title: string;
  url: string;
}

export interface AdResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  description: string;
  isTop: boolean;
}

export interface PeopleAlsoAsk {
  question: string;
  snippet: string | null;
  url: string | null;
}

export interface FeaturedSnippet {
  text: string;
  url: string;
  title: string;
  type: 'paragraph' | 'list' | 'table' | 'unknown';
}

export interface AiOverview {
  text: string;
  sources: { title: string; url: string }[];
}

export interface MapPackResult {
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  phone: string | null;
}

export interface KnowledgePanel {
  title: string;
  type: string | null;
  description: string | null;
  url: string | null;
  attributes: Record<string, string>;
}

export interface SerpResponse {
  query: string;
  country: string;
  language: string;
  location: string | null;
  totalResults: string | null;
  organic: OrganicResult[];
  ads: AdResult[];
  peopleAlsoAsk: PeopleAlsoAsk[];
  featuredSnippet: FeaturedSnippet | null;
  aiOverview: AiOverview | null;
  mapPack: MapPackResult[];
  knowledgePanel: KnowledgePanel | null;
  relatedSearches: string[];
}
