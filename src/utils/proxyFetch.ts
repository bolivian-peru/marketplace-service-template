import { fetch } from 'undici';

export async function proxyFetch(url: string) {
  const proxyUrl = process.env.PROXY_URL;
  const proxyAuth = process.env.PROXY_AUTH;

  const response = await fetch(url, {
    headers: {
      'Proxy-Authorization': `Basic ${proxyAuth}`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Mobile/15E148 Safari/604.1'
    },
    agent: new ProxyAgent(proxyUrl)
  });

  return response;
}