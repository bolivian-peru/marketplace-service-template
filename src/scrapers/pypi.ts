export interface PyPIPackage {
  name: string;
  version: string;
  summary: string;
  link: string;
}
export async function searchPyPI(query: string): Promise<PyPIPackage[]> {
  const url = `https://pypi.org/search/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const html = await res.text();
  const matches = html.match(/<a class="package-snippet" href="([^"]+)">([\s\S]*?)<\/a>/g) || [];
  return matches.slice(0, 10).map(m => {
    const link = m.match(/href="([^"]+)"/)?.[1] || '';
    const name = m.match(/<span class="package-snippet__name">([^<]+)<\/span>/)?.[1] || '';
    const summary = m.match(/<span class="package-snippet__description">([^<]+)<\/span>/)?.[1] || '';
    return { name, version: '', summary, link: `https://pypi.org${link}` };
  });
}
