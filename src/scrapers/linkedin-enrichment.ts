import { proxyFetch, getProxy } from '../proxy';

// LinkedIn Person Profile Interface
export interface LinkedInPerson {
  name: string;
  headline: string;
  location: string;
  industry?: string;
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
  growth_rate?: string;
  website?: string;
  specialties?: string[];
  technology_signals?: string[];
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractTechnologySignals(html: string): string[] {
  const lower = html.toLowerCase();
  const signals = [
    'aws',
    'gcp',
    'azure',
    'kubernetes',
    'docker',
    'react',
    'node.js',
    'python',
    'typescript',
    'postgresql',
    'snowflake',
    'databricks',
    'terraform',
  ];

  return signals.filter((signal) => lower.includes(signal));
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

    const industry = jsonLd.worksFor?.industry ||
                     html.match(/"industry":"([^"]+)"/)?.[1] ||
                     html.match(/\b(?:in|for)\s+the\s+([A-Za-z\s&-]+?)\s+industry\b/i)?.[1] ||
                     undefined;

    const currentMatch = headline.match(/at\s+(.+)$/i);
    const current_company = currentMatch ? {
      name: currentMatch[1].trim(),
      title: headline.split(' at ')[0].trim(),
    } : undefined;

    const skillSet = new Set<string>();
    if (jsonLd.knowsAbout && Array.isArray(jsonLd.knowsAbout)) {
      for (const skill of jsonLd.knowsAbout) {
        if (typeof skill === 'string' && skill.trim()) {
          skillSet.add(skill.trim());
        }
      }
    }

    for (const match of html.matchAll(/"skill(?:Name)?":"([^"]+)"/gi)) {
      const skill = decodeHtmlEntities(match[1]).trim();
      if (skill) skillSet.add(skill);
      if (skillSet.size >= 15) break;
    }

    const connections = html.match(/(\d+)\+?\s*connections?/i)?.[1] ||
                       html.match(/"connectionCount":(\d+)/)?.[1] ||
                       '500+';

    return {
      name: decodeHtmlEntities(name).replace(/\s+/g, ' ').trim(),
      headline: decodeHtmlEntities(headline).trim(),
      location: decodeHtmlEntities(location).trim(),
      industry: industry ? decodeHtmlEntities(industry).trim() : undefined,
      current_company,
      skills: skillSet.size > 0 ? Array.from(skillSet).slice(0, 10) : undefined,
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

    const growth_rate = html.match(/(?:headcount|employee)\s+growth[^\d]*(\d+%)/i)?.[1] ||
                        html.match(/(\d+%)\s*(?:yoy|year[-\s]*over[-\s]*year)\s*(?:growth)?/i)?.[1] ||
                        undefined;

    const website = jsonLd.url || html.match(/"companyPageUrl":"([^"]+)"/)?.[1] || undefined;

    const job_openingsMatch = html.match(/([\d,]+)\s+job\s+openings?/i) || html.match(/"jobCount":\s*(\d+)/i);
    const job_openings = job_openingsMatch?.[1] ? parseInt(job_openingsMatch[1].replace(/,/g, ''), 10) : undefined;

    const specialties = Array.from(new Set(Array.from(html.matchAll(/"specialt(?:y|ies)":"([^"]+)"/gi)).map((m) => decodeHtmlEntities(m[1]).trim()))).slice(0, 10);

    return {
      name: decodeHtmlEntities(name).replace(/\s+/g, ' ').trim(),
      description: decodeHtmlEntities(description).slice(0, 500),
      industry: decodeHtmlEntities(industry),
      headquarters: decodeHtmlEntities(headquarters),
      employee_count,
      growth_rate,
      website: website ? decodeHtmlEntities(website) : undefined,
      specialties: specialties.length ? specialties : undefined,
      technology_signals: extractTechnologySignals(html),
      job_openings,
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
    const titleRegex = /<h3[^\u003e]*>(.*?)<\/h3>/gi;
    
    const links: string[] = [];
    let match;
    
    while ((match = linkRegex.exec(html)) !== null && links.length < limit * 2) {
      links.push(match[1]);
    }
    
    const titles: string[] = [];
    while ((match = titleRegex.exec(html)) !== null && titles.length < limit * 2) {
      const clean = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '').trim());
      if (clean) titles.push(clean);
    }
    
    for (let i = 0; i < Math.min(links.length, titles.length, limit); i++) {
      const titleParts = titles[i].split(' - ');
      results.push({
        name: titleParts[0] || links[i],
        headline: titleParts.slice(1).join(' - ') || '',
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

export { searchCompanyEmployees as findCompanyEmployees };
