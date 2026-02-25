/**
 * LinkedIn People & Company Enrichment API
 * 
 * B2B数据抓取服务 - 通过公开页面获取LinkedIn个人和公司信息
 * 使用移动代理绕过反爬虫机制
 */

import { proxyFetch, getProxy } from '../proxy';

// Types
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
    period?: string;
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

export interface LinkedInCompany {
  name: string;
  description?: string;
  industry?: string;
  headquarters?: string;
  employee_count?: string;
  specialties?: string[];
  website?: string;
  company_url: string;
  meta?: {
    proxy?: {
      ip?: string;
      country?: string;
      carrier?: string;
    };
  };
}

export interface LinkedInSearchResult {
  name: string;
  headline: string;
  location?: string;
  profile_url: string;
}

// Extract public ID from LinkedIn URL
function extractPublicId(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
  return match ? match[1] : null;
}

function extractCompanyId(url: string): string | null {
  const match = url.match(/linkedin\.com\/company\/([^\/\?]+)/);
  return match ? match[1] : null;
}

// Parse person profile from LinkedIn public page
export async function scrapeLinkedInPerson(publicId: string): Promise<LinkedInPerson | null> {
  const url = `https://www.linkedin.com/in/${publicId}`;
  
  try {
    const response = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
      },
      timeoutMs: 30000,
      maxRetries: 2,
    });

    if (!response.ok) {
      console.error(`Failed to fetch profile: ${response.status}`);
      return null;
    }

    const html = await response.text();
    
    // Extract JSON-LD data (LinkedIn embeds structured data)
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^\u003c]+)<\/script>/);
    if (jsonLdMatch) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        
        // Parse person data from JSON-LD
        const person: LinkedInPerson = {
          name: data.name || '',
          headline: data.jobTitle?.[0] || data.description || '',
          location: data.address?.addressLocality || '',
          profile_url: url,
          skills: data.skills || [],
          connections: '500+', // Not always available in public data
        };

        // Extract education if available
        if (data.alumniOf) {
          person.education = Array.isArray(data.alumniOf) 
            ? data.alumniOf.map((edu: any) => ({
                school: edu.name || '',
                degree: edu.degree || '',
              }))
            : [{
                school: data.alumniOf.name || '',
                degree: data.alumniOf.degree || '',
              }];
        }

        // Extract current company
        if (data.worksFor) {
          person.current_company = {
            name: data.worksFor.name || '',
            title: data.jobTitle?.[0] || '',
          };
        }

        return person;
      } catch (e) {
        console.error('Failed to parse JSON-LD:', e);
      }
    }

    // Fallback: Extract from meta tags and HTML
    const name = extractMetaContent(html, 'name') || extractOgTitle(html);
    const description = extractMetaContent(html, 'description') || extractOgDescription(html);
    
    // Parse headline from description
    const headlineMatch = description?.match(/^([^\-]+)/);
    const headline = headlineMatch ? headlineMatch[1].trim() : '';
    
    return {
      name: name || publicId,
      headline: headline,
      location: '',
      profile_url: url,
    };

  } catch (error) {
    console.error(`Error scraping profile ${publicId}:`, error);
    return null;
  }
}

// Parse company profile from LinkedIn public page
export async function scrapeLinkedInCompany(companyId: string): Promise<LinkedInCompany | null> {
  const url = `https://www.linkedin.com/company/${companyId}`;
  
  try {
    const response = await proxyFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 30000,
      maxRetries: 2,
    });

    if (!response.ok) {
      console.error(`Failed to fetch company: ${response.status}`);
      return null;
    }

    const html = await response.text();
    
    // Extract JSON-LD data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^\u003c]+)<\/script>/);
    if (jsonLdMatch) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        
        const company: LinkedInCompany = {
          name: data.name || '',
          description: data.description || '',
          industry: data.industry || '',
          headquarters: data.address 
            ? `${data.address.addressLocality || ''}, ${data.address.addressRegion || ''}`
            : '',
          employee_count: extractEmployeeCount(html),
          company_url: url,
        };

        return company;
      } catch (e) {
        console.error('Failed to parse company JSON-LD:', e);
      }
    }

    // Fallback parsing
    const name = extractMetaContent(html, 'name') || extractOgTitle(html);
    const description = extractMetaContent(html, 'description') || extractOgDescription(html);
    
    return {
      name: name || companyId,
      description: description || '',
      company_url: url,
    };

  } catch (error) {
    console.error(`Error scraping company ${companyId}:`, error);
    return null;
  }
}

// Search people using Google site:linkedin.com/in search
export async function searchLinkedInPeople(
  title: string,
  location?: string,
  industry?: string,
  limit: number = 10
): Promise<LinkedInSearchResult[]> {
  const query = buildSearchQuery(title, location, industry);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit * 2, 20)}`;
  
  try {
    const response = await proxyFetch(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 30000,
    });

    if (!response.ok) {
      console.error(`Search failed: ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseGoogleSearchResults(html, limit);

  } catch (error) {
    console.error('Error searching LinkedIn:', error);
    return [];
  }
}

// Find company employees
export async function findCompanyEmployees(
  companyId: string,
  title?: string,
  limit: number = 10
): Promise<LinkedInSearchResult[]> {
  const titleQuery = title ? `+${encodeURIComponent(title)}` : '';
  const query = `site:linkedin.com/in "${companyId}"${titleQuery}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit * 2, 20)}`;
  
  try {
    const response = await proxyFetch(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 30000,
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return parseGoogleSearchResults(html, limit);

  } catch (error) {
    console.error('Error finding employees:', error);
    return [];
  }
}

// Helper functions
function extractMetaContent(html: string, name: string): string | null {
  const match = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'));
  return match ? match[1] : null;
}

function extractOgTitle(html: string): string | null {
  const match = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function extractOgDescription(html: string): string | null {
  const match = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function extractEmployeeCount(html: string): string | undefined {
  const match = html.match(/(\d+[\d,]*\s*-\s*\d+[\d,]*)\s*employees/i);
  if (match) return match[1];
  
  const match2 = html.match(/(\d+[\d,]*)\s*employees/i);
  return match2 ? match2[1] : undefined;
}

function buildSearchQuery(title: string, location?: string, industry?: string): string {
  let query = `site:linkedin.com/in "${title}"`;
  if (location) query += ` "${location}"`;
  if (industry) query += ` "${industry}"`;
  return query;
}

function parseGoogleSearchResults(html: string, limit: number): LinkedInSearchResult[] {
  const results: LinkedInSearchResult[] = [];
  
  // Extract search result links and titles
  const linkRegex = /<a[^>]*href=["']https:\/\/www\.linkedin\.com\/in\/([^"'\/]+)["'][^>]*>/gi;
  const titleRegex = /<h3[^>]*>([^\u003c]+)<\/h3>/gi;
  
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
  
  return results;
}