export interface DockerImage {
  name: string;
  pulls: string;
  stars: string;
  official: boolean;
  link: string;
}
export async function searchDockerHub(query: string): Promise<DockerImage[]> {
  const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=10`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.results || []).map((r: any) => ({
    name: r.repo_name, pulls: r.pull_count, stars: r.star_count, official: r.is_official,
    link: `https://hub.docker.com/r/${r.repo_name}`
  }));
}
