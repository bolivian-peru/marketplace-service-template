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

// ─── GOOGLE REVIEWS & BUSINESS DATA TYPES ───────────

export interface ReviewData {
  author: string;
  rating: number;
  text: string;
  date: string;
  relativeDate: string | null;
  likes: number;
  ownerResponse: string | null;
  ownerResponseDate: string | null;
  photos: string[];
}

export interface BusinessInfo {
  name: string;
  placeId: string;
  rating: number | null;
  totalReviews: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  hours: BusinessHours | null;
  category: string | null;
  categories: string[];
  priceLevel: string | null;
  photos: string[];
  coordinates: { latitude: number; longitude: number } | null;
  permanentlyClosed: boolean;
}

export interface RatingDistribution {
  '5': number;
  '4': number;
  '3': number;
  '2': number;
  '1': number;
}

export interface ReviewSummary {
  avgRating: number | null;
  totalReviews: number | null;
  ratingDistribution: RatingDistribution;
  responseRate: number;
  avgResponseTimeDays: number | null;
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
  };
}

export interface ReviewsResponse {
  business: BusinessInfo;
  reviews: ReviewData[];
  pagination: {
    total: number;
    returned: number;
    sort: string;
  };
}

export interface BusinessResponse {
  business: BusinessInfo;
  summary: ReviewSummary;
}

export interface ReviewSummaryResponse {
  business: {
    name: string;
    placeId: string;
    rating: number | null;
    totalReviews: number | null;
  };
  summary: ReviewSummary;
}

export interface ReviewSearchResponse {
  query: string;
  location: string;
  businesses: BusinessInfo[];
  totalFound: number;
}

// ─── REDDIT INTELLIGENCE API TYPES ─────────────────

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  created_utc: number;
  body_preview: string;
  selftext: string;
  thumbnail: string | null;
  is_video: boolean;
  over_18: boolean;
  link_flair_text: string | null;
  upvote_ratio: number;
  awards: number;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  replies_count: number;
  is_op: boolean;
  depth: number;
  permalink: string;
}

export interface RedditProxyMeta {
  ip: string | null;
  country: string;
  carrier: string | null;
}

export interface RedditSearchResponse {
  results: RedditPost[];
  meta: {
    query: string;
    subreddit: string;
    sort: string;
    time_filter: string;
    total_results: number;
    proxy: RedditProxyMeta;
    scraped_at: string;
    response_time_ms: number;
  };
  pagination: {
    after: string | null;
    has_more: boolean;
  };
}

export interface RedditTrendingResponse {
  results: RedditPost[];
  meta: {
    country: string;
    total_results: number;
    proxy: RedditProxyMeta;
    scraped_at: string;
    response_time_ms: number;
  };
}

export interface RedditSubredditResponse {
  subreddit: string;
  results: RedditPost[];
  meta: {
    time_filter: string;
    total_results: number;
    proxy: RedditProxyMeta;
    scraped_at: string;
    response_time_ms: number;
  };
  pagination: {
    after: string | null;
    has_more: boolean;
  };
}

export interface RedditThreadResponse {
  post: RedditPost;
  comments: RedditComment[];
  meta: {
    thread_id: string;
    total_comments: number;
    proxy: RedditProxyMeta;
    scraped_at: string;
    response_time_ms: number;
  };
}
