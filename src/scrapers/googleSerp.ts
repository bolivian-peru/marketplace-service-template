import * as cheerio from 'cheerio';

export interface SerpResult {
  title: string;
  link: string;
  snippet: string;
}

export async function searchGoogle(query: string, num: number = 10): Promise<SerpResult[]> {
  try {
    // Using DuckDuckGo HTML endpoint as a free, API-key-less fallback for SERP data
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch search results: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: SerpResult[] = [];

    $('.result').each((_, element) => {
      const titleEl = $(element).find('.result__a');
      const snippetEl = $(element).find('.result__snippet');

      if (titleEl.length && snippetEl.length) {
        results.push({
          title: titleEl.text().trim(),
          link: titleEl.attr('href') || '',
          snippet: snippetEl.text().trim()
        });
      }
    });

    return results.slice(0, num);
  } catch (error) {
    console.error("SERP Scraper Error:", error);
    return [];
  }
}
