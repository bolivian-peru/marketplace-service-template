export interface HNPost {
  title: string;
  points: string;
  comments: string;
  user: string;
  link: string;
}

export async function getHackerNewsTop(): Promise<HNPost[]> {
  try {
    const url = 'https://hacker-news.firebaseio.com/v0/topstories.json';
    const idsRes = await fetch(url);
    if (!idsRes.ok) throw new Error('HN fetch failed');
    const ids: number[] = await idsRes.json();

    const results: HNPost[] = [];
    // Fetch top 10
    for (const id of ids.slice(0, 10)) {
      const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (itemRes.ok) {
        const item = await itemRes.json();
        results.push({
          title: item.title || '',
          points: `${item.score || 0}`,
          comments: `${item.descendants || 0}`,
          user: item.by || '',
          link: item.url || `https://news.ycombinator.com/item?id=${id}`
        });
      }
    }
    return results;
  } catch (e) {
    console.error("HN Error:", e);
    return [];
  }
}
