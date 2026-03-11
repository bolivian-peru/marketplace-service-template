/**
 * Google Reviews & Business Data — Public API
 * ────────────────────────────────────────────
 * Re-exports the 4 main functions used by service.ts
 */

import { fetchGoogleMapsPage, buildReviewsUrl, buildPlaceUrl, buildSearchUrl, buildLocalSearchUrl } from './fetch';
import { extractBusinessInfo, extractBusinessFromSearch } from './extract-business';
import { extractReviews } from './extract-reviews';
import { extractSearchResults, extractFromLocalSearch } from './extract-search';
import { extractRatingDistribution, calculateSummary } from './summary';
import type { ReviewsResponse, BusinessResponse, ReviewSummaryResponse, ReviewSearchResponse } from '../../types';

export async function fetchReviews(
  placeId: string,
  sort: string = 'newest',
  limit: number = 20,
): Promise<ReviewsResponse> {
  const url = buildReviewsUrl(placeId, sort);
  const html = await fetchGoogleMapsPage(url);

  let business = extractBusinessInfo(html, placeId);
  const reviews = extractReviews(html, limit);

  if (!business.name) {
    console.log(`[REVIEWS] Maps returned sparse data for reviews, trying Google Search fallback...`);
    try {
      const fallbackUrl = `https://www.google.com/search?q=place_id:${encodeURIComponent(placeId)}&gbv=1&hl=en`;
      const fallbackHtml = await fetchGoogleMapsPage(fallbackUrl);
      const fallbackBiz = extractBusinessFromSearch(fallbackHtml, placeId);
      if (fallbackBiz.name) business = fallbackBiz;
    } catch { /* keep original */ }
  }

  if (!business.name && reviews.length === 0) {
    console.warn(`[REVIEWS] All extraction strategies failed for place_id="${placeId}" — Google may require mobile proxies for this request.`);
  }

  console.log(`[REVIEWS] Extracted: ${reviews.length} reviews for "${business.name || '(unknown)'}"`);

  return {
    business,
    reviews,
    pagination: {
      total: business.totalReviews || reviews.length,
      returned: reviews.length,
      sort,
    },
  };
}

export async function fetchBusinessDetails(placeId: string): Promise<BusinessResponse> {
  const url = buildPlaceUrl(placeId);
  const html = await fetchGoogleMapsPage(url);

  let business = extractBusinessInfo(html, placeId);
  let reviews = extractReviews(html, 50);
  let dist = extractRatingDistribution(html);

  if (!business.name) {
    console.log(`[REVIEWS] Maps returned sparse data, trying Google Search fallback...`);
    const fallbackUrl = `https://www.google.com/search?q=place_id:${encodeURIComponent(placeId)}&gbv=1&hl=en`;
    try {
      const fallbackHtml = await fetchGoogleMapsPage(fallbackUrl);
      const fallbackBiz = extractBusinessFromSearch(fallbackHtml, placeId);
      if (fallbackBiz.name) business = fallbackBiz;
    } catch { /* fallback failed, keep original */ }
  }

  const summary = calculateSummary(reviews, business, dist);

  if (!business.name) {
    console.warn(`[REVIEWS] All extraction strategies failed for place_id="${placeId}" — Google may require mobile proxies for this request.`);
  }

  console.log(`[REVIEWS] Business: "${business.name || '(unknown)'}" — ${business.rating}★ (${business.totalReviews} reviews)`);

  return { business, summary };
}

export async function fetchReviewSummary(placeId: string): Promise<ReviewSummaryResponse> {
  const url = buildPlaceUrl(placeId);
  const html = await fetchGoogleMapsPage(url);

  let business = extractBusinessInfo(html, placeId);
  const reviews = extractReviews(html, 50);
  const dist = extractRatingDistribution(html);

  if (!business.name) {
    console.log(`[REVIEWS] Maps returned sparse data for summary, trying Google Search fallback...`);
    try {
      const fallbackUrl = `https://www.google.com/search?q=place_id:${encodeURIComponent(placeId)}&gbv=1&hl=en`;
      const fallbackHtml = await fetchGoogleMapsPage(fallbackUrl);
      const fallbackBiz = extractBusinessFromSearch(fallbackHtml, placeId);
      if (fallbackBiz.name) business = fallbackBiz;
    } catch { /* keep original */ }
  }

  const summary = calculateSummary(reviews, business, dist);

  if (!business.name) {
    console.warn(`[REVIEWS] All extraction strategies failed for place_id="${placeId}" — Google may require mobile proxies for this request.`);
  }

  console.log(`[REVIEWS] Summary: "${business.name || '(unknown)'}" — response rate: ${summary.responseRate}%`);

  return {
    business: {
      name: business.name,
      placeId: business.placeId,
      rating: business.rating,
      totalReviews: business.totalReviews,
    },
    summary,
  };
}

export async function searchBusinesses(
  query: string,
  location: string,
  limit: number = 10,
): Promise<ReviewSearchResponse> {
  const url = buildSearchUrl(query, location);
  let html = await fetchGoogleMapsPage(url);
  let businesses = extractSearchResults(html).slice(0, limit);

  if (businesses.length === 0) {
    console.log(`[REVIEWS] Maps search returned 0 results, trying local web search...`);
    const localUrl = buildLocalSearchUrl(query, location);
    html = await fetchGoogleMapsPage(localUrl);
    businesses = extractFromLocalSearch(html).slice(0, limit);
  }

  if (businesses.length === 0) {
    console.warn(`[REVIEWS] All search strategies returned 0 results for "${query} in ${location}" — Google may require mobile proxies or the query returned no local results.`);
  }

  console.log(`[REVIEWS] Search: "${query} in ${location}" — found ${businesses.length} businesses`);

  return {
    query,
    location,
    businesses,
    totalFound: businesses.length,
  };
}
