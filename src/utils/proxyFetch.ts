// proxyFetch.ts

export async function proxyFetch(url: string, options?: RequestInit) {
  // Use Proxies.sx proxyFetch() for social sentiment scraping
  const response = await fetch(url, options);
  return response;
}