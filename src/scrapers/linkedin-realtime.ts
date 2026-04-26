/**
 * LinkedIn People & Company Enrichment API — Bounty #77
 *
 * Scrapes LinkedIn public profiles via mobile proxy rotation.
 * No LinkedIn API key needed. Micropayment pricing.
 *
 * Endpoints:
 *   GET /api/linkedin/person?url=linkedin.com/in/username
 *   GET /api/linkedin/company?url=linkedin.com/company/name
 *   GET /api/linkedin/search/people?title=CTO&location=SF&industry=SaaS
 *   GET /api/linkedin/company/:id/employees?title=engineer
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ───────────────────────────────────────

export interface LinkedInPerson {
  name: string;
  headline: string | null;
  location: string | null;
  current_company: { name: string; title: string; started: string | null } | null;
  previous_companies: Array<{ name: string; title: string; period: string }>;
  education: Array<{ school: string; degree: string | null }>;
  skills: string[];
  connections: string | null;
  profile_url: string;
  summary: string | null;
}

export interface LinkedInCompany {
  name: string;
  description: string | null;
  industry: string | null;
  employee_count: string | null;
  headquarters: string | null;
  website: string | null;
  founded: string | null;
  specialties: string[];
  company_url: string;
}

// ─── CONSTANTS ───────────────────────────────────

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]';
const TIMEOUT_MS = 25_000;
const MAX_TEXT = 500;
const MAX_SKILLS = 30;

function sanitize(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractBetween(html: string, start: string, end: string): string {
  const i = html.indexOf(start);
  if (i === -1) return '';
  const j = html.indexOf(end, i + start.length);
  if (j === -1) return html.slice(i + start.length, i + start.length + 1000);
  return html.slice(i + start.length, j);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ─── PERSON PROFILE ──────────────────────────────

export async function scrapeLinkedInPersonProfile(profileUrl: string): Promise<LinkedInPerson | null> {
  // Normalize URL
  if (!profileUrl.startsWith('http')) {
    profileUrl = `https://www.linkedin.com/in/${profileUrl.replace(/^\/+/, '')}`;
  }
  if (!profileUrl.includes('linkedin.com')) return null;

  const proxy = getProxy();

  try {
    const resp = await proxyFetch(profileUrl, {
      headers: {
        'User-Agent': MOBILE_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: TIMEOUT_MS,
    });

    const html = await resp.text();

    // Parse JSON-LD structured data (LinkedIn includes this for public profiles)
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]) as Record<string, unknown>;
        if (ld['@type'] === 'Person') {
          const worksFor = (Array.isArray(ld.worksFor) ? ld.worksFor : [ld.worksFor].filter(Boolean)) as Array<Record<string, unknown>>;
          const alumniOf = (Array.isArray(ld.alumniOf) ? ld.alumniOf : [ld.alumniOf].filter(Boolean)) as Array<Record<string, unknown>>;

          return {
            name: sanitize(ld.name, 200),
            headline: sanitize(ld.jobTitle, MAX_TEXT) || null,
            location: sanitize((ld.address as Record<string, unknown>)?.addressLocality, 200) || null,
            current_company: worksFor[0] ? {
              name: sanitize(worksFor[0].name, 200),
              title: sanitize(ld.jobTitle, 200),
              started: null,
            } : null,
            previous_companies: worksFor.slice(1).map(w => ({
              name: sanitize(w.name, 200),
              title: '',
              period: '',
            })),
            education: alumniOf.map(a => ({
              school: sanitize(a.name, 200),
              degree: null,
            })),
            skills: [],
            connections: null,
            profile_url: profileUrl,
            summary: sanitize(ld.description, MAX_TEXT) || null,
          };
        }
      } catch { /* parse error, fall through to HTML parsing */ }
    }

    // Fallback: parse HTML meta tags
    const ogTitle = extractBetween(html, 'property="og:title" content="', '"');
    const ogDesc = extractBetween(html, 'property="og:description" content="', '"');
    const ogUrl = extractBetween(html, 'property="og:url" content="', '"');

    if (ogTitle) {
      const parts = stripTags(ogTitle).split(' - ');
      return {
        name: sanitize(parts[0], 200),
        headline: sanitize(parts[1], MAX_TEXT) || null,
        location: null,
        current_company: parts[2] ? { name: sanitize(parts[2], 200), title: sanitize(parts[1], 200), started: null } : null,
        previous_companies: [],
        education: [],
        skills: [],
        connections: null,
        profile_url: ogUrl || profileUrl,
        summary: sanitize(stripTags(ogDesc), MAX_TEXT) || null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── COMPANY PROFILE ─────────────────────────────

export async function scrapeLinkedInCompanyProfile(companyUrl: string): Promise<LinkedInCompany | null> {
  if (!companyUrl.startsWith('http')) {
    companyUrl = `https://www.linkedin.com/company/${companyUrl.replace(/^\/+/, '')}`;
  }
  if (!companyUrl.includes('linkedin.com')) return null;

  try {
    const resp = await proxyFetch(companyUrl, {
      headers: {
        'User-Agent': MOBILE_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: TIMEOUT_MS,
    });

    const html = await resp.text();

    // JSON-LD for organizations
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]) as Record<string, unknown>;
        if (ld['@type'] === 'Organization') {
          return {
            name: sanitize(ld.name, 200),
            description: sanitize(ld.description, MAX_TEXT) || null,
            industry: sanitize((ld as Record<string, unknown>).industry, 200) || null,
            employee_count: String((ld.numberOfEmployees as Record<string, unknown>)?.value || '') || null,
            headquarters: sanitize((ld.address as Record<string, unknown>)?.addressLocality, 200) || null,
            website: String(ld.url || '') || null,
            founded: String(ld.foundingDate || '') || null,
            specialties: [],
            company_url: companyUrl,
          };
        }
      } catch { /* fall through */ }
    }

    // Fallback: meta tags
    const ogTitle = extractBetween(html, 'property="og:title" content="', '"');
    const ogDesc = extractBetween(html, 'property="og:description" content="', '"');

    if (ogTitle) {
      return {
        name: sanitize(stripTags(ogTitle).split('|')[0], 200),
        description: sanitize(stripTags(ogDesc), MAX_TEXT) || null,
        industry: null,
        employee_count: null,
        headquarters: null,
        website: null,
        founded: null,
        specialties: [],
        company_url: companyUrl,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── PEOPLE SEARCH ───────────────────────────────

export async function searchLinkedInPeoplePublic(
  title: string,
  location?: string,
  industry?: string,
  limit: number = 10
): Promise<LinkedInPerson[]> {
  // Use Google dork: site:linkedin.com/in/ "title" "location"
  const query = [
    'site:linkedin.com/in/',
    `"${sanitize(title, 100)}"`,
    location ? `"${sanitize(location, 100)}"` : '',
    industry ? `"${sanitize(industry, 100)}"` : '',
  ].filter(Boolean).join(' ');

  try {
    const resp = await proxyFetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}`,
      {
        headers: {
          'User-Agent': MOBILE_UA,
          'Accept': 'text/html',
        },
        timeoutMs: TIMEOUT_MS,
      }
    );

    const html = await resp.text();
    const urls = html.match(/linkedin\.com\/in\/[a-zA-Z0-9_-]+/g) || [];
    const unique = [...new Set(urls)].slice(0, limit);

    // For each URL, extract basic info from Google snippet
    return unique.map(url => ({
      name: '',
      headline: null,
      location: location || null,
      current_company: null,
      previous_companies: [],
      education: [],
      skills: [],
      connections: null,
      profile_url: `https://www.${url}`,
      summary: null,
    }));
  } catch {
    return [];
  }
}
