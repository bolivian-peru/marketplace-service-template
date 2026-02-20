/**
 * Reddit Intelligence — HTTP Fetching Layer
 * ──────────────────────────────────────────
 * Handles all HTTP requests to Reddit through Proxies.sx mobile proxies.
 * Includes error classification, retry logic, and CAPTCHA detection.
 */

import { proxyFetch, getProxy } from '../../proxy';
import type { RedditProxyMeta } from '../../types';

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

function getRandomUA(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

export class RedditError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 502,
  ) {
    super(message);
    this.name = 'RedditError';
  }
}

/**
 * Fetch a Reddit JSON endpoint through the mobile proxy.
 * Classifies errors into specific types for proper HTTP response codes.
 */
export async function fetchReddit(url: string): Promise<any> {
  console.log(`[REDDIT] Fetching: ${url}`);

  let response: Response;
  try {
    response = await proxyFetch(url, {
      timeoutMs: 30_000,
      maxRetries: 2,
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'application/json, text/html;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'DNT': '1',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    throw new RedditError('proxy_error', `Proxy connection failed: ${err?.message}`, 502);
  }

  if (response.status === 429) {
    throw new RedditError('rate_limited', 'Reddit rate limit exceeded (429). Try again later.', 503);
  }
  if (response.status === 403) {
    throw new RedditError('auth_required', 'Reddit returned 403 — content may require authentication.', 403);
  }
  if (response.status === 404) {
    throw new RedditError('not_found', 'Subreddit or thread not found on Reddit.', 404);
  }
  if (!response.ok) {
    throw new RedditError('http_error', `Reddit returned HTTP ${response.status}`, 502);
  }

  const text = await response.text();
  console.log(`[REDDIT] Response length: ${text.length}`);

  if (text.includes('whoa there, pardner') || text.includes('cdn-cgi/challenge-platform')) {
    throw new RedditError('captcha_detected', 'Reddit CAPTCHA/challenge detected. Mobile proxy may be flagged — try a different region.', 503);
  }

  if (text.includes('"reason": "private"') || text.includes('This community is private')) {
    throw new RedditError('auth_required', 'This subreddit is private.', 403);
  }

  try {
    return JSON.parse(text);
  } catch {
    if (text.includes('<html') && (text.includes('login') || text.includes('Log in'))) {
      throw new RedditError('auth_required', 'Reddit login wall detected — JSON endpoint returned HTML.', 403);
    }
    throw new RedditError('parse_error', 'Reddit returned non-JSON response — may be blocking or serving a challenge page.', 502);
  }
}

/**
 * Get proxy IP for response metadata.
 */
export async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 10_000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

/**
 * Build proxy metadata for response.
 */
export function buildProxyMeta(ip: string | null): RedditProxyMeta {
  const proxy = getProxy();
  return {
    ip,
    country: proxy.country,
    carrier: null,
  };
}
