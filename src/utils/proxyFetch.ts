export async function proxyFetch(url: string) {
  const proxyUrl = `https://api.proxies.sx/v1/x402/proxy?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl, {
    headers: {
      'x-api-key': process.env.PROXY_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`Proxy fetch failed: ${response.statusText}`);
  }
  return response;
}