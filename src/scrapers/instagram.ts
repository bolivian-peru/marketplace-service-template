import { proxyFetch } from '../proxy';

export async function scrapeInstagramProfile(username: string) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 214.0.0.27.120',
      'X-IG-App-ID': '936619743392459',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  if (!res.ok) {
    throw new Error(`Instagram profile fetch failed: ${res.status}`);
  }

  const data = await res.json() as any;
  if (!data?.data?.user) {
    throw new Error('User not found in Instagram response');
  }

  return data.data.user;
}

export async function searchInstagram(query: string) {
  const url = `https://www.instagram.com/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}`;
  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 214.0.0.27.120',
      'Accept': 'application/json',
    }
  });

  if (!res.ok) return [];
  const data = await res.json() as any;
  return data.users?.map((u: any) => u.user) || [];
}
