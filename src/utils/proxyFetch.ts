export async function proxyFetch(url: string, options?: RequestInit) {
  const proxyUrl = `https://api.proxies.sx/v1/x402/fetch`;
  const proxyOptions = {
    ...options,
    headers: { ...options?.headers, 'Proxy-Country': 'US', 'Proxy-Carrier': 'T-Mobile' }
  };
  const response = await fetch(proxyUrl, { ...proxyOptions, body: JSON.stringify({ url: url }) });
  return response;
}