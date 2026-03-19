import { fetch } from 'undici';

export async function proxyFetch(url: string): Promise<Response> {
  const proxyUrl = process.env.PROXY_URL || 'https://api.proxies.sx/v1/x402/fetch';
  const proxyHeaders = {
    'Authorization': `Bearer ${process.env.PROXY_TOKEN}`,
    'Content-Type': 'application/json',
  };
  const response = await fetch(proxyUrl, { method: 'POST', headers: proxyHeaders, body: JSON.stringify({ url }) });
  return response;
}