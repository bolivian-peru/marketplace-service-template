/**
 * ┌─────────────────────────────────────────────────┐
 * │    Job Market Intelligence API                  │
 * │    Aggregates jobs from Indeed + LinkedIn       │
 * │    Returns structured JSON with salary data     │
 * └─────────────────────────────────────────────────┘
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const serviceRouter = new Hono();

// ─── CONFIGURATION ─────────────────────────────────
const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.003;  // $0.003 per listing
const DESCRIPTION = 'Aggregate job listings from Indeed and LinkedIn. Returns structured data with title, company, location, salary, skills, and more.';

const OUTPUT_SCHEMA = {
  input: {
    role: 'string — Job title/role to search (required)',
    location: 'string — City, state, or country (required)',
    company: 'string — Filter by company name (optional)',
    limit: 'number — Max results per platform (default: 10)',
  },
  output: {
    query: '{ role, location, company }',
    results: [{
      platform: 'string — indeed | linkedin',
      title: 'string — Job title',
      company: 'string — Company name',
      location: 'string — Job location',
      salaryRange: '{ min: number, max: number, currency: string, period: string } | null',
      postingDate: 'string — When posted',
      url: 'string — Direct link to listing',
      workType: 'string — remote | hybrid | onsite',
      skills: 'string[] — Required skills extracted',
      applicantCount: 'number | null — Number of applicants',
      description: 'string — Job description snippet',
    }],
    metadata: {
      totalResults: 'number',
      platformBreakdown: '{ indeed: number, linkedin: number }',
      scrapedAt: 'string — ISO timestamp',
    },
  },
};

// ─── HELPER: Parse salary from text ─────────────────
function parseSalary(text: string): { min: number; max: number; currency: string; period: string } | null {
  if (!text) return null;
  
  // Match patterns like "$50,000 - $80,000 a year", "$25 - $35 an hour", "€50K - €70K"
  const patterns = [
    /\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*(?:per|a|an|\/)\s*(year|month|hour|week)/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*(?:per|a|an|\/)\s*(year|month|hour)/i,
    /€\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*€?\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i,
    /£\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*£?\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let min = parseFloat(match[1].replace(/,/g, ''));
      let max = match[2] ? parseFloat(match[2].replace(/,/g, '')) : min;
      const period = match[3]?.toLowerCase() || 'year';
      
      // Handle K notation
      if (text.toLowerCase().includes('k')) {
        if (min < 1000) min *= 1000;
        if (max < 1000) max *= 1000;
      }
      
      const currency = text.includes('€') ? 'EUR' : text.includes('£') ? 'GBP' : 'USD';
      
      return { min, max, currency, period };
    }
  }
  return null;
}

// ─── HELPER: Extract work type ──────────────────────
function extractWorkType(text: string): 'remote' | 'hybrid' | 'onsite' {
  const lower = text.toLowerCase();
  if (lower.includes('remote') || lower.includes('work from home') || lower.includes('wfh')) {
    return 'remote';
  }
  if (lower.includes('hybrid')) {
    return 'hybrid';
  }
  return 'onsite';
}

// ─── HELPER: Extract skills ─────────────────────────
function extractSkills(text: string): string[] {
  const skillPatterns = [
    'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP',
    'React', 'Angular', 'Vue', 'Node.js', 'Django', 'Flask', 'Spring', 'Rails',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform',
    'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
    'Machine Learning', 'AI', 'Deep Learning', 'NLP', 'Computer Vision',
    'Agile', 'Scrum', 'CI/CD', 'Git', 'Linux',
    'Product Management', 'Data Analysis', 'Excel', 'Tableau', 'Power BI',
    'Sales', 'Marketing', 'SEO', 'Google Ads', 'Facebook Ads',
    'Figma', 'Sketch', 'Adobe', 'UI/UX', 'Design',
  ];
  
  const found: string[] = [];
  const lower = text.toLowerCase();
  
  for (const skill of skillPatterns) {
    if (lower.includes(skill.toLowerCase())) {
      found.push(skill);
    }
  }
  
  return [...new Set(found)].slice(0, 10);
}

// ─── SCRAPE INDEED ──────────────────────────────────
async function scrapeIndeed(role: string, location: string, company: string | null, limit: number): Promise<any[]> {
  const query = encodeURIComponent(company ? `${role} ${company}` : role);
  const loc = encodeURIComponent(location);
  const url = `https://www.indeed.com/jobs?q=${query}&l=${loc}&limit=${limit}&vjk=`;
  
  try {
    const response = await proxyFetch(url, { timeoutMs: 30000 });
    const html = await response.text();
    
    const jobs: any[] = [];
    
    // Extract job cards using regex patterns (Indeed uses data attributes)
    const jobCardPattern = /<div[^>]*class="[^"]*job_seen_beacon[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    const titlePattern = /<h2[^>]*class="[^"]*jobTitle[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i;
    const companyPattern = /<span[^>]*data-testid="company-name"[^>]*>([^<]+)<\/span>/i;
    const locationPattern = /<div[^>]*data-testid="text-location"[^>]*>([^<]+)<\/div>/i;
    const salaryPattern = /<div[^>]*class="[^"]*salary-snippet[^"]*"[^>]*>([^<]+)<\/div>/i;
    const datePattern = /<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/span>/i;
    const snippetPattern = /<div[^>]*class="[^"]*job-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
    const jkPattern = /data-jk="([^"]+)"/i;
    
    // Alternative: extract from script tag with job data
    const scriptPattern = /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*({[\s\S]*?});/;
    const scriptMatch = html.match(scriptPattern);
    
    if (scriptMatch) {
      try {
        const data = JSON.parse(scriptMatch[1]);
        const results = data?.metaData?.mosaicProviderJobCardsModel?.results || [];
        
        for (const job of results.slice(0, limit)) {
          const salary = parseSalary(job.extractedSalary?.max ? 
            `$${job.extractedSalary.min} - $${job.extractedSalary.max}` : 
            job.salarySnippet?.text || '');
          
          jobs.push({
            platform: 'indeed',
            title: job.title || 'Unknown',
            company: job.company || 'Unknown',
            location: job.formattedLocation || location,
            salaryRange: salary,
            postingDate: job.formattedRelativeTime || 'Recently',
            url: `https://www.indeed.com/viewjob?jk=${job.jobkey}`,
            workType: extractWorkType(job.remoteLocation ? 'remote' : (job.title + ' ' + (job.snippet || ''))),
            skills: extractSkills(job.snippet || ''),
            applicantCount: null,
            description: (job.snippet || '').substring(0, 300),
          });
        }
      } catch (e) {
        // Fall back to HTML parsing
      }
    }
    
    // Fallback: Parse HTML directly
    if (jobs.length === 0) {
      // Try to find job data in simpler format
      const simpleJobPattern = /<a[^>]*id="job_([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
      let match;
      let count = 0;
      
      while ((match = simpleJobPattern.exec(html)) !== null && count < limit) {
        jobs.push({
          platform: 'indeed',
          title: match[2].trim(),
          company: 'See listing',
          location: location,
          salaryRange: null,
          postingDate: 'Recently',
          url: `https://www.indeed.com/viewjob?jk=${match[1]}`,
          workType: 'onsite',
          skills: [],
          applicantCount: null,
          description: 'Click link for details',
        });
        count++;
      }
    }
    
    return jobs;
  } catch (err: any) {
    console.error(`Indeed scrape error: ${err.message}`);
    return [];
  }
}

// ─── SCRAPE LINKEDIN ────────────────────────────────
async function scrapeLinkedIn(role: string, location: string, company: string | null, limit: number): Promise<any[]> {
  // LinkedIn public jobs API (guest access)
  const keywords = encodeURIComponent(company ? `${role} ${company}` : role);
  const loc = encodeURIComponent(location);
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keywords}&location=${loc}&start=0`;
  
  try {
    const response = await proxyFetch(url, { 
      timeoutMs: 30000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await response.text();
    
    const jobs: any[] = [];
    
    // LinkedIn returns job cards in list items
    const cardPattern = /<li[^>]*>[\s\S]*?<div[^>]*class="[^"]*base-card[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    const titlePattern = /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([^<]+)<\/h3>/i;
    const subtitlePattern = /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i;
    const locationPattern = /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([^<]+)<\/span>/i;
    const datePattern = /<time[^>]*datetime="([^"]+)"[^>]*>/i;
    const linkPattern = /<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i;
    const salaryPattern = /<span[^>]*class="[^"]*job-search-card__salary-info[^"]*"[^>]*>([^<]+)<\/span>/i;
    
    let match;
    let count = 0;
    
    while ((match = cardPattern.exec(html)) !== null && count < limit) {
      const card = match[1];
      
      const titleMatch = card.match(titlePattern);
      const companyMatch = card.match(subtitlePattern);
      const locMatch = card.match(locationPattern);
      const dateMatch = card.match(datePattern);
      const linkMatch = card.match(linkPattern);
      const salaryMatch = card.match(salaryPattern);
      
      if (titleMatch) {
        const title = titleMatch[1].trim();
        const companyName = companyMatch ? companyMatch[1].trim() : 'Unknown';
        const jobLoc = locMatch ? locMatch[1].trim() : location;
        const salaryText = salaryMatch ? salaryMatch[1].trim() : '';
        
        jobs.push({
          platform: 'linkedin',
          title,
          company: companyName,
          location: jobLoc,
          salaryRange: parseSalary(salaryText),
          postingDate: dateMatch ? dateMatch[1] : 'Recently',
          url: linkMatch ? linkMatch[1].split('?')[0] : 'https://linkedin.com/jobs',
          workType: extractWorkType(title + ' ' + jobLoc),
          skills: extractSkills(title),
          applicantCount: null,
          description: `${title} at ${companyName}`,
        });
        count++;
      }
    }
    
    return jobs;
  } catch (err: any) {
    console.error(`LinkedIn scrape error: ${err.message}`);
    return [];
  }
}

// ─── MAIN ENDPOINT ──────────────────────────────────
serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // Step 1: Check for payment
  const payment = extractPayment(c);

  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // Step 2: Verify payment on-chain
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
    }, 402);
  }

  // Step 3: Validate input
  const role = c.req.query('role');
  const location = c.req.query('location');
  const company = c.req.query('company') || null;
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25);

  if (!role || !location) {
    return c.json({ 
      error: 'Missing required parameters: role and location',
      example: '/api/run?role=software+engineer&location=San+Francisco&limit=10'
    }, 400);
  }

  // Step 4: Scrape both platforms
  try {
    const [indeedJobs, linkedinJobs] = await Promise.all([
      scrapeIndeed(role, location, company, limit),
      scrapeLinkedIn(role, location, company, limit),
    ]);

    const allResults = [...indeedJobs, ...linkedinJobs];
    
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      query: { role, location, company },
      results: allResults,
      metadata: {
        totalResults: allResults.length,
        platformBreakdown: {
          indeed: indeedJobs.length,
          linkedin: linkedinJobs.length,
        },
        scrapedAt: new Date().toISOString(),
        proxy: { country: getProxy().country, type: 'mobile' },
      },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Scraping failed',
      message: err.message,
    }, 502);
  }
});

// ─── DEMO ENDPOINT (no payment, for testing) ────────
serviceRouter.get('/demo', async (c) => {
  const role = c.req.query('role') || 'software engineer';
  const location = c.req.query('location') || 'New York';
  const company = c.req.query('company') || null;
  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 10);

  // Demo data for proof of concept
  const demoJobs = [
    {
      platform: 'indeed',
      title: `Senior ${role}`,
      company: company || 'Tech Corp',
      location: location,
      salaryRange: { min: 120000, max: 180000, currency: 'USD', period: 'year' },
      postingDate: '2 days ago',
      url: 'https://indeed.com/viewjob?demo=1',
      workType: 'hybrid',
      skills: ['Python', 'AWS', 'Docker', 'Kubernetes'],
      applicantCount: 47,
      description: `We are looking for a ${role} to join our team in ${location}...`,
    },
    {
      platform: 'linkedin',
      title: role,
      company: company || 'Innovation Labs',
      location: location,
      salaryRange: { min: 100000, max: 150000, currency: 'USD', period: 'year' },
      postingDate: '1 week ago',
      url: 'https://linkedin.com/jobs/view/demo',
      workType: 'remote',
      skills: ['JavaScript', 'React', 'Node.js', 'TypeScript'],
      applicantCount: 123,
      description: `Exciting opportunity for a ${role} at a fast-growing startup...`,
    },
  ];

  return c.json({
    query: { role, location, company },
    results: demoJobs,
    metadata: {
      totalResults: demoJobs.length,
      platformBreakdown: { indeed: 1, linkedin: 1 },
      scrapedAt: new Date().toISOString(),
      note: 'This is demo data. Use /api/run with x402 payment for live results.',
    },
  });
});
