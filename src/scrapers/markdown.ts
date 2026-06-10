/**
 * Web Content Extractor — Direct HTTP → Markdown
 *
 * No proxy dependency. Uses direct fetch with desktop UA.
 * Sites that block datacenter IPs will fail (use Proxies.sx later if needed).
 */

import TurndownService from 'turndown';

const DEFAULT_RULES = {
  headingStyle: 'atx' as const,
  codeBlockStyle: 'fenced' as const,
  bulletListMarker: '-' as const,
  emDelimiter: '_' as const,
  strongDelimiter: '**' as const,
};

const MAX_HTML_BYTES = 5_000_000;
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_TITLE_LENGTH = 300;
const MAX_DESC_LENGTH = 500;
const MAX_URL_LENGTH = 2048;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function sanitizeText(value: string, maxLen: number): string {
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function buildConverter(includeLinks: boolean, includeImages: boolean): TurndownService {
  const td = new TurndownService(DEFAULT_RULES);
  // @ts-ignore — Turndown types are overly strict on the filter array
  td.addRule('strikethrough', {
    filter: ['del', 's'] as any,
    replacement: (content: string) => `~~${content}~~`,
  });
  if (includeLinks) {
    // @ts-ignore
    td.addRule('defaultLink', {
      filter: 'a' as any,
      replacement: (content: string, node: any) => {
        const href = (node.getAttribute && node.getAttribute('href')) || '';
        if (!href || href.startsWith('#')) return content;
        return `[${content}](${href})`;
      },
    });
  } else {
    // @ts-ignore
    td.remove('a' as any);
  }
  if (includeImages) {
    // @ts-ignore
    td.addRule('defaultImage', {
      filter: 'img' as any,
      replacement: (_content: string, node: any) => {
        const src = (node.getAttribute && node.getAttribute('src')) || '';
        const alt = (node.getAttribute && node.getAttribute('alt')) || '';
        if (!src) return '';
        return `![${alt}](${src})`;
      },
    });
  } else {
    // @ts-ignore
    td.remove('img' as any);
  }
  // Strip noise
  // @ts-ignore
  td.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button', 'input']);
  return td;
}

export interface MarkdownResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  title: string;
  description: string;
  contentType: string;
  contentLength: number;
  markdown: string;
  markdownLength: number;
  truncated: boolean;
  fetchDurationMs: number;
  fetchedAt: string;
}

export interface ExtractOptions {
  maxChars?: number;
  includeLinks?: boolean;
  includeImages?: boolean;
  timeoutMs?: number;
}

export async function extractMarkdown(
  url: string,
  options: ExtractOptions = {},
): Promise<MarkdownResult> {
  const {
    maxChars = 50_000,
    includeLinks = true,
    includeImages = true,
    timeoutMs = 30_000,
  } = options;

  // Validate URL
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) {
    throw new Error('URL too long or invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL — must include protocol (https://)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol: ${parsed.protocol} (only http/https)`);
  }
  // SSRF protection
  const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'];
  if (blocked.includes(parsed.hostname) || parsed.hostname.endsWith('.local') || parsed.hostname.endsWith('.internal')) {
    throw new Error('Internal/private URLs not allowed');
  }

  const safeMaxChars = clamp(maxChars, 1000, 200_000);
  const converter = buildConverter(includeLinks, includeImages);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentLengthHeader = parseInt(response.headers.get('content-length') || '0');
    if (contentLengthHeader > MAX_HTML_BYTES) {
      throw new Error(`Content too large: ${contentLengthHeader} bytes (max ${MAX_HTML_BYTES})`);
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_HTML_BYTES) {
      throw new Error(`Content too large: ${body.byteLength} bytes (max ${MAX_HTML_BYTES})`);
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(body);

    let markdown = converter.turndown(html);
    let truncated = false;
    if (markdown.length > safeMaxChars) {
      markdown = markdown.slice(0, safeMaxChars) + `\n\n*[... truncated at ${safeMaxChars} chars ...]*`;
      truncated = true;
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? sanitizeText(titleMatch[1], MAX_TITLE_LENGTH) : '';
    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)
      ?? html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
    const description = descMatch ? sanitizeText(descMatch[1], MAX_DESC_LENGTH) : '';

    return {
      url,
      finalUrl: response.url,
      statusCode: response.status,
      title,
      description,
      contentType: response.headers.get('content-type') || 'unknown',
      contentLength: html.length,
      markdown,
      markdownLength: markdown.length,
      truncated,
      fetchDurationMs: Date.now() - start,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
