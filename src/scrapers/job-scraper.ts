/**
 * Job Market Intelligence Scraper
 * ──────────────────────────────
 * Multi-platform job listing scraper (Indeed, LinkedIn)
 * Extracts: title, company, location, salary, posting date, skills, remote status, applicant count
 */

import { proxyFetch } from '../proxy';

export interface JobListing {
  title: string;
  company: string;
  location: string;
  salaryRange: string | null;
  postingDate: string | null;
  requiredSkills: string[];
  workType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  applicantCount: number | null;
  jobUrl: string;
  platform: 'indeed' | 'linkedin';
  description?: string;
}

export interface JobSearchParams {
  role: string;
  location: string;
  platforms?: ('indeed' | 'linkedin')[];
  limit?: number;
}

export interface JobSearchResult {
  jobs: JobListing[];
  totalFound: number;
  platforms: string[];
  searchQuery: string;
}

// ─── INDEED SCRAPER ─────────────────────────────────────

/**
 * Scrape jobs from Indeed
 */
export async function scrapeIndeed(role: string, location: string, limit: number = 20): Promise<JobListing[]> {
  const jobs: JobListing[] = [];
  
  try {
    const query = encodeURIComponent(role);
    const loc = encodeURIComponent(location);
    const url = `https://www.indeed.com/jobs?q=${query}&l=${loc}&limit=${limit}`;
    
    console.log(`[Indeed] Fetching: ${url}`);
    const response = await proxyFetch(url);
    const html = await response.text();
    
    // Extract job cards from Indeed's HTML structure
    // Indeed uses data-jk attributes for job IDs and structured class names
    const jobCardRegex = /<div[^>]*class="[^"]*job_seen_beacon[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const matches = html.matchAll(jobCardRegex);
    
    for (const match of matches) {
      const cardHtml = match[1];
      
      try {
        const job = parseIndeedJobCard(cardHtml);
        if (job) {
          jobs.push(job);
          if (jobs.length >= limit) break;
        }
      } catch (err) {
        console.error('[Indeed] Failed to parse job card:', err);
      }
    }
    
    console.log(`[Indeed] Extracted ${jobs.length} jobs`);
    
  } catch (error) {
    console.error('[Indeed] Scraping error:', error);
  }
  
  return jobs;
}

function parseIndeedJobCard(html: string): JobListing | null {
  try {
    // Extract title
    const titleMatch = html.match(/<h2[^>]*class="[^"]*jobTitle[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
    const titleText = titleMatch ? stripHtml(titleMatch[1]) : null;
    
    // Extract company
    const companyMatch = html.match(/data-company-name="([^"]+)"/i) || 
                         html.match(/<span[^>]*class="[^"]*companyName[^"]*"[^>]*>([^<]+)<\/span>/i);
    const company = companyMatch ? companyMatch[1].trim() : 'Unknown Company';
    
    // Extract location
    const locationMatch = html.match(/data-rc-loc="([^"]+)"/i) ||
                          html.match(/<div[^>]*class="[^"]*companyLocation[^"]*"[^>]*>([^<]+)<\/div>/i);
    const location = locationMatch ? locationMatch[1].trim() : 'Unknown Location';
    
    // Extract salary
    const salaryMatch = html.match(/<div[^>]*class="[^"]*salary-snippet[^"]*"[^>]*>([^<]+)<\/div>/i) ||
                        html.match(/\$[\d,]+(?:\.\d{2})?(?:\s*-\s*\$[\d,]+(?:\.\d{2})?)?(?:\s*(?:per|\/)\s*(?:hour|year|month))?/i);
    const salaryRange = salaryMatch ? salaryMatch[1].trim() : null;
    
    // Extract job URL/ID
    const jobIdMatch = html.match(/data-jk="([^"]+)"/i);
    const jobId = jobIdMatch ? jobIdMatch[1] : null;
    const jobUrl = jobId ? `https://www.indeed.com/viewjob?jk=${jobId}` : '';
    
    // Extract posting date
    const dateMatch = html.match(/<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                      html.match(/Posted\s+(\d+\s+(?:day|hour|week)s?\s+ago)/i);
    const postingDate = dateMatch ? dateMatch[1].trim() : null;
    
    // Detect remote/hybrid/onsite
    let workType: JobListing['workType'] = 'unknown';
    const fullText = html.toLowerCase();
    if (fullText.includes('remote') || fullText.includes('work from home')) {
      workType = 'remote';
    } else if (fullText.includes('hybrid')) {
      workType = 'hybrid';
    } else if (fullText.includes('on-site') || fullText.includes('onsite') || fullText.includes('in-office')) {
      workType = 'onsite';
    }
    
    if (!titleText || !jobUrl) return null;
    
    return {
      title: titleText,
      company,
      location,
      salaryRange,
      postingDate,
      requiredSkills: [], // Would need full job page for skills
      workType,
      applicantCount: null, // Indeed doesn't show applicant count publicly
      jobUrl,
      platform: 'indeed',
    };
    
  } catch (err) {
    console.error('[Indeed] Parse error:', err);
    return null;
  }
}

// ─── LINKEDIN SCRAPER ─────────────────────────────────────

/**
 * Scrape jobs from LinkedIn
 */
export async function scrapeLinkedIn(role: string, location: string, limit: number = 20): Promise<JobListing[]> {
  const jobs: JobListing[] = [];
  
  try {
    // LinkedIn public job search URL
    const keywords = encodeURIComponent(role);
    const loc = encodeURIComponent(location);
    const url = `https://www.linkedin.com/jobs/search?keywords=${keywords}&location=${loc}&position=1&pageNum=0`;
    
    console.log(`[LinkedIn] Fetching: ${url}`);
    const response = await proxyFetch(url, { 
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      }
    });
    const html = await response.text();
    
    // LinkedIn's job cards have specific class structures
    const jobCardRegex = /<li[^>]*class="[^"]*base-card[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    const matches = html.matchAll(jobCardRegex);
    
    for (const match of matches) {
      const cardHtml = match[1];
      
      try {
        const job = parseLinkedInJobCard(cardHtml);
        if (job) {
          jobs.push(job);
          if (jobs.length >= limit) break;
        }
      } catch (err) {
        console.error('[LinkedIn] Failed to parse job card:', err);
      }
    }
    
    console.log(`[LinkedIn] Extracted ${jobs.length} jobs`);
    
  } catch (error) {
    console.error('[LinkedIn] Scraping error:', error);
  }
  
  return jobs;
}

function parseLinkedInJobCard(html: string): JobListing | null {
  try {
    // Extract title
    const titleMatch = html.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([^<]+)<\/h3>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // Extract company
    const companyMatch = html.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([^<]+)<\/h4>/i) ||
                         html.match(/<a[^>]*class="[^"]*hidden-nested-link[^"]*"[^>]*>([^<]+)<\/a>/i);
    const company = companyMatch ? companyMatch[1].trim() : 'Unknown Company';
    
    // Extract location
    const locationMatch = html.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([^<]+)<\/span>/i);
    const location = locationMatch ? locationMatch[1].trim() : 'Unknown Location';
    
    // Extract job URL
    const urlMatch = html.match(/href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+)"/i);
    const jobUrl = urlMatch ? urlMatch[1] : '';
    
    // Extract posting date
    const dateMatch = html.match(/<time[^>]*datetime="([^"]+)"/i) ||
                      html.match(/(\d+\s+(?:day|hour|week)s?\s+ago)/i);
    const postingDate = dateMatch ? dateMatch[1].trim() : null;
    
    // LinkedIn shows applicant count
    const applicantMatch = html.match(/(\d+)\s+applicants?/i);
    const applicantCount = applicantMatch ? parseInt(applicantMatch[1]) : null;
    
    // Detect work type
    let workType: JobListing['workType'] = 'unknown';
    const fullText = html.toLowerCase();
    if (fullText.includes('remote') || fullText.includes('work from home')) {
      workType = 'remote';
    } else if (fullText.includes('hybrid')) {
      workType = 'hybrid';
    } else if (fullText.includes('on-site') || fullText.includes('onsite')) {
      workType = 'onsite';
    }
    
    if (!title || !jobUrl) return null;
    
    return {
      title,
      company,
      location,
      salaryRange: null, // LinkedIn often doesn't show salary in listings
      postingDate,
      requiredSkills: [],
      workType,
      applicantCount,
      jobUrl,
      platform: 'linkedin',
    };
    
  } catch (err) {
    console.error('[LinkedIn] Parse error:', err);
    return null;
  }
}

// ─── MAIN SEARCH FUNCTION ─────────────────────────────────

/**
 * Search jobs across multiple platforms
 */
export async function searchJobs(params: JobSearchParams): Promise<JobSearchResult> {
  const {
    role,
    location,
    platforms = ['indeed', 'linkedin'],
    limit = 20
  } = params;
  
  const allJobs: JobListing[] = [];
  const usedPlatforms: string[] = [];
  const jobsPerPlatform = Math.ceil(limit / platforms.length);
  
  // Scrape from each requested platform
  const scrapePromises = platforms.map(async (platform) => {
    try {
      let jobs: JobListing[] = [];
      
      switch (platform) {
        case 'indeed':
          jobs = await scrapeIndeed(role, location, jobsPerPlatform);
          break;
        case 'linkedin':
          jobs = await scrapeLinkedIn(role, location, jobsPerPlatform);
          break;
        default:
          console.warn(`[Job Scraper] Platform "${platform}" not yet implemented`);
      }
      
      if (jobs.length > 0) {
        usedPlatforms.push(platform);
        return jobs;
      }
      
      return [];
    } catch (error) {
      console.error(`[Job Scraper] Error scraping ${platform}:`, error);
      return [];
    }
  });
  
  const results = await Promise.all(scrapePromises);
  
  // Flatten and limit results
  for (const platformJobs of results) {
    allJobs.push(...platformJobs);
  }
  
  // Sort by posting date (newest first) if available
  allJobs.sort((a, b) => {
    if (!a.postingDate || !b.postingDate) return 0;
    // Simple heuristic: "1 day ago" < "2 days ago"
    const aMatch = a.postingDate.match(/(\d+)/);
    const bMatch = b.postingDate.match(/(\d+)/);
    if (aMatch && bMatch) {
      return parseInt(aMatch[1]) - parseInt(bMatch[1]);
    }
    return 0;
  });
  
  return {
    jobs: allJobs.slice(0, limit),
    totalFound: allJobs.length,
    platforms: usedPlatforms,
    searchQuery: `${role} in ${location}`,
  };
}

// ─── HELPER FUNCTIONS ─────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
