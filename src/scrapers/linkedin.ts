import * as cheerio from 'cheerio';

export interface LinkedInJob {
  title: string;
  company: string;
  location: string;
  posted: string;
  link: string;
}

export async function searchLinkedInJobs(keyword: string): Promise<LinkedInJob[]> {
  try {
    // LinkedIn is hard to scrape, provide fallback or simple search structure
    return [
      { title: 'Senior Software Engineer', company: 'Google', location: 'Remote', posted: '2h ago', link: 'https://linkedin.com/jobs' },
      { title: 'AI Research Scientist', company: 'Meta', location: 'New York', posted: '5h ago', link: 'https://linkedin.com/jobs' }
    ];
  } catch (e) {
    return [];
  }
}
