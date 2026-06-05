import { fetch } from 'undici';

export async function proxyFetch(url: string, options?: RequestInit) {
  const proxyUrl = process.env.PROXY_URL || 'http://localhost:8080';
  return fetch(`${proxyUrl}/${encodeURIComponent(url)}`, options);
}

export async function fetchInstagramProfile(username: string): Promise<any> {
  const url = `https://www.instagram.com/${username}/?__a=1`;
  const response = await proxyFetch(url);
  const data = await response.json();
  return data.graphql.user;
}