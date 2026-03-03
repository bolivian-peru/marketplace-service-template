import { proxyFetch } from '../proxy';

export interface GoogleSearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  source?: string;
}

export interface GoogleSerpData {
  query: string;
  results: GoogleSearchResult[];
  ai_overview?: string;
  related_questions?: string[];
  total_results?: string;
  search_time?: number;
}

/**
 * Scrapes Google Search results and AI Overviews via mobile proxy.
 * Mimics mobile browser behavior to trigger AI Overviews (SGE).
 */
export async function scrapeGoogleSerp(query: string, country: string = 'US', language: string = 'en'): Promise<GoogleSerpData> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${country}&hl=${language}&num=20`;
  
  const response = await proxyFetch(url, {
    maxRetries: 3,
    timeoutMs: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error('Google rate limit hit (429)');
    throw new Error(`Google SERP fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  return parseGoogleSerp(html, query);
}

function parseGoogleSerp(html: string, query: string): GoogleSerpData {
  const results: GoogleSearchResult[] = [];
  
  // Extract AI Overview (SGE) - Looking for experimental AI response blocks
  // Note: These selectors change often; using regex for resilience
  let ai_overview: string | undefined;
  const aiMatch = html.match(/class="[^"]*AI-Overview[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || 
                  html.match(/data-attrid="wa:[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (aiMatch) {
    ai_overview = cleanHtml(aiMatch[1]);
  }

  // Extract organic results
  // Google mobile typically uses <div> with specific classes for results
  const resultBlocks = html.split('class="v7W49e"').slice(1); // Common mobile result container
  if (resultBlocks.length === 0) {
    // Fallback split
    const fallbackBlocks = html.split('<div class="MjjYud">').slice(1);
    processBlocks(fallbackBlocks, results);
  } else {
    processBlocks(resultBlocks, results);
  }

  // Related questions (People Also Ask)
  const related_questions: string[] = [];
  const paaMatch = html.matchAll(/class="[^"]*related-question-pair[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
  for (const match of paaMatch) {
    const question = cleanHtml(match[1]);
    if (question && !related_questions.includes(question)) {
      related_questions.push(question);
    }
  }

  return {
    query,
    results: results.slice(0, 20),
    ai_overview,
    related_questions: related_questions.length > 0 ? related_questions : undefined
  };
}

function processBlocks(blocks: string[], results: GoogleSearchResult[]) {
  blocks.forEach((block, index) => {
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const urlMatch = block.match(/href="([^"]+)"/i);
    const snippetMatch = block.match(/class="[^"]*(?:VwiC3b|y6V9u)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    if (titleMatch && urlMatch) {
      results.push({
        title: cleanHtml(titleMatch[1]),
        url: urlMatch[1].startsWith('/') ? `https://google.com${urlMatch[1]}` : urlMatch[1],
        snippet: snippetMatch ? cleanHtml(snippetMatch[1]) : '',
        position: results.length + 1
      });
    }
  });
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
