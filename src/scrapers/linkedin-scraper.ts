/**
 * LinkedIn People & Company Enrichment Scraper
 * ─────────────────────────────────────────────
 * Extracts profile data from LinkedIn public pages.
 * Uses multiple extraction strategies for resilience:
 *   1. JSON-LD structured data
 *   2. HTML meta tags (og:*, profile:*)
 *   3. Embedded JSON in <code> blocks
 *
 * All functions accept a proxyFetch parameter to decouple
 * proxy logic from scraping logic.
 */

import { decodeHtmlEntities } from '../utils/helpers';

// ─── TYPES ──────────────────────────────────────────

export type ProxyFetchFn = (
  url: string,
  options?: RequestInit & { maxRetries?: number; timeoutMs?: number },
) => Promise<Response>;

export interface LinkedInPerson {
  name: string;
  headline: string;
  location: string;
  current_company: { name: string; title: string; started: string } | null;
  previous_companies: Array<{ name: string; title: string; period: string }>;
  education: Array<{ school: string; degree: string }>;
  skills: string[];
  connections: string;
  profile_url: string;
}

export interface LinkedInCompany {
  name: string;
  description: string;
  industry: string;
  employee_count: string;
  headquarters: string;
  website: string;
  specialties: string[];
  founded: string;
}

export interface PeopleSearchResult {
  results: Array<{ name: string; headline: string; location: string; profile_url: string }>;
  total_results: number;
}

// ─── CONSTANTS ──────────────────────────────────────

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': MOBILE_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── HTML / JSON HELPERS ────────────────────────────

function strip(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function meta(html: string, prop: string): string {
  for (const order of [
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
  ]) {
    const m = html.match(new RegExp(order, 'i'));
    if (m) return decodeHtmlEntities(m[1]);
  }
  return '';
}

function jsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try { const p = JSON.parse(m[1]); Array.isArray(p) ? out.push(...p) : out.push(p); } catch {}
  }
  return out;
}

function codeJson(html: string): any[] {
  const out: any[] = [];
  const re = /<code[^>]*>([\s\S]*?)<\/code>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (raw[0] !== '{' && raw[0] !== '[') continue;
    try {
      out.push(JSON.parse(decodeHtmlEntities(raw.replace(/&quot;|&#34;/g, '"'))));
    } catch {}
  }
  return out;
}

function normalizeUrl(url: string): string {
  let u = url.replace(/^http:/, 'https:');
  if (!u.endsWith('/')) u += '/';
  return u;
}

/** Extract LinkedIn profile cards from Google SERP HTML. */
function parseGoogleProfileResults(html: string): PeopleSearchResult {
  const results: PeopleSearchResult['results'] = [];
  const linkRe = /href="(https?:\/\/\w{0,3}\.?linkedin\.com\/in\/[^"?&]+)/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const profileUrl = m[1].split('?')[0].replace(/\/$/, '');
    if (seen.has(profileUrl)) continue;
    seen.add(profileUrl);

    const ctx = html.slice(Math.max(0, m.index - 500), m.index + 500);
    let name = '';
    const h3 = ctx.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3) name = strip(h3[1]).replace(/\s*[-\u2013|].*LinkedIn.*$/i, '').replace(/\s*LinkedIn$/i, '').trim();

    let headline = '';
    const snip = ctx.match(/class="[^"]*(?:snippet|description|st)[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (snip) headline = strip(snip[1]);
    if (!headline) { const sp = ctx.match(/<span[^>]*>([\s\S]{10,200}?)<\/span>/i); if (sp) headline = strip(sp[1]); }

    let loc = '';
    const lm = (headline + ' ' + name).match(/(?:[-\u2013|])\s*([A-Z][\w\s]+(?:Area|Metro|Region|City)?[^-\u2013|]*)/);
    if (lm) loc = lm[1].trim();

    results.push({
      name: name || profileUrl.split('/in/')[1]?.replace(/-/g, ' ') || '',
      headline: headline.slice(0, 200),
      location: loc,
      profile_url: profileUrl,
    });
  }

  let total = results.length;
  const tm = html.match(/About\s+([\d,]+)\s+results/i);
  if (tm) total = parseInt(tm[1].replace(/,/g, ''), 10);

  return { results, total_results: total };
}

// ─── PERSON PROFILE ─────────────────────────────────

export async function getPersonProfile(
  profileUrl: string,
  proxyFetch: ProxyFetchFn,
): Promise<LinkedInPerson> {
  const url = normalizeUrl(profileUrl);
  const r: LinkedInPerson = {
    name: '', headline: '', location: '',
    current_company: null, previous_companies: [], education: [],
    skills: [], connections: '', profile_url: url.replace(/\/$/, ''),
  };

  try {
    const html = await (await proxyFetch(url, { headers: FETCH_HEADERS, maxRetries: 2, timeoutMs: 25_000 })).text();

    // Strategy 1: JSON-LD
    const person = jsonLd(html).find((j) => j['@type'] === 'Person' || j['@type']?.includes?.('Person'));
    if (person) {
      r.name = person.name || '';
      r.headline = person.jobTitle || person.description || '';
      r.location = person.address?.addressLocality || person.address?.name || (typeof person.address === 'string' ? person.address : '') || '';

      if (person.worksFor) {
        const ws = Array.isArray(person.worksFor) ? person.worksFor[0] : person.worksFor;
        r.current_company = { name: typeof ws === 'string' ? ws : ws.name || '', title: person.jobTitle || '', started: '' };
      }
      for (const e of (Array.isArray(person.alumniOf) ? person.alumniOf : [])) {
        if (e['@type'] === 'EducationalOrganization' || e['@type'] === 'CollegeOrUniversity') {
          r.education.push({ school: e.name || '', degree: e.description || '' });
        } else if (e.name) {
          r.previous_companies.push({ name: e.name, title: '', period: '' });
        }
      }
    }

    // Strategy 2: OG / meta tags (fill gaps)
    if (!r.name) r.name = meta(html, 'og:title').replace(/\s*[-|].*$/, '');
    if (!r.headline) r.headline = meta(html, 'og:description');
    if (!r.location) r.location = meta(html, 'profile:location');
    if (!r.name) {
      const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (t) r.name = strip(t[1]).replace(/\s*[-|].*LinkedIn.*$/i, '').trim();
    }

    // Strategy 3: Embedded JSON in <code> blocks
    for (const block of codeJson(html)) {
      try {
        const included = block.included || block.data?.included || [];
        if (!Array.isArray(included)) continue;
        for (const item of included) {
          if (item['$type']?.includes('Position') || item.companyName) {
            const entry = {
              name: item.companyName || item.company?.name || '',
              title: item.title || '',
              period: [item.timePeriod?.startDate?.year, item.timePeriod?.endDate?.year].filter(Boolean).join(' - ') || '',
            };
            if (entry.name) {
              if (!item.timePeriod?.endDate && !r.current_company) {
                r.current_company = { name: entry.name, title: entry.title, started: String(item.timePeriod?.startDate?.year || '') };
              } else {
                r.previous_companies.push(entry);
              }
            }
          }
          if (item['$type']?.includes('Education') || item.schoolName) {
            r.education.push({ school: item.schoolName || item.school?.name || '', degree: [item.degreeName, item.fieldOfStudy].filter(Boolean).join(', ') });
          }
          if (item['$type']?.includes('Skill') && item.name) r.skills.push(item.name);
        }
      } catch {}
    }

    // Connections / followers count
    const conn = html.match(/(\d+\+?)\s*connections?/i);
    if (conn) r.connections = conn[1];
    if (!r.connections) { const fw = html.match(/(\d[\d,]*\+?)\s*followers?/i); if (fw) r.connections = fw[1].replace(/,/g, ''); }

    // Deduplicate previous_companies and exclude current
    const seen = new Set<string>();
    r.previous_companies = r.previous_companies.filter((c) => {
      const key = `${c.name}|${c.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !(r.current_company && c.name === r.current_company.name && c.title === r.current_company.title);
    });
  } catch (err: any) {
    if (!r.name) r.name = `[Error: ${err?.message || 'fetch failed'}]`;
  }

  return r;
}

// ─── COMPANY PROFILE ────────────────────────────────

export async function getCompanyProfile(
  companyUrl: string,
  proxyFetch: ProxyFetchFn,
): Promise<LinkedInCompany> {
  const url = normalizeUrl(companyUrl);
  const r: LinkedInCompany = {
    name: '', description: '', industry: '', employee_count: '',
    headquarters: '', website: '', specialties: [], founded: '',
  };

  try {
    const html = await (await proxyFetch(url, { headers: FETCH_HEADERS, maxRetries: 2, timeoutMs: 25_000 })).text();

    // Strategy 1: JSON-LD
    const org = jsonLd(html).find((j) => j['@type'] === 'Organization' || j['@type'] === 'Corporation');
    if (org) {
      r.name = org.name || '';
      r.description = org.description || '';
      r.website = org.url || org.sameAs || '';
      r.employee_count = org.numberOfEmployees?.value || String(org.numberOfEmployees || '') || '';
      r.headquarters = org.address?.addressLocality || org.address?.name || (typeof org.address === 'string' ? org.address : '') || '';
      r.industry = org.industry || '';
      r.founded = String(org.foundingDate || '');
    }

    // Strategy 2: OG / meta tags
    if (!r.name) r.name = meta(html, 'og:title').replace(/\s*[-|].*$/, '');
    if (!r.description) r.description = meta(html, 'og:description');

    // Strategy 3: Embedded JSON in <code> blocks
    for (const block of codeJson(html)) {
      try {
        const included = block.included || block.data?.included || [];
        if (!Array.isArray(included)) continue;
        for (const item of included) {
          if (!item['$type']?.includes('Company') && !item['$type']?.includes('Organization')) continue;
          if (!r.name && item.name) r.name = item.name;
          if (!r.description && item.description) r.description = item.description;
          if (!r.industry) r.industry = item.companyIndustries?.[0]?.localizedName || item.industry?.localizedName || item.industry || '';
          if (!r.employee_count) {
            r.employee_count = item.staffCountRange?.start && item.staffCountRange?.end
              ? `${item.staffCountRange.start}-${item.staffCountRange.end}` : item.staffCount ? String(item.staffCount) : '';
          }
          if (!r.headquarters && item.headquarter) {
            const hq = item.headquarter;
            r.headquarters = [hq.city, hq.geographicArea, hq.country?.name].filter(Boolean).join(', ');
          }
          if (!r.website && item.companyPageUrl) r.website = item.companyPageUrl;
          if (!r.founded && item.foundedOn?.year) r.founded = String(item.foundedOn.year);
          if (r.specialties.length === 0 && item.specialities) {
            r.specialties = Array.isArray(item.specialities) ? item.specialities
              : typeof item.specialities === 'string' ? item.specialities.split(',').map((s: string) => s.trim()) : [];
          }
        }
      } catch {}
    }

    // HTML fallbacks
    if (!r.employee_count) { const m = html.match(/([\d,]+(?:\+)?)\s*employees?\s*on\s*LinkedIn/i); if (m) r.employee_count = m[1].replace(/,/g, ''); }
    if (!r.industry) { const m = html.match(/class="[^"]*industry[^"]*"[^>]*>([^<]+)/i); if (m) r.industry = strip(m[1]); }
    if (r.specialties.length === 0) {
      const m = html.match(/specialties[:\s]*([\s\S]{5,300}?)(?:<\/|\.)/i);
      if (m) r.specialties = m[1].split(/[,;]/).map((s) => strip(s)).filter((s) => s.length > 1 && s.length < 80);
    }
  } catch (err: any) {
    if (!r.name) r.name = `[Error: ${err?.message || 'fetch failed'}]`;
  }

  return r;
}

// ─── PEOPLE SEARCH ──────────────────────────────────

export async function searchPeople(
  title: string,
  location: string,
  industry: string,
  proxyFetch: ProxyFetchFn,
): Promise<PeopleSearchResult> {
  try {
    const parts = ['site:linkedin.com/in/', title ? `"${title}"` : '', location ? `"${location}"` : '', industry ? `"${industry}"` : ''].filter(Boolean);
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(parts.join(' '))}&num=20`;
    const html = await (await proxyFetch(googleUrl, { headers: FETCH_HEADERS, maxRetries: 2, timeoutMs: 20_000 })).text();
    const result = parseGoogleProfileResults(html);

    // Fallback: LinkedIn public directory if Google returned nothing
    if (result.results.length === 0 && title) {
      const nameParts = title.split(/\s+/);
      const dirUrl = `https://www.linkedin.com/pub/dir/${encodeURIComponent(nameParts[0])}/${encodeURIComponent(nameParts.slice(1).join(' ') || '+')}`;
      const dirHtml = await (await proxyFetch(dirUrl, { headers: FETCH_HEADERS, maxRetries: 1, timeoutMs: 20_000 })).text();
      if (!/authwall|login|sign[\s-]?in|session_redirect/i.test(dirHtml)) {
        const cardRe = /class="[^"]*search-result[^"]*"[\s\S]*?href="(https?:\/\/[^"]*linkedin\.com\/in\/[^"]+)"[\s\S]*?class="[^"]*name[^"]*"[^>]*>([^<]+)/gi;
        let m: RegExpExecArray | null;
        while ((m = cardRe.exec(dirHtml)) !== null) {
          result.results.push({ name: strip(m[2]), headline: '', location: '', profile_url: m[1].split('?')[0] });
        }
        result.total_results = result.results.length;
      }
    }
    return result;
  } catch {
    return { results: [], total_results: 0 };
  }
}

// ─── COMPANY EMPLOYEES ──────────────────────────────

export async function getCompanyEmployees(
  companyId: string,
  title: string,
  proxyFetch: ProxyFetchFn,
): Promise<PeopleSearchResult> {
  try {
    const parts = ['site:linkedin.com/in/', `"${companyId}"`, title ? `"${title}"` : ''].filter(Boolean);
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(parts.join(' '))}&num=20`;
    const html = await (await proxyFetch(googleUrl, { headers: FETCH_HEADERS, maxRetries: 2, timeoutMs: 20_000 })).text();
    return parseGoogleProfileResults(html);
  } catch {
    return { results: [], total_results: 0 };
  }
}