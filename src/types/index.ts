/**
 * TypeScript interfaces for Amazon Product & BSR Tracker API
 */

// ─── PRICING ────────────────────────────────────────

export interface PriceData {
  current: number | null;
  currency: string;
  was: number | null;
  discount_pct: number | null;
  deal_label: string | null;
}

// ─── BSR ────────────────────────────────────────────

export interface SubCategoryRank {
  category: string;
  rank: number;
}

export interface BSRData {
  rank: number | null;
  category: string | null;
  sub_category_ranks: SubCategoryRank[];
}

// ─── BUY BOX ────────────────────────────────────────

export interface BuyBoxData {
  seller: string | null;
  is_amazon: boolean;
  fulfilled_by: string | null;
  seller_rating: number | null;
  seller_ratings_count: number | null;
}

// ─── DIMENSIONS / SPECS ─────────────────────────────

export interface ProductDimensions {
  weight: string | null;
  dimensions: string | null;
}

// ─── FULL PRODUCT ────────────────────────────────────

export interface AmazonProduct {
  asin: string;
  title: string | null;
  price: PriceData;
  bsr: BSRData;
  rating: number | null;
  reviews_count: number | null;
  buy_box: BuyBoxData;
  availability: string | null;
  brand: string | null;
  images: string[];
  features: string[];
  categories: string[];
  dimensions: ProductDimensions;
  aplus_content: boolean;
  variations: ProductVariation[];
  meta: ProductMeta;
}

export interface ProductVariation {
  asin: string;
  title: string;
  selected: boolean;
}

export interface ProductMeta {
  marketplace: string;
  url: string;
  scraped_at: string;
  proxy: ProxyMeta;
}

export interface ProxyMeta {
  ip: string | null;
  country: string;
  carrier: string | null;
  type: 'mobile';
}

// ─── SEARCH ─────────────────────────────────────────

export interface SearchResult {
  asin: string;
  title: string | null;
  price: Pick<PriceData, 'current' | 'currency' | 'was' | 'discount_pct'>;
  rating: number | null;
  reviews_count: number | null;
  bsr_rank: number | null;
  bsr_category: string | null;
  is_prime: boolean;
  is_sponsored: boolean;
  image: string | null;
  url: string;
}

export interface SearchResponse {
  query: string;
  category: string | null;
  marketplace: string;
  total_results: number | null;
  page: number;
  results: SearchResult[];
  meta: {
    proxy: ProxyMeta;
  };
}

// ─── BESTSELLERS ─────────────────────────────────────

export interface BestSellerItem {
  rank: number;
  asin: string;
  title: string | null;
  price: Pick<PriceData, 'current' | 'currency'>;
  rating: number | null;
  reviews_count: number | null;
  image: string | null;
  url: string;
}

export interface BestSellersResponse {
  category: string;
  marketplace: string;
  category_url: string;
  items: BestSellerItem[];
  meta: {
    proxy: ProxyMeta;
  };
}

// ─── REVIEWS ─────────────────────────────────────────

export interface Review {
  id: string | null;
  author: string | null;
  author_url: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  date: string | null;
  date_raw: string | null;
  verified_purchase: boolean;
  helpful_votes: number | null;
  images: string[];
}

export interface ReviewsResponse {
  asin: string;
  marketplace: string;
  total_reviews: number | null;
  average_rating: number | null;
  rating_distribution: Record<string, number>;
  sort: string;
  page: number;
  reviews: Review[];
  meta: {
    proxy: ProxyMeta;
  };
}

// ─── MARKETPLACE CONFIGS ─────────────────────────────

export interface MarketplaceConfig {
  domain: string;
  currency: string;
  language: string;
  country: string;
}

export const MARKETPLACES: Record<string, MarketplaceConfig> = {
  US: { domain: 'www.amazon.com', currency: 'USD', language: 'en-US', country: 'US' },
  UK: { domain: 'www.amazon.co.uk', currency: 'GBP', language: 'en-GB', country: 'GB' },
  DE: { domain: 'www.amazon.de', currency: 'EUR', language: 'de-DE', country: 'DE' },
  FR: { domain: 'www.amazon.fr', currency: 'EUR', language: 'fr-FR', country: 'FR' },
  IT: { domain: 'www.amazon.it', currency: 'EUR', language: 'it-IT', country: 'IT' },
  ES: { domain: 'www.amazon.es', currency: 'EUR', language: 'es-ES', country: 'ES' },
  CA: { domain: 'www.amazon.ca', currency: 'CAD', language: 'en-CA', country: 'CA' },
  JP: { domain: 'www.amazon.co.jp', currency: 'JPY', language: 'ja-JP', country: 'JP' },
};

// ─── BESTSELLER CATEGORIES ───────────────────────────

export const BESTSELLER_CATEGORIES: Record<string, string> = {
  electronics: 'electronics',
  books: 'books',
  'home-kitchen': 'home-kitchen',
  'toys-games': 'toys-and-games',
  'sports-outdoors': 'sports-and-outdoors',
  'health-personal-care': 'health-and-personal-care',
  'beauty': 'beauty',
  'clothing': 'apparel',
  'automotive': 'automotive-parts-and-accessories',
  'office-products': 'office-products',
  'kitchen': 'kitchen',
  'garden': 'lawn-and-garden',
  'pet-supplies': 'pet-supplies',
  'baby': 'baby-products',
  'video-games': 'videogames',
  'software': 'software',
  'music': 'music',
  'movies': 'movies-tv',
  'tools': 'tools',
  'grocery': 'grocery',
};
