export interface AppMetadata {
  rank?: number;
  appName: string;
  developer: string;
  appId: string;
  rating: number;
  ratingCount: number;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string;
  size: string;
  icon: string;
}

export interface AppReview {
  rating: number;
  text: string;
  date: string;
  reviewer: string;
}

export interface ScraperResponse {
  type: 'rankings' | 'app' | 'search' | 'trending';
  store: 'apple' | 'google';
  category?: string;
  country: string;
  timestamp: string;
  rankings?: AppMetadata[];
  app?: AppMetadata & { reviews: AppReview[] };
  results?: AppMetadata[];
  metadata: {
    totalRanked?: number;
    totalResults?: number;
    scrapedAt: string;
  };
  proxy: {
    country: string;
    carrier: string;
    type: string;
  };
}
