import * as cheerio from 'cheerio';

export interface GitHubRepo {
  author: string;
  name: string;
  description: string;
  stars: string;
  forks: string;
  language: string;
  link: string;
}

export async function getGitHubTrending(since: string = 'daily'): Promise<GitHubRepo[]> {
  try {
    const validSince = ['daily', 'weekly', 'monthly'].includes(since) ? since : 'daily';
    const url = `https://github.com/trending?since=${validSince}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub fetch failed: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: GitHubRepo[] = [];

    $('article.Box-row').each((_, element) => {
      const titleEl = $(element).find('h2 a');
      const descEl = $(element).find('p.col-9');
      const starsEl = $(element).find('[href$="/stargazers"]');
      const forksEl = $(element).find('[href$="/forks"]');
      const langEl = $(element).find('[itemprop="programmingLanguage"]');

      const fullRepo = titleEl.attr('href') || '';
      const parts = fullRepo.replace(/^\//, '').split('/');

      if (parts.length >= 2) {
        results.push({
          author: parts[0],
          name: parts[1],
          description: descEl.text().trim() || '',
          stars: starsEl.text().trim().replace(',', ''),
          forks: forksEl.text().trim().replace(',', ''),
          language: langEl.text().trim() || 'Unknown',
          link: `https://github.com${fullRepo}`
        });
      }
    });

    return results;
  } catch (error) {
    console.error("GitHub Scraper Error:", error);
    return [];
  }
}
