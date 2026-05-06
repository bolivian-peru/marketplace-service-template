export interface DockerImage {
  name: string;
  pulls: string;
  stars: string;
  official: boolean;
  link: string;
}

export async function searchDockerHub(query: string): Promise<DockerImage[]> {
  try {
    const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=10`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error('DockerHub fetch failed');

    const data = await response.json();
    return (data.results || []).map((item: any) => ({
      name: item.repo_name || '',
      pulls: item.pull_count ? `${item.pull_count.toLocaleString()}` : '0',
      stars: item.star_count ? `${item.star_count}` : '0',
      official: item.is_official || false,
      link: `https://hub.docker.com/r/${item.repo_name}`
    }));
  } catch (e) {
    console.error("Docker Error:", e);
    return [];
  }
}
