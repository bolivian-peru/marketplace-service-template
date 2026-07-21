/**
 * Job Market Intelligence Scraper (Bounty #16)
 * ───────────────────────────────────────────
 * Extracts job listings from Indeed + LinkedIn.
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';

export type SalaryPeriod = 'hour' | 'year' | 'month' | 'week' | 'day' | null;

export interface ParsedSalary {
  raw: string;
  currency: 'USD' | string;
  period: SalaryPeriod;
  min: number | null;
  max: number | null;
  competitive: boolean;
}

export interface JobListing {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  salary_parsed?: ParsedSalary | null;
  date: string | null;
  link: string;
  platform: 'Indeed' | 'LinkedIn';
  remote: boolean;
}

function normalizeMoneyNumber(n: string): number {
  const cleaned = n.replace(/[$,\s]/g, '');
  return cleaned.includes('.') ? Math.round(parseFloat(cleaned)) : parseInt(cleaned, 10);
}

export function parseSalary(raw: string | null): ParsedSalary | null {
  if (!raw) return null;
  const s = decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const lower = s.toLowerCase();
  const competitive = /competitive|doe|depends|not disclosed/.test(lower);

  // Period hints
  let period: SalaryPeriod = null;
  if (/\bper\s*hour\b|\bhr\b|\/hour/.test(lower)) period = 'hour';
  else if (/\bper\s*year\b|\/year|\byr\b|ann?u?al/.test(lower)) period = 'year';
  else if (/\bper\s*month\b|\/month/.test(lower)) period = 'month';
  else if (/\bper\s*week\b|\/week/.test(lower)) period = 'week';
  else if (/\bper\s*day\b|\/day/.test(lower)) period = 'day';

  // Extract numbers (supports $120K, $120,000, 120k)
  const nums: number[] = [];
  const re = /(\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[kK]?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    let token = m[1].trim();
    const isK = /[kK]$/.test(token);
    token = token.replace(/[kK]$/, '');
    let val = normalizeMoneyNumber(token);
    if (isK) val = val * 1000;
    if (!Number.isNaN(val)) nums.push(val);
  }

  let min: number | null = null;
  let max: number | null = null;
  if (nums.length === 1) {
    min = nums[0];
    max = nums[0];
  } else if (nums.length >= 2) {
    min = Math.min(nums[0], nums[1]);
    max = Math.max(nums[0], nums[1]);
  }

  return {
    raw: s,
    currency: 'USD',
    period,
    min,
    max,
    competitive,
  };
}

export async function scrapeIndeed(query: string, location: string = 'Remote', limit: number = 20): Promise<JobListing[]> {
  const searchTerm = encodeURIComponent(query);
  const searchLoc = encodeURIComponent(location);
  const url = `https://www.indeed.com/jobs?q=${searchTerm}&l=${searchLoc}`;

  const response = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Indeed fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseIndeedHtml(html).slice(0, limit);
}

function parseIndeedHtml(html: string): JobListing[] {
  const listings: JobListing[] = [];

  // Indeed markup changes often. We anchor on data-jk and common classnames.
  // Salary/date are optional.
  const jobCardPattern = /data-jk="([^"]+)"[\s\S]*?class="jobTitle[^>]*>([\s\S]*?)<\/h2>[\s\S]*?class="companyName[^>]*>([\s\S]*?)<\/span>[\s\S]*?class="companyLocation[^>]*>([\s\S]*?)<\/div>(?:[\s\S]*?class="salary-section[^>]*>([\s\S]*?)<\/div>)?(?:[\s\S]*?class="date"[^>]*>([\s\S]*?)<\/span>)?/g;

  let match: RegExpExecArray | null;
  while ((match = jobCardPattern.exec(html)) !== null) {
    const jk = match[1];
    const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
    const company = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, '').trim());
    const location = decodeHtmlEntities(match[4].replace(/<[^>]+>/g, '').trim());
    const salary = match[5] ? decodeHtmlEntities(match[5].replace(/<[^>]+>/g, '').trim()) : null;
    const date = match[6] ? decodeHtmlEntities(match[6].replace(/<[^>]+>/g, '').trim()) : null;

    listings.push({
      title,
      company,
      location,
      salary,
      salary_parsed: parseSalary(salary),
      date,
      link: `https://www.indeed.com/viewjob?jk=${jk}`,
      platform: 'Indeed',
      remote: /remote/i.test(location),
    });
  }

  return listings;
}

export async function scrapeLinkedIn(query: string, location: string = 'United States', limit: number = 20): Promise<JobListing[]> {
  const searchTerm = encodeURIComponent(query);
  const searchLoc = encodeURIComponent(location);
  const url = `https://www.linkedin.com/jobs/search?keywords=${searchTerm}&location=${searchLoc}`;

  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`LinkedIn fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseLinkedInHtml(html).slice(0, limit);
}

function parseLinkedInHtml(html: string): JobListing[] {
  const listings: JobListing[] = [];

  const cardPattern = /class="base-card[^>]*>[\s\S]*?class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>[\s\S]*?href="([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html)) !== null) {
    const title = decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim());
    const company = decodeHtmlEntities(match[2].replace(/\s+/g, ' ').trim());
    const location = decodeHtmlEntities(match[3].replace(/\s+/g, ' ').trim());
    const link = match[4].split('?')[0];

    listings.push({
      title,
      company,
      location,
      salary: null,
      salary_parsed: null,
      date: null,
      link,
      platform: 'LinkedIn',
      remote: /remote/i.test(location),
    });
  }

  return listings;
}
