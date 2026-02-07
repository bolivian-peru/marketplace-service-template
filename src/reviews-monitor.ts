/**
 * ┌─────────────────────────────────────────────────┐
 * │    Review & Reputation Monitor                  │
 * │    Google Maps, Yelp, TripAdvisor, Trustpilot  │
 * │    Sentiment, trends, keyword extraction        │
 * └─────────────────────────────────────────────────┘
 * 
 * Bounty: https://github.com/bolivian-peru/marketplace-service-template/issues/14
 * Price: $0.002 per review ($50 bounty)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const reviewsRouter = new Hono();

// ─── CONFIGURATION ─────────────────────────────────
const SERVICE_NAME = 'reviews-monitor';
const PRICE_USDC = 0.002;  // $0.002 per review
const DESCRIPTION = 'Aggregate business reviews from Google Maps, Yelp, TripAdvisor, Trustpilot. Get ratings, sentiment, trends, keyword extraction.';

const OUTPUT_SCHEMA = {
  input: {
    business: 'string — Business name (required)',
    location: 'string — City/location for disambiguation (optional)',
    url: 'string — Direct URL to business page (optional, overrides name search)',
    platforms: 'string[] — Platforms to check: google, yelp, tripadvisor, trustpilot (default: all)',
    limit: 'number — Max reviews per platform (default: 20, max: 100)',
    since: 'string — ISO date, only reviews after this date (optional)',
  },
  output: {
    business: 'string — Business name',
    overallRating: 'number — Weighted average across platforms',
    totalReviews: 'number — Total review count across platforms',
    sentiment: '{ positive: number, neutral: number, negative: number } — Sentiment breakdown %',
    ratingTrend: 'string — Trend: improving, stable, declining',
    keywords: '[{ word: string, count: number, sentiment: string }] — Top extracted keywords',
    platforms: [{
      platform: 'string — Platform name',
      rating: 'number — Platform rating',
      reviewCount: 'number — Total reviews on platform',
      url: 'string — Business page URL',
      reviews: [{
        id: 'string — Review ID',
        author: 'string — Reviewer name',
        rating: 'number — Star rating (1-5)',
        date: 'string — Review date ISO',
        text: 'string — Review text',
        sentiment: 'string — positive/neutral/negative',
        helpful: 'number | null — Helpful votes',
        response: 'string | null — Business response',
      }],
    }],
    metadata: {
      scrapedAt: 'string — ISO timestamp',
      platformsQueried: 'string[]',
    },
  },
};

// ─── TYPES ─────────────────────────────────────────

interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  text: string;
  sentiment: string;
  helpful: number | null;
  response: string | null;
}

interface PlatformResult {
  platform: string;
  rating: number;
  reviewCount: number;
  url: string;
  reviews: Review[];
}

interface Keyword {
  word: string;
  count: number;
  sentiment: string;
}

// ─── SENTIMENT ANALYSIS ────────────────────────────

const POSITIVE_WORDS = new Set([
  'excellent', 'amazing', 'wonderful', 'fantastic', 'great', 'love', 'loved', 'best',
  'perfect', 'awesome', 'outstanding', 'superb', 'incredible', 'delicious', 'friendly',
  'helpful', 'professional', 'quick', 'clean', 'beautiful', 'recommend', 'recommended',
  'impressed', 'exceptional', 'quality', 'enjoy', 'enjoyed', 'happy', 'pleasant',
]);

const NEGATIVE_WORDS = new Set([
  'terrible', 'awful', 'horrible', 'worst', 'bad', 'poor', 'disappointing', 'disappointed',
  'rude', 'slow', 'dirty', 'cold', 'overpriced', 'expensive', 'mediocre', 'avoid',
  'never', 'waste', 'wrong', 'mistake', 'complaint', 'refund', 'waiting', 'waited',
  'unprofessional', 'broken', 'disgusting', 'stale', 'undercooked', 'overcooked',
]);

function analyzeSentiment(text: string): string {
  const words = text.toLowerCase().split(/\s+/);
  let positive = 0;
  let negative = 0;
  
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positive++;
    if (NEGATIVE_WORDS.has(word)) negative++;
  }
  
  if (positive > negative + 1) return 'positive';
  if (negative > positive + 1) return 'negative';
  return 'neutral';
}

function extractKeywords(reviews: Review[]): Keyword[] {
  const wordCounts: Map<string, { count: number; positive: number; negative: number }> = new Map();
  
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my',
    'your', 'his', 'her', 'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'whose',
    'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if', 'because', 'as',
    'until', 'while', 'about', 'against', 'between', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again',
  ]);
  
  for (const review of reviews) {
    const words = review.text.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
    
    const isPositive = review.sentiment === 'positive';
    const isNegative = review.sentiment === 'negative';
    
    for (const word of words) {
      const existing = wordCounts.get(word) || { count: 0, positive: 0, negative: 0 };
      existing.count++;
      if (isPositive) existing.positive++;
      if (isNegative) existing.negative++;
      wordCounts.set(word, existing);
    }
  }
  
  return Array.from(wordCounts.entries())
    .filter(([_, data]) => data.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([word, data]) => ({
      word,
      count: data.count,
      sentiment: data.positive > data.negative ? 'positive' : 
                 data.negative > data.positive ? 'negative' : 'neutral',
    }));
}

function calculateTrend(reviews: Review[]): string {
  if (reviews.length < 5) return 'stable';
  
  // Sort by date
  const sorted = [...reviews].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  const halfIndex = Math.floor(sorted.length / 2);
  const olderReviews = sorted.slice(0, halfIndex);
  const newerReviews = sorted.slice(halfIndex);
  
  const olderAvg = olderReviews.reduce((sum, r) => sum + r.rating, 0) / olderReviews.length;
  const newerAvg = newerReviews.reduce((sum, r) => sum + r.rating, 0) / newerReviews.length;
  
  const diff = newerAvg - olderAvg;
  
  if (diff > 0.3) return 'improving';
  if (diff < -0.3) return 'declining';
  return 'stable';
}

// ─── GOOGLE MAPS SCRAPER ───────────────────────────

async function scrapeGoogleMaps(businessName: string, location: string, limit: number): Promise<PlatformResult | null> {
  const proxy = await getProxy('mobile');
  
  try {
    // Search for business
    const searchQuery = encodeURIComponent(`${businessName} ${location}`);
    const searchUrl = `https://www.google.com/maps/search/${searchQuery}`;
    
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Extract data from page
    const ratingMatch = html.match(/<span[^>]*>(\d+\.?\d*)<\/span>\s*stars?/i) ||
                        html.match(/aria-label="(\d+\.?\d*) stars?"/i);
    const reviewCountMatch = html.match(/([\d,]+)\s*(?:reviews?|отзыв)/i);
    
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : 0;
    
    // Extract individual reviews
    const reviews: Review[] = [];
    const reviewPattern = /<div[^>]*class="[^"]*review[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;
    let reviewId = 0;
    
    while ((match = reviewPattern.exec(html)) !== null && reviews.length < limit) {
      const reviewHtml = match[1];
      const authorMatch = reviewHtml.match(/aria-label="([^"]+)"/);
      const ratingMatch = reviewHtml.match(/(\d) star/i);
      const textMatch = reviewHtml.match(/<span[^>]*>([^<]{20,})<\/span>/);
      const dateMatch = reviewHtml.match(/(\d+ (?:day|week|month|year)s? ago|\w+ \d+, \d{4})/i);
      
      if (textMatch) {
        const text = textMatch[1].trim();
        const sentiment = analyzeSentiment(text);
        
        reviews.push({
          id: `google-${++reviewId}`,
          author: authorMatch?.[1] || 'Anonymous',
          rating: parseInt(ratingMatch?.[1] || '5'),
          date: dateMatch?.[1] || new Date().toISOString(),
          text: text,
          sentiment: sentiment,
          helpful: null,
          response: null,
        });
      }
    }
    
    // If no structured reviews found, try to extract from JSON
    if (reviews.length === 0) {
      const jsonMatch = html.match(/window\.APP_INITIALIZATION_STATE=\[\[\[([\s\S]*?)\]\]\]/);
      if (jsonMatch) {
        // Parse Google's nested array format
        try {
          const reviewsData = extractGoogleReviewsFromJson(jsonMatch[1], limit);
          reviews.push(...reviewsData);
        } catch (e) {
          console.error('Failed to parse Google reviews JSON');
        }
      }
    }
    
    return {
      platform: 'google',
      rating,
      reviewCount,
      url: searchUrl,
      reviews,
    };
    
  } catch (error) {
    console.error('Google Maps scrape error:', error);
    return null;
  }
}

function extractGoogleReviewsFromJson(jsonStr: string, limit: number): Review[] {
  const reviews: Review[] = [];
  // Simplified extraction - in production would parse Google's complex nested arrays
  return reviews;
}

// ─── YELP SCRAPER ──────────────────────────────────

async function scrapeYelp(businessName: string, location: string, limit: number): Promise<PlatformResult | null> {
  const proxy = await getProxy('mobile');
  
  try {
    const searchQuery = encodeURIComponent(`${businessName}`);
    const locationQuery = encodeURIComponent(location);
    const searchUrl = `https://www.yelp.com/search?find_desc=${searchQuery}&find_loc=${locationQuery}`;
    
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Find business URL from search results
    const bizUrlMatch = html.match(/href="(\/biz\/[^"?]+)/);
    if (!bizUrlMatch) {
      return null;
    }
    
    const bizUrl = `https://www.yelp.com${bizUrlMatch[1]}`;
    
    // Fetch business page
    const bizResponse = await proxyFetch(bizUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const bizHtml = await bizResponse.text();
    
    // Extract rating and review count
    const ratingMatch = bizHtml.match(/aria-label="(\d+\.?\d*) star rating"/i) ||
                        bizHtml.match(/"rating":\s*(\d+\.?\d*)/);
    const reviewCountMatch = bizHtml.match(/([\d,]+)\s*reviews?/i);
    
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : 0;
    
    // Extract reviews from JSON-LD or page content
    const reviews: Review[] = [];
    const jsonLdMatch = bizHtml.match(/<script type="application\/ld\+json">({[^<]+})<\/script>/g);
    
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const json = JSON.parse(match.replace(/<\/?script[^>]*>/g, ''));
          if (json['@type'] === 'LocalBusiness' && json.review) {
            for (const rev of json.review.slice(0, limit)) {
              const text = rev.reviewBody || rev.description || '';
              reviews.push({
                id: `yelp-${reviews.length + 1}`,
                author: rev.author?.name || 'Anonymous',
                rating: rev.reviewRating?.ratingValue || 5,
                date: rev.datePublished || new Date().toISOString(),
                text: text,
                sentiment: analyzeSentiment(text),
                helpful: null,
                response: null,
              });
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return {
      platform: 'yelp',
      rating,
      reviewCount,
      url: bizUrl,
      reviews,
    };
    
  } catch (error) {
    console.error('Yelp scrape error:', error);
    return null;
  }
}

// ─── TRUSTPILOT SCRAPER ────────────────────────────

async function scrapeTrustpilot(businessName: string, limit: number): Promise<PlatformResult | null> {
  const proxy = await getProxy('mobile');
  
  try {
    // Search Trustpilot
    const searchQuery = encodeURIComponent(businessName.toLowerCase().replace(/\s+/g, '-'));
    const searchUrl = `https://www.trustpilot.com/review/${searchQuery}`;
    
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Check if we hit search results instead of direct page
    if (html.includes('search-results')) {
      // Try search API
      const apiUrl = `https://www.trustpilot.com/api/find-company?query=${encodeURIComponent(businessName)}`;
      const apiResponse = await proxyFetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
          'Accept': 'application/json',
        },
      }, proxy);
      
      const apiData = await apiResponse.json();
      if (apiData.businesses?.[0]?.identifyingName) {
        const bizName = apiData.businesses[0].identifyingName;
        return scrapeTrustpilotDirect(`https://www.trustpilot.com/review/${bizName}`, limit, proxy);
      }
    }
    
    return scrapeTrustpilotDirect(searchUrl, limit, proxy);
    
  } catch (error) {
    console.error('Trustpilot scrape error:', error);
    return null;
  }
}

async function scrapeTrustpilotDirect(url: string, limit: number, proxy: any): Promise<PlatformResult | null> {
  try {
    const response = await proxyFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Extract rating
    const ratingMatch = html.match(/"ratingValue":\s*"?(\d+\.?\d*)"?/);
    const reviewCountMatch = html.match(/"reviewCount":\s*"?(\d+)"?/) ||
                             html.match(/([\d,]+)\s*reviews?/i);
    
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : 0;
    
    // Extract reviews from JSON-LD
    const reviews: Review[] = [];
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/g);
    
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const json = JSON.parse(match.replace(/<\/?script[^>]*>/g, ''));
          if (json['@type'] === 'Organization' && json.review) {
            for (const rev of json.review.slice(0, limit)) {
              const text = rev.reviewBody || '';
              reviews.push({
                id: `trustpilot-${reviews.length + 1}`,
                author: rev.author?.name || 'Anonymous',
                rating: rev.reviewRating?.ratingValue || 5,
                date: rev.datePublished || new Date().toISOString(),
                text: text,
                sentiment: analyzeSentiment(text),
                helpful: null,
                response: null,
              });
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return {
      platform: 'trustpilot',
      rating,
      reviewCount,
      url,
      reviews,
    };
    
  } catch (error) {
    console.error('Trustpilot direct scrape error:', error);
    return null;
  }
}

// ─── TRIPADVISOR SCRAPER ───────────────────────────

async function scrapeTripAdvisor(businessName: string, location: string, limit: number): Promise<PlatformResult | null> {
  const proxy = await getProxy('mobile');
  
  try {
    const searchQuery = encodeURIComponent(`${businessName} ${location}`);
    const searchUrl = `https://www.tripadvisor.com/Search?q=${searchQuery}`;
    
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const html = await response.text();
    
    // Find business link
    const bizUrlMatch = html.match(/href="(\/(?:Restaurant|Hotel|Attraction)_Review[^"]+)"/);
    if (!bizUrlMatch) {
      return null;
    }
    
    const bizUrl = `https://www.tripadvisor.com${bizUrlMatch[1]}`;
    
    // Fetch business page
    const bizResponse = await proxyFetch(bizUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const bizHtml = await bizResponse.text();
    
    // Extract data
    const ratingMatch = bizHtml.match(/class="[^"]*rating[^"]*"[^>]*>(\d+\.?\d*)/i) ||
                        bizHtml.match(/"ratingValue":\s*"?(\d+\.?\d*)"?/);
    const reviewCountMatch = bizHtml.match(/([\d,]+)\s*reviews?/i);
    
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, '')) : 0;
    
    // Extract reviews
    const reviews: Review[] = [];
    const reviewPattern = /<div[^>]*data-automation="reviewCard"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    
    let match;
    while ((match = reviewPattern.exec(bizHtml)) !== null && reviews.length < limit) {
      const reviewHtml = match[1];
      const authorMatch = reviewHtml.match(/class="[^"]*username[^"]*"[^>]*>([^<]+)/);
      const ratingMatch = reviewHtml.match(/bubble_(\d+)/);
      const textMatch = reviewHtml.match(/<q[^>]*>([^<]+)<\/q>/) ||
                        reviewHtml.match(/<span[^>]*class="[^"]*reviewText[^"]*"[^>]*>([^<]+)/);
      const dateMatch = reviewHtml.match(/(\w+ \d{4}|\d+ \w+ ago)/i);
      
      if (textMatch) {
        const text = textMatch[1].trim();
        reviews.push({
          id: `tripadvisor-${reviews.length + 1}`,
          author: authorMatch?.[1] || 'Anonymous',
          rating: ratingMatch ? parseInt(ratingMatch[1]) / 10 : 5,
          date: dateMatch?.[1] || new Date().toISOString(),
          text: text,
          sentiment: analyzeSentiment(text),
          helpful: null,
          response: null,
        });
      }
    }
    
    return {
      platform: 'tripadvisor',
      rating,
      reviewCount,
      url: bizUrl,
      reviews,
    };
    
  } catch (error) {
    console.error('TripAdvisor scrape error:', error);
    return null;
  }
}

// ─── MAIN ROUTE ────────────────────────────────────

reviewsRouter.post('/run', async (c) => {
  // Check for x402 payment
  const payment = extractPayment(c.req);
  
  if (!payment) {
    return c.json(build402Response(
      PRICE_USDC,
      SERVICE_NAME,
      DESCRIPTION,
      OUTPUT_SCHEMA
    ), 402);
  }
  
  // Verify payment
  const verified = await verifyPayment(payment, PRICE_USDC);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed', details: verified.error }, 402);
  }
  
  // Parse request
  const body = await c.req.json();
  const { business, location = '', platforms = ['google', 'yelp', 'trustpilot', 'tripadvisor'], limit = 20, since } = body;
  
  if (!business) {
    return c.json({ error: 'business name is required' }, 400);
  }
  
  const effectiveLimit = Math.min(limit, 100);
  const platformsQueried: string[] = [];
  const platformResults: PlatformResult[] = [];
  
  // Scrape each platform
  if (platforms.includes('google')) {
    platformsQueried.push('google');
    const result = await scrapeGoogleMaps(business, location, effectiveLimit);
    if (result) platformResults.push(result);
  }
  
  if (platforms.includes('yelp')) {
    platformsQueried.push('yelp');
    const result = await scrapeYelp(business, location, effectiveLimit);
    if (result) platformResults.push(result);
  }
  
  if (platforms.includes('trustpilot')) {
    platformsQueried.push('trustpilot');
    const result = await scrapeTrustpilot(business, effectiveLimit);
    if (result) platformResults.push(result);
  }
  
  if (platforms.includes('tripadvisor')) {
    platformsQueried.push('tripadvisor');
    const result = await scrapeTripAdvisor(business, location, effectiveLimit);
    if (result) platformResults.push(result);
  }
  
  // Filter by date if specified
  if (since) {
    const sinceDate = new Date(since);
    for (const platform of platformResults) {
      platform.reviews = platform.reviews.filter(r => {
        const reviewDate = new Date(r.date);
        return reviewDate >= sinceDate;
      });
    }
  }
  
  // Calculate aggregates
  const allReviews = platformResults.flatMap(p => p.reviews);
  const totalReviews = platformResults.reduce((sum, p) => sum + p.reviewCount, 0);
  
  // Weighted average rating
  let weightedSum = 0;
  let weightTotal = 0;
  for (const platform of platformResults) {
    if (platform.rating > 0) {
      weightedSum += platform.rating * platform.reviewCount;
      weightTotal += platform.reviewCount;
    }
  }
  const overallRating = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0;
  
  // Sentiment breakdown
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  for (const review of allReviews) {
    if (review.sentiment in sentimentCounts) {
      sentimentCounts[review.sentiment as keyof typeof sentimentCounts]++;
    }
  }
  const totalSentiment = allReviews.length || 1;
  const sentiment = {
    positive: Math.round((sentimentCounts.positive / totalSentiment) * 100),
    neutral: Math.round((sentimentCounts.neutral / totalSentiment) * 100),
    negative: Math.round((sentimentCounts.negative / totalSentiment) * 100),
  };
  
  // Extract keywords and trend
  const keywords = extractKeywords(allReviews);
  const ratingTrend = calculateTrend(allReviews);
  
  return c.json({
    business,
    overallRating,
    totalReviews,
    sentiment,
    ratingTrend,
    keywords,
    platforms: platformResults,
    metadata: {
      scrapedAt: new Date().toISOString(),
      platformsQueried,
    },
  });
});

// ─── SCHEMA ENDPOINT ────────────────────────────────

reviewsRouter.get('/schema', (c) => {
  return c.json({
    service: SERVICE_NAME,
    description: DESCRIPTION,
    price: `$${PRICE_USDC} USDC per review`,
    schema: OUTPUT_SCHEMA,
  });
});

export default reviewsRouter;
