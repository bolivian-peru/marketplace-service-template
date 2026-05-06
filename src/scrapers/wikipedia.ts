export interface WikiResult {
  title: string;
  extract: string;
  url: string;
  thumbnail?: string;
}

export async function searchWikipedia(query: string): Promise<WikiResult[]> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return [{
      title: data.title,
      extract: data.extract,
      url: data.content_urls?.desktop?.page || '',
      thumbnail: data.thumbnail?.source
    }];
  } catch (e) {
    console.error("Wiki Error:", e);
    return [];
  }
}
