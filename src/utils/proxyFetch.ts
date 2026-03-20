export async function proxyFetch(url: string, options?: RequestInit) {
  const proxyUrl = `https://api.proxies.sx/v1/x402/fetch?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl, {
    method: options?.method || 'GET',
    headers: options?.headers || {},
    body: options?.body,
  });
  return response;
}