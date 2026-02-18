import { proxyFetch } from './proxy';

// ─── App Store Intelligence Scraper ───
// Apple App Store + Google Play Store

interface AppInfo {
  appId: string;
  name: string;
  developer: string;
  rating: number;
  ratingCount: number;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string;
  size: string;
  icon: string;
  url: string;
  description: string;
}

interface AppReview {
  rating: number;
  title: string;
  body: string;
  author: string;
  date: string;
}

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';

// Apple App Store uses iTunes Search API + RSS feeds
export async function getAppleRankings(category: string = 'games', country: string = 'us', limit: number = 50): Promise<AppInfo[]> {
  // Apple RSS feed for top apps
  const categoryMap: Record<string, number> = {
    'games': 6014, 'social-networking': 6005, 'entertainment': 6016, 'productivity': 6007,
    'utilities': 6002, 'health-fitness': 6013, 'education': 6017, 'finance': 6015,
    'business': 6000, 'music': 6011, 'photo-video': 6008, 'shopping': 6024,
    'food-drink': 6023, 'travel': 6003, 'news': 6009, 'weather': 6001
  };
  const genreId = categoryMap[category.toLowerCase()] || 6014;
  const feedUrl = `https://rss.applemarketingtools.com/api/v2/${country}/apps/top-free/${limit}/apps.json`;

  try {
    const resp = await proxyFetch(feedUrl, { headers: { 'User-Agent': MOBILE_UA } });
    const data = await resp.json() as any;
    const results = data?.feed?.results || [];
    return results.map((app: any, i: number) => ({
      appId: app.id || '',
      name: app.name || '',
      developer: app.artistName || '',
      rating: 0,
      ratingCount: 0,
      price: 'Free',
      inAppPurchases: true,
      category: app.genres?.[0]?.name || category,
      lastUpdated: app.releaseDate || '',
      size: '',
      icon: app.artworkUrl100 || '',
      url: app.url || `https://apps.apple.com/${country}/app/id${app.id}`,
      description: ''
    }));
  } catch { return []; }
}

export async function getAppleApp(appId: string, country: string = 'us'): Promise<AppInfo | null> {
  const lookupUrl = `https://itunes.apple.com/lookup?id=${appId}&country=${country}`;
  try {
    const resp = await proxyFetch(lookupUrl, { headers: { 'User-Agent': MOBILE_UA } });
    const data = await resp.json() as any;
    const app = data?.results?.[0];
    if (!app) return null;
    return {
      appId: String(app.trackId),
      name: app.trackName || '',
      developer: app.artistName || '',
      rating: app.averageUserRating || 0,
      ratingCount: app.userRatingCount || 0,
      price: app.formattedPrice || 'Free',
      inAppPurchases: (app.features || []).includes('iosUniversal'),
      category: app.primaryGenreName || '',
      lastUpdated: app.currentVersionReleaseDate || '',
      size: app.fileSizeBytes ? `${Math.round(parseInt(app.fileSizeBytes) / 1048576)} MB` : '',
      icon: app.artworkUrl512 || app.artworkUrl100 || '',
      url: app.trackViewUrl || '',
      description: (app.description || '').substring(0, 500)
    };
  } catch { return null; }
}

export async function searchAppleApps(query: string, country: string = 'us', limit: number = 20): Promise<AppInfo[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&media=software&limit=${limit}`;
  try {
    const resp = await proxyFetch(url, { headers: { 'User-Agent': MOBILE_UA } });
    const data = await resp.json() as any;
    return (data?.results || []).map((app: any) => ({
      appId: String(app.trackId),
      name: app.trackName || '',
      developer: app.artistName || '',
      rating: app.averageUserRating || 0,
      ratingCount: app.userRatingCount || 0,
      price: app.formattedPrice || 'Free',
      inAppPurchases: false,
      category: app.primaryGenreName || '',
      lastUpdated: app.currentVersionReleaseDate || '',
      size: app.fileSizeBytes ? `${Math.round(parseInt(app.fileSizeBytes) / 1048576)} MB` : '',
      icon: app.artworkUrl512 || '',
      url: app.trackViewUrl || '',
      description: ''
    }));
  } catch { return []; }
}

// Google Play Store scraping
export async function getPlayStoreApp(appId: string, country: string = 'us'): Promise<AppInfo | null> {
  const url = `https://play.google.com/store/apps/details?id=${appId}&hl=en&gl=${country}`;
  try {
    const resp = await proxyFetch(url, { headers: { 'User-Agent': MOBILE_UA } });
    const html = await resp.text();

    const getMatch = (pattern: RegExp) => { const m = html.match(pattern); return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''; };

    const name = getMatch(/<h1[^>]*>([^<]+)/) || getMatch(/itemprop="name"[^>]*>([^<]+)/);
    const developer = getMatch(/class="[^"]*developer[^"]*"[^>]*>([^<]+)/) || getMatch(/itemprop="author"[^>]*>.*?<span[^>]*>([^<]+)/s);
    const rating = parseFloat(getMatch(/class="[^"]*rating[^"]*"[^>]*>([\d.]+)/) || '0');
    const ratingCount = parseInt(getMatch(/([\d,]+) reviews/).replace(/,/g, '') || '0');
    const price = getMatch(/itemprop="price"[^>]*content="([^"]+)"/) || 'Free';
    const category = getMatch(/itemprop="genre"[^>]*>([^<]+)/);
    const updated = getMatch(/Updated on[^<]*<[^>]*>([^<]+)/) || getMatch(/"datePublished"\s*:\s*"([^"]+)/);
    const size = getMatch(/([\d.]+ [MG]B)/);
    const icon = getMatch(/itemprop="image"[^>]*src="([^"]+)"/) || getMatch(/class="[^"]*app-icon[^"]*"[^>]*src="([^"]+)"/);

    if (!name) return null;
    return { appId, name, developer, rating, ratingCount, price, inAppPurchases: html.includes('In-app purchases'), category, lastUpdated: updated, size, icon, url, description: '' };
  } catch { return null; }
}

export async function searchPlayStore(query: string, country: string = 'us'): Promise<AppInfo[]> {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=${country}`;
  try {
    const resp = await proxyFetch(url, { headers: { 'User-Agent': MOBILE_UA } });
    const html = await resp.text();
    const results: AppInfo[] = [];

    // Extract app cards from search results
    const appIdMatches = html.matchAll(/\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/g);
    const seenIds = new Set<string>();
    for (const m of appIdMatches) {
      if (results.length >= 20 || seenIds.has(m[1])) continue;
      seenIds.add(m[1]);
      // Extract inline info from the card
      results.push({ appId: m[1], name: '', developer: '', rating: 0, ratingCount: 0, price: 'Free', inAppPurchases: false, category: '', lastUpdated: '', size: '', icon: '', url: `https://play.google.com/store/apps/details?id=${m[1]}`, description: '' });
    }
    return results;
  } catch { return []; }
}

export async function getAppleReviews(appId: string, country: string = 'us'): Promise<AppReview[]> {
  const url = `https://itunes.apple.com/rss/customerreviews/id=${appId}/sortby=mostrecent/json?l=en&cc=${country}`;
  try {
    const resp = await proxyFetch(url, { headers: { 'User-Agent': MOBILE_UA } });
    const data = await resp.json() as any;
    const entries = data?.feed?.entry || [];
    return entries.filter((e: any) => e['im:rating']).map((e: any) => ({
      rating: parseInt(e['im:rating']?.label || '0'),
      title: e.title?.label || '',
      body: (e.content?.label || '').substring(0, 500),
      author: e.author?.name?.label || '',
      date: e.updated?.label || ''
    }));
  } catch { return []; }
}
