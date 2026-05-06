export interface HFModel {
  id: string;
  downloads: string;
  likes: string;
  pipeline: string;
  link: string;
}
export async function searchHuggingFace(query: string): Promise<HFModel[]> {
  try {
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    const data = await res.json();
    return data.map((m: any) => ({
      id: m.modelId,
      downloads: m.downloads.toLocaleString(),
      likes: m.likes.toLocaleString(),
      pipeline: m.pipeline_tag || 'N/A',
      link: `https://huggingface.co/${m.modelId}`
    }));
  } catch (err) { return []; }
}
