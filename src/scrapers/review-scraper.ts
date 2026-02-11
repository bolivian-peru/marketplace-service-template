/**
 * Review & Reputation Monitor Scraper
 * ─────────────────────────────────
 * Extracts reviews from Yelp and Trustpilot.
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

export interface Review {
  author: string;
  rating: number;
  content: string;
  date: string;
  platform: 'Yelp' | 'Trustpilot';
  link?: string;
}

/**
 * Scrape Yelp Reviews
 */
export async function scrapeYelp(businessSlug: string): Promise<Review[]> {
  const url = `https://www.yelp.com/biz/${businessSlug}`;
  console.log(`[ReviewScraper] Fetching Yelp: ${url}`);
  
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  if (!response.ok) {
    throw new Error(`Yelp fetch failed: ${response.status}`);
  }

  const html = await response.text();
  return parseYelp(html);
}

function parseYelp(html: string): Review[] {
  const reviews: Review[] = [];
  
  // Look for JSON-LD which often contains reviews on Yelp
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const reviewList = data.review || [];
      
      for (const r of reviewList) {
        reviews.push({
          author: r.author,
          rating: r.reviewRating?.ratingValue || 0,
          content: r.description,
          date: r.datePublished,
          platform: 'Yelp'
        });
      }
    } catch (e) {
      console.error('[ReviewScraper] Failed to parse Yelp JSON-LD');
    }
  }
  
  return reviews;
}

/**
 * Scrape Trustpilot Reviews
 */
export async function scrapeTrustpilot(domain: string): Promise<Review[]> {
  const url = `https://www.trustpilot.com/review/${domain}`;
  console.log(`[ReviewScraper] Fetching Trustpilot: ${url}`);
  
  const response = await proxyFetch(url);

  if (!response.ok) {
    throw new Error(`Trustpilot fetch failed: ${response.status}`);
  }

  const html = await response.text();
  return parseTrustpilot(html);
}

function parseTrustpilot(html: string): Review[] {
  const reviews: Review[] = [];
  
  // Trustpilot also uses JSON-LD or structured scripts
  const scriptMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    try {
      const data = JSON.parse(scriptMatch[1]);
      const businessUnit = data.props?.pageProps?.businessUnit;
      const reviewList = data.props?.pageProps?.reviews || [];
      
      for (const r of reviewList) {
        reviews.push({
          author: r.consumer?.displayName || 'Anonymous',
          rating: r.rating,
          content: r.text,
          date: r.dates?.publishedDate,
          platform: 'Trustpilot'
        });
      }
    } catch (e) {
      console.error('[ReviewScraper] Failed to parse Trustpilot NEXT_DATA');
    }
  }
  
  return reviews;
}
