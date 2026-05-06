export interface NPMPackage {
  name: string;
  description: string;
  version: string;
  downloads: string;
  link: string;
}

export async function searchNPM(query: string): Promise<NPMPackage[]> {
  try {
    // Using a search endpoint
    const searchUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`;
    const response = await fetch(searchUrl);
    if (!response.ok) throw new Error('NPM fetch failed');
    
    const data = await response.json();
    return (data.objects || []).map((item: any) => ({
      name: item.package.name,
      description: item.package.description || '',
      version: item.package.version,
      downloads: 'N/A',
      link: `https://npmjs.com/package/${item.package.name}`
    }));
  } catch (e) {
    console.error("NPM Error:", e);
    return [];
  }
}
