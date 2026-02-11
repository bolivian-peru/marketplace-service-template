/**
 * Shared Type Definitions
 * ───────────────────────
 * All interfaces used across the service.
 */

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

export interface SerpResult {
  rank: number;
  title: string;
  link: string;
  snippet: string;
  source?: string;
}

export interface AiOverview {
  text: string;
  links: { title: string; url: string }[];
}

export interface SerpData {
  results: SerpResult[];
  aiOverview?: AiOverview;
  relatedSearches: string[];
  peopleAlsoAsk: { question: string; answer?: string }[];
  totalResults?: string;
}
