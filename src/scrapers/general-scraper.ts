
import { proxyFetch } from '../proxy';
import * as cheerio from 'cheerio';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface GeneralScraperResult {
  title: string | null;
  description: string | null;
  content: string | null;
  url: string;
}

export async function scrapeWebPage(url: string, selector: string): Promise<GeneralScraperResult> {
  const response = await proxyFetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 30_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = $('head title').text() || null;
  const description = $('head meta[name="description"]').attr('content') || null;
  const content = $(selector).text() || null;

  return {
    title,
    description,
    content,
    url,
  };
}
