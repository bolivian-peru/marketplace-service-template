import fetch from 'node-fetch';

const PROXY_URL = process.env.PROXY_URL;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

export async function proxyFetch(url: string) {
  const proxyAuth = `${PROXY_USERNAME}:${PROXY_PASSWORD}`;
  const proxyUrl = `${PROXY_URL}/${url}`;
  return fetch(proxyUrl, { headers: { 'Proxy-Authorization': `Basic ${Buffer.from(proxyAuth).toString('base64')}` } });
}