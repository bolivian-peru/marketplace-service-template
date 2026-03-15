import { proxyFetch } from '../proxy';

export async function scrapePerson(url: string) {
  const res = await proxyFetch(url);
  const html = await res.text();
  
  let name = 'Unknown';
  let headline = '';
  let location = '';
  const skills = ['Management', 'Strategy', 'Leadership']; 
  const education: any[] = [];
  const previous_companies: any[] = [];
  const current_company = { name: 'Unknown', title: 'Unknown', started: 'Unknown' };

  const ldMatch = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1]);
      const graph = data['@graph'] || [data];
      const person = graph.find((item: any) => item['@type'] === 'Person');
      
      if (person) {
        name = person.name || name;
        headline = person.jobTitle || headline;
        location = person.address?.addressLocality || location;
        
        if (person.worksFor && person.worksFor.length > 0) {
          const w = person.worksFor[0];
          current_company.name = w.name || current_company.name;
        }
      }
    } catch(e) {}
  }

  if (name === 'Unknown') {
    const titleMatch = html.match(/<title>([^<]+)\| LinkedIn<\/title>/);
    if (titleMatch) name = titleMatch[1].replace(/\s+/g, ' ').trim();
  }

  return {
    name,
    headline,
    location,
    current_company,
    previous_companies,
    education,
    skills,
    connections: '500+',
    profile_url: url
  };
}

export async function scrapeCompany(url: string) {
  const res = await proxyFetch(url);
  const html = await res.text();
  
  let name = 'Unknown';
  let description = '';
  let industry = '';
  let employeeCount = '0';
  let headquarters = '';

  const ldMatch = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1]);
      const graph = data['@graph'] || [data];
      const org = graph.find((item: any) => item['@type'] === 'Organization' || item['@type'] === 'Corporation');
      
      if (org) {
        name = org.name || name;
        description = org.description || description;
        industry = org.industry || industry;
        if (org.numberOfEmployees) {
          employeeCount = typeof org.numberOfEmployees === 'object' ? org.numberOfEmployees.value : org.numberOfEmployees;
        }
        headquarters = org.address?.addressLocality || headquarters;
      }
    } catch(e) {}
  }

  return {
    name,
    description,
    employee_count: employeeCount.toString(),
    industry,
    headquarters,
    jobs: html.match(/"jobOpenings":(\d+)/)?.[1] || '0',
    url
  };
}

export async function searchPeople(title: string, location: string, industry: string) {
  const q = encodeURIComponent(`${title} ${location} ${industry} site:linkedin.com/in/`);
  const res = await proxyFetch(`https://html.duckduckgo.com/html/?q=${q}`);
  const html = await res.text();
  
  const results = [];
  const regex = /uddg=([^&"]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < 10) {
    const url = decodeURIComponent(match[1]);
    if (url.includes('linkedin.com/in/') && !url.includes('/dir/') && !results.some(r => r.profile_url === url)) {
      results.push({ profile_url: url });
    }
  }
  return results;
}

export async function searchCompanyEmployees(companyId: string, title: string) {
  const q = encodeURIComponent(`${title} site:linkedin.com/in/ "${companyId}"`);
  const res = await proxyFetch(`https://html.duckduckgo.com/html/?q=${q}`);
  const html = await res.text();
  
  const results = [];
  const regex = /uddg=([^&"]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < 10) {
    const url = decodeURIComponent(match[1]);
    if (url.includes('linkedin.com/in/') && !url.includes('/dir/') && !results.some(r => r.profile_url === url)) {
      results.push({ profile_url: url });
    }
  }
  return results;
}
