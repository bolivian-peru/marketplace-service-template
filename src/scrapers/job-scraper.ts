/**
 * Job Market Intelligence Scraper
 * ────────────────────────────────
 * Scrapes job listings from Indeed and LinkedIn.
 * Returns structured data: title, company, location, salary, skills, etc.
 */

import { proxyFetch } from '../proxy';

export interface JobListing {
    title: string;
    company: string;
    location: string;
    salaryRange: string | null;
    postingDate: string | null;
    description: string | null;
    requiredSkills: string[];
    workType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
    applicantCount: string | null;
    url: string;
    source: string;
}

export interface JobSearchResult {
    jobs: JobListing[];
    totalFound: number;
    query: string;
    location: string;
    page: number;
}

// ─── INDEED SCRAPER ─────────────────────────────────

function extractSkillsFromText(text: string): string[] {
    const skillPatterns = [
        'python', 'javascript', 'typescript', 'java', 'react', 'node\\.js', 'nodejs',
        'sql', 'aws', 'docker', 'kubernetes', 'git', 'html', 'css', 'c\\+\\+',
        'ruby', 'go', 'golang', 'rust', 'swift', 'kotlin', 'scala', 'php',
        'mongodb', 'postgresql', 'mysql', 'redis', 'elasticsearch',
        'machine learning', 'deep learning', 'nlp', 'computer vision',
        'data science', 'data engineering', 'devops', 'ci/cd',
        'agile', 'scrum', 'rest api', 'graphql', 'microservices',
        'tensorflow', 'pytorch', 'pandas', 'numpy', 'spark',
        'azure', 'gcp', 'linux', 'terraform', 'ansible',
        'figma', 'sketch', 'adobe', 'photoshop', 'illustrator',
    ];
    const found: string[] = [];
    const lower = text.toLowerCase();
    for (const skill of skillPatterns) {
        if (new RegExp(`\\b${skill}\\b`, 'i').test(lower)) {
            found.push(skill.replace(/\\\+/g, '+').replace(/\\\./g, '.'));
        }
    }
    return [...new Set(found)];
}

function detectWorkType(text: string): 'remote' | 'hybrid' | 'onsite' | 'unknown' {
    const lower = text.toLowerCase();
    if (/\bremote\b/.test(lower) && /\bhybrid\b/.test(lower)) return 'hybrid';
    if (/\bfully?\s*remote\b/.test(lower) || /\bwork\s*from\s*home\b/.test(lower)) return 'remote';
    if (/\bhybrid\b/.test(lower)) return 'hybrid';
    if (/\bon[\s-]*site\b/.test(lower) || /\bin[\s-]*office\b/.test(lower)) return 'onsite';
    return 'unknown';
}

export async function scrapeIndeed(
    query: string,
    location: string,
    page: number = 0,
): Promise<JobSearchResult> {
    const start = page * 10;
    const params = new URLSearchParams({
        q: query,
        l: location,
        start: start.toString(),
        fromage: '14', // last 14 days
        sort: 'date',
    });

    const url = `https://www.indeed.com/jobs?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
        },
    });

    if (!response.ok) {
        throw new Error(`Indeed returned ${response.status}`);
    }

    const html = await response.text();
    return parseIndeedHTML(html, query, location, page);
}

function parseIndeedHTML(html: string, query: string, location: string, page: number): JobSearchResult {
    const jobs: JobListing[] = [];

    // Extract job cards using regex patterns for Indeed's structure
    // Indeed uses data attributes and JSON-LD for job data
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const jsonStr = match.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonStr);
            if (data['@type'] === 'JobPosting' || (Array.isArray(data) && data[0]?.['@type'] === 'JobPosting')) {
                const postings = Array.isArray(data) ? data : [data];
                for (const posting of postings) {
                    if (posting['@type'] !== 'JobPosting') continue;
                    const description = posting.description || '';
                    jobs.push({
                        title: posting.title || 'Unknown',
                        company: posting.hiringOrganization?.name || 'Unknown',
                        location: posting.jobLocation?.address?.addressLocality
                            ? `${posting.jobLocation.address.addressLocality}, ${posting.jobLocation.address.addressRegion || ''}`
                            : location,
                        salaryRange: posting.baseSalary
                            ? `${posting.baseSalary.value?.minValue || ''}–${posting.baseSalary.value?.maxValue || ''} ${posting.baseSalary.currency || 'USD'}/${posting.baseSalary.value?.unitText || 'YEAR'}`
                            : null,
                        postingDate: posting.datePosted || null,
                        description: typeof description === 'string' ? description.replace(/<[^>]+>/g, '').slice(0, 500) : null,
                        requiredSkills: extractSkillsFromText(description),
                        workType: detectWorkType(`${posting.title} ${description} ${posting.jobLocationType || ''}`),
                        applicantCount: null,
                        url: posting.url || '',
                        source: 'indeed',
                    });
                }
            }
        } catch {
            // Skip malformed JSON-LD
        }
    }

    // Fallback: parse HTML structure if JSON-LD not found
    if (jobs.length === 0) {
        const cardPattern = /class="[^"]*job_seen_beacon[^"]*"[\s\S]*?<\/td>/g;
        const cards = html.match(cardPattern) || [];
        for (const card of cards.slice(0, 15)) {
            const titleMatch = card.match(/title="([^"]+)"/);
            const companyMatch = card.match(/data-testid="company-name"[^>]*>([^<]+)/);
            const locationMatch = card.match(/data-testid="text-location"[^>]*>([^<]+)/);
            const salaryMatch = card.match(/class="[^"]*salary-snippet[^"]*"[^>]*>([^<]+)/);
            const dateMatch = card.match(/data-testid="myJobsStateDate"[^>]*>([^<]+)/);
            const linkMatch = card.match(/href="(\/rc\/clk\?[^"]+)"/);

            if (titleMatch) {
                const fullText = card.replace(/<[^>]+>/g, ' ');
                jobs.push({
                    title: titleMatch[1],
                    company: companyMatch?.[1]?.trim() || 'Unknown',
                    location: locationMatch?.[1]?.trim() || location,
                    salaryRange: salaryMatch?.[1]?.trim() || null,
                    postingDate: dateMatch?.[1]?.trim() || null,
                    description: null,
                    requiredSkills: extractSkillsFromText(fullText),
                    workType: detectWorkType(fullText),
                    applicantCount: null,
                    url: linkMatch ? `https://www.indeed.com${linkMatch[1]}` : '',
                    source: 'indeed',
                });
            }
        }
    }

    // Try to extract total count
    const countMatch = html.match(/Page \d+ of ([\d,]+) jobs/);
    const totalFound = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : jobs.length;

    return { jobs, totalFound, query, location, page };
}

// ─── LINKEDIN SCRAPER (Guest/Public) ─────────────────

export async function scrapeLinkedIn(
    query: string,
    location: string,
    page: number = 0,
): Promise<JobSearchResult> {
    const start = page * 25;
    const params = new URLSearchParams({
        keywords: query,
        location: location,
        start: start.toString(),
        f_TPR: 'r1209600', // past 2 weeks
        sortBy: 'DD', // date descending
    });

    const url = `https://www.linkedin.com/jobs/search/?${params.toString()}`;
    const response = await proxyFetch(url, {
        timeoutMs: 45000,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error(`LinkedIn returned ${response.status}`);
    }

    const html = await response.text();
    return parseLinkedInHTML(html, query, location, page);
}

function parseLinkedInHTML(html: string, query: string, location: string, page: number): JobSearchResult {
    const jobs: JobListing[] = [];

    // LinkedIn guest job search uses structured data
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const match of jsonLdMatches) {
        try {
            const jsonStr = match.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonStr);

            const postings = data['@graph']?.filter((i: any) => i['@type'] === 'JobPosting')
                || (data['@type'] === 'JobPosting' ? [data] : [])
                || (Array.isArray(data) ? data.filter((i: any) => i['@type'] === 'JobPosting') : []);

            for (const posting of postings) {
                const description = typeof posting.description === 'string' ? posting.description : '';
                jobs.push({
                    title: posting.title || 'Unknown',
                    company: posting.hiringOrganization?.name || 'Unknown',
                    location: posting.jobLocation?.address?.addressLocality
                        ? `${posting.jobLocation.address.addressLocality}, ${posting.jobLocation.address.addressRegion || ''}`
                        : location,
                    salaryRange: posting.baseSalary
                        ? `${posting.baseSalary.value?.minValue || ''}–${posting.baseSalary.value?.maxValue || ''} ${posting.baseSalary.currency || 'USD'}`
                        : null,
                    postingDate: posting.datePosted || null,
                    description: description.replace(/<[^>]+>/g, '').slice(0, 500) || null,
                    requiredSkills: extractSkillsFromText(description),
                    workType: detectWorkType(`${posting.title} ${description} ${posting.employmentType || ''}`),
                    applicantCount: null,
                    url: posting.url || '',
                    source: 'linkedin',
                });
            }
        } catch {
            // Skip malformed JSON-LD
        }
    }

    // Fallback: HTML card parsing
    if (jobs.length === 0) {
        const cardPattern = /class="[^"]*base-card[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
        const cards = html.match(cardPattern) || [];
        for (const card of cards.slice(0, 25)) {
            const titleMatch = card.match(/class="[^"]*base-search-card__title[^"]*"[^>]*>([^<]+)/);
            const companyMatch = card.match(/class="[^"]*base-search-card__subtitle[^"]*"[\s\S]*?<a[^>]*>([^<]+)/);
            const locationMatch = card.match(/class="[^"]*job-search-card__location[^"]*"[^>]*>([^<]+)/);
            const dateMatch = card.match(/datetime="([^"]+)"/);
            const linkMatch = card.match(/href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"?]+)/);

            if (titleMatch) {
                const fullText = card.replace(/<[^>]+>/g, ' ');
                jobs.push({
                    title: titleMatch[1].trim(),
                    company: companyMatch?.[1]?.trim() || 'Unknown',
                    location: locationMatch?.[1]?.trim() || location,
                    salaryRange: null,
                    postingDate: dateMatch?.[1] || null,
                    description: null,
                    requiredSkills: extractSkillsFromText(fullText),
                    workType: detectWorkType(fullText),
                    applicantCount: null,
                    url: linkMatch?.[1] || '',
                    source: 'linkedin',
                });
            }
        }
    }

    const countMatch = html.match(/([\d,]+)\s*(?:results|jobs)/i);
    const totalFound = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : jobs.length;

    return { jobs, totalFound, query, location, page };
}

// ─── COMBINED SEARCH ────────────────────────────────

export async function searchJobs(
    query: string,
    location: string,
    page: number = 0,
    sources: string[] = ['indeed', 'linkedin'],
): Promise<JobSearchResult> {
    const results: JobListing[] = [];
    let totalFound = 0;
    const errors: string[] = [];

    const promises = sources.map(async (source) => {
        try {
            switch (source) {
                case 'indeed': {
                    const r = await scrapeIndeed(query, location, page);
                    results.push(...r.jobs);
                    totalFound += r.totalFound;
                    break;
                }
                case 'linkedin': {
                    const r = await scrapeLinkedIn(query, location, page);
                    results.push(...r.jobs);
                    totalFound += r.totalFound;
                    break;
                }
                default:
                    errors.push(`Unknown source: ${source}`);
            }
        } catch (err: any) {
            errors.push(`${source}: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);

    // Sort by posting date (most recent first)
    results.sort((a, b) => {
        if (!a.postingDate && !b.postingDate) return 0;
        if (!a.postingDate) return 1;
        if (!b.postingDate) return -1;
        return new Date(b.postingDate).getTime() - new Date(a.postingDate).getTime();
    });

    return {
        jobs: results,
        totalFound,
        query,
        location,
        page,
    };
}
