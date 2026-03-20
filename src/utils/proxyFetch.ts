export async function proxyFetch(url: string, options?: RequestInit) {
  const proxyUrl = process.env.PROXY_URL;
  const proxyAuth = process.env.PROXY_AUTH;

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${proxyAuth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...options }),
  });
  return response;
}