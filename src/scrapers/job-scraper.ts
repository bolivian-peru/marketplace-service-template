/**
 * Job Market Intelligence Scraper
 * ──────────────────────────────
 * Extracts job listings from Indeed and LinkedIn.
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

export interface JobListing {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  date: string | null;
  link: string;
  platform: 'Indeed' | 'LinkedIn' | 'Glassdoor';
  description?: string;
  remote: boolean;
}

/**
 * Scrape Indeed for jobs
 */
export async function scrapeIndeed(query: string, location: string = 'Remote'): Promise<JobListing[]> {
  const searchTerm = encodeURIComponent(query);
  const searchLoc = encodeURIComponent(location);
  const url = `https://www.indeed.com/jobs?q=${searchTerm}&l=${searchLoc}`;

  console.log(`[JobScraper] Fetching Indeed: ${url}`);
  
  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  if (!response.ok) {
    throw new Error(`Indeed fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseIndeedHtml(html);
}

/**
 * Parse Indeed HTML results
 */
function parseIndeedHtml(html: string): JobListing[] {
  const listings: JobListing[] = [];
  
  // Strategy: Indeed job cards often have data-jk (job key)
  const jobCardPattern = /data-jk="([^"]+)"[\s\S]*?class="jobTitle[^>]*>([\s\S]*?)<\/h2>[\s\S]*?class="companyName[^>]*>([\s\S]*?)<\/span>[\s\S]*?class="companyLocation[^>]*>([\s\S]*?)<\/div>/g;
  
  let match;
  while ((match = jobCardPattern.exec(html)) !== null) {
    const jk = match[1];
    const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
    const company = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, '').trim());
    const location = decodeHtmlEntities(match[4].replace(/<[^>]+>/g, '').trim());
    
    listings.push({
      title,
      company,
      location,
      salary: null, // Need more specific regex for salary
      date: null,
      link: `https://www.indeed.com/viewjob?jk=${jk}`,
      platform: 'Indeed',
      remote: location.toLowerCase().includes('remote')
    });
  }
  
  return listings;
}

/**
 * Scrape LinkedIn (Public Search)
 */
export async function scrapeLinkedIn(query: string, location: string = 'United States'): Promise<JobListing[]> {
  const searchTerm = encodeURIComponent(query);
  const searchLoc = encodeURIComponent(location);
  const url = `https://www.linkedin.com/jobs/search?keywords=${searchTerm}&location=${searchLoc}`;

  console.log(`[JobScraper] Fetching LinkedIn: ${url}`);
  
  const response = await proxyFetch(url);

  if (!response.ok) {
    throw new Error(`LinkedIn fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseLinkedInHtml(html);
}

function parseLinkedInHtml(html: string): JobListing[] {
  const listings: JobListing[] = [];
  
  const cardPattern = /class="base-card[^>]*>[\s\S]*?class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>[\s\S]*?href="([^"]+)"/g;
  
  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const title = decodeHtmlEntities(match[1].trim());
    const company = decodeHtmlEntities(match[2].trim());
    const location = decodeHtmlEntities(match[3].trim());
    const link = match[4].split('?')[0];
    
    listings.push({
      title,
      company,
      location,
      salary: null,
      date: null,
      link,
      platform: 'LinkedIn',
      remote: location.toLowerCase().includes('remote')
    });
  }
  
  return listings;
}
