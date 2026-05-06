export interface ESPNNews {
  headline: string;
  sport: string;
  time: string;
  link: string;
}
export async function getESPNNews(sport: string = 'all'): Promise<ESPNNews[]> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/news?limit=5`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.articles || []).map((a: any) => ({
      headline: a.headline,
      sport: a.links?.sport || 'General',
      time: new Date(a.published).toLocaleDateString(),
      link: a.links?.web?.href || ''
    }));
  } catch (err) { return []; }
}
