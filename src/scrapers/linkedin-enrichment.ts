import { proxyFetch, getProxy } from '../proxy';

// LinkedIn Person Profile Interface
export interface LinkedInPerson {
  name: string;
  headline: string;
  location: string;
  current_company?: {
    name: string;
    title: string;
    started?: string;
  };
  previous_companies?: Array<{
    name: string;
    title: string;
    period: string;
  }>;
  education?: Array<{
    school: string;
    degree?: string;
  }>;
  skills?: string[];
  connections?: string;
  profile_url: string;
  meta?: {
    proxy?: {
      ip?: string;
      country?: string;
      carrier?: string;
    };
  };
}

// LinkedIn Company Profile Interface
export interface LinkedInCompany {
  name: string;
  description?: string;
  industry?: string;
  headquarters?: string;
  employee_count?: string;
  website?: string;
  specialties?: string[];
  job_openings?: number;
  company_url: string;
  meta?: {
    proxy?: {
      ip?: string;
      country?: string;
      carrier?: string;
    };
  };
}

// Search result interface
export interface LinkedInSearchResult {
  name: string;
  headline: string;
  location?: string;
  profile_url: string;
}

// Extract username from LinkedIn URL
function extractUsername(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
  return match ? match[1] : null;
}

// Extract company name from LinkedIn URL
function extractCompanyName(url: string): string | null {
  const match = url.match(/linkedin\.com\/company\/([^\/\?]+)/);
  return match ? match[1] : null;
}

// Fetch LinkedIn public profile
export async function fetchLinkedInPerson(url: string): Promise<LinkedInPerson | null> {
  const username = extractUsername(url);
  if (!username) {
    throw new Error('Invalid LinkedIn profile URL');
  }

  try {
    const publicUrl = `https://www.linkedin.com/in/${username}`;
    
    const response = await proxyFetch(publicUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const html = await response.text();
    return parseLinkedInPerson(html, url);
  } catch (error: any) {
    console.error('Error fetching LinkedIn profile:', error.message);
    return null;
  }
}

// Parse LinkedIn person profile from HTML
function parseLinkedInPerson(html: string, profileUrl: string): LinkedInPerson | null {
  try {
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
    let jsonLd: any = {};
    
    if (jsonLdMatch) {
      try {
        jsonLd = JSON.parse(jsonLdMatch[1].replace(/&quot;/g, '"'));
      } catch (e) {
        // Continue with HTML parsing
      }
    }

    const name = jsonLd.name || 
                 html.match(/<title>([^<]+)\.?\s*[-|]\s*LinkedIn<\/title>/)?.[1]?.trim() ||
                 html.match(/"name":"([^"]+)"/)?.[1] ||
                 'Unknown';

    const headline = jsonLd.description || 
                     html.match(/"headline":"([^"]+)"/)?.[1] ||
                     html.match(/<meta name="description" content="([^"]+)"/)?.[1]?.split('.')[0] ||
                     '';

    const location = jsonLd.address?.addressLocality || 
                     html.match(/"addressLocality":"([^"]+)"/)?.[1] ||
                     '';

    const currentMatch = headline.match(/at\s+(.+)$/i);
    const current_company = currentMatch ? {
      name: currentMatch[1].trim(),
      title: headline.split(' at ')[0].trim(),
    } : undefined;

    const skills: string[] = [];
    if (jsonLd.knowsAbout && Array.isArray(jsonLd.knowsAbout)) {
      skills.push(...jsonLd.knowsAbout.slice(0, 10));
    }

    const connections = html.match(/(\d+)\+?\s*connections?/i)?.[1] ||
                       html.match(/"connectionCount":(\d+)/)?.[1] ||
                       '500+';

    return {
      name: name.replace(/\s+/g, ' ').trim(),
      headline: headline.trim(),
      location: location.trim(),
      current_company,
      skills: skills.length > 0 ? skills : undefined,
      connections,
      profile_url: profileUrl,
    };
  } catch (error: any) {
    console.error('Error parsing profile:', error.message);
    return null;
  }
}

// Fetch LinkedIn company profile
export async function fetchLinkedInCompany(url: string): Promise<LinkedInCompany | null> {
  const companyName = extractCompanyName(url);
  if (!companyName) {
    throw new Error('Invalid LinkedIn company URL');
  }

  try {
    const publicUrl = `https://www.linkedin.com/company/${companyName}`;
    
    const response = await proxyFetch(publicUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch company: ${response.status}`);
    }

    const html = await response.text();
    return parseLinkedInCompany(html, url);
  } catch (error: any) {
    console.error('Error fetching LinkedIn company:', error.message);
    return null;
  }
}

// Parse LinkedIn company from HTML
function parseLinkedInCompany(html: string, companyUrl: string): LinkedInCompany | null {
  try {
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
    let jsonLd: any = {};
    
    if (jsonLdMatch) {
      try {
        jsonLd = JSON.parse(jsonLdMatch[1].replace(/&quot;/g, '"'));
      } catch (e) {
        // Continue
      }
    }

    const name = jsonLd.name ||
                 html.match(/<title>([^<]+)\.?\s*[-|]\s*LinkedIn<\/title>/)?.[1]?.trim() ||
                 'Unknown Company';

    const description = jsonLd.description ||
                        html.match(/<meta name="description" content="([^"]+)"/)?.[1] ||
                        '';

    const industry = jsonLd.industry ||
                     html.match(/"industry":"([^"]+)"/)?.[1] ||
                     '';

    const headquarters = jsonLd.address?.addressLocality ||
                         html.match(/"addressLocality":"([^"]+)"/)?.[1] ||
                         '';

    const employee_count = html.match(/([\d,]+)\s*employees?/i)?.[1] ||
                           html.match(/"employeeCount":"([^"]+)"/)?.[1] ||
                           '';

    return {
      name: name.replace(/\s+/g, ' ').trim(),
      description: description.slice(0, 500),
      industry,
      headquarters,
      employee_count,
      company_url: companyUrl,
    };
  } catch (error: any) {
    console.error('Error parsing company:', error.message);
    return null;
  }
}

// Search LinkedIn people using Google
export async function searchLinkedInPeople(
  title: string,
  location?: string,
  industry?: string,
  limit: number = 10
): Promise<LinkedInSearchResult[]> {
  try {
    let query = `site:linkedin.com/in "${title}"`;
    if (location) query += ` "${location}"`;
    if (industry) query += ` "${industry}"`;
    
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit * 2}`;
    
    const response = await proxyFetch(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const html = await response.text();
    return parseSearchResults(html, limit);
  } catch (error: any) {
    console.error('Error searching LinkedIn:', error.message);
    return [];
  }
}

// Parse Google search results for LinkedIn profiles
function parseSearchResults(html: string, limit: number): LinkedInSearchResult[] {
  const results: LinkedInSearchResult[] = [];
  
  try {
    const linkRegex = /<a[^\u003e]*href="https:\/\/[^"]*linkedin\.com\/in\/([^"\/]+)[^"]*"[^\u003e]*>/gi;
    const titleRegex = /<h3[^\u003e]*>(.*?)\s*-\s*(.*?)\s*<\/h3>/gi;
    
    const links: string[] = [];
    let match;
    
    while ((match = linkRegex.exec(html)) !== null && links.length < limit * 2) {
      links.push(match[1]);
    }
    
    const titles: string[] = [];
    while ((match = titleRegex.exec(html)) !== null && titles.length < limit * 2) {
      titles.push(match[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    }
    
    for (let i = 0; i < Math.min(links.length, titles.length, limit); i++) {
      const titleParts = titles[i].split(' - ');
      results.push({
        name: titleParts[0] || links[i],
        headline: titleParts[1] || '',
        location: '',
        profile_url: `https://linkedin.com/in/${links[i]}`,
      });
    }
  } catch (error) {
    console.error('Error parsing search results:', error);
  }
  
  return results;
}

// Search employees of a company
export async function searchCompanyEmployees(
  companyId: string,
  titleFilter?: string,
  limit: number = 10
): Promise<LinkedInSearchResult[]> {
  try {
    let query = `site:linkedin.com/in "${companyId}"`;
    if (titleFilter) query += ` "${titleFilter}"`;
    
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit * 2}`;
    
    const response = await proxyFetch(searchUrl, {
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    if (!response.ok) {
      throw new Error(`Employee search failed: ${response.status}`);
    }

    const html = await response.text();
    return parseSearchResults(html, limit);
  } catch (error: any) {
    console.error('Error searching employees:', error.message);
    return [];
  }
}

// Export aliases for service.ts compatibility
export async function scrapeLinkedInPerson(username: string): Promise<LinkedInPerson | null> {
  const url = `https://linkedin.com/in/${username}`;
  return fetchLinkedInPerson(url);
}

export async function scrapeLinkedInCompany(companyName: string): Promise<LinkedInCompany | null> {
  const url = `https://linkedin.com/company/${companyName}`;
  return fetchLinkedInCompany(url);
}

export { searchLinkedInPeople };
export { searchCompanyEmployees as findCompanyEmployees };