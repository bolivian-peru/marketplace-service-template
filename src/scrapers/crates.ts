export interface CratesCrate {
  name: string;
  description: string;
  downloads: string;
  link: string;
}
export async function searchCrates(query: string): Promise<CratesCrate[]> {
  const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=10`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.crates || []).map((c: any) => ({
    name: c.name, description: c.description, downloads: c.downloads.toString(),
    link: `https://crates.io/crates/${c.name}`
  }));
}
