/**
 * Google SERP + AI Search Scraper
 * ──────────────────────────────
 * Logic for extracting search results and AI-generated overviews (SGE).
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

export interface SerpResult {
  rank: number;
  title: string;
  link: string;
  snippet: string;
  source?: string;
}

export interface AiOverview {
  text: string;
  links: { title: string; url: string }[];
}

export interface SerpData {
  results: SerpResult[];
  aiOverview?: AiOverview;
  relatedSearches: string[];
  peopleAlsoAsk: { question: string; answer?: string }[];
  totalResults?: string;
}

/**
 * Main scraping function for Google SERP
 */
export async function scrapeSerp(query: string, country: string = 'US'): Promise<SerpData> {
  // Mobile user agent is crucial for Google's latest layout
  // We add pws=0 (no personalization) and num=20 (more results)
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${country}&hl=en&pws=0&num=20`;

  console.log(`[SERP Scraper] Fetching: ${url}`);

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    }
  });

  if (!response.ok) {
    throw new Error(`Google Search returned status ${response.status}`);
  }

  const html = await response.text();

  const results: SerpResult[] = [];
  const seenLinks = new Set<string>();

  // 1. Extract Organic Results
  // Strategy: Multiple regex patterns for different layouts (Desktop, Mobile, Obfuscated)
  
  // Pattern A: Links with h3 titles (Standard Mobile/Desktop)
  // <a href="/url?q=..."><h3...>Title</h3></a> or <a href="..."><h3...>Title</h3></a>
  const patternA = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?(?:<div class="[^"]*(?:VwiC3b|MUwYf|yDqY9b|BNeawe)[^"]*">([\s\S]*?)<\/div>)?/gi;
  
  // Pattern B: Obfuscated mobile blocks
  // Look for result blocks and then extract inside
  const blockPattern = /<div class="[^"]*(?:xpd|v7W49e|tF2Cxc|g|yuRUbf)[^"]*">([\s\S]*?)<\/div>(?=<div class="[^"]*(?:xpd|v7W49e|tF2Cxc|g|yuRUbf)[^"]*">|$)/gi;

  let match;
  let rank = 1;

  // Try Pattern A first as it's the most reliable for structured data
  while ((match = patternA.exec(html)) !== null) {
    let link = match[1];
    const title = decodeHtmlEntities(match[2].replace(/<[^>]*>/g, '').trim());
    const snippet = match[3] ? decodeHtmlEntities(match[3].replace(/<[^>]*>/g, '').trim()) : '';

    if (link.startsWith('/url?q=')) {
      link = new URL(link, 'https://www.google.com').searchParams.get('q') || link;
    }

    if (!seenLinks.has(link) && !link.includes('google.com/search') && title.length > 0) {
      seenLinks.add(link);
      results.push({
        rank: rank++,
        title,
        link,
        snippet
      });
    }
  }

  // If no results from Pattern A, try block parsing
  if (results.length === 0) {
    console.log("[SERP Scraper] Pattern A failed, trying block-level parsing...");
    while ((match = blockPattern.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const linkMatch = block.match(/<a[^>]*href="([^"]+)"/i);
      
      if (titleMatch && linkMatch) {
        let link = linkMatch[1];
        const title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]*>/g, '').trim());
        
        if (link.startsWith('/url?q=')) {
          link = new URL(link, 'https://www.google.com').searchParams.get('q') || link;
        }

        if (!seenLinks.has(link) && !link.includes('google.com/search') && title.length > 0) {
          seenLinks.add(link);
          results.push({
            rank: rank++,
            title,
            link,
            snippet: '' // Snippet extraction from block is harder via regex
          });
        }
      }
    }
  }

  // 2. Extract AI Overview (SGE)
  let aiOverview: AiOverview | undefined;
  // SGE is often inside a script tag as JSON or in a specific data-attrid
  const aiPattern = /data-attrid="wa:\/description"[^>]*>([\s\S]*?)<\/div>/i;
  const aiMatch = html.match(aiPattern);
  if (aiMatch) {
    const text = decodeHtmlEntities(aiMatch[1].replace(/<[^>]*>/g, '').trim());
    if (text) {
      aiOverview = { text, links: [] };
      const linkPattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let lMatch;
      while ((lMatch = linkPattern.exec(aiMatch[1])) !== null) {
        aiOverview.links.push({
          url: lMatch[1],
          title: lMatch[2].replace(/<[^>]*>/g, '').trim()
        });
      }
    }
  }

  // 3. People Also Ask
  const paa: { question: string; answer?: string }[] = [];
  const paaPattern = /<div class="[^"]*(?:cb74p|kNoY6b)[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  while ((match = paaPattern.exec(html)) !== null) {
    const question = match[1].replace(/<[^>]*>/g, '').trim();
    if (question && question.length > 5) paa.push({ question });
  }

  // 4. Related Searches
  const related: string[] = [];
  const relatedPattern = /<div class="[^"]*(?:s75dhu|BNeawe)[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  while ((match = relatedPattern.exec(html)) !== null) {
    const term = match[1].replace(/<[^>]*>/g, '').trim();
    if (term && term.length > 2 && term.length < 100) related.push(term);
  }

  return {
    results,
    aiOverview,
    peopleAlsoAsk: paa,
    relatedSearches: related
  };
}
