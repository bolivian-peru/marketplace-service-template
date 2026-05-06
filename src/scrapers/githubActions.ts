import * as cheerio from 'cheerio';
export interface GitHubAction {
  name: string;
  downloads: string;
  link: string;
}
export async function searchGitHubActions(query: string): Promise<GitHubAction[]> {
  const url = `https://github.com/marketplace?type=actions&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const actions: GitHubAction[] = [];
  $('.Box-row').each((_, el) => {
    actions.push({
      name: $(el).find('h3').text().trim(),
      downloads: $(el).find('.d-inline-block.mt-1').text().trim(),
      link: 'https://github.com' + $(el).find('h3 a').attr('href')
    });
  });
  return actions.slice(0, 10);
}
