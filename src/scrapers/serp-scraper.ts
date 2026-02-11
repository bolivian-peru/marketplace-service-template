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
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${country}&hl=en&pws=0`;
  
  console.log(`[SERP Scraper] Fetching: ${url}`);
  
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    }
  });

  if (!response.ok) {
    throw new Error(`Google Search returned status ${response.status}`);
  }

  const html = await response.text();
  
  // Debug: Save HTML for inspection if needed
  // await Bun.write('debug_serp.html', html);

  const results: SerpResult[] = [];
  const seenLinks = new Set<string>();

  // 1. Extract Organic Results (Strategy: Regex for speed and reliability in raw HTML)
  // Pattern for result blocks: <div class="g"> or <div class="tF2Cxc"> or mobile variant
  // In mobile, it often looks like <div class="xpd"> or <div class="v7W49e">
  const mobileBlockPattern = /<div class="[^"]*(?:xpd|v7W49e|tF2Cxc)[^"]*">([\s\S]*?)<\/div>(?=<div class="[^"]*(?:xpd|v7W49e|tF2Cxc)[^"]*">|$)/g;
  let match;
  let rank = 1;

  while ((match = mobileBlockPattern.exec(html)) !== null) {
    const block = match[1];
    
    // Extract Title & Link
    const titleLinkPattern = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i;
    const tlMatch = block.match(titleLinkPattern);
    
    if (tlMatch) {
      let link = tlMatch[1];
      const title = decodeHtmlEntities(tlMatch[2].replace(/<[^>]*>/g, '').trim());
      
      // Handle Google redirect links
      if (link.startsWith('/url?q=')) {
        link = new URL(link, 'https://www.google.com').searchParams.get('q') || link;
      }

      if (!seenLinks.has(link) && !link.includes('google.com/search')) {
        seenLinks.add(link);
        
        // Extract Snippet
        const snippetPattern = /<div class="[^"]*(?:VwiC3b|MUwYf|yDqY9b)[^"]*">([\s\S]*?)<\/div>/i;
        const sMatch = block.match(snippetPattern);
        const snippet = sMatch ? decodeHtmlEntities(sMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

        results.push({
          rank: rank++,
          title,
          link,
          snippet
        });
      }
    }
  }

  // 2. Extract AI Overview (SGE)
  // This is tricky in raw HTML as it's often in a script tag or highly obfuscated
  let aiOverview: AiOverview | undefined;
  
  // Strategy: Look for specific data-attrid or classes associated with SGE
  const aiPattern = /data-attrid="wa:\/description"[^>]*>([\s\S]*?)<\/div>/i;
  const aiMatch = html.match(aiPattern);
  if (aiMatch) {
    const text = decodeHtmlEntities(aiMatch[1].replace(/<[^>]*>/g, '').trim());
    if (text) {
      aiOverview = { text, links: [] };
      // Attempt to extract source links from the AI overview
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
  const paaPattern = /<div class="[^"]*cb74p[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  while ((match = paaPattern.exec(html)) !== null) {
    const question = match[1].replace(/<[^>]*>/g, '').trim();
    if (question) paa.push({ question });
  }

  // 4. Related Searches
  const related: string[] = [];
  const relatedPattern = /<div class="[^"]*s75dhu[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  while ((match = relatedPattern.exec(html)) !== null) {
    const term = match[1].replace(/<[^>]*>/g, '').trim();
    if (term && term.length > 2) related.push(term);
  }

  return {
    results,
    aiOverview,
    peopleAlsoAsk: paa,
    relatedSearches: related
  };
}
