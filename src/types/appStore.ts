export interface AppInfo {
  id: string;
  name: string;
  developer: string;
  category: string;
  price: number;
  currency: string;
  version: string;
  size: number;
  rating: number;
  reviewCount: number;
  description: string;
  iconUrl: string;
  screenshotUrls: string[];
  releaseDate: string;
  lastUpdated: string;
  bundleId: string;
  minimumOsVersion: string;
  supportedDevices: string[];
  languages: string[];
  contentRating: string;
  inAppPurchases: boolean;
  website?: string;
  supportUrl?: string;
  privacyPolicyUrl?: string;
}

export interface RankingEntry {
  position: number;
  app: AppInfo;
  previousPosition?: number;
  positionChange?: number;
}

export interface AppRankings {
  category: string;
  country: string;
  chartType: 'free' | 'paid' | 'grossing';
  lastUpdated: string;
  apps: RankingEntry[];
}

export interface AppMetrics {
  downloads: number;
  revenue: number;
  activeUsers: number;
  retentionRate: number;
  sessionDuration: number;
  crashRate: number;
  period: string;
  country?: string;
}

export interface AppReview {
  id: string;
  rating: number;
  title: string;
  content: string;
  author: string;
  date: string;
  version: string;
  country: string;
  helpful: number;
  verified: boolean;
}

export interface SearchFilters {
  category?: string;
  price?: 'free' | 'paid' | 'any';
  rating?: number;
  developer?: string;
  country?: string;
  language?: string;
}

export interface SearchResult {
  apps: AppInfo[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AppStoreResponse<T = any> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
  timestamp: string;
  requestId: string;
}

export interface RankingsResponse extends AppStoreResponse<AppRankings> {}
export interface AppInfoResponse extends AppStoreResponse<AppInfo> {}
export interface SearchResponse extends AppStoreResponse<SearchResult> {}
export interface MetricsResponse extends AppStoreResponse<AppMetrics> {}
export interface ReviewsResponse extends AppStoreResponse<AppReview[]> {}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
}

export type Country = 
  | 'US' | 'GB' | 'CA' | 'AU' | 'DE' | 'FR' | 'IT' | 'ES' | 'NL' | 'BE'
  | 'CH' | 'AT' | 'SE' | 'NO' | 'DK' | 'FI' | 'IE' | 'PT' | 'GR' | 'PL'
  | 'CZ' | 'HU' | 'RO' | 'BG' | 'HR' | 'SI' | 'SK' | 'LT' | 'LV' | 'EE'
  | 'JP' | 'KR' | 'CN' | 'HK' | 'TW' | 'SG' | 'MY' | 'TH' | 'ID' | 'PH'
  | 'VN' | 'IN' | 'BR' | 'MX' | 'AR' | 'CL' | 'CO' | 'PE' | 'VE' | 'RU'
  | 'TR' | 'SA' | 'AE' | 'IL' | 'ZA' | 'EG' | 'MA' | 'NG' | 'KE' | 'GH';

export type AppCategory =
  | 'games'
  | 'entertainment'
  | 'utilities'
  | 'productivity'
  | 'lifestyle'
  | 'health_fitness'
  | 'social_networking'
  | 'music'
  | 'shopping'
  | 'travel'
  | 'news'
  | 'photo_video'
  | 'sports'
  | 'business'
  | 'education'
  | 'medical'
  | 'weather'
  | 'food_drink'
  | 'finance'
  | 'books'
  | 'navigation'
  | 'reference'
  | 'developer_tools'
  | 'graphics_design';