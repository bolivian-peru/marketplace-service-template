/**
 * Google Reviews — Rating Distribution & Summary Calculation
 */

import type { ReviewData, BusinessInfo, ReviewSummary, RatingDistribution } from '../../types';

// ─── RATING DISTRIBUTION EXTRACTION ─────────────────

/**
 * Extract rating distribution (1-5 star breakdown) from HTML
 */
export function extractRatingDistribution(html: string): RatingDistribution {
  const dist: RatingDistribution = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };

  // Pattern 1: aria-label with star counts
  const ariaPattern = /aria-label="(\d)\s+stars?,?\s*(\d[\d,]*)\s+reviews?"/gi;
  let match;
  while ((match = ariaPattern.exec(html)) !== null) {
    const star = match[1] as keyof RatingDistribution;
    if (star in dist) {
      dist[star] = parseInt(match[2].replace(/,/g, ''));
    }
  }

  // Pattern 2: percentage bars with counts
  if (Object.values(dist).every(v => v === 0)) {
    for (let i = 5; i >= 1; i--) {
      const countPattern = new RegExp(`${i}\\s+stars?[\\s\\S]*?(\\d[\\d,]*)`, 'i');
      const countMatch = html.match(countPattern);
      if (countMatch) {
        dist[String(i) as keyof RatingDistribution] = parseInt(countMatch[1].replace(/,/g, ''));
      }
    }
  }

  // Pattern 3: percentage-based distribution (convert to counts using total)
  if (Object.values(dist).every(v => v === 0)) {
    const totalMatch = html.match(/([\d,]+)\s+(?:total\s+)?reviews?/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;

    if (total > 0) {
      const pctPattern = /(\d)\s+stars?\s*[\s\S]*?(\d+)%/gi;
      while ((match = pctPattern.exec(html)) !== null) {
        const star = match[1] as keyof RatingDistribution;
        if (star in dist) {
          dist[star] = Math.round(total * parseInt(match[2]) / 100);
        }
      }
    }
  }

  return dist;
}

// ─── REVIEW SUMMARY CALCULATION ─────────────────────

/**
 * Calculate review summary statistics from reviews and business info
 */
export function calculateSummary(reviews: ReviewData[], info: BusinessInfo, dist: RatingDistribution): ReviewSummary {
  // Calculate response rate from reviews
  const reviewsWithOwnerResponse = reviews.filter(r => r.ownerResponse !== null).length;
  const responseRate = reviews.length > 0
    ? Math.round((reviewsWithOwnerResponse / reviews.length) * 100)
    : 0;

  // Calculate average response time (estimate from relative dates)
  let avgResponseTimeDays: number | null = null;

  // Sentiment breakdown from ratings
  const rated = reviews.filter(r => r.rating > 0);
  const positive = rated.filter(r => r.rating >= 4).length;
  const neutral = rated.filter(r => r.rating === 3).length;
  const negative = rated.filter(r => r.rating <= 2).length;
  const totalRated = rated.length || 1;

  return {
    avgRating: info.rating,
    totalReviews: info.totalReviews,
    ratingDistribution: dist,
    responseRate,
    avgResponseTimeDays,
    sentimentBreakdown: {
      positive: Math.round((positive / totalRated) * 100),
      neutral: Math.round((neutral / totalRated) * 100),
      negative: Math.round((negative / totalRated) * 100),
    },
  };
}
