export interface CivitAIModel {
  name: string;
  type: string;
  downloads: string;
  rating: string;
  link: string;
}
export async function searchCivitAI(query: string): Promise<CivitAIModel[]> {
  try {
    const url = `https://civitai.com/api/v1/models?query=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.items || []).map((m: any) => ({
      name: m.name,
      type: m.type,
      downloads: m.stats?.downloads?.toLocaleString() || '0',
      rating: m.stats?.rating?.toFixed(1) || '0',
      link: `https://civitai.com/models/${m.id}`
    }));
  } catch (err) { return []; }
}
