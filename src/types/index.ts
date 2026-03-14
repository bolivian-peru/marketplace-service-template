/**
 * Shared Type Definitions
 * ───────────────────────
 * All interfaces used across the service.
 */

// ─── TREND INTELLIGENCE TYPES (Bounty #70) ──────────

export type Platform = 'reddit' | 'web' | 'x' | 'youtube' | 'twitter';
export type SignalStrength = 'established' | 'reinforced' | 'emerging';
export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface PatternEvidence {
  platform: string;
  title: string;
  url: string;
  engagement: number;
  // Reddit-specific
  subreddit?: string;
  score?: number;
  numComments?: number;
  created?: number;
  // Web-specific
  source?: string;
}

export interface TrendPattern {
  pattern: string;
  strength: SignalStrength;
  sources: ('reddit' | 'web' | 'youtube' | 'twitter')[];
  totalEngagement: number;
  evidence: PatternEvidence[];
}

// ─── YOUTUBE TYPES ───────────────────────────────────

export interface YouTubeResult {
  videoId: string;
  title: string;
  url: string;
  channelName: string | null;
  viewCount: number | null;
  description: string;
  publishedAt: string | null;
  engagementScore: number;
  platform: 'youtube';
}

// ─── TWITTER TYPES ───────────────────────────────────

export interface TwitterResult {
  tweetId: string | null;
  author: string | null;
  text: string;
  url: string;
  likes: number | null;
  retweets: number | null;
  engagementScore: number;
  publishedAt: string | null;
  platform: 'twitter';
}

export interface PlatformSentimentBreakdown {
  overall: SentimentLabel;
  positive: number;   // percentage 0-100
  neutral: number;
  negative: number;
}

export interface ResearchRequest {
  topic: string;
  platforms: Platform[];
  days: number;
  country: string;
}

export interface TopDiscussion {
  platform: string;
  title: string;
  url: string;
  engagement: number;
  subreddit?: string;
  score?: number;
  numComments?: number;
}

export interface ResearchResponse {
  topic: string;
  timeframe: string;
  patterns: TrendPattern[];
  sentiment: {
    overall: SentimentLabel;
    by_platform: Record<string, PlatformSentimentBreakdown>;
  };
  top_discussions: TopDiscussion[];
  emerging_topics: string[];
  meta: {
    sources_checked: number;
    platforms_used: string[];
    proxy: { ip: string | null; country: string; type: string };
    generated_at: string;
  };
  payment: {
    txHash: string;
    network: string;
    amount: number;
    settled: boolean;
  };
}

export interface TrendingItem {
  topic: string;
  platform: string;
  engagement: number | null;
  traffic?: string | null;
  url?: string;
}

export interface TrendingResponse {
  country: string;
  platforms: string[];
  trending: TrendingItem[];
  generated_at: string;
  meta: {
    proxy: { ip: string | null; country: string; type: string };
  };
  payment: {
    txHash: string;
    network: string;
    amount: number;
    settled: boolean;
  };
}

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

// ─── AIRBNB INTELLIGENCE TYPES (Bounty #78) ─────────

export type OccupancyConfidence = 'low' | 'medium' | 'high';
export type PriceRating = 'budget' | 'below_average' | 'average' | 'above_average' | 'premium';

export interface AirbnbPriceAnalysis {
  listing_id: string;
  listing_title: string;
  price_per_night: number | null;
  market_comparison: {
    market_avg: number | null;
    market_median: number | null;
    percentile: number | null;
    price_rating: PriceRating;
    difference_from_avg_pct: number | null;
  };
  comparable_listings: AirbnbComparableListing[];
  value_score: number | null;
  price_factors: string[];
}

export interface AirbnbComparableListing {
  id: string;
  title: string;
  price_per_night: number | null;
  rating: number | null;
  bedrooms: number;
  type: string;
  url: string;
}

export interface AirbnbOccupancyEstimate {
  listing_id: string;
  listing_title: string;
  estimated_occupancy_rate: number;
  confidence: OccupancyConfidence;
  methodology: string;
  factors: {
    review_frequency: number | null;
    reviews_last_12_months: number | null;
    total_reviews: number | null;
    rating: number | null;
    superhost: boolean;
    price_competitiveness: string | null;
  };
  monthly_breakdown: AirbnbMonthlyOccupancy[];
}

export interface AirbnbMonthlyOccupancy {
  month: string;
  estimated_occupancy_pct: number;
  is_peak: boolean;
}

export interface AirbnbHostAnalysis {
  host_name: string;
  superhost: boolean;
  response_rate: string | null;
  response_time: string | null;
  portfolio_stats: {
    total_listings: number;
    avg_price: number | null;
    avg_rating: number | null;
    total_reviews: number;
    property_types: Record<string, number>;
  };
  performance_indicators: {
    review_sentiment: {
      overall: string;
      positive_pct: number;
      neutral_pct: number;
      negative_pct: number;
    };
    strengths: string[];
    areas_for_improvement: string[];
    responsiveness_score: string;
  };
}

export interface AirbnbRevenueProjection {
  listing_id: string;
  listing_title: string;
  price_per_night: number | null;
  projections: {
    conservative: AirbnbRevenueScenario;
    moderate: AirbnbRevenueScenario;
    optimistic: AirbnbRevenueScenario;
  };
  assumptions: {
    occupancy_rates: { conservative: number; moderate: number; optimistic: number };
    avg_nightly_rate: number | null;
    cleaning_fee_estimate: number;
    service_fee_pct: number;
    monthly_expenses_estimate: number;
  };
  market_context: {
    avg_daily_rate: number | null;
    total_comparable_listings: number;
    superhost_premium_pct: number;
  };
  roi_metrics: {
    breakeven_occupancy_pct: number | null;
    revenue_per_available_night: number | null;
  };
}

export interface AirbnbRevenueScenario {
  annual_gross_revenue: number;
  monthly_avg_revenue: number;
  annual_net_revenue: number;
  monthly_avg_net: number;
  occupancy_rate: number;
  booked_nights_per_year: number;
}
