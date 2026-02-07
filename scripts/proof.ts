/**
 * Proof of Concept - Job Market Intelligence API
 * Tests 3+ job titles in 3+ locations with real data
 */

// Job search configurations for proof
const SEARCHES = [
  { role: 'Software Engineer', location: 'San Francisco, CA' },
  { role: 'Software Engineer', location: 'New York, NY' },
  { role: 'Software Engineer', location: 'London, UK' },
  { role: 'Data Scientist', location: 'San Francisco, CA' },
  { role: 'Data Scientist', location: 'Berlin, Germany' },
  { role: 'Data Scientist', location: 'Singapore' },
  { role: 'Product Manager', location: 'New York, NY' },
  { role: 'Product Manager', location: 'Austin, TX' },
  { role: 'Product Manager', location: 'Toronto, Canada' },
];

// Helper: Parse salary from text
function parseSalary(text: string): { min: number; max: number; currency: string; period: string } | null {
  if (!text) return null;
  
  const patterns = [
    /\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*(?:per|a|an|\/)\s*(year|month|hour|week)/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i,
    /£\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*£?\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i,
    /€\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*€?\s*([\d,]+(?:\.\d+)?)\s*[kK]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let min = parseFloat(match[1].replace(/,/g, ''));
      let max = match[2] ? parseFloat(match[2].replace(/,/g, '')) : min;
      const period = match[3]?.toLowerCase() || 'year';
      
      if (text.toLowerCase().includes('k') && min < 1000) {
        min *= 1000;
        max *= 1000;
      }
      
      const currency = text.includes('€') ? 'EUR' : text.includes('£') ? 'GBP' : 'USD';
      return { min, max, currency, period };
    }
  }
  return null;
}

// Scrape Indeed (direct, no proxy for demo)
async function scrapeIndeed(role: string, location: string): Promise<any[]> {
  const query = encodeURIComponent(role);
  const loc = encodeURIComponent(location);
  const url = `https://www.indeed.com/jobs?q=${query}&l=${loc}&limit=15`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await response.text();
    
    const jobs: any[] = [];
    
    // Try to extract from mosaic provider data
    const scriptPattern = /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*({[\s\S]*?});/;
    const scriptMatch = html.match(scriptPattern);
    
    if (scriptMatch) {
      try {
        const data = JSON.parse(scriptMatch[1]);
        const results = data?.metaData?.mosaicProviderJobCardsModel?.results || [];
        
        for (const job of results.slice(0, 5)) {
          const salaryText = job.extractedSalary?.max ? 
            `$${job.extractedSalary.min} - $${job.extractedSalary.max}` : 
            job.salarySnippet?.text || '';
            
          jobs.push({
            platform: 'indeed',
            title: job.title || 'Unknown',
            company: job.company || 'Unknown',
            location: job.formattedLocation || location,
            salaryRange: parseSalary(salaryText),
            postingDate: job.formattedRelativeTime || 'Recently',
            url: `https://www.indeed.com/viewjob?jk=${job.jobkey}`,
            workType: job.remoteLocation ? 'remote' : 'onsite',
            description: (job.snippet || '').substring(0, 200),
          });
        }
      } catch (e) {
        console.error('Indeed JSON parse error:', e);
      }
    }
    
    return jobs;
  } catch (err: any) {
    console.error(`Indeed error for ${role} in ${location}: ${err.message}`);
    return [];
  }
}

// Scrape LinkedIn guest jobs API
async function scrapeLinkedIn(role: string, location: string): Promise<any[]> {
  const keywords = encodeURIComponent(role);
  const loc = encodeURIComponent(location);
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keywords}&location=${loc}&start=0`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html',
      }
    });
    const html = await response.text();
    
    const jobs: any[] = [];
    
    // Parse job cards
    const titlePattern = /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([^<]+)<\/h3>/gi;
    const companyPattern = /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
    const locationPattern = /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([^<]+)<\/span>/gi;
    const linkPattern = /<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/gi;
    
    const titles: string[] = [];
    const companies: string[] = [];
    const locations: string[] = [];
    const links: string[] = [];
    
    let match;
    while ((match = titlePattern.exec(html)) !== null) titles.push(match[1].trim());
    while ((match = companyPattern.exec(html)) !== null) companies.push(match[1].trim());
    while ((match = locationPattern.exec(html)) !== null) locations.push(match[1].trim());
    while ((match = linkPattern.exec(html)) !== null) links.push(match[1].split('?')[0]);
    
    for (let i = 0; i < Math.min(titles.length, 5); i++) {
      jobs.push({
        platform: 'linkedin',
        title: titles[i] || 'Unknown',
        company: companies[i] || 'Unknown',
        location: locations[i] || location,
        salaryRange: null, // LinkedIn rarely shows salary in list view
        postingDate: 'Recently',
        url: links[i] || 'https://linkedin.com/jobs',
        workType: titles[i]?.toLowerCase().includes('remote') ? 'remote' : 'onsite',
        description: `${titles[i]} at ${companies[i]}`,
      });
    }
    
    return jobs;
  } catch (err: any) {
    console.error(`LinkedIn error for ${role} in ${location}: ${err.message}`);
    return [];
  }
}

// Main proof function
async function runProof() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   JOB MARKET INTELLIGENCE API - PROOF OF CONCEPT');
  console.log('   Testing 3+ job titles in 3+ locations');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const allResults: any[] = [];
  const jobTitles = new Set<string>();
  const locations = new Set<string>();
  
  for (const search of SEARCHES) {
    console.log(`\n🔍 Searching: "${search.role}" in "${search.location}"...`);
    
    const [indeedJobs, linkedinJobs] = await Promise.all([
      scrapeIndeed(search.role, search.location),
      scrapeLinkedIn(search.role, search.location),
    ]);
    
    const combined = [...indeedJobs, ...linkedinJobs];
    
    if (combined.length > 0) {
      jobTitles.add(search.role);
      locations.add(search.location);
      
      console.log(`   ✅ Found ${combined.length} jobs (Indeed: ${indeedJobs.length}, LinkedIn: ${linkedinJobs.length})`);
      
      // Show first 2 results
      for (const job of combined.slice(0, 2)) {
        const salary = job.salaryRange 
          ? `${job.salaryRange.currency} ${job.salaryRange.min.toLocaleString()}-${job.salaryRange.max.toLocaleString()}/${job.salaryRange.period}`
          : 'Not disclosed';
        console.log(`      📋 ${job.title} @ ${job.company}`);
        console.log(`         Location: ${job.location} | Salary: ${salary}`);
        console.log(`         Work: ${job.workType} | Platform: ${job.platform}`);
      }
      
      allResults.push({
        query: search,
        results: combined,
        count: combined.length,
      });
    } else {
      console.log(`   ⚠️  No results (may need proxy for this location)`);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   PROOF SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Job Titles Tested: ${jobTitles.size} (${[...jobTitles].join(', ')})`);
  console.log(`   Locations Tested:  ${locations.size} (${[...locations].join(', ')})`);
  console.log(`   Total Jobs Found:  ${allResults.reduce((sum, r) => sum + r.count, 0)}`);
  console.log(`   Platforms:         Indeed + LinkedIn`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Output JSON proof
  const proofJson = {
    timestamp: new Date().toISOString(),
    summary: {
      jobTitlesTested: [...jobTitles],
      locationsTested: [...locations],
      totalJobsFound: allResults.reduce((sum, r) => sum + r.count, 0),
      platforms: ['indeed', 'linkedin'],
    },
    searches: allResults,
  };
  
  console.log('\n📄 FULL JSON PROOF:\n');
  console.log(JSON.stringify(proofJson, null, 2));
  
  // Save to file
  await Bun.write('./proof-results.json', JSON.stringify(proofJson, null, 2));
  console.log('\n✅ Results saved to proof-results.json');
}

runProof().catch(console.error);
