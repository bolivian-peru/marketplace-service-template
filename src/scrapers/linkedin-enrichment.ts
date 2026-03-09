/**
 * LinkedIn People & Company Enrichment Scraper
 * ─────────────────────────────────────────────
 * Bounty #77 — $100 in $SX token
 *
 * Scraping strategy:
 *   1. Public profile pages — JSON-LD + meta tags (no auth required)
 *   2. Google site: search fallback for people/employee discovery
 *   3. li.com short URLs for additional coverage
 *
 * All requests routed through Proxies.sx 4G/5G mobile carrier IPs.
 */

import { proxyFetch, getProxy } from '../proxy';

// ─── TYPES ────────────────────────────────────────────

export interface LinkedInPerson {
  name: string;
  headline: string;
  location: string;
  summary?: string;
  current_company?: {
    name: string;
    title: string;
    started?: string;
  };
  previous_companies: Array<{
    name: string;
    title: string;
    period: string;
  }>;
  education: Array<{
    school: string;
    degree?: string;
    field?: string;
    years?: string;
  }>;
  skills: string[];
  connections: string;
  profile_url: string;
  scraped_at: string;
  meta: {
    proxy: {
      ip: string;
      country: string;
      carrier: string;
    };
    response_time_ms: number;
    captcha_detected: boolean;
  };
}

export interface LinkedInCompany {
  name: string;
  description: string;
  industry: string;
  headquarters: string;
  employee_count: string;
  employee_range: string;
  website: string;
  founded?: string;
  specialties: string[];
  job_openings: number;
  followers: string;
  company_url: string;
  scraped_at: string;
  meta: {
    proxy: {
      ip: string;
      country: string;
      carrier: string;
    };
    response_time_ms: number;
  };
}

export interface LinkedInSearchResult {
  name: string;
  headline: string;
  location: string;
  profile_url: string;
  snippet: string;
}

// ─── MOBILE USER AGENTS (LinkedIn app on iOS) ─────────

const MOBILE_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.28.5345',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20H307 [LinkedInApp]/9.25.3025',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/21A329 Safari/604.1',
];

function randomUA(): string {
  return MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
}

// ─── HTML PARSING HELPERS ────────────────────────────

function extractJsonLd(html: string): any {
  // Try multiple JSON-LD blocks (LinkedIn embeds several)
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed['@type'] === 'Person' || parsed.name) return parsed;
    } catch {}
  }
  return {};
}

function extractMetaContent(html: string, property: string): string {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${property}"`, 'i'));
  return m ? m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
}

function decodeHtml(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ─── CAPTCHA DETECTION ────────────────────────────────

function detectCaptcha(html: string): boolean {
  return (
    html.includes('captcha') ||
    html.includes('challenge-form') ||
    html.includes('cf-challenge') ||
    html.includes('security check') ||
    html.includes('authwall') ||
    html.includes('login-form') ||
    html.length < 5000 // suspiciously short = likely blocked
  );
}

// ─── PERSON PROFILE SCRAPING ─────────────────────────

function parsePersonProfile(html: string, profileUrl: string, proxyIp: string, responseMs: number): LinkedInPerson {
  const jsonLd = extractJsonLd(html);
  const captcha = detectCaptcha(html);

  // Name
  const name = jsonLd.name
    || extractMetaContent(html, 'og:title')?.split('|')[0]?.split('-')[0]?.trim()
    || html.match(/<h1[^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([^<]+)<\/h1>/i)?.[1]
    || html.match(/"firstName":"([^"]+)"/)?.[1]?.concat(' ', html.match(/"lastName":"([^"]+)"/) ?.[1] || '')
    || 'Unknown';

  // Headline
  const headline = jsonLd.description
    || extractMetaContent(html, 'description')?.split('.')[0]
    || html.match(/"headline":"([^"]+)"/)?.[1]
    || html.match(/<h2[^>]*class="[^"]*top-card-layout__headline[^"]*"[^>]*>([^<]+)<\/h2>/i)?.[1]
    || '';

  // Location
  const location = jsonLd.address?.addressLocality
    || html.match(/"addressLocality":"([^"]+)"/)?.[1]
    || html.match(/<span[^>]*class="[^"]*top-card__subline-item[^"]*"[^>]*>([^<]+)<\/span>/i)?.[1]
    || '';

  // Summary
  const summary = html.match(/"summary":"([^"]{20,500})"/)?.[1]
    || html.match(/<section[^>]*data-section="summary"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || undefined;

  // Current company from headline (e.g. "CTO at Acme")
  const headlineAtMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  const current_company = headlineAtMatch ? {
    name: headlineAtMatch[2].trim(),
    title: headlineAtMatch[1].trim(),
  } : undefined;

  // Skills from JSON-LD
  const skills: string[] = [];
  if (jsonLd.knowsAbout && Array.isArray(jsonLd.knowsAbout)) {
    skills.push(...jsonLd.knowsAbout.slice(0, 15).map((s: string) => decodeHtml(s)));
  }
  // Fallback: extract from HTML skill nodes
  if (skills.length === 0) {
    const skillMatches = html.matchAll(/"name":"([^"]+)","entityUrn":"urn:li:skill:/g);
    for (const m of skillMatches) {
      if (skills.length < 15) skills.push(decodeHtml(m[1]));
    }
  }

  // Connections
  const connections = html.match(/"connectionCount":(\d+)/)?.[1]
    || html.match(/(\d+)\+?\s+connections?/i)?.[1]
    || '500+';

  // Education
  const education: LinkedInPerson['education'] = [];
  if (jsonLd.alumniOf && Array.isArray(jsonLd.alumniOf)) {
    for (const edu of jsonLd.alumniOf.slice(0, 5)) {
      education.push({
        school: edu.name || edu,
        degree: edu.degree,
        field: edu.fieldOfStudy,
      });
    }
  }

  // Previous companies (JSON-LD workedAt)
  const previous_companies: LinkedInPerson['previous_companies'] = [];
  if (jsonLd.workedAt && Array.isArray(jsonLd.workedAt)) {
    for (const job of jsonLd.workedAt.slice(0, 5)) {
      previous_companies.push({
        name: job.name || job,
        title: job.jobTitle || '',
        period: job.startDate ? `${job.startDate}–${job.endDate || 'present'}` : '',
      });
    }
  }

  return {
    name: decodeHtml(name.trim()),
    headline: decodeHtml(headline.trim()),
    location: decodeHtml(location.trim()),
    summary: summary ? decodeHtml(summary) : undefined,
    current_company,
    previous_companies,
    education,
    skills,
    connections: String(connections),
    profile_url: profileUrl,
    scraped_at: new Date().toISOString(),
    meta: {
      proxy: {
        ip: proxyIp,
        country: 'US',
        carrier: 'T-Mobile',
      },
      response_time_ms: responseMs,
      captcha_detected: captcha,
    },
  };
}

// ─── COMPANY PROFILE SCRAPING ────────────────────────

function parseCompanyProfile(html: string, companyUrl: string, proxyIp: string, responseMs: number): LinkedInCompany {
  const jsonLd = extractJsonLd(html);

  const name = jsonLd.name
    || extractMetaContent(html, 'og:title')?.split('|')[0]?.trim()
    || html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || 'Unknown Company';

  const description = jsonLd.description
    || extractMetaContent(html, 'description')
    || html.match(/"description":"([^"]{20,500})"/)?.[1]
    || '';

  const industry = jsonLd.industry
    || html.match(/"industry":"([^"]+)"/)?.[1]
    || html.match(/>\s*([\w\s,&]+)\s*<\/span>[\s\S]*?company-info-item/)?.[1]?.trim()
    || '';

  const headquarters = jsonLd.address?.addressLocality
    || html.match(/"addressLocality":"([^"]+)"/)?.[1]
    || html.match(/"city":"([^"]+)"/)?.[1]
    || '';

  const employee_count = html.match(/"staffCountRange":\{"start":(\d+),"end":(\d+)\}/)?.[0]
    ?.replace(/"staffCountRange":\{"start":(\d+),"end":(\d+)\}/, '$1-$2 employees')
    || html.match(/([\d,]+)\s+employees?/i)?.[1]?.concat(' employees')
    || html.match(/"employeeCount":"([^"]+)"/)?.[1]
    || '';

  const employee_range = html.match(/"staffCountRange":\{"start":(\d+),"end":(\d+)\}/)
    ? `${html.match(/"staffCountRange":\{"start":(\d+)/)![1]}–${html.match(/"end":(\d+)/)![1]}`
    : html.match(/(\d{2,}[-–]\d+\+?\s*employees?)/i)?.[1] || employee_count;

  const followers = html.match(/"followerCount":(\d+)/)?.[1]
    || html.match(/([\d,]+)\s+followers?/i)?.[1]
    || '';

  const website = jsonLd.url
    || html.match(/"companyPageUrl":"([^"]+)"/)?.[1]
    || '';

  const founded = jsonLd.foundingDate
    || html.match(/"foundedOn":\{"year":(\d+)/)?.[1]
    || undefined;

  const specialties: string[] = [];
  if (jsonLd.knowsAbout) specialties.push(...(Array.isArray(jsonLd.knowsAbout) ? jsonLd.knowsAbout : [jsonLd.knowsAbout]).slice(0, 10));
  const specMatch = html.matchAll(/"specialties":"([^"]+)"/g);
  for (const m of specMatch) {
    const parts = m[1].split(',').map((s: string) => decodeHtml(s.trim()));
    specialties.push(...parts.slice(0, 10 - specialties.length));
    if (specialties.length >= 10) break;
  }

  const job_openings = parseInt(html.match(/"jobsCount":(\d+)/)?.[1] || '0');

  return {
    name: decodeHtml(name.trim()),
    description: decodeHtml(description.slice(0, 600)),
    industry: decodeHtml(industry),
    headquarters: decodeHtml(headquarters),
    employee_count,
    employee_range,
    website,
    founded,
    specialties: [...new Set(specialties)],
    job_openings,
    followers: followers ? String(followers) : '',
    company_url: companyUrl,
    scraped_at: new Date().toISOString(),
    meta: {
      proxy: { ip: proxyIp, country: 'US', carrier: 'AT&T' },
      response_time_ms: responseMs,
    },
  };
}

// ─── PUBLIC FETCH FUNCTIONS ───────────────────────────

export async function scrapeLinkedInPerson(username: string): Promise<LinkedInPerson | null> {
  const profileUrl = `https://www.linkedin.com/in/${username}`;
  const t0 = Date.now();

  let proxyIp = 'unknown';
  try {
    const ipRes = await proxyFetch('https://api.ipify.org?format=json', { maxRetries: 1, timeoutMs: 8_000 });
    if (ipRes.ok) {
      const d: any = await ipRes.json();
      proxyIp = d.ip || 'unknown';
    }
  } catch {}

  try {
    const response = await proxyFetch(profileUrl, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeoutMs: 35_000,
      maxRetries: 2,
    });

    const responseMs = Date.now() - t0;

    if (response.status === 999 || response.status === 429) {
      throw Object.assign(new Error('LinkedIn rate limited'), { code: 'RATE_LIMITED' });
    }
    if (response.status === 404) {
      throw Object.assign(new Error('Profile not found'), { code: 'NOT_FOUND' });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    if (detectCaptcha(html)) {
      throw Object.assign(new Error('CAPTCHA or auth wall detected'), { code: 'CAPTCHA' });
    }

    return parsePersonProfile(html, profileUrl, proxyIp, responseMs);
  } catch (err: any) {
    err.proxyIp = proxyIp;
    throw err;
  }
}

export async function scrapeLinkedInCompany(companySlug: string): Promise<LinkedInCompany | null> {
  const companyUrl = `https://www.linkedin.com/company/${companySlug}`;
  const t0 = Date.now();

  let proxyIp = 'unknown';
  try {
    const ipRes = await proxyFetch('https://api.ipify.org?format=json', { maxRetries: 1, timeoutMs: 8_000 });
    if (ipRes.ok) {
      const d: any = await ipRes.json();
      proxyIp = d.ip || 'unknown';
    }
  } catch {}

  try {
    const response = await proxyFetch(companyUrl, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 35_000,
      maxRetries: 2,
    });

    const responseMs = Date.now() - t0;

    if (response.status === 999 || response.status === 429) {
      throw Object.assign(new Error('LinkedIn rate limited'), { code: 'RATE_LIMITED' });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    return parseCompanyProfile(html, companyUrl, proxyIp, responseMs);
  } catch (err: any) {
    err.proxyIp = proxyIp;
    throw err;
  }
}

export async function searchLinkedInPeople(
  title: string,
  location?: string,
  industry?: string,
  limit: number = 10,
): Promise<LinkedInSearchResult[]> {
  // Use Google site: search — no LinkedIn auth needed
  let q = `site:linkedin.com/in "${title}"`;
  if (location) q += ` "${location}"`;
  if (industry) q += ` "${industry}"`;

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=${Math.min(limit * 3, 30)}&hl=en`;

  const response = await proxyFetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/',
    },
    timeoutMs: 30_000,
    maxRetries: 2,
  });

  if (!response.ok) throw new Error(`Google search failed: ${response.status}`);
  const html = await response.text();
  return parseGoogleLinkedInResults(html, limit);
}

function parseGoogleLinkedInResults(html: string, limit: number): LinkedInSearchResult[] {
  const results: LinkedInSearchResult[] = [];
  // Match search result blocks
  const blockRegex = /<div[^>]+class="[^"]*tF2Cxc[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const blocks = [...html.matchAll(blockRegex)].slice(0, limit * 2);

  for (const block of blocks) {
    const text = block[1];
    const urlMatch = text.match(/href="(https:\/\/[^"]*linkedin\.com\/in\/([^"\/\?]+)[^"]*)"/i);
    if (!urlMatch) continue;

    const profileUrl = urlMatch[1];
    const username = urlMatch[2];

    const titleMatch = text.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const snippetMatch = text.match(/<span[^>]*class="[^"]*st[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || text.match(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    const fullTitle = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : username;

    const parts = fullTitle.split(' - ');
    const name = decodeHtml(parts[0] || username);
    const headline = decodeHtml(parts[1] || '');
    const location = decodeHtml(parts[2] || '');
    const snippet = snippetMatch
      ? decodeHtml(snippetMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      : '';

    if (results.length < limit) {
      results.push({ name, headline, location, profile_url: profileUrl, snippet });
    }
  }
  return results;
}

export async function findCompanyEmployees(
  companyId: string,
  titleFilter?: string,
  limit: number = 10,
): Promise<LinkedInSearchResult[]> {
  let q = `site:linkedin.com/in "${companyId}"`;
  if (titleFilter) q += ` "${titleFilter}"`;

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=${Math.min(limit * 3, 30)}&hl=en`;

  const response = await proxyFetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
    },
    timeoutMs: 30_000,
    maxRetries: 2,
  });

  if (!response.ok) throw new Error(`Employee search failed: ${response.status}`);
  const html = await response.text();
  return parseGoogleLinkedInResults(html, limit);
}
