/**
 * Mobile Proxy Helper
 * ───────────────────
 * DON'T EDIT THIS FILE. It manages proxy credentials from .env.
 *
 * Features:
 * - Reads credentials from environment variables
 * - Proxy-aware fetch() wrapper with retry logic
 * - Handles proxy failures gracefully
 */

// ─── TYPES ──────────────────────────────────────────

export interface ProxyConfig {
  url: string;         // http://user:pass@host:port
  host: string;
  port: number;
  user: string;
  pass: string;
  country: string;
}

export interface ProxyFetchOptions extends RequestInit {
  maxRetries?: number;
  timeoutMs?: number;
}

// ─── GET PROXY CREDENTIALS ──────────────────────────

/**
 * Read proxy credentials from .env
 * Get credentials from https://client.proxies.sx or via x402 API:
 *   curl https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1
 */
export function getProxy(): ProxyConfig | null {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_HTTP_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  return {
    url: `http://${user}:${pass}@${host}:${port}`,
    host,
    port: parseInt(port),
    user,
    pass,
    country: process.env.PROXY_COUNTRY || 'US',
  };
}

// ─── FETCH THROUGH PROXY ────────────────────────────

/**
 * Fetch a URL through the configured mobile proxy.
 * Includes retry logic for transient proxy failures.
 *
 * @example
 * const response = await proxyFetch('https://example.com');
 * const text = await response.text();
 */
export async function proxyFetch(
  url: string,
  options: ProxyFetchOptions = {},
): Promise<Response> {
  const { maxRetries = 2, timeoutMs = 30_000, ...fetchOptions } = options;
  const proxy = getProxy();

  const defaultHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (!proxy) {
    console.warn('[Proxy] No proxy configured, falling back to direct fetch');
    return fetch(url, {
      ...fetchOptions,
      headers: { ...defaultHeaders, ...fetchOptions.headers as Record<string, string> },
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...fetchOptions,
        headers: { ...defaultHeaders, ...fetchOptions.headers as Record<string, string> },
        signal: controller.signal,
        // @ts-ignore — Bun supports the proxy option natively
        proxy: proxy.url,
      });

      clearTimeout(timeout);
      return response;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        // Wait before retry: 1s, 2s, 4s...
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  throw new Error(`Proxy fetch failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}
