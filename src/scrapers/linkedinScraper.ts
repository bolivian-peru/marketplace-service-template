import cheerio from 'cheerio';

export async function extractPersonProfile(html: string, titleFilter?: string) {
  const $ = cheerio.load(html);
  const name = $('h1').text().trim();
  const headline = $('h2').text().trim();
  const location = $('span.text-body-small').text().trim();
  const currentCompany = {
    name: $('.pv-entity__secondary-title').first().text().trim(),
    title: $('.pv-entity__primary-title').first().text().trim(),
    started: $('.pv-entity__date-range').first().text().trim().split('–')[0].trim(),
  };
  const previousCompanies = $('.pv-entity__position-group-pager').map((i, el) => ({
    name: $(el).find('.pv-entity__secondary-title').text().trim(),
    title: $(el).find('.pv-entity__primary-title').text().trim(),
    period: $(el).find('.pv-entity__date-range').text().trim(),
  })).get().filter(company => company.title !== currentCompany.title);
  const education = $('.education-section').map((i, el) => ({
    school: $(el).find('.pv-entity__school-name').text().trim(),
    degree: $(el).find('.pv-entity__degree-name').text().trim(),
  })).get();
  const skills = $('.pv-skill-category__name').map((i, el) => $(el).text().trim()).get();
  const connections = $('.pv-top-card--list-bullet').text().trim();
  const profileUrl = $('link[rel="canonical"]').attr('href');
  const meta = {
    proxy: {
      ip: '...', // Placeholder for actual proxy IP
      country: 'US',
      carrier: 'AT&T',
    },
  };

  if (titleFilter && currentCompany.title.toLowerCase() !== titleFilter.toLowerCase()) {
    return [];
  }

  return {
    name,
    headline,
    location,
    current_company: currentCompany,
    previous_companies: previousCompanies,
    education,
    skills,
    connections,
    profile_url: profileUrl,
    meta,
  };
}

export async function extractCompanyProfile(html: string) {
  const $ = cheerio.load(html);
  const description = $('.org-about-us__description').text().trim();
  const employeeCount = $('.org-about-company-module__company-size').text().trim();
  const industry = $('.org-about-company-module__industry').text().trim();
  const headquarters = $('.org-about-company-module__headquarters').text().trim();
  const jobs = $('.jobs-search-results-list').map((i, el) => ({
    title: $(el).find('.base-search-card__title').text().trim(),
    location: $(el).find('.job-search-card__location').text().trim(),
  })).get();
  return {
    description,
    employee_count: employeeCount,
    industry,
    headquarters,
    jobs,
  };
}

export async function searchPeople(title: string, location: string, industry: string) {
  // Placeholder for actual search logic
  return [];
}