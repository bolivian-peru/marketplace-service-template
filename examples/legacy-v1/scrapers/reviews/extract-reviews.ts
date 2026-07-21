/**
 * Google Reviews — Review Extraction & Parsing
 */

import { decodeHtmlEntities } from '../../utils/helpers';
import { parseDateString } from './helpers';
import type { ReviewData } from '../../types';

// ─── REVIEW EXTRACTION ──────────────────────────────

/**
 * Extract individual reviews from Google Maps HTML
 */
export function extractReviews(html: string, limit: number = 20): ReviewData[] {
  const reviews: ReviewData[] = [];

  // Strategy 1: Extract from JSON-LD / embedded data
  const reviewJsonPattern = /"review"\s*:\s*\[([\s\S]*?)\](?=\s*[,}])/;
  const jsonMatch = html.match(reviewJsonPattern);

  if (jsonMatch) {
    try {
      const reviewsData = JSON.parse(`[${jsonMatch[1]}]`);
      for (const r of reviewsData) {
        if (reviews.length >= limit) break;
        reviews.push({
          author: r.author?.name || r.author || 'Anonymous',
          rating: parseInt(r.reviewRating?.ratingValue || r.rating) || 0,
          text: decodeHtmlEntities(r.reviewBody || r.text || ''),
          date: r.datePublished || r.date || '',
          relativeDate: null,
          likes: parseInt(r.likes) || 0,
          ownerResponse: r.ownerResponse?.text || r.owner_response || null,
          ownerResponseDate: r.ownerResponse?.datePublished || null,
          photos: [],
        });
      }
    } catch { /* fallback to HTML parsing */ }
  }

  // Strategy 2: Parse from HTML review blocks
  if (reviews.length === 0) {
    const reviewBlockPatterns = [
      /class="[^"]*(?:jftiEf|gws-localreviews__google-review)[^"]*"[\s\S]*?(?=class="[^"]*(?:jftiEf|gws-localreviews__google-review)[^"]*"|<\/div>\s*<\/div>\s*<\/div>\s*$)/gi,
      /data-review-id="[^"]*"[\s\S]*?(?=data-review-id="|$)/gi,
      /class="[^"]*review-dialog-list[^"]*"[\s\S]*?class="[^"]*(?:review-snippet)[^"]*"/gi,
    ];

    for (const blockPattern of reviewBlockPatterns) {
      const blocks = html.match(blockPattern) || [];
      for (const block of blocks) {
        if (reviews.length >= limit) break;
        const review = parseReviewBlock(block);
        if (review && review.author && review.text) {
          reviews.push(review);
        }
      }
      if (reviews.length > 0) break;
    }
  }

  // Strategy 3: Extract from search results page review snippets
  if (reviews.length === 0) {
    const snippetPattern = /class="[^"]*(?:review-snippet|Jtu6Td|OA1nbd)[^"]*"[\s\S]*?<\/div>/gi;
    const snippets = html.match(snippetPattern) || [];
    for (const snippet of snippets) {
      if (reviews.length >= limit) break;
      const review = parseReviewSnippet(snippet);
      if (review) {
        reviews.push(review);
      }
    }
  }

  return reviews;
}

/**
 * Parse a single review block from Google Maps HTML
 */
function parseReviewBlock(block: string): ReviewData | null {
  // Extract author
  const authorMatch = block.match(/class="[^"]*(?:d4r55|TSUbDb|lTi8oc)[^"]*"[^>]*>([^<]+)/i) ||
                      block.match(/aria-label="([^"]+)'s? review/i) ||
                      block.match(/class="[^"]*author[^"]*"[^>]*>([^<]+)/i);
  const author = authorMatch ? decodeHtmlEntities(authorMatch[1].trim()) : null;

  // Extract rating
  const ratingMatch = block.match(/aria-label="(\d)\s+stars?"/i) ||
                      block.match(/class="[^"]*(?:kvMYJc|hCCjke)[^"]*"[^>]*aria-label="[^"]*?(\d)/i) ||
                      block.match(/data-rating="(\d)"/i);
  const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

  // Extract text
  const textMatch = block.match(/class="[^"]*(?:wiI7pd|review-full-text|Jtu6Td)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)/i) ||
                    block.match(/class="[^"]*(?:rsqaWe)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)/i);
  const text = textMatch ? decodeHtmlEntities(textMatch[1].replace(/<[^>]+>/g, '').trim()) : '';

  // Extract date
  const dateMatch = block.match(/class="[^"]*(?:rsqaWe|dehysf)[^"]*"[^>]*>([^<]*(?:ago|week|month|year|day|hour)[^<]*)/i) ||
                    block.match(/(\d{4}-\d{2}-\d{2})/);
  const relativeDate = dateMatch ? decodeHtmlEntities(dateMatch[1].trim()) : null;
  const date = parseDateString(relativeDate);

  // Extract likes/helpful count
  const likesMatch = block.match(/(\d+)\s+(?:people|person)?\s*(?:found this|helpful)/i) ||
                     block.match(/class="[^"]*(?:pkWtMe)[^"]*"[^>]*>(\d+)/i);
  const likes = likesMatch ? parseInt(likesMatch[1]) : 0;

  // Extract owner response
  const ownerMatch = block.match(/class="[^"]*(?:CDe7pd|owner-response)[^"]*"[\s\S]*?class="[^"]*(?:wiI7pd|review-full-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)/i);
  const ownerResponse = ownerMatch ? decodeHtmlEntities(ownerMatch[1].replace(/<[^>]+>/g, '').trim()) : null;

  // Extract owner response date
  const ownerDateMatch = block.match(/class="[^"]*(?:CDe7pd|owner-response)[^"]*"[\s\S]*?class="[^"]*(?:rsqaWe|dehysf)[^"]*"[^>]*>([^<]+)/i);
  const ownerResponseDate = ownerDateMatch ? decodeHtmlEntities(ownerDateMatch[1].trim()) : null;

  // Extract review photos
  const photoMatches = block.match(/https:\/\/lh[35]\.googleusercontent\.com\/[a-zA-Z0-9_\-\/=]+/g) || [];
  const photos = [...new Set(photoMatches)].slice(0, 5);

  if (!author && !text) return null;

  return {
    author: author || 'Anonymous',
    rating,
    text,
    date,
    relativeDate,
    likes,
    ownerResponse,
    ownerResponseDate,
    photos,
  };
}

/**
 * Parse a review snippet from search results
 */
function parseReviewSnippet(snippet: string): ReviewData | null {
  const authorMatch = snippet.match(/>([^<]+?)\s*(?:wrote|posted|reviewed)/i) ||
                      snippet.match(/class="[^"]*(?:TSUbDb|lTi8oc)[^"]*"[^>]*>([^<]+)/i);
  const textMatch = snippet.match(/"([^"]{20,})"/i) ||
                    snippet.match(/class="[^"]*(?:Jtu6Td|OA1nbd)[^"]*"[^>]*>([^<]+)/i);
  const ratingMatch = snippet.match(/(\d)\s*(?:\/5|stars?|out of)/i);

  if (!textMatch) return null;

  return {
    author: authorMatch ? decodeHtmlEntities(authorMatch[1].trim()) : 'Anonymous',
    rating: ratingMatch ? parseInt(ratingMatch[1]) : 0,
    text: decodeHtmlEntities(textMatch[1].trim()),
    date: '',
    relativeDate: null,
    likes: 0,
    ownerResponse: null,
    ownerResponseDate: null,
    photos: [],
  };
}
