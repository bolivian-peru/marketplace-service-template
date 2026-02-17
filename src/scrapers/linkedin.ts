import { getProxy, proxyFetch } from '../proxy';

export interface LinkedInProxyMeta {
  ip: string | null;
  country: string;
  carrier: string;
  host: string;
  type: 'mobile';
}

export interface LinkedInPersonProfile {
  name: string;
  headline: string;
  location: string;
  current_company: {
    name: string;
    title: string;
    started: string;
  };
  previous_companies: Array<{ name: string; title: string; period: string }>;
  education: Array<{ school: string; degree: string }>;
  skills: string[];
  connections: string;
  profile_url: string;
}

export interface LinkedInCompanyProfile {
  id: string;
  name: string;
  description: string;
  industry: string;
  headquarters: string;
  employee_count: string;
  employee_growth_rate: string;
  job_openings: number;
  tech_stack_signals: string[];
  company_url: string;
}

export interface LinkedInPeopleSearchResult {
  query: {
    title: string;
    location: string;
    industry: string;
    limit: number;
  };
  results: LinkedInPersonProfile[];
}

export interface LinkedInEmployeeSearchResult {
  company_id: string;
  title: string;
  total: number;
  employees: LinkedInPersonProfile[];
}

export interface LinkedInEnrichmentProvider {
  providerName: string;
  isMock: boolean;
  getPersonByUrl(url: string): Promise<LinkedInPersonProfile>;
  getCompanyByUrl(url: string): Promise<LinkedInCompanyProfile>;
  searchPeople(params: { title: string; location: string; industry: string; limit: number }): Promise<LinkedInPeopleSearchResult>;
  getCompanyEmployees(companyId: string, title: string, limit: number): Promise<LinkedInEmployeeSearchResult>;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_CLIENT = parseInt(process.env.LINKEDIN_MAX_REQ_PER_MIN || '12');
const clientRateLimit = new Map<string, { count: number; resetAt: number }>();

const accountStates = new Map<string, { nextAllowedAt: number; failures: number }>();

function clampLimit(v: number, max = 10): number {
  if (!Number.isFinite(v)) return max;
  return Math.min(Math.max(Math.floor(v), 1), max);
}

function seededPick<T>(seed: number, values: T[]): T {
  return values[Math.abs(seed) % values.length]!;
}

function strHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function normalizeLinkedInUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(withProtocol);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

export function checkLinkedInRateLimit(clientIp: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = clientIp || 'unknown';
  const current = clientRateLimit.get(key);
  if (!current || now > current.resetAt) {
    clientRateLimit.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  current.count += 1;
  if (current.count > RATE_LIMIT_MAX_PER_CLIENT) {
    return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  }

  return { allowed: true };
}

export async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (!r.ok) return null;
    const data = await r.json() as any;
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

export async function buildLinkedInMeta(): Promise<LinkedInProxyMeta> {
  const proxy = getProxy();
  return {
    ip: await getProxyExitIp(),
    country: proxy.country,
    carrier: process.env.PROXY_CARRIER || 'unknown-mobile-carrier',
    host: proxy.host,
    type: 'mobile',
  };
}

class MockLinkedInProvider implements LinkedInEnrichmentProvider {
  providerName = 'mock-linkedin-provider';
  isMock = true;

  async getPersonByUrl(url: string): Promise<LinkedInPersonProfile> {
    const profileUrl = normalizeLinkedInUrl(url);
    const seed = strHash(profileUrl);
    return mockPersonFromSeed(seed, profileUrl);
  }

  async getCompanyByUrl(url: string): Promise<LinkedInCompanyProfile> {
    const companyUrl = normalizeLinkedInUrl(url);
    const seed = strHash(companyUrl);
    return mockCompanyFromSeed(seed, companyUrl);
  }

  async searchPeople(params: { title: string; location: string; industry: string; limit: number }): Promise<LinkedInPeopleSearchResult> {
    const limit = clampLimit(params.limit, 10);
    const results: LinkedInPersonProfile[] = [];

    for (let i = 0; i < limit; i++) {
      const url = `https://linkedin.com/in/${slugify(`${params.title}-${params.location}-${params.industry}-${i}`)}`;
      results.push(mockPersonFromSeed(strHash(url), url, {
        headline: `${params.title} in ${params.industry}`,
        location: params.location,
      }));
    }

    return { query: { ...params, limit }, results };
  }

  async getCompanyEmployees(companyId: string, title: string, limit: number): Promise<LinkedInEmployeeSearchResult> {
    const safeLimit = clampLimit(limit, 25);
    const employees: LinkedInPersonProfile[] = [];

    for (let i = 0; i < safeLimit; i++) {
      const url = `https://linkedin.com/in/${slugify(`${companyId}-${title}-${i}`)}`;
      employees.push(mockPersonFromSeed(strHash(url), url, {
        headline: `${title} at ${companyId}`,
      }));
    }

    return {
      company_id: companyId,
      title,
      total: employees.length,
      employees,
    };
  }
}

class LiveLinkedInProvider implements LinkedInEnrichmentProvider {
  providerName = 'live-linkedin-html-provider';
  isMock = false;
  private sessionPool: string[];

  constructor() {
    this.sessionPool = (process.env.LINKEDIN_SESSION_COOKIES || '')
      .split('||')
      .map(v => v.trim())
      .filter(Boolean);

    if (this.sessionPool.length === 0) {
      throw new Error('LINKEDIN_SESSION_COOKIES not configured for live provider');
    }
  }

  private pickSession() {
    const now = Date.now();
    let best = this.sessionPool[0]!;
    let bestAllowed = Number.MAX_SAFE_INTEGER;

    for (const s of this.sessionPool) {
      const state = accountStates.get(s) || { nextAllowedAt: 0, failures: 0 };
      if (state.nextAllowedAt <= now) return s;
      if (state.nextAllowedAt < bestAllowed) {
        best = s;
        bestAllowed = state.nextAllowedAt;
      }
    }

    return best;
  }

  private markSessionResult(session: string, status: number) {
    const current = accountStates.get(session) || { nextAllowedAt: 0, failures: 0 };

    if (status === 429 || status === 999) {
      const failures = current.failures + 1;
      const backoffMs = Math.min(120_000, 2 ** failures * 1_000);
      accountStates.set(session, { failures, nextAllowedAt: Date.now() + backoffMs });
      return;
    }

    if (status >= 200 && status < 400) {
      accountStates.set(session, { failures: 0, nextAllowedAt: 0 });
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const target = normalizeLinkedInUrl(url);
    const session = this.pickSession();

    const response = await proxyFetch(target, {
      headers: {
        Cookie: session,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeoutMs: 25_000,
      maxRetries: 1,
    });

    this.markSessionResult(session, response.status);

    if (!response.ok) {
      throw new Error(`LinkedIn request failed (${response.status})`);
    }

    return response.text();
  }

  async getPersonByUrl(url: string): Promise<LinkedInPersonProfile> {
    const profileUrl = normalizeLinkedInUrl(url);
    const html = await this.fetchHtml(profileUrl);
    return parsePersonFromHtml(profileUrl, html);
  }

  async getCompanyByUrl(url: string): Promise<LinkedInCompanyProfile> {
    const companyUrl = normalizeLinkedInUrl(url);
    const html = await this.fetchHtml(companyUrl);
    return parseCompanyFromHtml(companyUrl, html);
  }

  async searchPeople(params: { title: string; location: string; industry: string; limit: number }): Promise<LinkedInPeopleSearchResult> {
    const limit = clampLimit(params.limit, 10);
    const searchUrl = new URL('https://www.linkedin.com/search/results/people/');
    searchUrl.searchParams.set('keywords', params.title);
    if (params.location) searchUrl.searchParams.set('geoUrn', params.location);

    const html = await this.fetchHtml(searchUrl.toString());
    const profiles = extractProfileUrlsFromSearchHtml(html).slice(0, limit);

    const results = await Promise.all(profiles.map((profileUrl) => this.getPersonByUrl(profileUrl)));
    return {
      query: { ...params, limit },
      results,
    };
  }

  async getCompanyEmployees(companyId: string, title: string, limit: number): Promise<LinkedInEmployeeSearchResult> {
    const safeLimit = clampLimit(limit, 25);
    const target = `https://www.linkedin.com/company/${encodeURIComponent(companyId)}/people/`;
    const html = await this.fetchHtml(target);
    const profileUrls = extractProfileUrlsFromSearchHtml(html).slice(0, safeLimit);
    const employees = await Promise.all(profileUrls.map((u) => this.getPersonByUrl(u)));

    return { company_id: companyId, title, total: employees.length, employees };
  }
}

function parsePersonFromHtml(url: string, html: string): LinkedInPersonProfile {
  const jsonLd = extractJsonLd(html);
  const name = pickFirstString(jsonLd, ['name']) || inferNameFromUrl(url);
  const headline = pickFirstString(jsonLd, ['description']) || extractOgTitle(html) || 'LinkedIn member';
  const location = pickFromRegex(html, /"locationName":"([^"]+)"/i) || 'Unknown';

  return {
    name,
    headline,
    location,
    current_company: {
      name: pickFromRegex(html, /"companyName":"([^"]+)"/i) || 'Unknown Company',
      title: pickFromRegex(html, /"title":"([^"]+)"/i) || headline,
      started: pickFromRegex(html, /"startedOn":"([^"]+)"/i) || 'unknown',
    },
    previous_companies: [],
    education: [],
    skills: extractSkills(html),
    connections: pickFromRegex(html, /"numConnections":(\d+)/i)?.concat('+') || 'N/A',
    profile_url: normalizeLinkedInUrl(url),
  };
}

function parseCompanyFromHtml(url: string, html: string): LinkedInCompanyProfile {
  const jsonLd = extractJsonLd(html);
  const name = pickFirstString(jsonLd, ['name']) || inferCompanyFromUrl(url);
  return {
    id: normalizeLinkedInUrl(url).split('/').pop() || name,
    name,
    description: pickFirstString(jsonLd, ['description']) || extractMetaDescription(html) || 'No description available',
    industry: pickFromRegex(html, /"industry":\{"name":"([^"]+)"/i) || 'Unknown',
    headquarters: pickFromRegex(html, /"headquarter":\{"country":"([^"]+)"/i) || 'Unknown',
    employee_count: pickFromRegex(html, /"staffCount":(\d+)/i) || 'Unknown',
    employee_growth_rate: 'unknown',
    job_openings: Number(pickFromRegex(html, /"jobPostingsCount":(\d+)/i) || 0),
    tech_stack_signals: extractTechStackSignals(html),
    company_url: normalizeLinkedInUrl(url),
  };
}

function extractJsonLd(html: string): any {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1] || 'null');
  } catch {
    return null;
  }
}

function pickFirstString(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

function pickFromRegex(input: string, regex: RegExp): string | null {
  const m = input.match(regex);
  return m?.[1] ? decodeHtml(m[1]) : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/\\u0026/g, '&')
    .replace(/\\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

function extractMetaDescription(html: string): string | null {
  const m = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  return m?.[1] ? decodeHtml(m[1]) : null;
}

function extractOgTitle(html: string): string | null {
  const m = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  return m?.[1] ? decodeHtml(m[1]) : null;
}

function extractSkills(html: string): string[] {
  const candidates = ['Python', 'TypeScript', 'Machine Learning', 'Sales', 'Product Management', 'System Design'];
  return candidates.filter((c) => html.toLowerCase().includes(c.toLowerCase())).slice(0, 8);
}

function extractTechStackSignals(html: string): string[] {
  const candidates = ['AWS', 'GCP', 'Azure', 'Kubernetes', 'React', 'Salesforce', 'Snowflake'];
  const found = candidates.filter((c) => html.toLowerCase().includes(c.toLowerCase()));
  return found.length > 0 ? found : ['not-detected'];
}

function inferNameFromUrl(url: string): string {
  const slug = normalizeLinkedInUrl(url).split('/').pop() || 'member';
  return slug
    .split('-')
    .map((v) => v.charAt(0).toUpperCase() + v.slice(1))
    .join(' ');
}

function inferCompanyFromUrl(url: string): string {
  return inferNameFromUrl(url);
}

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mockPersonFromSeed(seed: number, profileUrl: string, override?: Partial<Pick<LinkedInPersonProfile, 'headline' | 'location'>>): LinkedInPersonProfile {
  const firstNames = ['Jane', 'Alex', 'Taylor', 'Jordan', 'Riley', 'Casey', 'Morgan'];
  const lastNames = ['Smith', 'Lee', 'Patel', 'Garcia', 'Khan', 'Nguyen', 'Brown'];
  const companies = ['TechCorp', 'DataScale', 'Orbit Systems', 'Nimbus Labs', 'Acme AI'];
  const titles = ['Chief Technology Officer', 'VP Engineering', 'Head of Data', 'Staff Engineer', 'Product Lead'];
  const locations = ['San Francisco, CA', 'New York, NY', 'Austin, TX', 'Singapore', 'Sydney, AU'];

  const fullName = `${seededPick(seed, firstNames)} ${seededPick(seed + 7, lastNames)}`;
  const company = seededPick(seed + 13, companies);
  const title = seededPick(seed + 23, titles);
  const location = override?.location || seededPick(seed + 31, locations);

  return {
    name: fullName,
    headline: override?.headline || `${title} at ${company}`,
    location,
    current_company: {
      name: company,
      title,
      started: `${2020 + (seed % 5)}-0${(seed % 9) + 1}`,
    },
    previous_companies: [
      { name: seededPick(seed + 3, companies), title: seededPick(seed + 5, titles), period: '2019-2022' },
      { name: seededPick(seed + 11, companies), title: seededPick(seed + 19, titles), period: '2016-2019' },
    ],
    education: [{ school: 'Stanford University', degree: 'MS Computer Science' }],
    skills: ['Python', 'Machine Learning', 'System Design', 'Leadership'].slice(0, 3 + (seed % 2)),
    connections: seed % 2 === 0 ? '500+' : '200+',
    profile_url: profileUrl,
  };
}

function mockCompanyFromSeed(seed: number, companyUrl: string): LinkedInCompanyProfile {
  const industries = ['SaaS', 'FinTech', 'HealthTech', 'AI Infrastructure', 'Cybersecurity'];
  const hq = ['San Francisco, US', 'London, UK', 'Singapore', 'Berlin, DE', 'Sydney, AU'];

  const name = inferCompanyFromUrl(companyUrl);

  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    description: `${name} builds B2B software products for enterprise customers.`,
    industry: seededPick(seed + 5, industries),
    headquarters: seededPick(seed + 17, hq),
    employee_count: String(50 + (seed % 3000)),
    employee_growth_rate: `${(seed % 40) + 5}% YoY`,
    job_openings: seed % 50,
    tech_stack_signals: ['AWS', 'Kubernetes', 'TypeScript'],
    company_url: companyUrl,
  };
}

function extractProfileUrlsFromSearchHtml(html: string): string[] {
  const urls = new Set<string>();
  const regex = /https:\/\/www\.linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/g;
  const matches = html.match(regex) || [];
  for (const m of matches) {
    urls.add(m.replace(/%2F/g, '/').replace(/\/$/, ''));
  }
  return [...urls];
}

export function getLinkedInProvider(): LinkedInEnrichmentProvider {
  const mode = (process.env.LINKEDIN_PROVIDER || 'mock').toLowerCase();
  if (mode === 'live') return new LiveLinkedInProvider();
  return new MockLinkedInProvider();
}
