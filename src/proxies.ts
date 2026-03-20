import { fetch } from 'undici';

export async function proxyFetch(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  });
  return response;
}

// Placeholder for proxy configuration and fetch logic