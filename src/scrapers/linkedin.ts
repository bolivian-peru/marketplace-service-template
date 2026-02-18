/**
 * LinkedIn People & Company Enrichment Scraper
 * Extracts profiles, company data, and search results via mobile proxies
 * Bypasses LinkedIn's aggressive anti-scraping via Proxies.sx
 */

import { proxyFetch, getProxy } from '../proxy';

export interface LinkedInPerson {
  name: string;
  headline: string;
  location: string;
  current_company: {
    name: string;
    title: string;
    started: string;
  } | null;
  previous_companies: Array<{
    name: string;
    title: string;
    period: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    field_of_study: string | null;
  }>;
  skills: string[];
  connections: string;
  profile_url: string;
  profile_image_url: string | null;
  about: string | null;
  industry: string | null;
}

export interface LinkedInCompany {
  name: string;
  description: string;
  website: string | null;
  industry: string;
  company_size: string;
  employee_count: number | null;
  headquarters: string | null;
  founded: string | null;
  specialties: string[];
  logo_url: string | null;
  company_type: string | null;
  follower_count: number | null;
  jobs_url: string | null;
  linkedin_url: string;
}

export interface LinkedInSearchResult {
  name: string;
  headline: string;
  location: string;
  profile_url: string;
  profile_image_url: string | null;
  current_company: string | null;
  connections: string | null;
}

const LI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [LinkedInApp]',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

// LinkedIn Voyager API headers (for public profile data)
const VOYAGER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept': 'application/vnd.linkedin.normalized+json+2.1',
  'x-li-lang': 'en_US',
  'x-restli-protocol-version': '2.0.0',
};

/**
 * Extract CSRF token and session cookies from LinkedIn
 */
async function getSessionContext(): Promise<{ cookies: string; csrfToken: string }> {
  const response = await proxyFetch('https://www.linkedin.com/', {
    headers: LI_HEADERS,
    maxRetries: 3,
    timeoutMs: 20000,
  });

  const html = await response.text();
  const cookies = response.headers.get('set-cookie') || '';

  // Extract JSESSIONID for CSRF
  const jsessionMatch = cookies.match(/JSESSIONID="?([^";]+)/);
  const csrfToken = jsessionMatch ? jsessionMatch[1] : '';

  return { cookies, csrfToken };
}

/**
 * Parse person profile from public LinkedIn page HTML
 */
function parsePersonFromHtml(html: string, profileUrl: string): LinkedInPerson {
  // Extract JSON-LD structured data
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/);
  let structuredData: any = {};
  if (jsonLdMatch) {
    try { structuredData = JSON.parse(jsonLdMatch[1]); } catch {}
  }

  // Extract from meta tags and structured data
  const nameMatch = html.match(/<title>([^|<]+?)(?:\s*[|\-]|<)/);
  const name = structuredData.name || (nameMatch ? nameMatch[1].trim() : 'Unknown');

  const headlineMatch = html.match(/class="top-card-layout__headline[^"]*"[^>]*>([^<]+)/);
  const headline = headlineMatch ? headlineMatch[1].trim() : structuredData.jobTitle?.[0] || '';

  const locationMatch = html.match(/class="top-card-layout__(?:first-)?subline[^"]*"[^>]*>([^<]+)/);
  const location = locationMatch ? locationMatch[1].trim() : structuredData.address?.addressLocality || '';

  const aboutMatch = html.match(/class="core-section-container__content[^"]*"[^>]*>\s*<p[^>]*>([^<]+)/s);
  const about = aboutMatch ? aboutMatch[1].trim() : null;

  const imgMatch = html.match(/class="top-card-layout__entity-image[^"]*"[^>]*src="([^"]+)"/);
  const profileImage = imgMatch ? imgMatch[1] : null;

  // Parse experience sections
  const experiences: Array<{ name: string; title: string; period: string }> = [];
  const expRegex = /class="experience-item[^"]*"[^>]*>.*?<h3[^>]*>([^<]+)<\/h3>.*?<h4[^>]*>([^<]+)<\/h4>.*?<span[^>]*class="[^"]*date-range[^"]*"[^>]*>([^<]+)/gs;
  let expMatch;
  while ((expMatch = expRegex.exec(html)) !== null) {
    experiences.push({
      title: expMatch[1].trim(),
      name: expMatch[2].trim(),
      period: expMatch[3].trim(),
    });
  }

  // Parse education
  const education: Array<{ school: string; degree: string; field_of_study: string | null }> = [];
  const eduData = structuredData.alumniOf || [];
  for (const edu of (Array.isArray(eduData) ? eduData : [eduData])) {
    if (edu?.name) {
      education.push({
        school: edu.name,
        degree: edu['@type'] === 'EducationalOrganization' ? '' : (edu.description || ''),
        field_of_study: null,
      });
    }
  }

  // Parse skills
  const skills: string[] = [];
  const skillRegex = /class="skill-card-skill-name[^"]*"[^>]*>([^<]+)/g;
  let skillMatch;
  while ((skillMatch = skillRegex.exec(html)) !== null) {
    skills.push(skillMatch[1].trim());
  }

  const connectionsMatch = html.match(/(\d+\+?)\s*connections/);
  const connections = connectionsMatch ? connectionsMatch[1] : '500+';

  const currentCompany = experiences.length > 0 ? {
    name: experiences[0].name,
    title: experiences[0].title,
    started: experiences[0].period.split(' - ')[0] || '',
  } : null;

  return {
    name,
    headline,
    location,
    current_company: currentCompany,
    previous_companies: experiences.slice(1).map(e => ({
      name: e.name,
      title: e.title,
      period: e.period,
    })),
    education,
    skills,
    connections,
    profile_url: profileUrl,
    profile_image_url: profileImage,
    about,
    industry: structuredData.worksFor?.[0]?.['@type'] || null,
  };
}

/**
 * Parse company profile from public LinkedIn page HTML
 */
function parseCompanyFromHtml(html: string, companyUrl: string): LinkedInCompany {
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/);
  let data: any = {};
  if (jsonLdMatch) {
    try { data = JSON.parse(jsonLdMatch[1]); } catch {}
  }

  const nameMatch = html.match(/<title>([^|<]+?)(?:\s*[|\-]|<)/);
  const name = data.name || (nameMatch ? nameMatch[1].trim() : 'Unknown');

  const descMatch = html.match(/class="org-top-card-summary__tagline[^"]*"[^>]*>([^<]+)/);
  const description = data.description || (descMatch ? descMatch[1].trim() : '');

  const sizeMatch = html.match(/(\d[\d,]+(?:\-\d[\d,]+)?)\s*employees/);
  const sizeStr = sizeMatch ? sizeMatch[1] : '';
  const employeeCount = sizeStr ? parseInt(sizeStr.replace(/[^\d]/g, '')) : null;

  const industryMatch = html.match(/class="org-top-card-summary-info-list__info-item[^"]*"[^>]*>([^<]+)/);
  const industry = industryMatch ? industryMatch[1].trim() : '';

  const logoMatch = html.match(/class="org-top-card-primary-content__logo[^"]*"[^>]*src="([^"]+)"/);

  const followersMatch = html.match(/(\d[\d,]+)\s*followers/);
  const followerCount = followersMatch ? parseInt(followersMatch[1].replace(/,/g, '')) : null;

  return {
    name,
    description,
    website: data.url || null,
    industry,
    company_size: sizeStr ? `${sizeStr} employees` : 'Unknown',
    employee_count: employeeCount,
    headquarters: data.address?.addressLocality || null,
    founded: data.foundingDate || null,
    specialties: data.keywords?.split(',').map((s: string) => s.trim()) || [],
    logo_url: logoMatch ? logoMatch[1] : null,
    company_type: data['@type'] || null,
    follower_count: followerCount,
    jobs_url: `${companyUrl}/jobs`,
    linkedin_url: companyUrl,
  };
}

/**
 * Get person profile by LinkedIn URL or username
 */
export async function getPersonProfile(usernameOrUrl: string): Promise<LinkedInPerson> {
  const username = usernameOrUrl.includes('linkedin.com')
    ? usernameOrUrl.split('/in/')[1]?.replace(/\/$/, '') || usernameOrUrl
    : usernameOrUrl;

  const profileUrl = `https://www.linkedin.com/in/${username}`;

  const response = await proxyFetch(profileUrl, {
    headers: LI_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) {
    throw new Error(`LinkedIn profile fetch failed for ${username}: ${response.status}`);
  }

  const html = await response.text();
  return parsePersonFromHtml(html, profileUrl);
}

/**
 * Get company profile by LinkedIn URL or company name
 */
export async function getCompanyProfile(nameOrUrl: string): Promise<LinkedInCompany> {
  const companySlug = nameOrUrl.includes('linkedin.com')
    ? nameOrUrl.split('/company/')[1]?.replace(/\/$/, '') || nameOrUrl
    : nameOrUrl;

  const companyUrl = `https://www.linkedin.com/company/${companySlug}`;

  const response = await proxyFetch(companyUrl, {
    headers: LI_HEADERS,
    maxRetries: 3,
    timeoutMs: 30000,
    followRedirects: true,
  });

  if (!response.ok) {
    throw new Error(`LinkedIn company fetch failed for ${companySlug}: ${response.status}`);
  }

  const html = await response.text();
  return parseCompanyFromHtml(html, companyUrl);
}

/**
 * Search people on LinkedIn by title, location, industry
 */
export async function searchPeople(
  title?: string,
  location?: string,
  industry?: string,
  limit = 10,
): Promise<LinkedInSearchResult[]> {
  // Build Google-powered LinkedIn search (more reliable than LinkedIn's own search without auth)
  const parts = ['site:linkedin.com/in'];
  if (title) parts.push(`"${title}"`);
  if (location) parts.push(`"${location}"`);
  if (industry) parts.push(`"${industry}"`);

  const query = parts.join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`;

  const response = await proxyFetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 3,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new Error(`LinkedIn people search failed: ${response.status}`);
  }

  const html = await response.text();
  const results: LinkedInSearchResult[] = [];

  // Parse Google results for LinkedIn profiles
  const resultRegex = /<a[^>]*href="(https:\/\/(?:www\.)?linkedin\.com\/in\/[^"?&]+)"[^>]*>.*?<h3[^>]*>([^<]+)<\/h3>/gs;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const url = match[1];
    const rawTitle = match[2];

    // Parse "Name - Title - Company | LinkedIn" format
    const titleParts = rawTitle.split(' - ').map((s: string) => s.trim());
    const name = titleParts[0]?.replace(/\s*[|].*$/, '') || '';
    const headline = titleParts.slice(1).join(' - ').replace(/\s*[|]\s*LinkedIn.*$/, '') || '';

    if (name && !name.includes('LinkedIn')) {
      results.push({
        name,
        headline,
        location: location || '',
        profile_url: url.split('?')[0],
        profile_image_url: null,
        current_company: titleParts[2]?.replace(/\s*[|]\s*LinkedIn.*$/, '') || null,
        connections: null,
      });
    }
  }

  return results;
}

/**
 * Get employees of a company by title filter
 */
export async function getCompanyEmployees(
  companySlug: string,
  titleFilter?: string,
  limit = 10,
): Promise<LinkedInSearchResult[]> {
  // Use Google-powered search for company employees
  const parts = [`site:linkedin.com/in "${companySlug}"`];
  if (titleFilter) parts.push(`"${titleFilter}"`);

  const query = parts.join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`;

  const response = await proxyFetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRetries: 3,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new Error(`LinkedIn employee search failed: ${response.status}`);
  }

  const html = await response.text();
  const results: LinkedInSearchResult[] = [];

  const resultRegex = /<a[^>]*href="(https:\/\/(?:www\.)?linkedin\.com\/in\/[^"?&]+)"[^>]*>.*?<h3[^>]*>([^<]+)<\/h3>/gs;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const url = match[1];
    const rawTitle = match[2];
    const titleParts = rawTitle.split(' - ').map((s: string) => s.trim());
    const name = titleParts[0]?.replace(/\s*[|].*$/, '') || '';
    const headline = titleParts.slice(1).join(' - ').replace(/\s*[|]\s*LinkedIn.*$/, '') || '';

    if (name && !name.includes('LinkedIn')) {
      results.push({
        name,
        headline,
        location: '',
        profile_url: url.split('?')[0],
        profile_image_url: null,
        current_company: companySlug,
        connections: null,
      });
    }
  }

  return results;
}
