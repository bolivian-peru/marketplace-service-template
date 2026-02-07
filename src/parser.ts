/**
 * Google SERP Parser
 * ───────────────────
 * Extracts structured data from Google search results page
 */

import { Page } from 'playwright';

export interface OrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  siteLinks?: string[];
}

export interface AdResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  description: string;
}

export interface AIOverview {
  text: string;
  sources: { title: string; url: string }[];
}

export interface FeaturedSnippet {
  text: string;
  source: string;
  sourceUrl: string;
}

export interface SerpResults {
  query: string;
  country: string;
  timestamp: string;
  results: {
    organic: OrganicResult[];
    ads: AdResult[];
    aiOverview: AIOverview | null;
    featuredSnippet: FeaturedSnippet | null;
    peopleAlsoAsk: string[];
    relatedSearches: string[];
    knowledgePanel: { title: string; description: string } | null;
  };
  metadata: {
    totalResults: string;
    searchTime: string;
    scrapedAt: string;
    proxyCountry: string;
  };
}

/**
 * Parse Google SERP page and extract all components
 */
export async function parseGoogleSerp(page: Page, query: string, country: string): Promise<SerpResults> {
  const results: SerpResults = {
    query,
    country,
    timestamp: new Date().toISOString(),
    results: {
      organic: [],
      ads: [],
      aiOverview: null,
      featuredSnippet: null,
      peopleAlsoAsk: [],
      relatedSearches: [],
      knowledgePanel: null,
    },
    metadata: {
      totalResults: '',
      searchTime: '',
      scrapedAt: new Date().toISOString(),
      proxyCountry: country,
    },
  };

  // Wait for results to load
  await page.waitForSelector('body', { timeout: 10000 });
  await page.waitForTimeout(2000); // Wait for dynamic content

  // Extract AI Overview (SGE - Search Generative Experience)
  results.results.aiOverview = await extractAIOverview(page);

  // Extract Featured Snippet
  results.results.featuredSnippet = await extractFeaturedSnippet(page);

  // Extract Organic Results
  results.results.organic = await extractOrganicResults(page);

  // Extract Ads
  results.results.ads = await extractAds(page);

  // Extract People Also Ask
  results.results.peopleAlsoAsk = await extractPeopleAlsoAsk(page);

  // Extract Related Searches
  results.results.relatedSearches = await extractRelatedSearches(page);

  // Extract Knowledge Panel
  results.results.knowledgePanel = await extractKnowledgePanel(page);

  // Extract metadata
  results.metadata = await extractMetadata(page, country);

  return results;
}

async function extractAIOverview(page: Page): Promise<AIOverview | null> {
  try {
    // AI Overview appears in various containers
    const aiSelectors = [
      '[data-attrid="SGEOverview"]',
      '.M8OgIe', // AI Overview container
      '[data-sgeh]', // SGE element
      '.wDYxhc[data-md]', // Featured AI content
      '.xpdopen .hgKElc', // Expandable AI content
    ];

    for (const selector of aiSelectors) {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        if (text && text.length > 50) {
          // Extract sources from AI Overview
          const sources: { title: string; url: string }[] = [];
          const sourceElements = await page.$$(`${selector} a[href^="http"]`);
          for (const src of sourceElements.slice(0, 5)) {
            const href = await src.getAttribute('href');
            const title = await src.textContent();
            if (href && title) {
              sources.push({ title: title.trim(), url: href });
            }
          }
          return { text: text.trim().substring(0, 2000), sources };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function extractFeaturedSnippet(page: Page): Promise<FeaturedSnippet | null> {
  try {
    const snippetSelectors = [
      '.xpdopen .hgKElc',
      '.ifM9O .LGOjhe',
      '[data-attrid="wa:/description"] span',
      '.IZ6rdc',
    ];

    for (const selector of snippetSelectors) {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        if (text && text.length > 30) {
          // Try to find source
          const sourceLink = await page.$('.xpdopen a[data-ved], .ifM9O a[href^="http"]');
          let source = '';
          let sourceUrl = '';
          if (sourceLink) {
            source = (await sourceLink.textContent()) || '';
            sourceUrl = (await sourceLink.getAttribute('href')) || '';
          }
          return {
            text: text.trim(),
            source: source.trim(),
            sourceUrl,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function extractOrganicResults(page: Page): Promise<OrganicResult[]> {
  const organic: OrganicResult[] = [];
  
  try {
    // Main organic result selectors
    const resultElements = await page.$$('div.g:not(.ULSxyf), div[data-hveid]:not([data-hveid=""]) .tF2Cxc');
    
    let position = 1;
    for (const element of resultElements) {
      try {
        const titleEl = await element.$('h3');
        const linkEl = await element.$('a[href^="http"]');
        const snippetEl = await element.$('.VwiC3b, .lEBKkf, [data-sncf]');
        
        if (titleEl && linkEl) {
          const title = await titleEl.textContent();
          const url = await linkEl.getAttribute('href');
          const snippet = snippetEl ? await snippetEl.textContent() : '';
          
          if (title && url && !url.includes('google.com/search')) {
            organic.push({
              position: position++,
              title: title.trim(),
              url,
              snippet: (snippet || '').trim(),
            });
          }
        }
      } catch {
        continue;
      }
      
      if (organic.length >= 10) break;
    }
    
    // Fallback: try alternative selector
    if (organic.length === 0) {
      const altResults = await page.$$('[data-sokoban-container] a[href^="http"]');
      for (const link of altResults) {
        try {
          const url = await link.getAttribute('href');
          const title = await link.textContent();
          if (url && title && !url.includes('google.com')) {
            organic.push({
              position: organic.length + 1,
              title: title.trim(),
              url,
              snippet: '',
            });
          }
        } catch {
          continue;
        }
        if (organic.length >= 10) break;
      }
    }
  } catch {
    // Ignore extraction errors
  }
  
  return organic;
}

async function extractAds(page: Page): Promise<AdResult[]> {
  const ads: AdResult[] = [];
  
  try {
    const adElements = await page.$$('[data-text-ad], .uEierd, .commercial-unit-mobile-top');
    
    let position = 1;
    for (const element of adElements) {
      try {
        const titleEl = await element.$('.CCgQ5, [role="heading"]');
        const linkEl = await element.$('a[data-rw]');
        const descEl = await element.$('.MUxGbd, .yDYNvb');
        const displayUrlEl = await element.$('.x2VHCd, .Zu0yb');
        
        if (titleEl && linkEl) {
          const title = await titleEl.textContent();
          const url = await linkEl.getAttribute('href');
          const description = descEl ? await descEl.textContent() : '';
          const displayUrl = displayUrlEl ? await displayUrlEl.textContent() : '';
          
          if (title && url) {
            ads.push({
              position: position++,
              title: title.trim(),
              url,
              displayUrl: (displayUrl || '').trim(),
              description: (description || '').trim(),
            });
          }
        }
      } catch {
        continue;
      }
      
      if (ads.length >= 5) break;
    }
  } catch {
    // Ignore extraction errors
  }
  
  return ads;
}

async function extractPeopleAlsoAsk(page: Page): Promise<string[]> {
  const questions: string[] = [];
  
  try {
    const paaElements = await page.$$('[data-q], .related-question-pair [role="button"], div.wQiwMc');
    
    for (const element of paaElements) {
      const text = await element.textContent();
      if (text && text.length > 10 && text.length < 200) {
        questions.push(text.trim());
      }
      if (questions.length >= 8) break;
    }
  } catch {
    // Ignore extraction errors
  }
  
  return questions;
}

async function extractRelatedSearches(page: Page): Promise<string[]> {
  const related: string[] = [];
  
  try {
    const relatedElements = await page.$$('.k8XOCe, .s75CSd, .EIaa9b');
    
    for (const element of relatedElements) {
      const text = await element.textContent();
      if (text && text.length > 2 && text.length < 100) {
        related.push(text.trim());
      }
      if (related.length >= 8) break;
    }
  } catch {
    // Ignore extraction errors
  }
  
  return related;
}

async function extractKnowledgePanel(page: Page): Promise<{ title: string; description: string } | null> {
  try {
    const kpTitle = await page.$('.kno-ecr-pt, .qrShPb');
    const kpDesc = await page.$('.kno-rdesc span, .IZ6rdc');
    
    if (kpTitle) {
      const title = await kpTitle.textContent();
      const description = kpDesc ? await kpDesc.textContent() : '';
      
      if (title) {
        return {
          title: title.trim(),
          description: (description || '').trim(),
        };
      }
    }
  } catch {
    // Ignore extraction errors
  }
  
  return null;
}

async function extractMetadata(page: Page, country: string): Promise<SerpResults['metadata']> {
  let totalResults = '';
  let searchTime = '';
  
  try {
    const statsEl = await page.$('#result-stats');
    if (statsEl) {
      const statsText = await statsEl.textContent();
      if (statsText) {
        // Parse "About 1,234,567 results (0.45 seconds)"
        const match = statsText.match(/About ([\d,]+) results \(([\d.]+) seconds\)/);
        if (match) {
          totalResults = match[1];
          searchTime = match[2] + 's';
        }
      }
    }
  } catch {
    // Ignore metadata extraction errors
  }
  
  return {
    totalResults,
    searchTime,
    scrapedAt: new Date().toISOString(),
    proxyCountry: country,
  };
}
