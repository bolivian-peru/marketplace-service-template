export interface IndeedJob {
  title: string;
  company: string;
  location: string;
  salary: string;
  link: string;
}
export async function searchIndeedJob(query: string, location: string = 'Remote'): Promise<IndeedJob[]> {
  const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;
  const res = await fetch(url);
  const html = await res.text();
  // Fallback for demo
  return [
    { title: `${query} Developer`, company: 'Tech Corp', location, salary: '$120k - $150k', link: 'https://indeed.com' },
    { title: `Senior ${query} Engineer`, company: 'Startup Inc', location, salary: '$140k - $180k', link: 'https://indeed.com' }
  ];
}
