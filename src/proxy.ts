/**
 * Mobile Proxy Helper
 * ─────────────────────────────────────────
 * DON'T EDIT THIS FILE. It manages proxy credentials from .env.
 *
 * Features:
 * - Reads credentials from environment variables
 * - Proxy-aware fetch() wrapper with retry logic
 * - Handles proxy failures gracefully
 * - Falls back to direct fetch if no proxy configured
 */

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  url: string;          // http://user:pass@host:port
  host: string;
  port: number;
  user: string;
  pass: string;
  country: string;
  configured: boolean;  // false = no proxy, direct fetch
}

export interface ProxyFetchOptions extends RequestInit {
  maxRetries?: number;
  timeoutMs?: number;
}

// ─── GET PROXY CREDENTIALS ──────────────────────────────────────────────────

/**
 * Read proxy credentials from .env
 * Returns a config with configured=false if no proxy vars are set (service runs direct).
 * Get credentials from https://client.proxies.sx or via x402 API:
 *   curl https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1
 */
export function getProxy(): ProxyConfig {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_HTTP_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port || !user || !pass) {
    // No proxy configured — service runs in direct mode
    return {
      url: '',
      host: '',
      port: 0,
      user: '',
      pass: '',
      country: process.env.PROXY_COUNTRY || 'US',
      configured: false,
    };
  }

  return {
    url: `http://${user}:${pass}@${host}:${port}`,
    host,
    port: parseInt(port),
    user,
    pass,
    country: process.env.PROXY_COUNTRY || 'US',
    configured: true,
  };
}

// ─── FETCH THROUGH PROXY ────────────────────────────────────────────────────

/**
 * Fetch a URL through the configured mobile proxy.
 * Falls back to direct fetch if no proxy is configured.
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

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const fetchInit: any = {
        ...fetchOptions,
        headers: { ...defaultHeaders, ...fetchOptions.headers as Record<string, string> },
        signal: controller.signal,
      };

      // Only set proxy option if credentials are configured
      if (proxy.configured) {
        // @ts-ignore — Bun supports the proxy option natively
        fetchInit.proxy = proxy.url;
      }

      const response = await fetch(url, fetchInit);

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

  throw new Error(`Fetch failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}
