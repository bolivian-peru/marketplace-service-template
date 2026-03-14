/**
 * Ad Verification & Creative Intelligence Types
 * ───────────────────────────────────────────────
 * Types for mobile ad verification, brand safety scoring,
 * viewability estimation, competitive ad intelligence,
 * and ad network detection.
 */

// ─── AD CREATIVE TYPES ─────────────────────────────

export interface AdCreative {
  position: number;
  placement: 'top' | 'bottom' | 'sidebar' | 'in-feed' | 'interstitial' | 'unknown';
  title: string;
  description: string;
  displayUrl: string;
  finalUrl: string;
  advertiser: string;
  extensions: string[];
  isResponsive: boolean;
  adNetwork: string;
  adFormat: 'search' | 'display' | 'shopping' | 'video' | 'app-install' | 'unknown';
}

export interface DisplayAd {
  position: number;
  type: 'banner' | 'native' | 'video' | 'interstitial' | 'unknown';
  advertiser: string | null;
  landingUrl: string | null;
  adNetwork: string;
  dimensions: string | null;
  isTracked: boolean;
  trackingPixels: string[];
}

// ─── BRAND SAFETY TYPES ────────────────────────────

export type BrandSafetyCategory =
  | 'adult'
  | 'violence'
  | 'hate-speech'
  | 'drugs'
  | 'gambling'
  | 'weapons'
  | 'misinformation'
  | 'piracy'
  | 'spam'
  | 'safe';

export type BrandSafetyRisk = 'low' | 'medium' | 'high' | 'critical';

export interface BrandSafetyScore {
  overall: BrandSafetyRisk;
  score: number; // 0-100, higher is safer
  categories: BrandSafetyCategory[];
  flags: string[];
  pageContent: {
    hasAdultContent: boolean;
    hasViolentContent: boolean;
    hasHateSpeech: boolean;
    hasDrugContent: boolean;
    hasGamblingContent: boolean;
    hasMisinformation: boolean;
  };
}

// ─── VIEWABILITY TYPES ─────────────────────────────

export interface ViewabilityEstimate {
  score: number; // 0-100
  aboveFold: boolean;
  adDensity: number; // ads per page
  estimatedViewRate: number; // 0-1
  pageLoadFactors: {
    hasLazyLoading: boolean;
    hasInfiniteScroll: boolean;
    estimatedLoadTime: 'fast' | 'medium' | 'slow';
    mobileOptimized: boolean;
  };
}

// ─── AD NETWORK DETECTION ──────────────────────────

export interface DetectedAdNetwork {
  name: string;
  type: 'search' | 'display' | 'native' | 'video' | 'social' | 'programmatic';
  trackingDomains: string[];
  pixelCount: number;
}

// ─── ADVERTISER INTELLIGENCE ────────────────────────

export interface AdvertiserIntel {
  domain: string;
  name: string | null;
  verifiedByGoogle: boolean | null;
  adCount: number;
  adFormats: string[];
  regions: string[];
  lastSeen: string | null;
  transparencyUrl: string | null;
}

// ─── RESPONSE TYPES ────────────────────────────────

export interface SearchAdsResponse {
  type: 'search_ads';
  query: string;
  country: string;
  timestamp: string;
  ads: AdCreative[];
  organic_count: number;
  total_ads: number;
  ad_positions: { top: number; bottom: number };
  ad_networks: DetectedAdNetwork[];
  brand_safety: BrandSafetyScore;
  viewability: ViewabilityEstimate;
  proxy: { country: string; carrier: string; type: string };
  payment: { txHash: string; amount: number; verified: boolean };
}

export interface DisplayAdsResponse {
  type: 'display_ads';
  url: string;
  country: string;
  timestamp: string;
  ads: DisplayAd[];
  total_ads: number;
  ad_networks: DetectedAdNetwork[];
  brand_safety: BrandSafetyScore;
  viewability: ViewabilityEstimate;
  proxy: { country: string; carrier: string; type: string };
  payment: { txHash: string; amount: number; verified: boolean };
}

export interface AdvertiserResponse {
  type: 'advertiser';
  domain: string;
  country: string;
  timestamp: string;
  advertiser: AdvertiserIntel;
  recent_ads: AdCreative[];
  ad_networks: DetectedAdNetwork[];
  proxy: { country: string; carrier: string; type: string };
  payment: { txHash: string; amount: number; verified: boolean };
}

export type AdVerificationResponse =
  | SearchAdsResponse
  | DisplayAdsResponse
  | AdvertiserResponse;
