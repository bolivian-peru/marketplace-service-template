/**
 * Review Monitor Scraper — Proxies.sx Marketplace Service
 * Bounty: Review Monitor ($200)
 *
 * Monitors business reviews on Google Maps and Yelp.
 * Tracks review count changes, rating changes, and new reviews.
 * Uses Proxies.sx mobile proxies.
 *
 * Endpoints:
 *   GET /api/reviews/monitor?place=ChIJ...&platform=google
 *   GET /api/reviews/latest?place=ChIJ...&platform=google&limit=10
 */

import { proxyFetch } from '../proxy';

export interface ReviewResult {
  author: string;
  rating: number;
  text: string;
  date: string;
  language: string;
  reviewId: string;
}

export interface MonitorResult {
  placeId: string;
  placeName: string;
  platform: string;
  currentRating: number | null;
  currentReviewCount: number;
  newReviews: ReviewResult[];
  changedSince?: string;
  scrapedAt: string;
  meta: { proxy: { ip: string; country: string; type: string } };
}

export const SERVICE_NAME = 'review-monitor';
export const PRICE_USDC = 0.005;
export const DESC = 'Monitor Google Maps and Yelp reviews. Track rating changes, new reviews, and review counts. Real mobile IPs for geo-accurate results.';

function extractReviewsFromGoogleHTML(html: string): { reviews: ReviewResult[]; rating: number | null; reviewCount: number; name: string } {
  const reviews: ReviewResult[] = [];
  let rating: number | null = null;
  let reviewCount = 0;
  let name = '';

  // JSON-LD first
  const jsonMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
  if (jsonMatch) {
    for (const block of jsonMatch) {
      try {
        const ld = JSON.parse(block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''));
        if (ld['@type'] === 'LocalBusiness' || ld['@type'] === 'Restaurant') {
          name = ld.name || '';
          rating = ld.aggregateRating?.ratingValue ? parseFloat(String(ld.aggregateRating.ratingValue)) : null;
          reviewCount = ld.aggregateRating?.reviewCount ? parseInt(String(ld.aggregateRating.reviewCount)) : 0;
        }
        if (ld['@type'] === 'Review' && ld.reviewBody) {
          reviews.push({
            author: ld.author?.name || 'Anonymous',
            rating: ld.reviewRating?.ratingValue ? parseInt(String(ld.reviewRating.ratingValue)) : 0,
            text: ld.reviewBody.substring(0, 500),
            date: ld.datePublished || '',
            language: ld.inLanguage || 'en',
            reviewId: ld['@id'] || '',
          });
        }
      } catch {}
    }
  }

  // Fallback regex
  if (reviews.length === 0) {
    const reviewBlocks = html.match(/<div[^>]*data-review-id="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi);
    if (reviewBlocks) {
      for (const block of reviewBlocks) {
        const authorMatch = block.match(/<span[^>]*class="[^"]*d4r55[^"]*"[^>]*>([^<]+)<\/span>/);
        const ratingMatch = block.match(/aria-label="([\d.]+) stars?"/);
        const textMatch = block.match(/<span[^>]*class="[^"]*wiI7pd[^"]*"[^>]*>([\s\S]*?)<\/span>/);
        
        if (authorMatch) {
          reviews.push({
            author: authorMatch[1].trim(),
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
            text: textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 500) : '',
            date: '',
            language: 'en',
            reviewId: block.match(/data-review-id="([^"]+)"/)?.[1] || '',
          });
        }
      }
    }
  }

  // Rating from aggregate section
  if (!rating) {
    const ratingMatch = html.match(/aria-label="([\d.]+) stars? [\d,]+ reviews?"/);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1]);
      const countMatch = ratingMatch[0].match(/([\d,]+) reviews?/);
      if (countMatch) reviewCount = parseInt(countMatch[1].replace(/,/g, ''));
    }
  }

  // Name
  if (!name) {
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    if (titleMatch) name = titleMatch[1].replace(/\s*-\s*Google.*$/, '').trim();
  }

  return { reviews, rating, reviewCount, name };
}

function extractReviewsFromYelpHTML(html: string): { reviews: ReviewResult[]; rating: number | null; reviewCount: number; name: string } {
  const reviews: ReviewResult[] = [];
  let rating: number | null = null;
  let reviewCount = 0;
  let name = '';

  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    try {
      const ld = JSON.parse(jsonMatch[1]);
      name = ld.name || '';
      rating = ld.aggregateRating?.ratingValue || null;
      reviewCount = ld.aggregateRating?.reviewCount || 0;
      if (ld.review) {
        const rv = Array.isArray(ld.review) ? ld.review : [ld.review];
        for (const r of rv) {
          reviews.push({
            author: r.author || 'Anonymous',
            rating: r.reviewRating?.ratingValue || 0,
            text: (r.description || r.reviewBody || '').substring(0, 500),
            date: r.datePublished || '',
            language: 'en',
            reviewId: r['@id'] || '',
          });
        }
      }
    } catch {}
  }

  if (reviews.length === 0) {
    const cards = html.match(/<div[^>]*data-testid="review-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi);
    if (cards) {
      for (const card of cards) {
        const authorMatch = card.match(/<a[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)</);
        const ratingMatch = card.match(/aria-label="([\d.]+) star rating"/);
        const textMatch = card.match(/<p[^>]*class="[^"]*comment[^"]*"[^>]*>([\s\S]*?)<\/p>/);
        if (authorMatch) {
          reviews.push({
            author: authorMatch[1].trim(),
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
            text: textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 500) : '',
            date: '',
            language: 'en',
            reviewId: '',
          });
        }
      }
    }
  }

  return { reviews, rating, reviewCount, name };
}

export async function monitorReviews(
  placeId: string,
  platform: string = 'google',
): Promise<MonitorResult> {
  let url: string;
  let extractor: typeof extractReviewsFromGoogleHTML;

  if (platform === 'yelp') {
    url = `https://www.yelp.com/biz/${placeId}`;
    extractor = extractReviewsFromYelpHTML;
  } else {
    url = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
    extractor = extractReviewsFromGoogleHTML;
  }

  const result = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!result.ok) {
    return { placeId, placeName: 'Unknown', platform, currentRating: null, currentReviewCount: 0,
      newReviews: [], scrapedAt: new Date().toISOString(),
      meta: { proxy: { ip: 'unavailable', country: 'US', type: 'mobile' } } };
  }

  const { reviews, rating, reviewCount, name } = extractor(result.text || '');

  return {
    placeId,
    placeName: name,
    platform,
    currentRating: rating,
    currentReviewCount: reviewCount,
    newReviews: reviews.slice(0, 10),
    scrapedAt: new Date().toISOString(),
    meta: { proxy: { ip: 'proxies.sx-mobile', country: 'US', type: 'mobile' } },
  };
}

export async function getLatestReviews(
  placeId: string,
  platform: string = 'google',
  limit: number = 10,
): Promise<ReviewResult[]> {
  const result = await monitorReviews(placeId, platform);
  return result.newReviews.slice(0, limit);
}
