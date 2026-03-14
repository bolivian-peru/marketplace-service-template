/**
 * Airbnb Intelligence Engine (Bounty #78)
 * ────────────────────────────────────────
 * Advanced analytics layer on top of Airbnb scraper data:
 *   - Price analysis & comparison
 *   - Occupancy rate estimation
 *   - Host profile analysis
 *   - Revenue projection
 */

import {
  searchAirbnb,
  getListingDetail,
  getListingReviews,
  type AirbnbListing,
  type AirbnbListingDetail,
  type AirbnbReview,
  type MarketStats,
} from './airbnb-scraper';
import { scoreSentiment } from '../analysis/sentiment';

// ─── TYPES ──────────────────────────────────────────

export interface PriceAnalysis {
  listing_id: string;
  listing_title: string;
  price_per_night: number | null;
  market_comparison: {
    market_avg: number | null;
    market_median: number | null;
    percentile: number | null;
    price_rating: 'budget' | 'below_average' | 'average' | 'above_average' | 'premium';
    difference_from_avg_pct: number | null;
  };
  comparable_listings: ComparableListing[];
  value_score: number | null;
  price_factors: string[];
}

export interface ComparableListing {
  id: string;
  title: string;
  price_per_night: number | null;
  rating: number | null;
  bedrooms: number;
  type: string;
  url: string;
}

export interface OccupancyEstimate {
  listing_id: string;
  listing_title: string;
  estimated_occupancy_rate: number;
  confidence: 'low' | 'medium' | 'high';
  methodology: string;
  factors: {
    review_frequency: number | null;
    reviews_last_12_months: number | null;
    total_reviews: number | null;
    rating: number | null;
    superhost: boolean;
    price_competitiveness: string | null;
  };
  monthly_breakdown: MonthlyOccupancy[];
  comparable_occupancy: {
    market_avg_estimate: number | null;
    listing_vs_market: string | null;
  };
}

export interface MonthlyOccupancy {
  month: string;
  estimated_occupancy_pct: number;
  is_peak: boolean;
}

export interface HostAnalysis {
  host_name: string;
  superhost: boolean;
  response_rate: string | null;
  response_time: string | null;
  listings_analyzed: HostListingSummary[];
  portfolio_stats: {
    total_listings: number;
    avg_price: number | null;
    avg_rating: number | null;
    total_reviews: number;
    property_types: Record<string, number>;
    superhost: boolean;
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

export interface HostListingSummary {
  id: string;
  title: string;
  price_per_night: number | null;
  rating: number | null;
  reviews_count: number | null;
  type: string;
  url: string;
}

export interface RevenueProjection {
  listing_id: string;
  listing_title: string;
  price_per_night: number | null;
  projections: {
    conservative: RevenueScenario;
    moderate: RevenueScenario;
    optimistic: RevenueScenario;
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

export interface RevenueScenario {
  annual_gross_revenue: number;
  monthly_avg_revenue: number;
  annual_net_revenue: number;
  monthly_avg_net: number;
  occupancy_rate: number;
  booked_nights_per_year: number;
}

// ─── PRICE ANALYSIS ────────────────────────────────

export async function analyzePricing(
  listingId: string,
  location?: string,
  checkin?: string,
  checkout?: string,
): Promise<PriceAnalysis> {
  // Fetch the target listing
  const listing = await getListingDetail(listingId);

  // Determine location for comparison
  const searchLocation = location || listing.neighborhood || '';
  if (!searchLocation) {
    return buildPriceAnalysisNoComps(listing);
  }

  // Fetch comparable listings in the same area
  const comparables = await searchAirbnb(searchLocation, checkin, checkout, 2, undefined, undefined, 50);

  const prices = comparables
    .map(l => l.price_per_night)
    .filter((p): p is number => p !== null && p > 0)
    .sort((a, b) => a - b);

  const avg = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  const median = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null;

  const listingPrice = listing.price_per_night;
  let percentile: number | null = null;
  let priceRating: PriceAnalysis['market_comparison']['price_rating'] = 'average';
  let diffFromAvgPct: number | null = null;

  if (listingPrice && prices.length > 0 && avg) {
    const belowCount = prices.filter(p => p <= listingPrice).length;
    percentile = Math.round((belowCount / prices.length) * 100);
    diffFromAvgPct = Math.round(((listingPrice - avg) / avg) * 100);

    if (percentile <= 20) priceRating = 'budget';
    else if (percentile <= 40) priceRating = 'below_average';
    else if (percentile <= 60) priceRating = 'average';
    else if (percentile <= 80) priceRating = 'above_average';
    else priceRating = 'premium';
  }

  // Find similar listings (same bedroom count, similar type)
  const similar = comparables
    .filter(c => c.id !== listingId)
    .filter(c => {
      const bedroomMatch = Math.abs(c.bedrooms - listing.bedrooms) <= 1;
      return bedroomMatch;
    })
    .slice(0, 10)
    .map(c => ({
      id: c.id,
      title: c.title,
      price_per_night: c.price_per_night,
      rating: c.rating,
      bedrooms: c.bedrooms,
      type: c.type,
      url: c.url,
    }));

  // Value score: rating / price ratio relative to market
  let valueScore: number | null = null;
  if (listingPrice && listing.rating && avg) {
    const ratingNorm = listing.rating / 5;
    const priceNorm = avg > 0 ? listingPrice / avg : 1;
    valueScore = Math.round((ratingNorm / priceNorm) * 100);
    valueScore = Math.min(200, Math.max(0, valueScore));
  }

  // Determine price factors
  const factors: string[] = [];
  if (listing.superhost) factors.push('Superhost status may justify premium pricing');
  if (listing.rating && listing.rating >= 4.8) factors.push('High rating (4.8+) supports higher rates');
  if (listing.bedrooms >= 3) factors.push('Larger property with 3+ bedrooms');
  if (listing.amenities.length >= 15) factors.push('Extensive amenity list adds value');
  if (priceRating === 'budget') factors.push('Priced below market — potential for rate increase');
  if (priceRating === 'premium') factors.push('Premium priced — ensure amenities/experience justify rate');

  return {
    listing_id: listingId,
    listing_title: listing.title,
    price_per_night: listingPrice,
    market_comparison: {
      market_avg: avg,
      market_median: median,
      percentile,
      price_rating: priceRating,
      difference_from_avg_pct: diffFromAvgPct,
    },
    comparable_listings: similar,
    value_score: valueScore,
    price_factors: factors,
  };
}

function buildPriceAnalysisNoComps(listing: AirbnbListingDetail): PriceAnalysis {
  return {
    listing_id: listing.id,
    listing_title: listing.title,
    price_per_night: listing.price_per_night,
    market_comparison: {
      market_avg: null,
      market_median: null,
      percentile: null,
      price_rating: 'average',
      difference_from_avg_pct: null,
    },
    comparable_listings: [],
    value_score: null,
    price_factors: ['Insufficient market data for comparison — provide location parameter for better analysis'],
  };
}

// ─── OCCUPANCY ESTIMATION ──────────────────────────

export async function estimateOccupancy(
  listingId: string,
  location?: string,
): Promise<OccupancyEstimate> {
  const [listing, reviews] = await Promise.all([
    getListingDetail(listingId),
    getListingReviews(listingId, 50),
  ]);

  const totalReviews = listing.reviews_count || reviews.length;

  // Estimate reviews in last 12 months from review dates
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let recentReviews = 0;
  const monthlyReviewCounts: Record<string, number> = {};

  for (const review of reviews) {
    const reviewDate = parseReviewDate(review.date);
    if (reviewDate && reviewDate >= oneYearAgo) {
      recentReviews++;
      const monthKey = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}`;
      monthlyReviewCounts[monthKey] = (monthlyReviewCounts[monthKey] || 0) + 1;
    }
  }

  // Airbnb review rate is roughly 50-72% of stays result in a review
  // We use 60% as the midpoint estimate
  const REVIEW_TO_STAY_RATIO = 0.60;
  const estimatedStaysPerYear = Math.round(recentReviews / REVIEW_TO_STAY_RATIO);

  // Average stay length assumption: 3.5 nights
  const AVG_STAY_LENGTH = 3.5;
  const estimatedBookedNights = estimatedStaysPerYear * AVG_STAY_LENGTH;
  const estimatedOccupancy = Math.min(95, Math.round((estimatedBookedNights / 365) * 100));

  // Confidence assessment
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  if (reviews.length < 5) confidence = 'low';
  else if (reviews.length >= 20 && recentReviews >= 10) confidence = 'high';

  // Determine price competitiveness
  let priceCompetitiveness: string | null = null;
  if (location) {
    try {
      const comparables = await searchAirbnb(location, undefined, undefined, 2, undefined, undefined, 30);
      const prices = comparables.map(l => l.price_per_night).filter((p): p is number => p !== null && p > 0);
      if (prices.length > 0 && listing.price_per_night) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const ratio = listing.price_per_night / avg;
        if (ratio < 0.8) priceCompetitiveness = 'below_market';
        else if (ratio > 1.2) priceCompetitiveness = 'above_market';
        else priceCompetitiveness = 'at_market';
      }
    } catch { /* ignore comparison failure */ }
  }

  // Monthly breakdown with seasonality
  const monthlyBreakdown = generateMonthlyOccupancy(estimatedOccupancy, monthlyReviewCounts);

  // Review frequency (reviews per month)
  const monthsActive = totalReviews > 0 ? Math.max(1, totalReviews / 2) : null;
  const reviewFrequency = monthsActive ? Math.round((totalReviews / monthsActive) * 10) / 10 : null;

  return {
    listing_id: listingId,
    listing_title: listing.title,
    estimated_occupancy_rate: estimatedOccupancy,
    confidence,
    methodology: 'Review-based estimation: uses review frequency with 60% review-to-stay ratio and 3.5-night average stay length. Seasonality inferred from review date distribution.',
    factors: {
      review_frequency: reviewFrequency,
      reviews_last_12_months: recentReviews,
      total_reviews: totalReviews,
      rating: listing.rating,
      superhost: listing.superhost,
      price_competitiveness: priceCompetitiveness,
    },
    monthly_breakdown: monthlyBreakdown,
    comparable_occupancy: {
      market_avg_estimate: null,
      listing_vs_market: null,
    },
  };
}

function parseReviewDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Try common formats: "March 2024", "2024-03-15", "Mar 2024"
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  // Try "Month Year" format
  const monthYearMatch = dateStr.match(/(\w+)\s+(\d{4})/);
  if (monthYearMatch) {
    const parsed = new Date(`${monthYearMatch[1]} 1, ${monthYearMatch[2]}`);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function generateMonthlyOccupancy(
  baseOccupancy: number,
  monthlyReviews: Record<string, number>,
): MonthlyOccupancy[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Default seasonality multipliers (US/general market)
  const seasonality = [0.75, 0.70, 0.85, 0.90, 1.05, 1.15, 1.25, 1.20, 1.10, 0.95, 0.80, 0.85];

  // If we have real review data, use it to adjust
  const reviewCounts = Object.values(monthlyReviews);
  let hasRealData = reviewCounts.length >= 3;

  if (hasRealData) {
    const maxReviews = Math.max(...reviewCounts, 1);
    const monthIndices: Record<string, number> = {};
    for (const [key, count] of Object.entries(monthlyReviews)) {
      const monthNum = parseInt(key.split('-')[1]) - 1;
      monthIndices[monthNum] = count / maxReviews;
    }

    for (let i = 0; i < 12; i++) {
      if (monthIndices[i] !== undefined) {
        // Blend real data with default seasonality
        seasonality[i] = (monthIndices[i] + seasonality[i]) / 2;
      }
    }
  }

  // Normalize so average is 1.0
  const avgSeason = seasonality.reduce((a, b) => a + b, 0) / 12;
  const normalized = seasonality.map(s => s / avgSeason);

  // Peak months: June, July, August typically
  const peakThreshold = 1.1;

  return months.map((month, i) => ({
    month,
    estimated_occupancy_pct: Math.min(98, Math.max(10, Math.round(baseOccupancy * normalized[i]))),
    is_peak: normalized[i] >= peakThreshold,
  }));
}

// ─── HOST PROFILE ANALYSIS ────────────────────────

export async function analyzeHost(
  listingId: string,
  location?: string,
): Promise<HostAnalysis> {
  const [listing, reviews] = await Promise.all([
    getListingDetail(listingId),
    getListingReviews(listingId, 30),
  ]);

  // Analyze review sentiment
  const reviewTexts = reviews.map(r => r.text).filter(t => t.length > 0);
  const sentimentResults = reviewTexts.map(t => scoreSentiment(t));

  const posCount = sentimentResults.filter(s => s.overall === 'positive').length;
  const negCount = sentimentResults.filter(s => s.overall === 'negative').length;
  const neuCount = sentimentResults.length - posCount - negCount;
  const total = Math.max(sentimentResults.length, 1);

  // Extract strengths and weaknesses from reviews
  const strengths = extractThemes(reviewTexts, 'positive');
  const improvements = extractThemes(reviewTexts, 'negative');

  // Responsiveness score
  let responsivenessScore = 'unknown';
  if (listing.host.response_rate) {
    const rate = parseInt(listing.host.response_rate);
    if (rate >= 95) responsivenessScore = 'excellent';
    else if (rate >= 80) responsivenessScore = 'good';
    else if (rate >= 60) responsivenessScore = 'fair';
    else responsivenessScore = 'needs_improvement';
  }

  // Try to find other listings by this host in the same area
  let otherListings: HostListingSummary[] = [];
  if (location) {
    try {
      const areaListings = await searchAirbnb(location, undefined, undefined, 2, undefined, undefined, 50);
      // We can't directly identify same-host listings from search results,
      // but we include the analyzed listing
      otherListings = [{
        id: listing.id,
        title: listing.title,
        price_per_night: listing.price_per_night,
        rating: listing.rating,
        reviews_count: listing.reviews_count,
        type: listing.type,
        url: listing.url,
      }];
    } catch { /* ignore */ }
  } else {
    otherListings = [{
      id: listing.id,
      title: listing.title,
      price_per_night: listing.price_per_night,
      rating: listing.rating,
      reviews_count: listing.reviews_count,
      type: listing.type,
      url: listing.url,
    }];
  }

  const propertyTypes: Record<string, number> = {};
  for (const l of otherListings) {
    const t = l.type || 'Unknown';
    propertyTypes[t] = (propertyTypes[t] || 0) + 1;
  }

  return {
    host_name: listing.host.name,
    superhost: listing.host.superhost,
    response_rate: listing.host.response_rate,
    response_time: listing.host.response_time,
    listings_analyzed: otherListings,
    portfolio_stats: {
      total_listings: otherListings.length,
      avg_price: otherListings.length > 0
        ? Math.round(
            otherListings.reduce((sum, l) => sum + (l.price_per_night || 0), 0) / otherListings.length
          )
        : null,
      avg_rating: otherListings.length > 0
        ? Math.round(
            (otherListings.reduce((sum, l) => sum + (l.rating || 0), 0) / otherListings.length) * 10
          ) / 10
        : null,
      total_reviews: otherListings.reduce((sum, l) => sum + (l.reviews_count || 0), 0),
      property_types: propertyTypes,
      superhost: listing.host.superhost,
    },
    performance_indicators: {
      review_sentiment: {
        overall: posCount > negCount ? 'positive' : negCount > posCount ? 'negative' : 'neutral',
        positive_pct: Math.round((posCount / total) * 100),
        neutral_pct: Math.round((neuCount / total) * 100),
        negative_pct: Math.round((negCount / total) * 100),
      },
      strengths,
      areas_for_improvement: improvements,
      responsiveness_score: responsivenessScore,
    },
  };
}

function extractThemes(reviewTexts: string[], sentiment: 'positive' | 'negative'): string[] {
  const positiveThemes: Record<string, string[]> = {
    'Clean and well-maintained': ['clean', 'spotless', 'tidy', 'immaculate', 'maintained', 'pristine'],
    'Great location': ['location', 'convenient', 'central', 'walkable', 'close to', 'nearby', 'neighborhood'],
    'Excellent communication': ['communicat', 'responsive', 'helpful', 'respond', 'quick reply', 'message'],
    'Comfortable space': ['comfortable', 'cozy', 'spacious', 'roomy', 'bed', 'comfy'],
    'Good amenities': ['amenities', 'kitchen', 'wifi', 'parking', 'equipped', 'everything we needed'],
    'Great value': ['value', 'worth', 'price', 'affordable', 'deal', 'reasonable'],
    'Welcoming host': ['welcoming', 'friendly', 'warm', 'generous', 'hospitable', 'kind'],
    'Accurate listing': ['accurate', 'as described', 'pictures', 'exactly', 'matched'],
    'Smooth check-in': ['check-in', 'check in', 'easy access', 'self check', 'keyless', 'instructions'],
  };

  const negativeThemes: Record<string, string[]> = {
    'Cleanliness concerns': ['dirty', 'unclean', 'stain', 'dust', 'hair', 'smell', 'odor'],
    'Noise issues': ['noise', 'noisy', 'loud', 'traffic', 'construction', 'thin walls'],
    'Communication gaps': ['no response', 'slow response', 'unreachable', 'didnt respond', 'no answer'],
    'Inaccurate listing': ['misleading', 'inaccurate', 'not as described', 'different from', 'photos'],
    'Maintenance issues': ['broken', 'leak', 'repair', 'fix', 'malfunction', 'not working'],
    'Check-in problems': ['check-in', 'lockout', 'key', 'access', 'waited', 'late'],
    'Missing amenities': ['missing', 'no towels', 'no soap', 'expected', 'advertised'],
    'Uncomfortable space': ['uncomfortable', 'cramped', 'small', 'thin mattress', 'hard bed'],
  };

  const themes = sentiment === 'positive' ? positiveThemes : negativeThemes;
  const found: string[] = [];
  const combined = reviewTexts.join(' ').toLowerCase();

  for (const [theme, keywords] of Object.entries(themes)) {
    const matchCount = keywords.filter(kw => combined.includes(kw)).length;
    if (matchCount >= 2 || (matchCount >= 1 && reviewTexts.length <= 5)) {
      found.push(theme);
    }
  }

  return found.slice(0, 5);
}

// ─── REVENUE PROJECTION ──────────────────────────

export async function projectRevenue(
  listingId: string,
  location?: string,
  monthlyExpenses?: number,
): Promise<RevenueProjection> {
  const listing = await getListingDetail(listingId);
  const nightlyRate = listing.price_per_night || 0;

  // Get market context if location provided
  let marketAvg: number | null = null;
  let totalComparables = 0;
  let superhostPremium = 10; // default 10% premium for superhosts

  if (location) {
    try {
      const comparables = await searchAirbnb(location, undefined, undefined, 2, undefined, undefined, 50);
      const prices = comparables.map(l => l.price_per_night).filter((p): p is number => p !== null && p > 0);
      if (prices.length > 0) {
        marketAvg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        totalComparables = comparables.length;

        // Calculate superhost premium from data
        const superhostPrices = comparables.filter(l => l.superhost).map(l => l.price_per_night).filter((p): p is number => p !== null);
        const nonSuperhostPrices = comparables.filter(l => !l.superhost).map(l => l.price_per_night).filter((p): p is number => p !== null);

        if (superhostPrices.length > 0 && nonSuperhostPrices.length > 0) {
          const shAvg = superhostPrices.reduce((a, b) => a + b, 0) / superhostPrices.length;
          const nshAvg = nonSuperhostPrices.reduce((a, b) => a + b, 0) / nonSuperhostPrices.length;
          superhostPremium = Math.round(((shAvg - nshAvg) / nshAvg) * 100);
        }
      }
    } catch { /* ignore */ }
  }

  // Occupancy rate assumptions
  const occupancyRates = {
    conservative: 40,
    moderate: 60,
    optimistic: 80,
  };

  // Expense assumptions
  const cleaningFeeEstimate = Math.round(nightlyRate * 0.3); // ~30% of nightly rate
  const serviceFeeRate = 0.03; // Airbnb host fee ~3%
  const expenses = monthlyExpenses || Math.round(nightlyRate * 10); // rough estimate if not provided

  const scenarios = {
    conservative: calculateScenario(nightlyRate, occupancyRates.conservative, cleaningFeeEstimate, serviceFeeRate, expenses),
    moderate: calculateScenario(nightlyRate, occupancyRates.moderate, cleaningFeeEstimate, serviceFeeRate, expenses),
    optimistic: calculateScenario(nightlyRate, occupancyRates.optimistic, cleaningFeeEstimate, serviceFeeRate, expenses),
  };

  // Breakeven calculation
  const fixedCosts = expenses * 12;
  let breakevenOccupancy: number | null = null;
  if (nightlyRate > 0) {
    const revenuePerNight = nightlyRate * (1 - serviceFeeRate);
    const nightsNeeded = Math.ceil(fixedCosts / revenuePerNight);
    breakevenOccupancy = Math.min(100, Math.round((nightsNeeded / 365) * 100));
  }

  // RevPAN (Revenue Per Available Night)
  const revPAN = nightlyRate > 0 ? Math.round(nightlyRate * (occupancyRates.moderate / 100)) : null;

  return {
    listing_id: listingId,
    listing_title: listing.title,
    price_per_night: nightlyRate || null,
    projections: scenarios,
    assumptions: {
      occupancy_rates: occupancyRates,
      avg_nightly_rate: nightlyRate || null,
      cleaning_fee_estimate: cleaningFeeEstimate,
      service_fee_pct: serviceFeeRate * 100,
      monthly_expenses_estimate: expenses,
    },
    market_context: {
      avg_daily_rate: marketAvg,
      total_comparable_listings: totalComparables,
      superhost_premium_pct: superhostPremium,
    },
    roi_metrics: {
      breakeven_occupancy_pct: breakevenOccupancy,
      revenue_per_available_night: revPAN,
    },
  };
}

function calculateScenario(
  nightlyRate: number,
  occupancyPct: number,
  cleaningFee: number,
  serviceFeeRate: number,
  monthlyExpenses: number,
): RevenueScenario {
  const bookedNights = Math.round((occupancyPct / 100) * 365);
  const avgStayLength = 3.5;
  const numberOfStays = Math.round(bookedNights / avgStayLength);

  const grossNightly = nightlyRate * bookedNights;
  const grossCleaning = cleaningFee * numberOfStays;
  const annualGross = grossNightly + grossCleaning;

  const serviceFees = annualGross * serviceFeeRate;
  const annualExpenses = monthlyExpenses * 12;
  const annualNet = annualGross - serviceFees - annualExpenses;

  return {
    annual_gross_revenue: Math.round(annualGross),
    monthly_avg_revenue: Math.round(annualGross / 12),
    annual_net_revenue: Math.round(annualNet),
    monthly_avg_net: Math.round(annualNet / 12),
    occupancy_rate: occupancyPct,
    booked_nights_per_year: bookedNights,
  };
}
