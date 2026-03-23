/**
 * LinkedIn Enrichment API Proof Script
 * ─────────────────────────────────────
 * Demonstrates 10+ consecutive successful LinkedIn profile/company extractions
 * using mobile proxies.
 *
 * Usage:
 *   bun run proof:linkedin -- "tesla" company 10
 *   bun run proof:linkedin -- "elon-musk" person 10
 *   bun run proof:linkedin -- "CTO" search "San Francisco" 10
 */

import { scrapeLinkedInPerson, scrapeLinkedInCompany, searchLinkedInPeople, findCompanyEmployees } from '../src/scrapers/linkedin-enrichment';
import { getProxy, proxyFetch } from '../src/proxy';

async function getExitIp() {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j: any = await r.json();
    return typeof j?.ip === 'string' ? j.ip : null;
  } catch {
    return null;
  }
}

// Sample LinkedIn profiles for testing
const SAMPLE_PROFILES = [
  'elon-musk',
  'satyanadella',
  'sundarpichai',
  'timcook',
  'jeffweiner',
  'reidhoffman',
  'marcbenioff',
  'danielhouston',
  'johnson',
  'smith',
];

const SAMPLE_COMPANIES = [
  'tesla',
  'microsoft',
  'google',
  'apple',
  'linkedin',
  'salesforce',
  'amazon',
  'meta',
  'netflix',
  'uber',
];

async function testPersonProfile(username: string) {
  try {
    const person = await scrapeLinkedInPerson(username);
    return {
      ok: person !== null,
      data: person,
      error: person ? null : 'Failed to scrape profile',
    };
  } catch (e: any) {
    return {
      ok: false,
      data: null,
      error: e?.message || String(e),
    };
  }
}

async function testCompanyProfile(companyName: string) {
  try {
    const company = await scrapeLinkedInCompany(companyName);
    return {
      ok: company !== null,
      data: company,
      error: company ? null : 'Failed to scrape company',
    };
  } catch (e: any) {
    return {
      ok: false,
      data: null,
      error: e?.message || String(e),
    };
  }
}

async function testPeopleSearch(title: string, location?: string) {
  try {
    const results = await searchLinkedInPeople(title, location);
    return {
      ok: results.length > 0,
      data: results,
      error: results.length === 0 ? 'No results found' : null,
    };
  } catch (e: any) {
    return {
      ok: false,
      data: null,
      error: e?.message || String(e),
    };
  }
}

async function testEmployeeSearch(companyId: string, titleFilter?: string) {
  try {
    const results = await findCompanyEmployees(companyId, titleFilter);
    return {
      ok: results.length > 0,
      data: results,
      error: results.length === 0 ? 'No employees found' : null,
    };
  } catch (e: any) {
    return {
      ok: false,
      data: null,
      error: e?.message || String(e),
    };
  }
}

async function main() {
  const [mode = 'all', arg1 = '', arg2 = '', runsRaw = '10'] = process.argv.slice(2);
  const runs = Math.max(1, Math.min(parseInt(runsRaw, 10) || 10, 50));

  const proxy = getProxy();
  const ip = await getExitIp();

  console.log(`🔍 LinkedIn Enrichment API Proof`);
  console.log(`   Mode: ${mode}`);
  console.log(`   Proxy: ${proxy.host}:${proxy.port} (${proxy.country})`);
  console.log(`   Exit IP: ${ip || 'unknown'}`);
  console.log(`   Runs: ${runs}`);
  console.log();

  const all: any[] = [];
  let successCount = 0;

  if (mode === 'person' || mode === 'all') {
    console.log('📌 Testing Person Profiles...');
    const profiles = arg1 && mode === 'person' ? [arg1] : SAMPLE_PROFILES.slice(0, runs);
    
    for (let i = 0; i < profiles.length; i++) {
      const username = profiles[i];
      const startedAt = new Date().toISOString();
      
      try {
        const result = await testPersonProfile(username);
        successCount += result.ok ? 1 : 0;
        all.push({
          type: 'person',
          i,
          username,
          startedAt,
          ...result,
        });
        console.log(`   ${result.ok ? '✅' : '❌'} ${username} - ${result.ok ? 'OK' : result.error}`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (e: any) {
        all.push({
          type: 'person',
          i,
          username,
          startedAt,
          ok: false,
          error: e?.message || String(e),
        });
        console.log(`   ❌ ${username} - ${e?.message || String(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log();
  }

  if (mode === 'company' || mode === 'all') {
    console.log('🏢 Testing Company Profiles...');
    const companies = arg1 && mode === 'company' ? [arg1] : SAMPLE_COMPANIES.slice(0, runs);
    
    for (let i = 0; i < companies.length; i++) {
      const companyName = companies[i];
      const startedAt = new Date().toISOString();
      
      try {
        const result = await testCompanyProfile(companyName);
        successCount += result.ok ? 1 : 0;
        all.push({
          type: 'company',
          i,
          company: companyName,
          startedAt,
          ...result,
        });
        console.log(`   ${result.ok ? '✅' : '❌'} ${companyName} - ${result.ok ? 'OK' : result.error}`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (e: any) {
        all.push({
          type: 'company',
          i,
          company: companyName,
          startedAt,
          ok: false,
          error: e?.message || String(e),
        });
        console.log(`   ❌ ${companyName} - ${e?.message || String(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log();
  }

  if (mode === 'search' || mode === 'all') {
    console.log('🔎 Testing People Search...');
    const searches = [
      { title: 'CTO', location: 'San Francisco' },
      { title: 'Software Engineer', location: 'New York' },
      { title: 'Product Manager', location: 'Seattle' },
      { title: 'Data Scientist', location: 'Boston' },
      { title: 'Designer', location: 'Austin' },
    ];
    
    for (let i = 0; i < Math.min(searches.length, runs); i++) {
      const { title, location } = searches[i];
      const startedAt = new Date().toISOString();
      
      try {
        const result = await testPeopleSearch(title, location);
        successCount += result.ok ? 1 : 0;
        all.push({
          type: 'search',
          i,
          title,
          location,
          startedAt,
          ...result,
        });
        console.log(`   ${result.ok ? '✅' : '❌'} ${title} in ${location} - ${result.ok ? `${result.data?.length} results` : result.error}`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (e: any) {
        all.push({
          type: 'search',
          i,
          title,
          location,
          startedAt,
          ok: false,
          error: e?.message || String(e),
        });
        console.log(`   ❌ ${title} in ${location} - ${e?.message || String(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log();
  }

  if (mode === 'employees' || mode === 'all') {
    console.log('👥 Testing Employee Search...');
    const employeeSearches = [
      { company: 'google', title: 'engineer' },
      { company: 'microsoft', title: 'developer' },
      { company: 'amazon', title: 'manager' },
    ];
    
    for (let i = 0; i < Math.min(employeeSearches.length, runs); i++) {
      const { company, title } = employeeSearches[i];
      const startedAt = new Date().toISOString();
      
      try {
        const result = await testEmployeeSearch(company, title);
        successCount += result.ok ? 1 : 0;
        all.push({
          type: 'employees',
          i,
          company,
          title,
          startedAt,
          ...result,
        });
        console.log(`   ${result.ok ? '✅' : '❌'} ${company} ${title} - ${result.ok ? `${result.data?.length} results` : result.error}`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (e: any) {
        all.push({
          type: 'employees',
          i,
          company,
          title,
          startedAt,
          ok: false,
          error: e?.message || String(e),
        });
        console.log(`   ❌ ${company} ${title} - ${e?.message || String(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log();
  }

  const payload = {
    mode,
    runs: all.length,
    successCount,
    failureCount: all.length - successCount,
    successRate: `${((successCount / all.length) * 100).toFixed(1)}%`,
    proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
    results: all,
    generatedAt: new Date().toISOString(),
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync('listings', { recursive: true });
  const outPath = path.join('listings', `linkedin-proof-${mode}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  
  console.log('═══════════════════════════════════════════');
  console.log(`📊 Summary:`);
  console.log(`   Total: ${all.length}`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Failure: ${all.length - successCount}`);
  console.log(`   Success Rate: ${payload.successRate}`);
  console.log(`   Proof: ${outPath}`);
  console.log('═══════════════════════════════════════════');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
