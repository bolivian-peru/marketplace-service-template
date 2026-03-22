/**
 * Mobile Proxy Helper — Multi-Proxy Pool Rotation
 * ────────────────────────────────────────────────
 * Verbatim from marketplace-service-template, unchanged.
 */

export interface ProxyConfig {
  url: string;
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

let proxyPool: ProxyConfig[] | null = null;
let proxyIndex = 0;

function initPool(): ProxyConfig[] {
  if (proxyPool) return proxyPool;

  const list = process.env.PROXY_LIST;
  if (list) {
    proxyPool = list.split(';').filter(Boolean).map(entry => {
      const [host, port, user, pass, country] = entry.split(':');
      return {
        url: `http://${user}:${pass}@${host}:${port}`,
        host,
        port: parseInt(port),
        user,
        pass,
        country: country || 'US',
      };
    });
    console.log(`[PROXY] Loaded ${proxyPool.length} proxies from PROXY_LIST`);
    return proxyPool;
  }

  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_HTTP_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port || !user || !pass) {
    throw new Error(
      'Proxy not configured. Set PROXY_LIST or PROXY_HOST/PROXY_HTTP_PORT/PROXY_USER/PROXY_PASS in .env.'
    );
  }

  proxyPool = [{
    url: `http://${user}:${pass}@${host}:${port}`,
    host,
    port: parseInt(port),
    user,
    pass,
    country: process.env.PROXY_COUNTRY || 'US',
  }];
  return proxyPool;
}

export function getProxy(): ProxyConfig {
  const pool = initPool();
  const proxy = pool[proxyIndex % pool.length];
  proxyIndex++;
  return proxy;
}

export async function proxyFetch(
  url: string,
  options: ProxyFetchOptions = {},
): Promise<Response> {
  const { maxRetries = 2, timeoutMs = 30_000, ...fetchOptions } = options;

  const defaultHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  let lastError: Error | null = null;
  const pool = initPool();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const proxy = pool[proxyIndex % pool.length];
    proxyIndex++;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...fetchOptions,
        headers: { ...defaultHeaders, ...fetchOptions.headers as Record<string, string> },
        signal: controller.signal,
        // @ts-ignore — Bun supports proxy natively
        proxy: proxy.url,
      });

      clearTimeout(timeout);
      return response;
    } catch (err: any) {
      lastError = err;
      console.error(`[PROXY] Attempt ${attempt + 1} failed via ${proxy.host}:${proxy.port}: ${err.message}`);

      if (pool.length > 1 && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT')) {
        const idx = pool.indexOf(proxy);
        if (idx !== -1) {
          pool.splice(idx, 1);
          console.warn(`[PROXY] Removed dead proxy ${proxy.host}:${proxy.port}, ${pool.length} remaining`);
        }
      }

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  throw new Error(`Proxy fetch failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}
