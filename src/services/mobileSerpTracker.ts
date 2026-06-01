import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

/**
 * Interface for a single SERP result.
 */
interface SerpResult {
  title: string;
  url: string;
  description: string;
}

/**
 * Interface for the entire SERP data structure.
 */
interface SerpData {
  keyword: string;
  results: SerpResult[];
}

const GOOGLE_BASE_URL = 'https://www.google.com';

// Crucial: Use a mobile User-Agent string to ensure Google serves mobile-optimized results.
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': MOBILE_USER_AGENT,
  'Accept-Language': 'en-US,en;q=0.9', // Request English content primarily
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Fetches and parses mobile SERP results for a given keyword.
 * This function mimics a mobile browser to ensure mobile-specific results
 * and provides robust parsing for common SERP elements.
 *
 * @param keyword The search keyword.
 * @param location Optional. The geographic location for the search (e.g., 'us', 'gb', 'de').
 *                 This usually influences the Google domain and `hl`/`gl` parameters.
 * @param proxy Optional. A proxy URL (e.g., 'http://user:pass@host:port') to route requests
 *              through, which can help avoid IP blocking and obtain geo-specific results.
 * @returns A promise that resolves to SerpData containing the keyword and an array of search results.
 * @throws Error if the request fails or parsing encounters issues.
 */
export async function getMobileSerpResults(
  keyword: string,
  location: string = 'us', // Default to United States for general purpose
  proxy?: string
): Promise<SerpData> {
  // Construct the Google search URL for mobile.
  // `hl` for interface language, `gl` for geographic location, `pws=0` for no personalization.
  // `uule` can be used for more precise location targeting, but `gl` is often sufficient.
  const searchUrl = `${GOOGLE_BASE_URL}/search?q=${encodeURIComponent(keyword)}&hl=${location}&gl=${location}&pws=0`;

  const axiosConfig: AxiosRequestConfig = {
    headers: DEFAULT_HEADERS,
    timeout: 15000, // Set a reasonable timeout (15 seconds)
  };

  if (proxy) {
    try {
      const proxyUrl = new URL(proxy);
      axiosConfig.proxy = {
        protocol: proxyUrl.protocol.replace(':', ''),
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port, 10),
        auth: proxyUrl.username && proxyUrl.password ? {
          username: proxyUrl.username,
          password: proxyUrl.password,
        } : undefined,
      };
    } catch (e) {
      throw new Error(`Invalid proxy URL provided: ${proxy}. Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const response = await axios.get(searchUrl, axiosConfig);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch mobile SERP for "${keyword}": Status ${response.status} - ${response.statusText}`);
    }

    const $ = cheerio.load(response.data);
    const results: SerpResult[] = [];

    // Common containers for organic search results on Google mobile.
    // These selectors are prone to change and might need frequent updates.
    // Prioritize `.tF2Lb` and `.kCrYT` as they often wrap the main content.
    // `div.g` is more general but still useful.
    $('div.g, .tF2Lb, .kCrYT').each((_i, el) => {
        // Find title, URL, and description within each result container element.
        const titleElement = $(el).find('h3').first();
        // Look for the main link within the container. Often it's a direct child or
        // within a small path, using a general a[href] and then cleaning is robust.
        const urlElement = $(el).find('a[href]').first();
        // Robustly attempt to find description from several common patterns.
        const descriptionElement = $(el).find('div[data-sncf]').first() ||
                                   $(el).find('span[class*="sP8mVe"]').first() ||
                                   $(el).find('div[role="text"]').filter((_idx, descEl) => $(descEl).text().trim().length > 50).first(); // Heuristic: description should be long enough

        const title = titleElement.text().trim();
        let url = urlElement.attr('href') || '';
        let description = descriptionElement.text().trim();

        // Clean up Google's internal redirect URLs (e.g., /url?q=...)
        if (url.startsWith('/url?q=')) {
          try {
            const parsedUrl = new URL(url, GOOGLE_BASE_URL);
            url = parsedUrl.searchParams.get('q') || url;
          } catch (e) {
            // Keep original URL if parsing fails (unlikely for Google's own redirects)
          }
        }

        // Ensure the URL is absolute, resolve against GOOGLE_BASE_URL for relative paths.
        if (url && !url.startsWith('http')) {
            url = `${GOOGLE_BASE_URL}${url}`;
        }

        // Only add results that have at least a title and a valid, non-internal URL.
        // A description might be absent, which is acceptable.
        if (title && url && !url.includes('google.com/search')) {
          results.push({ title, url, description });
        }
    });

    return {
      keyword: keyword,
      results: results,
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      // Provide more specific error messages for Axios errors to aid debugging.
      if (axiosError.code === 'ECONNABORTED') {
        throw new Error(`Request timed out for "${keyword}". Details: ${axiosError.message}`);
      } else if (axiosError.response) {
        throw new Error(`HTTP Error fetching SERP for "${keyword}": Status ${axiosError.response.status} - ${axiosError.response.statusText}. URL: ${searchUrl}`);
      } else if (axiosError.request) {
        throw new Error(`Network Error fetching SERP for "${keyword}": No response received. Details: ${axiosError.message}`);
      }
    }
    // Fallback for other errors or generic Axios errors not caught above.
    throw new Error(`Error tracking mobile SERP for "${keyword}": ${error.message || String(error)}`);
  }
}