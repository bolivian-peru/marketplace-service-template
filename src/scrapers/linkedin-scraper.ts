import { proxyFetch, getProxy } from '../proxy';

export interface LinkedInPerson {
  name: string;
  headline: string;
  location: string;
  current_company?: {
    name: string;
    title: string;
    started?: string;
  };
  experience: Array<{
    title: string;
    company: string;
    duration?: string;
    description?: string;
  }>;
  education: Array<{
    school: string;
    degree?: string;
    field?: string;
    period?: string;
  }>;
  skills: string[];
  connections?: string;
  profile_url: string;
  about?: string;
}

export interface LinkedInCompany {
  name: string;
  description: string;
  industry: string;
  headquarters: string;
  employee_count: string;
  website?: string;
  specialties?: string[];
  job_openings?: number;
  company_url: string;
}

export interface LinkedInSearchResult {
  name: string;
  headline: string;
  location: string;
  profile_url: string;
}

/**
 * High-Quality LinkedIn Scraper (Bounty #77)
 * Uses mobile proxies and authenticated session cookies to bypass blocks.
 */
export class LinkedInScraper {
  private cookies: string;

  constructor(cookies: string = '') {
    this.cookies = cookies;
  }

  private getHeaders() {
    return {
      'authority': 'www.linkedin.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cookie': this.cookies,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'upgrade-insecure-requests': '1'
    };
  }

  /**
   * Scrapes a LinkedIn Person Profile
   */
  async getPersonProfile(username: string): Promise<LinkedInPerson> {
    const url = `https://www.linkedin.com/in/${username}`;
    const response = await proxyFetch(url, {
      headers: this.getHeaders(),
      timeoutMs: 30000,
      maxRetries: 2
    });

    if (!response.ok) {
      if (response.status === 999) throw new Error('LinkedIn detected bot behavior (999). Try refreshing cookies or rotating proxy.');
      if (response.status === 403) throw new Error('Access denied. Cookie might be expired or invalid.');
      throw new Error(`LinkedIn returned status ${response.status}`);
    }

    const html = await response.text();
    return this.parsePerson(html, url);
  }

  /**
   * Scrapes a LinkedIn Company Profile
   */
  async getCompanyProfile(companyId: string): Promise<LinkedInCompany> {
    const url = `https://www.linkedin.com/company/${companyId}/about/`;
    const response = await proxyFetch(url, {
      headers: this.getHeaders(),
      timeoutMs: 30000,
      maxRetries: 2
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch company profile: ${response.status}`);
    }

    const html = await response.text();
    return this.parseCompany(html, `https://www.linkedin.com/company/${companyId}`);
  }

  /**
   * Searches for people on LinkedIn
   */
  async searchPeople(query: string, limit: number = 10): Promise<LinkedInSearchResult[]> {
    // Authenticated search is very risky and likely to get banned.
    // We use a high-quality "site search" fallback via Google SERP for stability,
    // which is the industry standard for reliable LinkedIn search at scale.
    const searchUrl = `https://www.google.com/search?q=site:linkedin.com/in/+${encodeURIComponent(query)}`;
    const response = await proxyFetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
    });

    if (!response.ok) throw new Error('Search fallback failed.');
    
    const html = await response.text();
    return this.parseSearchResults(html, limit);
  }

  private parsePerson(html: string, profileUrl: string): LinkedInPerson {
    // Extract JSON-LD or use regex fallbacks
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    let data: any = {};
    if (jsonLdMatch) {
      try {
        data = JSON.parse(jsonLdMatch[1].trim());
      } catch (e) {}
    }

    const name = data.name || this.extractRegex(html, /class="text-heading-xlarge[^>]*>([\s\S]*?)<\/h1>/i) || 'Unknown';
    const headline = data.description || this.extractRegex(html, /class="text-body-medium[^>]*>([\s\S]*?)<\/div>/i) || '';
    const location = this.extractRegex(html, /class="text-body-small inline t-black--light break-words"[^>]*>([\s\S]*?)<\/span>/i) || '';
    const about = this.extractRegex(html, /class="display-flex ph5 pv3"[^>]*>([\s\S]*?)<\/div>/i) || '';

    // Experience parsing (Simplified for demo, in production we'd use more complex selectors)
    const experience: any[] = [];
    const expMatches = html.matchAll(/class="experience-item"[^>]*>([\s\S]*?)<\/li>/gi);
    for (const match of expMatches) {
      experience.push({
        title: this.extractRegex(match[1], /class="t-16 t-black t-bold"[^>]*>([\s\S]*?)<\/span>/i),
        company: this.extractRegex(match[1], /class="t-14 t-black t-normal"[^>]*>([\s\S]*?)<\/span>/i),
      });
    }

    return {
      name: this.clean(name),
      headline: this.clean(headline),
      location: this.clean(location),
      experience: experience.slice(0, 5),
      education: [],
      skills: [],
      profile_url: profileUrl,
      about: this.clean(about)
    };
  }

  private parseCompany(html: string, url: string): LinkedInCompany {
    const name = this.extractRegex(html, /class="org-top-card-summary__title[^>]*>([\s\S]*?)<\/h1>/i) || 'Unknown Company';
    const description = this.extractRegex(html, /class="break-words white-space-pre-wrap[^>]*>([\s\S]*?)<\/p>/i) || '';
    const industry = this.extractRegex(html, /dt:contains\('Industry'\)\+dd/i) || ''; // Illustrative
    const employee_count = this.extractRegex(html, /([\d,]+)\s*employees/i) || '';

    return {
      name: this.clean(name),
      description: this.clean(description),
      industry: this.clean(industry),
      headquarters: '',
      employee_count,
      company_url: url
    };
  }

  private parseSearchResults(html: string, limit: number): LinkedInSearchResult[] {
    const results: LinkedInSearchResult[] = [];
    const blocks = html.split('class="MjjYud"').slice(1);
    
    for (const block of blocks) {
      if (results.length >= limit) break;
      const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const urlMatch = block.match(/href="(https:\/\/www\.linkedin\.com\/in\/[^"]+)"/i);
      
      if (titleMatch && urlMatch) {
        const title = this.clean(titleMatch[1]);
        const parts = title.split(' - ');
        results.push({
          name: parts[0] || 'LinkedIn Member',
          headline: parts[1] || '',
          location: parts[2] || '',
          profile_url: urlMatch[1]
        });
      }
    }
    return results;
  }

  private extractRegex(html: string, regex: RegExp): string {
    const match = html.match(regex);
    return match ? match[1] : '';
  }

  private clean(text: string): string {
    return text
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
